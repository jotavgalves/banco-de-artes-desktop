const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const crypto = require("node:crypto");
const { app, shell } = require("electron");
const { google } = require("googleapis");
const { BASE_SHEETS, OPERATIONAL_SHEETS } = require("../shared/defaults");
const { buildArtworkFilename, normalizeText, normalizeDimension } = require("../shared/rules");

const SCOPES = [
  "https://www.googleapis.com/auth/spreadsheets",
  "https://www.googleapis.com/auth/drive",
];

function userDataDir() {
  return typeof app?.getPath === "function" ? app.getPath("userData") : process.cwd();
}

function appName() {
  return typeof app?.getName === "function" ? app.getName() : "Banco de Artes";
}

function googleDir() {
  const fallback = path.join(userDataDir(), "google");
  fs.mkdirSync(fallback, { recursive: true });
  return fallback;
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
  if (!fs.existsSync(file)) {
    throw new Error("Credenciais Google não encontradas. Configure um arquivo credentials.json.");
  }
  const data = JSON.parse(fs.readFileSync(file, "utf8"));
  const client = data.installed || data.web;
  if (!client?.client_id || !client?.client_secret) {
    throw new Error("Arquivo de credenciais Google inválido.");
  }
  return client;
}

function createOAuthClient(config, appRoot, redirectUri = "http://127.0.0.1") {
  const client = readCredentials(config, appRoot);
  return new google.auth.OAuth2(client.client_id, client.client_secret, redirectUri);
}

function loadStoredToken(auth) {
  return false;
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
      missingScopes: SCOPES.filter((scope) => !scopes.includes(scope)),
      tokenPath: tokenPath(config),
      credentialsPath: credentialsPath(config, appRoot),
    };
  } catch (error) {
    return {
      ok: false,
      authenticated: false,
      message: friendlyGoogleError(error),
      scopes: tokenScopes(config),
      tokenPath: tokenPath(config),
      credentialsPath: credentialsPath(config, appRoot),
    };
  }
}

function tokenScopes(config) {
  try {
    const file = tokenPath(config);
    if (!fs.existsSync(file)) return [];
    const token = JSON.parse(fs.readFileSync(file, "utf8"));
    return token.scope ? String(token.scope).split(/\s+/) : token.scopes || [];
  } catch {
    return [];
  }
}

async function authenticate(config, appRoot) {
  const { server, port, codePromise } = await createCallbackServer();
  const redirectUri = `http://localhost:${port}`;
  const auth = createOAuthClient(config, appRoot, redirectUri);
  const url = auth.generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    scope: SCOPES,
  });

  await shell.openExternal(url);
  const code = await codePromise;
  server.close();

  const { tokens } = await auth.getToken(code);
  fs.writeFileSync(tokenPath(config), JSON.stringify(tokens, null, 2), "utf8");
  auth.setCredentials(tokens);
  return authStatus(config, appRoot);
}

function friendlyGoogleError(error) {
  const message = String(error?.message || error || "");
  if (message.includes("missing required authentication credential") || message.includes("Expected OAuth")) {
    return "Google não conectado. Clique em Conectar Google ou coloque um token.json válido na pasta fixa.";
  }
  if (message.includes("invalid_grant")) {
    return "Token Google expirado ou revogado. Apague o token antigo e conecte novamente.";
  }
  if (message.includes("redirect_uri_mismatch")) {
    return "OAuth recusado: o redirect URI do projeto Google não permite este app.";
  }
  if (message.includes("Credenciais Google")) {
    return message;
  }
  return `Falha Google: ${message}`;
}

function createCallbackServer() {
  let resolveCode;
  let rejectCode;
  const codePromise = new Promise((resolve, reject) => {
    resolveCode = resolve;
    rejectCode = reject;
  });

  const server = http.createServer((req, res) => {
    const url = new URL(req.url, "http://127.0.0.1");
    const code = url.searchParams.get("code");
    const error = url.searchParams.get("error");
    if (code) {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end("<h1>Banco de Artes autenticado.</h1><p>Você pode fechar esta janela.</p>");
      resolveCode(code);
    } else {
      res.writeHead(400, { "Content-Type": "text/html; charset=utf-8" });
      res.end("<h1>Falha na autenticação.</h1>");
      rejectCode(new Error(error || "Código OAuth não recebido."));
    }
  });

  return new Promise((resolve) => {
    server.listen(0, "localhost", () => {
      resolve({ server, port: server.address().port, codePromise });
    });
  });
}

async function services(config, appRoot) {
  const auth = await getAuth(config, appRoot);
  return {
    sheets: google.sheets({ version: "v4", auth }),
    drive: google.drive({ version: "v3", auth }),
  };
}

async function dashboardData(config, appRoot) {
  if (!config.operationalSpreadsheetId) return emptyDashboard();
  const { sheets } = await services(config, appRoot);
  const rows = await readCadastroRows(sheets, config).catch(() => []);
  if (!rows.length) return emptyDashboard();
  const byUser = {};
  const byTheme = {};
  let maxId = 0;
  for (const row of rows) {
    const id = Number(row[0]);
    if (Number.isFinite(id)) maxId = Math.max(maxId, id);
    const theme = row[1] || "SEM TEMA";
    const user = row[5] || "SEM USUARIO";
    byTheme[theme] = (byTheme[theme] || 0) + 1;
    byUser[user] = (byUser[user] || 0) + 1;
  }
  return {
    totalArtworks: rows.length,
    nextId: maxId + 1,
    topTheme: topEntry(byTheme),
    byUser: Object.entries(byUser).sort((a, b) => b[1] - a[1]),
    byTheme: Object.entries(byTheme).sort((a, b) => b[1] - a[1]),
  };
}

async function listArtworks(config, appRoot) {
  if (!config.operationalSpreadsheetId) return [];
  const { sheets } = await services(config, appRoot);
  const rows = await readCadastroRows(sheets, config).catch(() => []);
  return rows.map((row, index) => ({
    rowNumber: index + 2,
    id: row[0] || "",
    theme: row[1] || "",
    product: row[2] || "",
    size: row[3] || "",
    client: row[4] || "",
    user: row[5] || "",
    phone: row[6] || "",
    date: row[7] || "",
    url: row[8] || "",
  })).sort((a, b) => Number(b.id || 0) - Number(a.id || 0));
}

async function nextAvailableArtworkIds(config, appRoot, count, reserved = []) {
  const needed = Number(count);
  if (!Number.isInteger(needed) || needed < 1) return [];
  const used = new Set((reserved || []).map((id) => String(id).trim()).filter(Boolean));
  if (config.operationalSpreadsheetId) {
    const { sheets } = await services(config, appRoot);
    const rows = await readCadastroRows(sheets, config).catch(() => []);
    for (const row of rows) {
      const id = String(row[0] || "").trim();
      if (id) used.add(id);
    }
  }
  const ids = [];
  let next = Math.max(0, ...Array.from(used).map((id) => Number(id)).filter(Number.isFinite)) + 1;
  while (ids.length < needed) {
    const value = String(next);
    if (!used.has(value)) {
      ids.push(value);
      used.add(value);
    }
    next += 1;
  }
  return ids;
}

function mimeTypeForFile(filePath = "") {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".png") return "image/png";
  if (ext === ".webp") return "image/webp";
  if (ext === ".tif" || ext === ".tiff") return "image/tiff";
  return "image/jpeg";
}

async function updateArtwork(config, appRoot, payload) {
  if (!config.operationalSpreadsheetId) throw new Error("Planilha de artes não configurada.");
  const { sheets } = await services(config, appRoot);
  const sheetName = await resolveCadastroSheetName(sheets, config);
  const rows = await readCadastroRows(sheets, config);
  const id = String(payload.id || "").trim();
  const rowIndex = rows.findIndex((row) => String(row[0] || "").trim() === id);
  if (rowIndex < 0) throw new Error(`ID ${id} não encontrado na planilha.`);
  const current = rows[rowIndex] || [];
  const next = [
    current[0] || id,
    normalizeText(payload.theme ?? current[1] ?? ""),
    normalizeText(payload.product ?? current[2] ?? ""),
    normalizeDimension(payload.size ?? current[3] ?? ""),
    normalizeText(payload.client ?? current[4] ?? ""),
    normalizeText(payload.user ?? current[5] ?? ""),
    current[6] || "",
    current[7] || "",
    current[8] || "",
  ];
  await sheets.spreadsheets.values.update({
    spreadsheetId: config.operationalSpreadsheetId,
    range: `'${sheetName}'!A${rowIndex + 2}:I${rowIndex + 2}`,
    valueInputOption: "RAW",
    requestBody: { values: [next] },
  });
  return {
    rowNumber: rowIndex + 2,
    id: next[0],
    theme: next[1],
    product: next[2],
    size: next[3],
    client: next[4],
    user: next[5],
    phone: next[6],
    date: next[7],
    url: next[8],
  };
}

async function deleteArtwork(config, appRoot, payload) {
  if (!config.operationalSpreadsheetId) throw new Error("Planilha de artes não configurada.");
  const { sheets } = await services(config, appRoot);
  const sheetName = await resolveCadastroSheetName(sheets, config);
  const rows = await readCadastroRows(sheets, config);
  const id = String(payload.id || "").trim();
  const rowIndex = rows.findIndex((row) => String(row[0] || "").trim() === id);
  if (rowIndex < 0) throw new Error(`ID ${id} não encontrado na planilha.`);
  const sheet = await sheetIdByName(sheets, config.operationalSpreadsheetId, sheetName);
  if (!sheet?.sheetId && sheet?.sheetId !== 0) throw new Error("Não consegui localizar a aba para excluir.");
  await sheets.spreadsheets.batchUpdate({
    spreadsheetId: config.operationalSpreadsheetId,
    requestBody: {
      requests: [{
        deleteDimension: {
          range: {
            sheetId: sheet.sheetId,
            dimension: "ROWS",
            startIndex: rowIndex + 1,
            endIndex: rowIndex + 2,
          },
        },
      }],
    },
  });
  return { ok: true, id, rowNumber: rowIndex + 2 };
}

async function lockStatus(config, appRoot) {
  if (!config.baseSpreadsheetId) return { global: { status: "SEM BASE" }, local: localLockStatus(config) };
  const { sheets } = await services(config, appRoot);
  const row = await sheets.spreadsheets.values.get({
    spreadsheetId: config.baseSpreadsheetId,
    range: `'${BASE_SHEETS.execution.name}'!A2:F2`,
  }).catch(() => ({ data: {} }));
  const value = row.data.values?.[0] || [];
  return {
    global: {
      status: value[0] || "LIVRE",
      user: value[1] || "",
      machine: value[2] || "",
      startedAt: value[3] || "",
      token: value[4] || "",
      note: value[5] || "",
    },
    local: localLockStatus(config),
  };
}

function localLockStatus(config = {}) {
  const file = path.join(fixedDataDir(config), "local-lock.json");
  if (!fs.existsSync(file)) return { status: "LIVRE" };
  try {
    return { status: "OCUPADO", ...JSON.parse(fs.readFileSync(file, "utf8")) };
  } catch {
    return { status: "OCUPADO" };
  }
}

function createLocalLock(config, user, token) {
  const file = path.join(fixedDataDir(config), "local-lock.json");
  fs.writeFileSync(file, JSON.stringify({
    user: user || "Operador",
    token,
    machine: appName(),
    startedAt: new Date().toISOString(),
  }, null, 2), "utf8");
}

function releaseLocalLock(config, token) {
  const file = path.join(fixedDataDir(config), "local-lock.json");
  if (!fs.existsSync(file)) return;
  try {
    const current = JSON.parse(fs.readFileSync(file, "utf8"));
    if (current.token && current.token !== token) return;
  } catch {
    return;
  }
  fs.unlinkSync(file);
}

async function readCadastroRows(sheets, config) {
  const sheetName = await resolveCadastroSheetName(sheets, config);
  const result = await sheets.spreadsheets.values.get({
    spreadsheetId: config.operationalSpreadsheetId,
    range: `'${sheetName}'!A2:I`,
  });
  return result.data.values || [];
}

async function resolveCadastroSheetName(sheets, config) {
  const detected = await detectCadastroSheet(sheets, config.operationalSpreadsheetId, config.cadastroSheetName);
  if (!detected?.name) {
    throw new Error("Não encontrei uma aba com o cabeçalho da planilha de artes.");
  }
  return detected.name;
}

function emptyDashboard() {
  return { totalArtworks: 0, nextId: 1, topTheme: ["-", 0], byUser: [], byTheme: [] };
}

function topEntry(map) {
  return Object.entries(map).sort((a, b) => b[1] - a[1])[0] || ["-", 0];
}

async function provision(config, appRoot) {
  const { sheets, drive } = await services(config, appRoot);
  const nextConfig = { ...config };

  if (!nextConfig.baseSpreadsheetId) {
    nextConfig.baseSpreadsheetId = await findOrCreateSpreadsheet(drive, nextConfig.baseSpreadsheetName);
  }
  for (const sheet of Object.values(BASE_SHEETS)) {
    await ensureSheet(sheets, nextConfig.baseSpreadsheetId, sheet.name, sheet.header);
  }
  await ensureExecutionRow(sheets, nextConfig.baseSpreadsheetId);
  await ensureConfigRows(sheets, nextConfig.baseSpreadsheetId, nextConfig);

  if (nextConfig.operationalSpreadsheetId) {
    const detected = await detectCadastroSheet(sheets, nextConfig.operationalSpreadsheetId, nextConfig.cadastroSheetName);
    if (detected?.name) nextConfig.cadastroSheetName = detected.name;
    await ensureSheet(sheets, nextConfig.operationalSpreadsheetId, nextConfig.cadastroSheetName, OPERATIONAL_SHEETS.cadastroHeader);
    await ensureSheet(sheets, nextConfig.operationalSpreadsheetId, nextConfig.operationalLogsSheetName, OPERATIONAL_SHEETS.logsHeader);
  }

  const driveFolderId = await findOrCreateFolder(drive, nextConfig.driveFolderName);
  return { config: nextConfig, driveFolderId };
}

async function validateOperationalSpreadsheet(config, appRoot, spreadsheetId = "") {
  const sid = String(spreadsheetId || config.operationalSpreadsheetId || "").trim();
  if (!sid) throw new Error("Informe o ID da planilha de artes.");
  const { sheets } = await services(config, appRoot);
  const meta = await sheets.spreadsheets.get({
    spreadsheetId: sid,
    fields: "properties(title),sheets(properties(title))",
  });
  const titles = (meta.data.sheets || []).map((sheet) => sheet.properties.title);
  const detected = await detectCadastroSheet(sheets, sid, config.cadastroSheetName, titles);
  const hasCadastro = Boolean(detected?.name);
  const hasLogs = titles.includes(config.operationalLogsSheetName);
  return {
    ok: true,
    id: sid,
    title: meta.data.properties?.title || "",
    sheets: titles,
    detectedCadastroName: detected?.name || "",
    detectedHeader: detected?.header || [],
    hasCadastro,
    hasLogs,
    message: hasCadastro
      ? `Planilha encontrada: ${meta.data.properties?.title || sid}. Aba de artes: ${detected.name}.`
      : `Planilha encontrada, mas nenhuma aba tem o cabeçalho esperado.`,
  };
}

async function testConnectivity(config, appRoot) {
  const checks = [];
  const push = (label, ok, detail) => checks.push({ label, ok, detail: String(detail || "") });
  const auth = await authStatus(config, appRoot).catch((error) => ({ authenticated: false, message: error.message }));
  push("Token Google", Boolean(auth.authenticated), auth.authenticated ? "Token encontrado e legível." : auth.message);
  if (!auth.authenticated) return { ok: false, checks };

  const { sheets, drive } = await services(config, appRoot);
  if (config.baseSpreadsheetId) {
    try {
      const base = await sheets.spreadsheets.get({ spreadsheetId: config.baseSpreadsheetId, fields: "properties(title)" });
      push("Planilha central", true, base.data.properties?.title || config.baseSpreadsheetId);
    } catch (error) {
      push("Planilha central", false, error.message);
    }
  } else {
    push("Planilha central", false, "ID não configurado.");
  }

  if (config.operationalSpreadsheetId) {
    try {
      const operational = await validateOperationalSpreadsheet(config, appRoot, config.operationalSpreadsheetId);
      push("Planilha de artes", operational.hasCadastro, operational.message);
    } catch (error) {
      push("Planilha de artes", false, error.message);
    }
  } else {
    push("Planilha de artes", false, "ID não configurado.");
  }

  try {
    await drive.files.list({ pageSize: 1, fields: "files(id,name)" });
    push("Drive", true, "API do Drive respondeu.");
  } catch (error) {
    push("Drive", false, error.message);
  }

  try {
    const folderName = config.driveFolderName || "Banco de Artes";
    const folder = await drive.files.list({
      q: `mimeType='application/vnd.google-apps.folder' and name='${escapeQuery(folderName)}' and trashed=false`,
      fields: "files(id,name)",
      pageSize: 1,
    });
    push("Pasta raiz", Boolean(folder.data.files?.length), folder.data.files?.[0]?.name || `Pasta "${folderName}" não encontrada.`);
  } catch (error) {
    push("Pasta raiz", false, error.message);
  }
  return { ok: checks.every((item) => item.ok), checks };
}

async function detectCadastroSheet(sheets, spreadsheetId, preferredName = "", knownTitles = null) {
  if (!spreadsheetId) return null;
  const titles = knownTitles || (await sheets.spreadsheets.get({
    spreadsheetId,
    fields: "sheets(properties(title))",
  })).data.sheets?.map((sheet) => sheet.properties.title) || [];
  const ordered = unique([preferredName, "Página1", "Cadastro", ...titles].filter(Boolean));
  for (const title of ordered) {
    const header = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `'${title}'!A1:I1`,
    }).then((result) => result.data.values?.[0] || []).catch(() => []);
    if (headerMatches(header, OPERATIONAL_SHEETS.cadastroHeader)) {
      return { name: title, header };
    }
  }
  return null;
}

function headerMatches(actual, expected) {
  const cleanActual = actual.map(cleanHeader);
  const cleanExpected = expected.map(cleanHeader);
  return cleanExpected.every((value, index) => cleanActual[index] === value);
}

function cleanHeader(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, " ");
}

function unique(values) {
  return [...new Set(values)];
}

async function findOrCreateSpreadsheet(drive, name) {
  const found = await drive.files.list({
    q: `name='${escapeQuery(name)}' and mimeType='application/vnd.google-apps.spreadsheet' and trashed=false`,
    fields: "files(id,name)",
    spaces: "drive",
    pageSize: 10,
  });
  if (found.data.files?.length) return found.data.files[0].id;
  const created = await drive.files.create({
    requestBody: { name, mimeType: "application/vnd.google-apps.spreadsheet" },
    fields: "id",
  });
  return created.data.id;
}

async function findOrCreateFolder(drive, name, parentId = null) {
  const parentQuery = parentId ? ` and '${parentId}' in parents` : "";
  const found = await drive.files.list({
    q: `name='${escapeQuery(name)}' and mimeType='application/vnd.google-apps.folder' and trashed=false${parentQuery}`,
    fields: "files(id,name)",
    spaces: "drive",
    pageSize: 10,
  });
  if (found.data.files?.length) return found.data.files[0].id;
  const created = await drive.files.create({
    requestBody: {
      name,
      mimeType: "application/vnd.google-apps.folder",
      ...(parentId ? { parents: [parentId] } : {}),
    },
    fields: "id",
  });
  return created.data.id;
}

async function listThemeFolders(drive, rootFolderId) {
  const folders = [];
  let pageToken = null;
  do {
    const result = await drive.files.list({
      q: `'${rootFolderId}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`,
      fields: "nextPageToken,files(id,name)",
      spaces: "drive",
      pageSize: 1000,
      pageToken: pageToken || undefined,
    });
    folders.push(...(result.data.files || []));
    pageToken = result.data.nextPageToken || null;
  } while (pageToken);
  return folders;
}

async function listImageFilesInFolder(drive, folderId) {
  const files = [];
  let pageToken = null;
  do {
    const result = await drive.files.list({
      q: `'${folderId}' in parents and mimeType contains 'image/' and trashed=false`,
      fields: "nextPageToken,files(id,name,mimeType)",
      spaces: "drive",
      pageSize: 1000,
      pageToken: pageToken || undefined,
    });
    files.push(...(result.data.files || []));
    pageToken = result.data.nextPageToken || null;
  } while (pageToken);
  return files;
}

async function listChildrenInFolder(drive, folderId) {
  const files = [];
  let pageToken = null;
  do {
    const result = await drive.files.list({
      q: `'${folderId}' in parents and trashed=false`,
      fields: "nextPageToken,files(id,name,mimeType)",
      spaces: "drive",
      pageSize: 1000,
      pageToken: pageToken || undefined,
    });
    files.push(...(result.data.files || []));
    pageToken = result.data.nextPageToken || null;
  } while (pageToken);
  return files;
}

async function syncThemeFolderCache(config, drive, rootFolderId) {
  if (!rootFolderId) return readDriveFolderCache(config);
  const folders = await listThemeFolders(drive, rootFolderId);
  const grouped = new Map();
  for (const folder of folders) {
    const key = folderKey(folder.name);
    if (!key) continue;
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push({ ...folder, imageCount: 0 });
  }

  const themes = {};
  for (const [key, group] of grouped) {
    for (const folder of group) {
      folder.images = await listImageFilesInFolder(drive, folder.id).catch(() => []);
      folder.imageCount = folder.images.length;
    }
    group.sort((a, b) => b.imageCount - a.imageCount || a.name.localeCompare(b.name));
    const keeper = group[0];
    for (const duplicate of group.slice(1)) {
      for (const image of duplicate.images) {
        await drive.files.update({
          fileId: image.id,
          addParents: keeper.id,
          removeParents: duplicate.id,
          fields: "id,parents",
        }).catch(() => null);
      }
      const remaining = await listChildrenInFolder(drive, duplicate.id).catch(() => []);
      if (!remaining.length) {
        await drive.files.delete({ fileId: duplicate.id }).catch(() => null);
      }
    }
    themes[key] = { id: keeper.id, name: keeper.name, imageCount: group.reduce((sum, item) => sum + item.imageCount, 0) };
  }

  return writeDriveFolderCache(config, { rootFolderId, themes });
}

async function getThemeFolderId(config, drive, rootFolderId, themeName) {
  const key = folderKey(themeName);
  let cache = readDriveFolderCache(config);
  if (cache.rootFolderId !== rootFolderId || !cache.themes?.[key]) {
    cache = await syncThemeFolderCache(config, drive, rootFolderId);
  }
  if (cache.themes?.[key]?.id) return cache.themes[key].id;

  const createdId = await findOrCreateFolder(drive, themeName, rootFolderId);
  cache.themes = cache.themes || {};
  cache.themes[key] = { id: createdId, name: themeName, imageCount: 0 };
  cache.rootFolderId = rootFolderId;
  writeDriveFolderCache(config, cache);
  return createdId;
}

async function listDriveThemeFolders(config, appRoot, refresh = false) {
  const { drive } = await services(config, appRoot);
  const rootFolderName = config.driveFolderName || "Banco de Artes";
  const rootFolderId = await findOrCreateFolder(drive, rootFolderName);
  let cache = readDriveFolderCache(config);
  if (refresh || cache.rootFolderId !== rootFolderId || !cache.lastSync) {
    cache = await syncThemeFolderCache(config, drive, rootFolderId);
  }
  const folders = Object.values(cache.themes || {})
    .map((folder) => ({
      ...folder,
      url: `https://drive.google.com/drive/folders/${folder.id}`,
    }))
    .sort((a, b) => String(a.name || "").localeCompare(String(b.name || ""), "pt-BR"));
  return {
    rootFolderId,
    rootFolderName,
    rootUrl: `https://drive.google.com/drive/folders/${rootFolderId}`,
    lastSync: cache.lastSync || null,
    folders,
  };
}

async function ensureSheet(sheets, spreadsheetId, title, header) {
  const meta = await sheets.spreadsheets.get({ spreadsheetId, fields: "sheets(properties(title))" });
  const exists = meta.data.sheets?.some((sheet) => sheet.properties.title === title);
  if (!exists) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: { requests: [{ addSheet: { properties: { title } } }] },
    });
  }
  const current = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `'${title}'!A1:${columnName(header.length)}1`,
  }).catch(() => ({ data: {} }));
  if (!current.data.values?.length) {
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `'${title}'!A1:${columnName(header.length)}1`,
      valueInputOption: "RAW",
      requestBody: { values: [header] },
    });
  }
}

async function ensureExecutionRow(sheets, spreadsheetId) {
  const row = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `'${BASE_SHEETS.execution.name}'!A2:F2`,
  }).catch(() => ({ data: {} }));
  if (!row.data.values?.length) {
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `'${BASE_SHEETS.execution.name}'!A2:F2`,
      valueInputOption: "RAW",
      requestBody: { values: [["LIVRE", "", "", "", "", ""]] },
    });
  }
}

async function ensureConfigRows(sheets, spreadsheetId, config) {
  const values = Object.entries(config)
    .filter(([, value]) => typeof value !== "object")
    .map(([key, value]) => [key, String(value)]);
  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: `'${BASE_SHEETS.config.name}'!A1:B${values.length + 1}`,
    valueInputOption: "RAW",
    requestBody: { values: [BASE_SHEETS.config.header, ...values] },
  });
}

async function sheetIdByName(sheets, spreadsheetId, title) {
  const meta = await sheets.spreadsheets.get({
    spreadsheetId,
    fields: "sheets(properties(sheetId,title,gridProperties(rowCount)))",
  });
  return (meta.data.sheets || []).find((sheet) => sheet.properties?.title === title)?.properties || null;
}

function startRowFromUpdatedRange(updatedRange = "") {
  const match = String(updatedRange).match(/![A-Z]+(\d+):/);
  return match ? Number(match[1]) : null;
}

async function copyCadastroFormatting(sheets, spreadsheetId, sheetName, rowCount, updatedRange) {
  const startRow = startRowFromUpdatedRange(updatedRange);
  if (!startRow || !rowCount) return;
  const props = await sheetIdByName(sheets, spreadsheetId, sheetName);
  if (!props) return;
  const sourceRow = Math.max(1, startRow - 1);
  await sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: {
      requests: [{
        copyPaste: {
          source: {
            sheetId: props.sheetId,
            startRowIndex: sourceRow - 1,
            endRowIndex: sourceRow,
            startColumnIndex: 0,
            endColumnIndex: 9,
          },
          destination: {
            sheetId: props.sheetId,
            startRowIndex: startRow - 1,
            endRowIndex: startRow - 1 + rowCount,
            startColumnIndex: 0,
            endColumnIndex: 9,
          },
          pasteType: "PASTE_FORMAT",
          pasteOrientation: "NORMAL",
        },
      }],
    },
  }).catch(() => null);
}

async function uploadBatch(config, appRoot, rows, onProgress = () => {}) {
  if (config.maintenanceMode) throw new Error("Sistema em manutenção. Upload bloqueado temporariamente.");
  if (!config.operationalSpreadsheetId) throw new Error("Planilha de artes não configurada.");
  const startedAt = Date.now();
  const progress = (phase, current = 0, total = rows.length, detail = "") => {
    const elapsedMs = Date.now() - startedAt;
    const done = Math.max(0, current);
    const etaMs = done > 0 && total > done ? Math.round((elapsedMs / done) * (total - done)) : 0;
    onProgress({ phase, current: done, total, detail, elapsedMs, etaMs });
  };
  progress("Preparando conexão", 0, rows.length, "Validando Google, Drive e planilha.");
  const { sheets, drive } = await services(config, appRoot);
  progress("Preparando bases", 0, rows.length, "Conferindo abas, pasta e permissões.");
  const provisioned = await provision(config, appRoot);
  progress("Aguardando lock", 0, rows.length, "Reservando execução global para evitar conflito.");
  const token = await acquireGlobalLock(sheets, provisioned.config, config.operatorName);
  createLocalLock(config, config.operatorName, token);
  const successes = [];
  const failures = [];

  try {
    const rootFolderId = provisioned.driveFolderId;
    
    progress("Checando IDs", 0, rows.length, "Confirmando IDs livres diretamente na planilha.");
    const cadastroSheetName = await resolveCadastroSheetName(sheets, provisioned.config);
    const existingIdsRes = await sheets.spreadsheets.values.get({
      spreadsheetId: provisioned.config.operationalSpreadsheetId,
      range: `'${cadastroSheetName}'!A:A`,
    });
    const liveIds = new Set((existingIdsRes.data.values || []).map(r => String(r[0]).trim()));
    
    for (const row of rows) {
      const rowId = String(row.id || "").trim();
      if (rowId && liveIds.has(rowId)) {
        throw new Error(`Conflito: O ID ${rowId} já existe na planilha! Abortando para evitar duplicação.`);
      }
    }

    for (const row of rows) {
      try {
        progress("Enviando arquivos", successes.length + failures.length, rows.length, row.fileName || `ID ${row.id}`);
        const normalized = normalizeArtworkRow(row);
        const themeFolderId = await getThemeFolderId(provisioned.config, drive, rootFolderId, normalized.theme);
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
        const folderCache = readDriveFolderCache(provisioned.config);
        const key = folderKey(normalized.theme);
        if (folderCache.themes?.[key]) {
          folderCache.themes[key].imageCount = Number(folderCache.themes[key].imageCount || 0) + 1;
          writeDriveFolderCache(provisioned.config, folderCache);
        }
        progress("Enviando arquivos", successes.length + failures.length, rows.length, `${fileName} enviado.`);
      } catch (error) {
        failures.push({ ...row, error: error.message });
        progress("Falha em arquivo", successes.length + failures.length, rows.length, `${row.fileName || row.id}: ${error.message}`);
      }
    }

    if (successes.length) {
      try {
        progress("Salvando planilha", rows.length, rows.length, "Gravando linhas na aba de artes.");
        const appendResult = await sheets.spreadsheets.values.append({
          spreadsheetId: provisioned.config.operationalSpreadsheetId,
          range: `'${cadastroSheetName}'!A:I`,
          valueInputOption: "RAW",
          insertDataOption: "INSERT_ROWS",
          requestBody: {
            values: successes.map((row) => [
              row.id,
              row.theme,
              row.product,
              row.size,
              row.client || "",
              provisioned.config.operatorName || "Operador",
              row.phone || "",
              new Date().toLocaleDateString("pt-BR"),
              row.url,
            ]),
          },
        });
        await copyCadastroFormatting(sheets, provisioned.config.operationalSpreadsheetId, cadastroSheetName, successes.length, appendResult.data.updates?.updatedRange);
      } catch (appendError) {
        progress("Revertendo Drive", rows.length, rows.length, "A planilha falhou. Removendo arquivos enviados.");
        for (const succ of successes) {
          if (succ.driveFileId) {
            await drive.files.delete({ fileId: succ.driveFileId }).catch(() => null);
          }
        }
        throw new Error("Falha ao salvar na planilha. Os arquivos do Drive foram revertidos. Erro: " + appendError.message);
      }
    }
    progress("Concluído", rows.length, rows.length, `${successes.length} enviadas, ${failures.length} falhas.`);
  } finally {
    releaseLocalLock(config, token);
    await releaseGlobalLock(sheets, provisioned.config, token);
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

async function acquireGlobalLock(sheets, config, user) {
  const current = await sheets.spreadsheets.values.get({
    spreadsheetId: config.baseSpreadsheetId,
    range: `'${BASE_SHEETS.execution.name}'!A2:F2`,
  });
  const status = current.data.values?.[0]?.[0] || "LIVRE";
  if (String(status).toUpperCase() === "OCUPADO") {
    const lockTimeStr = current.data.values?.[0]?.[3];
    if (lockTimeStr) {
      const lockTime = new Date(lockTimeStr).getTime();
      const now = Date.now();
      // TTL de 2 minutos (120000 ms)
      if (now - lockTime < 120000) {
        throw new Error("Existe outro cadastro global em andamento.");
      }
      // Se passou de 2 min, assume que travou e pega o lock
    } else {
      throw new Error("Existe outro cadastro global em andamento.");
    }
  }

  const token = crypto.randomUUID();
  await sheets.spreadsheets.values.update({
    spreadsheetId: config.baseSpreadsheetId,
    range: `'${BASE_SHEETS.execution.name}'!A2:F2`,
    valueInputOption: "RAW",
    requestBody: { values: [["OCUPADO", user || "Operador", appName(), new Date().toISOString(), token, "CADASTRO_EM_ANDAMENTO"]] },
  });
  return token;
}

async function releaseGlobalLock(sheets, config, token) {
  const current = await sheets.spreadsheets.values.get({
    spreadsheetId: config.baseSpreadsheetId,
    range: `'${BASE_SHEETS.execution.name}'!A2:F2`,
  });
  const currentToken = current.data.values?.[0]?.[4] || "";
  if (currentToken !== token) return false;
  await sheets.spreadsheets.values.update({
    spreadsheetId: config.baseSpreadsheetId,
    range: `'${BASE_SHEETS.execution.name}'!A2:F2`,
    valueInputOption: "RAW",
    requestBody: { values: [["LIVRE", "", "", "", "", ""]] },
  });
  return true;
}

async function syncGlobalState(config, appRoot, type, jsonString) {
  if (!config.baseSpreadsheetId) return;
  const { sheets } = await services(config, appRoot);
  const rangeMap = {
    "SESSIONS": `'${BASE_SHEETS.execution.name}'!G2`,
    "RESERVATIONS": `'${BASE_SHEETS.execution.name}'!H2`,
  };
  const range = rangeMap[type];
  if (!range) return;
  await sheets.spreadsheets.values.update({
    spreadsheetId: config.baseSpreadsheetId,
    range,
    valueInputOption: "RAW",
    requestBody: { values: [[jsonString]] },
  }).catch(() => null);
}

function columnName(n) {
  let s = "";
  while (n > 0) {
    const mod = (n - 1) % 26;
    s = String.fromCharCode(65 + mod) + s;
    n = Math.floor((n - mod) / 26);
  }
  return s;
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
  deleteArtwork,
  lockStatus,
  syncGlobalState,
  validateOperationalSpreadsheet,
  testConnectivity,
  syncThemeFolderCache,
  listDriveThemeFolders,
  findOrCreateFolder,
  copyLegacyCredentialsIfNeeded,
  tokenPath,
  credentialsPath,
  services,
  readCadastroRows,
};
