const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { dialog, nativeImage, shell } = require("electron");
const {
  readImagePhysicalSize,
  validateDimensionsForTarget,
} = require("./imageMeasurementService");

function resolveFolder(baseDir, folder) {
  if (path.isAbsolute(folder)) return folder;
  return path.join(baseDir, folder);
}

async function thumbnailForFile(fullPath, ext) {
  if (ext !== ".tif" && ext !== ".tiff") return pathToFileURL(fullPath).href;
  try {
    const image = await nativeImage.createThumbnailFromPath(fullPath, { width: 256, height: 256 });
    if (!image.isEmpty()) return image.toDataURL();
  } catch {}

  try {
    const sharp = require('sharp');
    const buffer = await sharp(fullPath).resize({ width: 120 }).jpeg().toBuffer();
    return `data:image/jpeg;base64,${buffer.toString('base64')}`;
  } catch (err) {
    try {
      const { Jimp } = require("jimp");
      const img = await Jimp.read(fullPath);
      img.resize({ w: 120 });
      return await img.getBase64("image/jpeg");
    } catch (jimpErr) {
      console.error('Erro ao gerar thumb para TIFF', fullPath, jimpErr);
    }
  }

  const name = path.basename(fullPath).replace(/[&<>"']/g, "");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="160" height="160" viewBox="0 0 160 160"><rect width="160" height="160" rx="18" fill="#161619"/><rect x="20" y="20" width="120" height="120" rx="14" fill="#222226" stroke="#3a3a40"/><text x="80" y="72" text-anchor="middle" font-family="Arial,sans-serif" font-size="28" font-weight="700" fill="#f5f5f7">TIFF</text><text x="80" y="96" text-anchor="middle" font-family="Arial,sans-serif" font-size="11" fill="#a1a1a6">arquivo de imagem</text><text x="80" y="118" text-anchor="middle" font-family="Arial,sans-serif" font-size="9" fill="#6e6e73">${name.slice(0, 18)}</text></svg>`;
  return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`;
}

async function listCandidateImages(baseDir, config) {
  const extensions = new Set([...(config.acceptedExtensions || []), ".jpg", ".jpeg", ".jpe", ".png", ".webp", ".tif", ".tiff"].map((ext) => ext.toLowerCase()));
  const folders = config.localImageFolders?.length ? config.localImageFolders : ["imagens"];
  const files = [];
  const seen = new Set();

  const filePromises = [];
  for (const folder of folders) {
    const fullFolder = resolveFolder(baseDir, folder);
    if (!fs.existsSync(fullFolder)) continue;

    for (const entry of fs.readdirSync(fullFolder, { withFileTypes: true })) {
      if (!entry.isFile()) continue;
      const fullPath = path.join(fullFolder, entry.name);
      const ext = path.extname(entry.name).toLowerCase();
      if (!extensions.has(ext)) continue;
      if (seen.has(fullPath.toLowerCase())) continue;

      seen.add(fullPath.toLowerCase());
      const stat = fs.statSync(fullPath);

      filePromises.push((async () => {
        const dimensions = await readImagePhysicalSize(fullPath);

        const previewUrl = await thumbnailForFile(fullPath, ext);

        return {
          path: fullPath,
          name: entry.name,
          folder: fullFolder,
          extension: ext,
          previewUrl,
          originalUrl: pathToFileURL(fullPath).href,
          sizeBytes: stat.size,
          dimensions,
        };
      })());
    }
  }

  const results = await Promise.all(filePromises);
  files.push(...results);

  return files.sort((a, b) => a.name.localeCompare(b.name));
}

function filterCandidateImagesByTarget(files, target) {
  if (!target) return { files, rejected: [], total: files.length };
  const accepted = [];
  const rejected = [];
  for (const file of files) {
    const validation = validateDimensionsForTarget(file.dimensions, target);
    if (validation.valid) {
      accepted.push(file);
    } else {
      rejected.push({
        name: file.name,
        path: file.path,
        reason: validation.reason,
        actualSize: validation.actualSize,
        expectedSize: validation.expectedSize,
        dimensions: file.dimensions,
      });
    }
  }
  return { files: accepted, rejected, total: files.length };
}

async function chooseImageFolder(window) {
  const result = await dialog.showOpenDialog(window, {
    title: "Selecionar pasta de imagens",
    properties: ["openDirectory"],
  });
  if (result.canceled || !result.filePaths.length) return null;
  return result.filePaths[0];
}

async function chooseMockupFile(window) {
  const result = await dialog.showOpenDialog(window, {
    title: "Selecionar mockup do Photoshop",
    properties: ["openFile"],
    filters: [{ name: "Photoshop", extensions: ["psb", "psd"] }],
  });
  if (result.canceled || !result.filePaths.length) return null;
  return result.filePaths[0];
}

function isSystemEntry(name = "") {
  return ["thumbs.db", ".ds_store"].includes(String(name).toLowerCase());
}

function containsArtworkId(value, id) {
  const text = String(value || "");
  const target = String(id || "").trim();
  if (!target) return false;
  const escaped = target.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|\\D)${escaped}(?!\\d)`).test(text);
}

function findFolderByArtworkId(rootFolder, id) {
  const root = String(rootFolder || "").trim();
  const target = String(id || "").trim();
  if (!root) throw new Error("Pasta local não configurada.");
  if (!fs.existsSync(root)) throw new Error(`Pasta não encontrada: ${root}`);
  if (!target) throw new Error("ID da arte não informado.");

  const queue = [root];
  let fallback = "";
  let inspected = 0;
  while (queue.length && inspected < 5000) {
    const current = queue.shift();
    inspected += 1;
    let entries = [];
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (!entry.isDirectory() || isSystemEntry(entry.name)) continue;
      const fullPath = path.join(current, entry.name);
      if (entry.name === target) return fullPath;
      if (!fallback && containsArtworkId(entry.name, target)) fallback = fullPath;
      queue.push(fullPath);
    }
  }
  if (fallback) return fallback;
  throw new Error(`Não encontrei pasta para o ID ${target}.`);
}

async function openArtworkFolder(config, type, id) {
  const root = type === "drive-local" ? config.panel50DriveLocalRoot : config.panel50OrganizedRoot;
  const folder = findFolderByArtworkId(root, id);
  const result = await shell.openPath(folder);
  if (result) throw new Error(result);
  return { ok: true, folder };
}

async function findLocalBackupImages(config, id, theme) {
  const root = String(config.panel50DriveLocalRoot || "X:\\2 - DRIVE").trim();
  if (!fs.existsSync(root)) throw new Error(`Diretório raiz não encontrado: ${root}`);

  const targetId = String(id || "").trim();
  const targetTheme = String(theme || "").trim();
  if (!targetId) throw new Error("ID não informado.");

  const compareStr = (a, b) => String(a || "").trim().toLowerCase() === String(b || "").trim().toLowerCase();
  
  let idFolder = null;

  // Tentativa rápida (caminho direto clássico)
  const quickPath = path.join(root, targetTheme, targetId);
  if (fs.existsSync(quickPath)) {
    try {
      if (fs.statSync(quickPath).isDirectory()) idFolder = quickPath;
    } catch(e) {}
  }

  // Fallback: Busca em largura (BFS) limitando profundidade
  // Isso resolve casos onde a arte está em sub-sub-pastas (ex: PRINCESAS/ARIEL/131)
  if (!idFolder) {
    const maxDepth = 3; 
    let queue = [{ dir: root, depth: 0 }];
    
    while (queue.length > 0) {
      const current = queue.shift();
      
      const targetPath = path.join(current.dir, targetId);
      if (fs.existsSync(targetPath)) {
        try {
          if (fs.statSync(targetPath).isDirectory()) {
            idFolder = targetPath;
            break;
          }
        } catch (e) {}
      }
      
      if (current.depth < maxDepth) {
        try {
          const entries = fs.readdirSync(current.dir, { withFileTypes: true });
          for (const entry of entries) {
            if (entry.isDirectory() && !isSystemEntry(entry.name)) {
               queue.push({ dir: path.join(current.dir, entry.name), depth: current.depth + 1 });
            }
          }
        } catch (e) {}
      }
    }
  }

  if (!idFolder) {
    throw new Error(`Pasta da arte não encontrada no backup local (ID: ${targetId}).`);
  }

  const extensions = new Set([".jpg", ".jpeg", ".jpe", ".png", ".webp", ".tif", ".tiff"]);
  const files = [];
  
  for (const entry of fs.readdirSync(idFolder, { withFileTypes: true })) {
    if (!entry.isFile() || isSystemEntry(entry.name)) continue;
    const ext = path.extname(entry.name).toLowerCase();
    if (!extensions.has(ext)) continue;

    const fullPath = path.join(idFolder, entry.name);
    const previewUrl = await thumbnailForFile(fullPath, ext);
    
    files.push({
      path: fullPath,
      name: entry.name,
      extension: ext,
      previewUrl,
    });
  }

  return files;
}

module.exports = {
  listCandidateImages,
  filterCandidateImagesByTarget,
  chooseImageFolder,
  chooseMockupFile,
  thumbnailForFile,
  containsArtworkId,
  findFolderByArtworkId,
  openArtworkFolder,
  findLocalBackupImages,
};
