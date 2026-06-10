const fs = require("node:fs");
const fsPromises = require("node:fs").promises;
const path = require("node:path");
const { thumbnailForFile } = require("./fileService");
const syncService = require("./syncService");

const SYSTEM_FILES = new Set(["thumbs.db", ".ds_store"]);

function cleanName(value) {
  return String(value || "")
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalize(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .trim();
}

function clientRoot(config) {
  return path.resolve(config.financialClientRoot || "Z:\\2 - ARMAZEM FESTAS E EVENTOS");
}

function organizedRoot(config) {
  return path.resolve(config.panel50OrganizedRoot || "X:\\1 - TEMAS ORGANIZADOS");
}

function parseClientFolder(folderPath) {
  const name = path.basename(folderPath);
  const match = name.match(/^(\d+)\s*-\s*(.+)$/);
  return {
    code: match ? match[1] : "",
    name: match ? match[2].trim() : name,
    label: name,
    path: folderPath,
  };
}

function listClients(config) {
  const root = clientRoot(config);
  if (!fs.existsSync(root)) return [];
  return fs.readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => parseClientFolder(path.join(root, entry.name)))
    .filter((client) => client.code || client.name)
    .sort((a, b) => Number(a.code || 0) - Number(b.code || 0) || a.name.localeCompare(b.name, "pt-BR"));
}

function findClient(config, query) {
  const term = normalize(query);
  if (!term) return null;
  return listClients(config).find((client) => {
    return normalize(client.code) === term
      || normalize(client.label) === term
      || normalize(client.name) === term
      || normalize(client.label).includes(term);
  }) || null;
}

function createClient(config, code, name) {
  const root = clientRoot(config);
  fs.mkdirSync(root, { recursive: true });
  const cleanCode = String(code || "").trim();
  const cleanClientName = cleanName(name);
  if (!/^\d+$/.test(cleanCode)) throw new Error("Informe o código numérico do cliente.");
  if (!cleanClientName) throw new Error("Informe o nome do cliente.");
  const folder = path.join(root, `${cleanCode} - ${cleanClientName.toUpperCase()}`);
  fs.mkdirSync(folder, { recursive: true });
  return parseClientFolder(folder);
}

function resolveClient(config, query, newClientName = "") {
  const found = findClient(config, query);
  if (found) return found;
  const codeMatch = String(query || "").match(/\d+/);
  if (newClientName && codeMatch) return createClient(config, codeMatch[0], newClientName);
  throw new Error("Cliente não encontrado. Informe código e nome para criar.");
}

async function locateArtwork(config, id) {
  const wanted = String(id || "").trim();
  if (!/^\d+$/.test(wanted)) throw new Error(`Código inválido: ${id}`);
  const root = organizedRoot(config);
  if (!fs.existsSync(root)) return { id: wanted, found: false, files: [] };

  // Fast path via cache
  const cache = syncService.getCache(config);
  const themeHint = cache.artworksMap?.[wanted];
  if (typeof themeHint === "string" && themeHint !== "true") {
    const expectedPath = path.join(root, themeHint, wanted);
    if (fs.existsSync(expectedPath)) {
      const entries = fs.readdirSync(expectedPath, { withFileTypes: true });
      const files = entries
        .filter((entry) => entry.isFile() && !SYSTEM_FILES.has(entry.name.toLowerCase()))
        .map((entry) => path.join(expectedPath, entry.name));
      if (files.length > 0) {
        return {
          id: wanted,
          found: true,
          theme: themeHint,
          folder: expectedPath,
          files,
          previews: await Promise.all(files.map(async (file) => ({
            path: file,
            name: path.basename(file),
            previewUrl: await thumbnailForFile(file, path.extname(file).toLowerCase()),
            sizeBytes: fs.statSync(file).size,
          }))),
        };
      }
    }
  }

  // Fallback slow path
  const stack = [root];
  while (stack.length) {
    const current = stack.pop();
    const entries = fs.readdirSync(current, { withFileTypes: true });
    if (path.basename(current) === wanted) {
      const files = entries
        .filter((entry) => entry.isFile() && !SYSTEM_FILES.has(entry.name.toLowerCase()))
        .map((entry) => path.join(current, entry.name));
      return {
        id: wanted,
        found: files.length > 0,
        theme: path.basename(path.dirname(current)),
        folder: current,
        files,
        previews: await Promise.all(files.map(async (file) => ({
          path: file,
          name: path.basename(file),
          previewUrl: await thumbnailForFile(file, path.extname(file).toLowerCase()),
          sizeBytes: fs.statSync(file).size,
        }))),
      };
    }
    for (const entry of entries) {
      if (entry.isDirectory()) stack.push(path.join(current, entry.name));
    }
  }
  return { id: wanted, found: false, files: [] };
}

async function previewOrder(config, ids) {
  const uniqueIds = [...new Set((ids || []).map((id) => String(id).trim()).filter(Boolean))];
  return Promise.all(uniqueIds.map((id) => locateArtwork(config, id)));
}

async function copyOrder(config, payload = {}, onProgress = null) {
  const client = resolveClient(config, payload.clientQuery, payload.newClientName);
  const items = await previewOrder(config, payload.ids);
  const missing = items.filter((item) => !item.found);
  if (missing.length) throw new Error(`Arte não encontrada: ${missing.map((item) => item.id).join(", ")}`);
  
  const copied = [];
  let totalFiles = 0;
  for (const item of items) totalFiles += item.files.length;
  let copiedCount = 0;

  for (const item of items) {
    for (const source of item.files) {
      const destination = path.join(client.path, path.basename(source));
      await fsPromises.copyFile(source, destination);
      copiedCount++;
      if (onProgress) onProgress({ current: copiedCount, total: totalFiles, filename: path.basename(source) });
      copied.push({ id: item.id, source, destination, theme: item.theme });
    }
  }
  return { client, items, copied };
}

module.exports = {
  listClients,
  previewOrder,
  copyOrder,
};
