const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const crypto = require("node:crypto");
const { app, shell } = require("electron");
const { google } = require("googleapis");
const { buildArtworkFilename, normalizeText, normalizeDimension } = require("../shared/rules");
const { containsArtworkId, findFolderByArtworkId } = require("./fileService");

const DRIVE_SCOPE = "https://www.googleapis.com/auth/drive";

function requiredScopes() {
  return [DRIVE_SCOPE];
}

function userDataDir() {
  return typeof app?.getPath === "function" ? app.getPath("userData") : process.cwd();
}

function fixedDataDir(config) {
  const preferred = config.fixedDataFolder || "C:\\BancoDeArtes";
  try {
    fs.mkdirSync(preferred, { recursive: true });
    return preferred;
  } catch {
    return userDataDir();
  }
}

function googleDataDir(config) {
  const dir = path.join(fixedDataDir(config), "google");
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function tokenPath(config) {
  return path.join(googleDataDir(config), "token.json");
}

function managedCredentialsPath(config) {
  return path.join(googleDataDir(config), "credentials.json");
}

function copyLegacyCredentialsIfNeeded(config, appRoot) {
  const target = managedCredentialsPath(config);
  if (fs.existsSync(target)) return target;
  const legacy = path.join(appRoot, "credentials.json");
  if (fs.existsSync(legacy)) {
    fs.copyFileSync(legacy, target);
    return target;
  }
  return target;
}

function credentialsPath(config, appRoot) {
  if (config.credentialsPath && fs.existsSync(config.credentialsPath)) return config.credentialsPath;
  return copyLegacyCredentialsIfNeeded(config, appRoot);
}

function readCredentials(config, appRoot) {
  const file = credentialsPath(config, appRoot);
  if (!fs.existsSync(file)) throw new Error("Credenciais Google não encontradas. Configure um arquivo credentials.json.");
  const data = JSON.parse(fs.readFileSync(file, "utf8"));
  const client = data.installed || data.web;
  if (!client?.client_id || !client?.client_secret) throw new Error("Arquivo de credenciais Google inválido.");
  return client;
}

function createOAuthClient(config, appRoot, redirectUri = "http://127.0.0.1") {
  const client = readCredentials(config, appRoot);
  return new google.auth.OAuth2(client.client_id, client.client_secret, redirectUri);
}

function loadTokenFromPath(auth, file) {
  if (!fs.existsSync(file)) return false;
  auth.setCredentials(JSON.parse(fs.readFileSync(file, "utf8")));
  return true;
}

async function getAuth(config, appRoot) {
  const auth = createOAuthClient(config, appRoot);
  if (!loadTokenFromPath(auth, tokenPath(config))) {
    const legacyToken = path.join(appRoot, "token.json");
    if (fs.existsSync(legacyToken)) {
      fs.copyFileSync(legacyToken, tokenPath(config));
      loadTokenFromPath(auth, tokenPath(config));
    }
    const archivedToken = path.join(appRoot, "pode apagar", "token.json");
    if (!auth.credentials?.refresh_token && fs.existsSync(archivedToken)) {
      fs.copyFileSync(archivedToken, tokenPath(config));
      loadTokenFromPath(auth, tokenPath(config));
    }
  }
  return auth;
}

async function authStatus(config, appRoot) {
  try {
    const auth = await getAuth(config, appRoot);
    const hasToken = Boolean(auth.credentials?.access_token || auth.credentials?.refresh_token);
    if (!hasToken) {
      return {
        ok: false,
        authenticated: false,
        message: "Token não encontrado",
        tokenPath: tokenPath(config),
        credentialsPath: credentialsPath(config, appRoot),
      };
    }
    const drive = google.drive({ version: "v3", auth });
    await drive.files.list({ pageSize: 1, fields: "files(id)" });
    const scopes = tokenScopes(config);
    return {
      ok: true,
      authenticated: true,
      email: "",
      message: "Autenticado",
      scopes,
      missingScopes: requiredScopes().filter((scope) => !scopes.includes(scope)),
      tokenPath: tokenPath(config),
      credentialsPath: credentialsPath(config, appRoot),
    };
  } catch (error) {
    return {
      ok: false,
      authenticated: false,
      message: error.message,
      tokenPath: tokenPath(config),
      credentialsPath: credentialsPath(config, appRoot),
    };
  }
}

function tokenScopes(config) {
  try {
    const token = JSON.parse(fs.readFileSync(tokenPath(config), "utf8"));
    const value = token.scope || token.scopes || "";
    return Array.isArray(value) ? value : String(value).split(/\s+/).filter(Boolean);
  } catch {
    return [];
  }
}

async function authenticate(config, appRoot) {
  const redirectUri = await startOAuthServer(config, appRoot);
  const auth = createOAuthClient(config, appRoot, redirectUri.url);
  const url = auth.generateAuthUrl({
    access_type: "offline",
    scope: requiredScopes(),
    prompt: "consent",
  });
  await shell.openExternal(url);
  const code = await redirectUri.waitForCode;
  const { tokens } = await auth.getToken(code);
  fs.writeFileSync(tokenPath(config), JSON.stringify(tokens, null, 2), "utf8");
  return authStatus(config, appRoot);
}

function startOAuthServer() {
  let server;
  const waitForCode = new Promise((resolve, reject) => {
    server = http.createServer((req, res) => {
      try {
        const url = new URL(req.url, "http://127.0.0.1");
        const code = url.searchParams.get("code");
        if (!code) throw new Error("Código OAuth não encontrado.");
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end("<h1>Google conectado.</h1><p>Pode voltar ao Banco de Artes.</p>");
        resolve(code);
        server.close();
      } catch (error) {
        res.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" });
        res.end(error.message);
        reject(error);
        server.close();
      }
    });
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      resolve({ url: `http://127.0.0.1:${port}`, waitForCode });
    });
  });
}

async function services(config, appRoot) {
  const auth = await getAuth(config, appRoot);
  return {
    drive: google.drive({ version: "v3", auth }),
  };
}

async function provision(config, appRoot) {
  const { drive } = await services(config, appRoot);
  const driveFolderId = await findOrCreateFolder(drive, config.driveFolderName || "Banco de Artes");
  return { config, driveFolderId };
}

async function testConnectivity(config, appRoot) {
  const checks = [];
  const push = (label, ok, detail) => checks.push({ label, ok, detail: String(detail || "") });
  const auth = await authStatus(config, appRoot).catch((error) => ({ authenticated: false, message: error.message }));
  push("Token Google", Boolean(auth.authenticated), auth.authenticated ? "Token encontrado e legível." : auth.message);
  if (!auth.authenticated) return { ok: false, checks };

  const { drive } = await services(config, appRoot);
  try {
    await drive.files.list({ pageSize: 1, fields: "files(id,name)" });
    push("Drive", true, "API do Drive respondeu.");
  } catch (error) {
    push("Drive", false, error.message);
  }

  try {
    const folderName = config.driveFolderName || "Banco de Artes";
    const folder = await drive.files.list({
      q: `name = '${escapeQuery(folderName)}' and mimeType = 'application/vnd.google-apps.folder' and trashed = false`,
      fields: "files(id,name)",
      pageSize: 1,
    });
    push("Pasta raiz", Boolean(folder.data.files?.[0]), folder.data.files?.[0]?.name || "Será criada no primeiro uso.");
  } catch (error) {
    push("Pasta raiz", false, error.message);
  }

  return { ok: checks.every((item) => item.ok), checks };
}

async function dashboardData() {
  return { totalArtworks: 0, nextId: 1, topTheme: ["-", 0], byUser: [], byTheme: [] };
}

async function listArtworks() {
  return [];
}

async function nextAvailableArtworkIds(_config, _appRoot, count) {
  return Array.from({ length: Number(count) || 0 }, (_, index) => String(index + 1));
}

async function updateArtwork() {
  throw new Error("A base oficial de artes é o Supabase.");
}

async function deleteArtwork() {
  throw new Error("A base oficial de artes é o Supabase.");
}

async function refreshArtworkUrlFromDrive(config, appRoot, payload = {}, options = {}) {
  const { drive } = await services(config, appRoot);
  const id = String(payload.id || "").trim();
  const art = {
    id,
    theme: normalizeText(payload.theme || ""),
    product: normalizeText(payload.product || ""),
    size: normalizeDimension(payload.size || ""),
    client: normalizeText(payload.client || ""),
    user: normalizeText(payload.user || ""),
    phone: payload.phone || "",
    date: payload.date || "",
  };

  const rootFolderId = await findOrCreateFolder(drive, config.driveFolderName || "Banco de Artes");
  const themeFolderId = await getThemeFolderId(config, drive, rootFolderId, art.theme || "Sem tema");
  let found = await findDriveImageByArtworkId(drive, themeFolderId, id);
  if (!found) {
    const themeFolders = await listThemeFolders(drive, rootFolderId).catch(() => []);
    for (const folder of themeFolders) {
      if (folder.id === themeFolderId) continue;
      found = await findDriveImageByArtworkId(drive, folder.id, id).catch(() => null);
      if (found) break;
    }
  }

  let uploaded = false;
  if (!found && !payload.allowUpload) {
    return { ok: false, needsUpload: true, id, message: `A arte ${id} ainda não tem imagem no Drive.` };
  }

  if (!found) {
    const localFile = findLocalArtworkFile(config, id);
    const fileName = buildArtworkFilename({
      id,
      theme: art.theme,
      product: art.product,
      size: art.size,
      extension: path.extname(localFile) || ".jpg",
    });
    const result = await drive.files.create({
      requestBody: { name: fileName, parents: [themeFolderId] },
      media: { mimeType: mimeTypeForFile(localFile), body: fs.createReadStream(localFile) },
      fields: "id,name,webViewLink,webContentLink",
    });
    if (config.publicDriveUploads) {
      await drive.permissions.create({
        fileId: result.data.id,
        requestBody: { type: "anyone", role: "reader" },
      }).catch(() => null);
    }
    found = result.data;
    uploaded = true;
  }

  const url = found.webViewLink || found.webContentLink || `https://drive.google.com/file/d/${found.id}/view`;
  const updated = typeof options.persistArtwork === "function"
    ? await options.persistArtwork({ ...art, url, drive_url: url, driveFileId: found.id, fileName: found.name })
    : { ...art, url };
  return { ok: true, uploaded, file: found, ...updated, url };
}

async function uploadBatch(config, appRoot, rows, onProgress = () => {}, options = {}) {
  if (config.maintenanceMode) throw new Error("Sistema em manutenção. Upload bloqueado temporariamente.");
  if (typeof options.persistArtwork !== "function") throw new Error("Upload oficial precisa gravar no Supabase.");
  if (typeof options.usedArtworkIds !== "function") throw new Error("Upload oficial precisa checar IDs no Supabase.");

  const startedAt = Date.now();
  const progress = (phase, current = 0, total = rows.length, detail = "") => {
    const elapsedMs = Date.now() - startedAt;
    const done = Math.max(0, current);
    const etaMs = done > 0 && total > done ? Math.round((elapsedMs / done) * (total - done)) : 0;
    onProgress({ phase, current: done, total, detail, elapsedMs, etaMs });
  };

  const { drive } = await services(config, appRoot);
  progress("Preparando conexão", 0, rows.length, "Validando Drive e Supabase.");
  const rootFolderId = await findOrCreateFolder(drive, config.driveFolderName || "Banco de Artes");

  let token = crypto.randomUUID();
  let externalLock = null;
  if (typeof options.acquireGlobalLock === "function") {
    progress("Aguardando lock", 0, rows.length, "Reservando execução global no Supabase.");
    externalLock = await options.acquireGlobalLock();
    token = externalLock?.token || externalLock?.id || token;
  }
  createLocalLock(config, config.operatorName, token);

  const successes = [];
  const failures = [];
  try {
    progress("Checando IDs", 0, rows.length, "Confirmando IDs livres no Supabase.");
    const liveIds = await options.usedArtworkIds();
    for (const row of rows) {
      const rowId = String(row.id || "").trim();
      if (rowId && liveIds.has(rowId)) throw new Error(`Conflito: O ID ${rowId} já existe no Supabase.`);
    }

    for (const row of rows) {
      try {
        progress("Enviando arquivos", successes.length + failures.length, rows.length, row.fileName || `ID ${row.id}`);
        const normalized = normalizeArtworkRow(row);
        const themeFolderId = await getThemeFolderId(config, drive, rootFolderId, normalized.theme);
        const fileName = buildArtworkFilename({
          id: normalized.id,
          theme: normalized.theme,
          product: normalized.product,
          size: normalized.size,
          extension: path.extname(row.fileName || row.path || ".jpg") || ".jpg",
        });
        const uploaded = await drive.files.create({
          requestBody: { name: fileName, parents: [themeFolderId] },
          media: { mimeType: mimeTypeForFile(row.path || row.fileName), body: fs.createReadStream(row.path) },
          fields: "id,webViewLink,webContentLink",
        });
        if (config.publicDriveUploads) {
          await drive.permissions.create({
            fileId: uploaded.data.id,
            requestBody: { type: "anyone", role: "reader" },
          }).catch(() => null);
        }
        const url = uploaded.data.webViewLink || uploaded.data.webContentLink || `https://drive.google.com/file/d/${uploaded.data.id}/view`;
        successes.push({ ...row, ...normalized, url, fileName, driveFileId: uploaded.data.id });
        incrementThemeCache(config, normalized.theme);
        progress("Enviando arquivos", successes.length + failures.length, rows.length, `${fileName} enviado.`);
      } catch (error) {
        failures.push({ ...row, error: error.message });
        progress("Falha em arquivo", successes.length + failures.length, rows.length, `${row.fileName || row.id}: ${error.message}`);
      }
    }

    if (successes.length) {
      try {
        progress("Salvando Supabase", rows.length, rows.length, "Gravando artes no Supabase.");
        for (const row of successes) {
          await options.persistArtwork({ ...row, user: config.operatorName || "Operador" });
        }
      } catch (supabaseError) {
        progress("Revertendo Drive", rows.length, rows.length, "O Supabase falhou. Removendo arquivos enviados.");
        for (const succ of successes) {
          if (succ.driveFileId) await drive.files.delete({ fileId: succ.driveFileId }).catch(() => null);
        }
        throw new Error("Falha ao salvar no Supabase. Os arquivos do Drive foram revertidos. Erro: " + supabaseError.message);
      }
    }
    progress("Concluído", rows.length, rows.length, `${successes.length} enviadas, ${failures.length} falhas.`);
  } finally {
    releaseLocalLock(config, token);
    if (externalLock && typeof options.releaseGlobalLock === "function") {
      await options.releaseGlobalLock(externalLock).catch(() => null);
    }
  }

  return { successes, failures };
}

function normalizeArtworkRow(row) {
  return {
    id: String(row.id || "").trim(),
    theme: normalizeText(row.theme),
    product: normalizeText(row.product),
    size: normalizeDimension(row.size),
    client: normalizeText(row.client),
    phone: String(row.phone || "").trim(),
  };
}

function mimeTypeForFile(filePath = "") {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".png") return "image/png";
  if (ext === ".webp") return "image/webp";
  if (ext === ".tif" || ext === ".tiff") return "image/tiff";
  return "image/jpeg";
}

function driveFolderCachePath(config) {
  return path.join(fixedDataDir(config), "drive-folder-cache.json");
}

function readDriveFolderCache(config) {
  const file = driveFolderCachePath(config);
  if (!fs.existsSync(file)) return { rootFolderId: "", themes: {}, lastSync: null };
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return { rootFolderId: "", themes: {}, lastSync: null };
  }
}

function writeDriveFolderCache(config, cache) {
  fs.writeFileSync(driveFolderCachePath(config), JSON.stringify({
    rootFolderId: cache.rootFolderId || "",
    themes: cache.themes || {},
    lastSync: new Date().toISOString(),
  }, null, 2), "utf8");
  return cache;
}

function folderKey(name) {
  return normalizeText(name || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/\s+/g, " ")
    .trim();
}

function incrementThemeCache(config, theme) {
  const folderCache = readDriveFolderCache(config);
  const key = folderKey(theme);
  if (folderCache.themes?.[key]) {
    folderCache.themes[key].imageCount = Number(folderCache.themes[key].imageCount || 0) + 1;
    writeDriveFolderCache(config, folderCache);
  }
}

async function findOrCreateFolder(drive, name, parentId = null) {
  const parentQuery = parentId ? ` and '${parentId}' in parents` : "";
  const result = await drive.files.list({
    q: `name = '${escapeQuery(name)}' and mimeType = 'application/vnd.google-apps.folder' and trashed = false${parentQuery}`,
    fields: "files(id,name,webViewLink)",
    pageSize: 1,
  });
  if (result.data.files?.[0]) return result.data.files[0].id;
  const created = await drive.files.create({
    requestBody: {
      name,
      mimeType: "application/vnd.google-apps.folder",
      parents: parentId ? [parentId] : undefined,
    },
    fields: "id",
  });
  return created.data.id;
}

async function listThemeFolders(drive, rootFolderId) {
  const folders = [];
  let pageToken = "";
  do {
    const result = await drive.files.list({
      q: `'${rootFolderId}' in parents and mimeType = 'application/vnd.google-apps.folder' and trashed = false`,
      fields: "nextPageToken,files(id,name,webViewLink)",
      pageSize: 1000,
      pageToken: pageToken || undefined,
    });
    folders.push(...(result.data.files || []));
    pageToken = result.data.nextPageToken || "";
  } while (pageToken);
  return folders;
}

async function countImagesInFolder(drive, folderId) {
  let count = 0;
  let pageToken = "";
  do {
    const result = await drive.files.list({
      q: `'${folderId}' in parents and trashed = false and (mimeType contains 'image/' or name contains '.jpg' or name contains '.png' or name contains '.webp' or name contains '.tif')`,
      fields: "nextPageToken,files(id)",
      pageSize: 1000,
      pageToken: pageToken || undefined,
    });
    count += (result.data.files || []).length;
    pageToken = result.data.nextPageToken || "";
  } while (pageToken);
  return count;
}

async function syncThemeFolderCache(config, drive, rootFolderId) {
  const themes = {};
  const folders = await listThemeFolders(drive, rootFolderId);
  for (const folder of folders) {
    const key = folderKey(folder.name);
    themes[key] = {
      id: folder.id,
      name: folder.name,
      url: folder.webViewLink || driveFolderUrl(folder.id),
      imageCount: await countImagesInFolder(drive, folder.id).catch(() => 0),
      lastSync: new Date().toISOString(),
    };
  }
  return writeDriveFolderCache(config, {
    rootFolderId,
    themes,
    lastSync: new Date().toISOString(),
  });
}

async function getThemeFolderId(config, drive, rootFolderId, themeName) {
  const cache = readDriveFolderCache(config);
  const key = folderKey(themeName);
  if (cache.rootFolderId === rootFolderId && cache.themes?.[key]?.id) return cache.themes[key].id;
  const id = await findOrCreateFolder(drive, themeName || "SEM TEMA", rootFolderId);
  cache.rootFolderId = rootFolderId;
  cache.themes = cache.themes || {};
  cache.themes[key] = {
    id,
    name: themeName || "SEM TEMA",
    url: driveFolderUrl(id),
    imageCount: Number(cache.themes[key]?.imageCount || 0),
    lastSync: new Date().toISOString(),
  };
  writeDriveFolderCache(config, cache);
  return id;
}

async function listDriveThemeFolders(config, appRoot, refresh = false) {
  const cache = readDriveFolderCache(config);
  if (!refresh && cache.rootFolderId && cache.themes) return driveFolderPayload(config, cache);
  const { drive } = await services(config, appRoot);
  const rootFolderId = await findOrCreateFolder(drive, config.driveFolderName || "Banco de Artes");
  const next = await syncThemeFolderCache(config, drive, rootFolderId);
  return driveFolderPayload(config, next);
}

function driveFolderPayload(config, cache) {
  const folders = Object.values(cache.themes || {}).sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
  return {
    rootFolderId: cache.rootFolderId || "",
    rootFolderName: config.driveFolderName || "Banco de Artes",
    rootUrl: cache.rootFolderId ? driveFolderUrl(cache.rootFolderId) : "",
    lastSync: cache.lastSync || "",
    folders,
  };
}

function driveFolderUrl(folderId) {
  return folderId ? `https://drive.google.com/drive/folders/${folderId}` : "";
}

async function findDriveImageByArtworkId(drive, folderId, id) {
  const result = await drive.files.list({
    q: `'${folderId}' in parents and trashed = false`,
    spaces: "drive",
    fields: "files(id,name,webViewLink,webContentLink,mimeType)",
    pageSize: 1000,
  });
  const files = result.data.files || [];
  return files.find((file) => {
    const name = String(file.name || "");
    const ext = path.extname(name);
    const stem = path.basename(name, ext);
    return stem === String(id) || stem.startsWith(`${id}_`) || containsArtworkId(stem, id);
  }) || null;
}

function findLocalArtworkFile(config, id) {
  const roots = [
    ...(config.localImageFolders || []),
    config.panel50DriveLocalRoot,
    config.panel50OrganizedRoot,
  ].filter(Boolean);
  const extensions = new Set(config.acceptedExtensions || [".jpg", ".jpeg", ".png", ".webp", ".tif", ".tiff"]);
  let fallback = "";
  for (const root of roots) {
    const direct = findFolderByArtworkId(root, id);
    const searchRoot = direct || root;
    if (!fs.existsSync(searchRoot)) continue;
    const queue = [searchRoot];
    while (queue.length) {
      const current = queue.shift();
      let entries = [];
      try {
        entries = fs.readdirSync(current, { withFileTypes: true });
      } catch {
        continue;
      }
      for (const entry of entries) {
        const fullPath = path.join(current, entry.name);
        if (entry.isDirectory()) {
          queue.push(fullPath);
          continue;
        }
        const ext = path.extname(entry.name).toLowerCase();
        if (!extensions.has(ext)) continue;
        const stem = path.basename(entry.name, ext);
        if (stem === id || stem.startsWith(`${id}_`)) return fullPath;
        if (!fallback && containsArtworkId(stem, id)) fallback = fullPath;
      }
    }
  }
  if (!fallback) throw new Error(`Arquivo local da arte ${id} não encontrado.`);
  return fallback;
}

function lockPath(config) {
  return path.join(fixedDataDir(config), "operation-lock.json");
}

function createLocalLock(config, user, token) {
  const lock = {
    status: "OCUPADO",
    user,
    machine: require("node:os").hostname(),
    startedAt: new Date().toISOString(),
    token,
  };
  fs.writeFileSync(lockPath(config), JSON.stringify(lock, null, 2), "utf8");
  return lock;
}

function releaseLocalLock(config, token) {
  const current = localLockStatus(config);
  if (current.token && current.token !== token) return false;
  fs.writeFileSync(lockPath(config), JSON.stringify({ status: "LIVRE" }, null, 2), "utf8");
  return true;
}

function localLockStatus(config = {}) {
  try {
    const lock = JSON.parse(fs.readFileSync(lockPath(config), "utf8"));
    return lock.status ? lock : { status: "LIVRE" };
  } catch {
    return { status: "LIVRE" };
  }
}

function lockStatus(config) {
  return { global: { status: "LIVRE", provider: "supabase" }, local: localLockStatus(config) };
}

function escapeQuery(value) {
  return String(value).replace(/'/g, "\\'");
}

module.exports = {
  authStatus,
  authenticate,
  provision,
  uploadBatch,
  dashboardData,
  listArtworks,
  nextAvailableArtworkIds,
  updateArtwork,
  refreshArtworkUrlFromDrive,
  deleteArtwork,
  lockStatus,
  testConnectivity,
  syncThemeFolderCache,
  listDriveThemeFolders,
  findOrCreateFolder,
  copyLegacyCredentialsIfNeeded,
  tokenPath,
  credentialsPath,
  services,
};
