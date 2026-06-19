const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const crypto = require("node:crypto");
const { app } = require("electron");
const { google } = require("googleapis");
const supabaseAuthService = require("./supabaseAuthService");
const { buildArtworkFilename, normalizeText, normalizeDimension } = require("../shared/rules");
const { containsArtworkId, findFolderByArtworkId } = require("./fileService");

const DRIVE_SCOPE = "https://www.googleapis.com/auth/drive";
const PREFLIGHT_CACHE_TTL_MS = 90 * 1000;
const drivePreflightCache = new Map();
const runtimeHooks = {
  currentActor: null,
  loadRemoteGoogleCredentials: null,
  saveRemoteGoogleCredentials: null,
  openExternal: null,
};

function configureRuntimeHooks(hooks = {}) {
  for (const [key, value] of Object.entries(hooks)) {
    if (key in runtimeHooks) runtimeHooks[key] = value;
  }
}

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
  if (!fs.existsSync(file)) throw new Error("Credenciais Google não encontradas. Adicione o credentials.json do robô ou do Desktop App.");
  const data = JSON.parse(fs.readFileSync(file, "utf8"));
  if (data.type === "service_account") {
    if (!data.client_email || !data.private_key) throw new Error("Chave de serviço inválida.");
    return { data, file, type: "service_account" };
  } else if (data.installed || data.web) {
    return { data, file, type: "oauth2" };
  }
  throw new Error("O credentials.json deve ser uma Conta de Serviço ou credencial de App de Desktop (OAuth2).");
}

async function getAuth(config, appRoot, redirectUri = "", options = {}) {
  const creds = readCredentials(config, appRoot);
  if (creds.type === "service_account") {
    return new google.auth.GoogleAuth({
      keyFile: creds.file,
      scopes: requiredScopes(),
    });
  } else {
    const info = creds.data.installed || creds.data.web;
    const oAuth2Client = new google.auth.OAuth2(
      info.client_id,
      info.client_secret,
      redirectUri || preferredRedirectUri(info)
    );
    const tokenFile = tokenPath(config);
    if (fs.existsSync(tokenFile)) {
      const token = JSON.parse(fs.readFileSync(tokenFile, "utf8"));
      oAuth2Client.setCredentials(token);
      attachTokenPersistence(oAuth2Client, config, appRoot);
      return oAuth2Client;
    } else {
      if (!options.skipRemoteRecovery && await loadRemoteGoogleCredentials(config, appRoot)) {
        return getAuth(config, appRoot, redirectUri, { ...options, skipRemoteRecovery: true });
      }
      if (canAdminStartOAuth() && !options.skipAdminOAuth) {
        await runOAuthBrowserFlow(config, appRoot, runtimeHooks.openExternal);
        return getAuth(config, appRoot, redirectUri, { ...options, skipRemoteRecovery: true, skipAdminOAuth: true });
      }
      const authUrl = oAuth2Client.generateAuthUrl({
        access_type: "offline",
        scope: requiredScopes(),
        prompt: "consent",
      });
      const err = new Error("Autenticação OAuth2 necessária.");
      err.authUrl = authUrl;
      throw err;
    }
  }
}

async function authStatus(config, appRoot) {
  try {
    const creds = readCredentials(config, appRoot);
    const { drive } = await services(config, appRoot);
    await drive.files.list({ pageSize: 1, fields: "files(id)" });
    
    let email = "Usuário Google";
    if (creds.type === "service_account") {
      email = creds.data.client_email;
    }
    
    return {
      ok: true,
      authenticated: true,
      email: email,
      message: creds.type === "service_account" ? "Autenticado (Service Account)" : "Autenticado (Conta Google)",
      scopes: requiredScopes(),
      missingScopes: [],
      tokenPath: creds.type === "service_account" ? "N/A" : tokenPath(config),
      credentialsPath: creds.file,
    };
  } catch (error) {
    return {
      ok: false,
      authenticated: false,
      message: error.message,
      authUrl: error.authUrl || null,
      tokenPath: tokenPath(config),
      credentialsPath: credentialsPath(config, appRoot),
    };
  }
}

async function submitAuthCode(config, appRoot, code) {
  const creds = readCredentials(config, appRoot);
  if (creds.type !== "oauth2") throw new Error("A credencial atual não é OAuth2.");
  const info = creds.data.installed || creds.data.web;
  const oAuth2Client = new google.auth.OAuth2(
    info.client_id,
    info.client_secret,
    preferredRedirectUri(info)
  );
  const { tokens } = await oAuth2Client.getToken(code);
  saveRawToken(config, tokens);
  await persistAdminGoogleToken(config, appRoot).catch(() => null);
  return authStatus(config, appRoot);
}

async function authenticate(config, appRoot, openUrl = null, options = {}) {
  const status = await authStatus(config, appRoot);
  if (status.authenticated && !options.force) return status;

  const creds = readCredentials(config, appRoot);
  if (creds.type !== "oauth2") return status;
  if (typeof openUrl !== "function") {
    throw new Error("Não consegui abrir o navegador externo para o OAuth.");
  }

  await runOAuthBrowserFlow(config, appRoot, openUrl);
  return authStatus(config, appRoot);
}

async function runOAuthBrowserFlow(config, appRoot, openUrl) {
  const creds = readCredentials(config, appRoot);
  if (creds.type !== "oauth2") throw new Error("A credencial atual não é OAuth2.");

  const server = await startOAuthLoopbackServer();
  try {
    const info = creds.data.installed || creds.data.web;
    const oAuth2Client = new google.auth.OAuth2(
      info.client_id,
      info.client_secret,
      server.redirectUri
    );
    const authUrl = oAuth2Client.generateAuthUrl({
      access_type: "offline",
      scope: requiredScopes(),
      prompt: "consent",
    });
    await openUrl(authUrl);
    const code = await server.waitForCode;
    const { tokens } = await oAuth2Client.getToken(code);
    saveRawToken(config, tokens);
    await persistAdminGoogleToken(config, appRoot);
    return getRawToken(config);
  } finally {
    server.close();
  }
}

function preferredRedirectUri(info = {}) {
  const uris = Array.isArray(info.redirect_uris) ? info.redirect_uris : [];
  return uris.find((uri) => /^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?(\/|$)/i.test(uri))
    || "http://127.0.0.1";
}

function startOAuthLoopbackServer() {
  let server;
  let closed = false;
  const waitForCode = new Promise((resolve, reject) => {
    server = http.createServer((req, res) => {
      try {
        const url = new URL(req.url || "/", "http://127.0.0.1");
        if (url.pathname !== "/oauth2callback") {
          res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
          res.end("Pagina nao encontrada.");
          return;
        }
        const denied = url.searchParams.get("error");
        if (denied) throw new Error(`Google recusou a autorizacao: ${denied}`);
        const code = url.searchParams.get("code");
        if (!code) throw new Error("Codigo OAuth nao encontrado.");
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end("<!doctype html><meta charset=\"utf-8\"><title>Google conectado</title><h1>Google conectado.</h1><p>Pode voltar ao Banco de Artes.</p>");
        resolve(code);
      } catch (error) {
        res.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" });
        res.end(error.message);
        reject(error);
      }
    });
  });

  return new Promise((resolve, reject) => {
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      resolve({
        redirectUri: `http://127.0.0.1:${port}/oauth2callback`,
        waitForCode,
        close() {
          if (closed) return;
          closed = true;
          server.close(() => {});
        },
      });
    });
  });
}

async function services(config, appRoot) {
  const auth = await getAuth(config, appRoot);
  const drive = google.drive({ version: "v3", auth });
  return {
    drive: wrapDriveWithAuthRecovery(config, appRoot, drive),
  };
}

function attachTokenPersistence(oAuth2Client, config, appRoot) {
  if (oAuth2Client.__bancoDeArtesTokenPersistence) return;
  oAuth2Client.__bancoDeArtesTokenPersistence = true;
  oAuth2Client.on("tokens", (tokens) => {
    const saved = saveRawToken(config, tokens);
    if (!saved) return;
    persistAdminGoogleToken(config, appRoot, saved).catch((error) => {
      console.warn("Falha ao sincronizar token Google no Supabase:", error.message);
    });
  });
}

function currentActor() {
  try {
    return typeof runtimeHooks.currentActor === "function" ? runtimeHooks.currentActor() : null;
  } catch {
    return null;
  }
}

function canAdminStartOAuth() {
  return currentActor()?.role === "admin" && typeof runtimeHooks.openExternal === "function";
}

async function persistAdminGoogleToken(config, appRoot, token = null) {
  const actor = currentActor();
  if (actor?.role !== "admin") return false;
  if (typeof runtimeHooks.saveRemoteGoogleCredentials !== "function") return false;
  const credentials = getRawCredentials(config, appRoot);
  const currentToken = token || getRawToken(config);
  if (!credentials || !currentToken) return false;
  await runtimeHooks.saveRemoteGoogleCredentials(config, credentials, currentToken);
  return true;
}

async function loadRemoteGoogleCredentials(config, appRoot) {
  if (typeof runtimeHooks.loadRemoteGoogleCredentials !== "function") return false;
  const remote = await runtimeHooks.loadRemoteGoogleCredentials(config);
  if (!remote?.credentials || !remote?.token) return false;
  saveRawCredentials(config, appRoot, remote.credentials);
  saveRawToken(config, remote.token);
  return true;
}

function wrapDriveWithAuthRecovery(config, appRoot, drive, pathParts = []) {
  // Use an empty object as target so we don't violate Proxy invariants for non-configurable properties like 'files'
  return new Proxy({}, {
    get(_target, prop) {
      if (prop === "then") return undefined; // Prevent Promise resolution issues on proxies
      const value = drive[prop];
      if (typeof value === "function") {
        return async (...args) => {
          try {
            return await value.apply(drive, args);
          } catch (error) {
            if (!isGoogleAuthError(error)) throw error;
            const freshDrive = await recoverDriveAfterAuthError(config, appRoot, error);
            const freshTarget = pathParts.reduce((node, key) => node?.[key], freshDrive);
            const freshMethod = freshTarget?.[prop];
            if (typeof freshMethod !== "function") throw error;
            return freshMethod.apply(freshTarget, args);
          }
        };
      }
      if (value && typeof value === "object") {
        return wrapDriveWithAuthRecovery(config, appRoot, value, [...pathParts, prop]);
      }
      return value;
    },
  });
}

async function recoverDriveAfterAuthError(config, appRoot, originalError) {
  if (await loadRemoteGoogleCredentials(config, appRoot)) {
    const auth = await getAuth(config, appRoot, "", { skipRemoteRecovery: true, skipAdminOAuth: true });
    const drive = google.drive({ version: "v3", auth });
    try {
      await drive.files.list({ pageSize: 1, fields: "files(id)", supportsAllDrives: true });
      return drive;
    } catch (remoteError) {
      if (!isGoogleAuthError(remoteError)) throw remoteError;
      if (!canAdminStartOAuth()) {
        const actor = currentActor();
        const suffix = actor?.role === "admin"
          ? "Reconecte o Google Drive."
          : "Peça para um admin reconectar o Google Drive.";
        throw new Error(`Token do Google Drive inválido. ${suffix} Detalhe: ${remoteError.message}`);
      }
    }
  }

  if (canAdminStartOAuth()) {
    await runOAuthBrowserFlow(config, appRoot, runtimeHooks.openExternal);
    const auth = await getAuth(config, appRoot, "", { skipRemoteRecovery: true, skipAdminOAuth: true });
    return google.drive({ version: "v3", auth });
  }

  const actor = currentActor();
  const suffix = actor?.role === "admin"
    ? "Reconecte o Google Drive."
    : "Peça para um admin reconectar o Google Drive.";
  throw new Error(`Token do Google Drive inválido. ${suffix} Detalhe: ${originalError.message}`);
}

function isGoogleAuthError(error = {}) {
  const status = Number(error.code || error.status || error.response?.status || 0);
  const text = [
    error.message,
    error.errors?.map((item) => item.message).join(" "),
    error.response?.data?.error,
    error.response?.data?.error_description,
  ].filter(Boolean).join(" ");
  return status === 401
    || /invalid[_\s-]?grant|invalid[_\s-]?credentials|unauthorized|login required|expected oauth|missing required authentication credential|insufficient authentication scopes/i.test(text);
}

function driveFileIdFromUrl(url = "") {
  const text = String(url || "");
  const pathMatch = text.match(/\/file\/d\/([^/?#]+)/i);
  if (pathMatch) return pathMatch[1];
  const queryMatch = text.match(/[?&]id=([^&#]+)/i);
  if (queryMatch) return queryMatch[1];
  const openMatch = text.match(/\/open\?id=([^&#]+)/i);
  return openMatch ? openMatch[1] : "";
}

async function provision(config, appRoot) {
  const { drive } = await services(config, appRoot);
  const bolinhas = await findOrCreateFolder(drive, config.driveFolderBolinhas || "BOLINHAS 50X50");
  const geral = await findOrCreateFolder(drive, (config.driveFolderGeral === "PAINÉIS DE FESTA" ? "1poSJTWYybZB1kvRwBK4ZnpVTMtHCpUfE" : config.driveFolderGeral || "1poSJTWYybZB1kvRwBK4ZnpVTMtHCpUfE"));
  return { config, driveFolderId: bolinhas };
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
    const idBolinhas = await findOrCreateFolder(drive, config.driveFolderBolinhas || "BOLINHAS 50X50");
    const idGeral = await findOrCreateFolder(drive, (config.driveFolderGeral === "PAINÉIS DE FESTA" ? "1poSJTWYybZB1kvRwBK4ZnpVTMtHCpUfE" : config.driveFolderGeral || "1poSJTWYybZB1kvRwBK4ZnpVTMtHCpUfE"));
    push("Pastas raízes", Boolean(idBolinhas && idGeral), "Acesso garantido às pastas raízes.");
  } catch (error) {
    push("Pastas raízes", false, error.message);
  }

  return { ok: checks.every((item) => item.ok), checks };
}

async function assertDriveUploadReady(config, appRoot, payload = {}) {
  const product = payload.product || "PAINEL REDONDO";
  const size = payload.size || "50X50";
  const theme = normalizeText(payload.theme || "SEM TEMA");
  const rootFolderName = getRootFolderName(config, product, size);
  const productFolderName = getProductFolderName(product, size);
  const cacheKey = [
    fixedDataDir(config),
    rootFolderName,
    rootFolderName === getRootFolderName(config, "PAINEL REDONDO", "50X50") ? "" : productFolderName,
    theme,
  ].join("|");
  const cached = drivePreflightCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return { ...cached.result, cached: true };

  const { drive } = await services(config, appRoot);
  const rootFolderId = await findOrCreateFolder(drive, rootFolderName);
  const themeFolderId = await getThemeFolderId(config, drive, rootFolderId, theme);
  let targetFolderId = themeFolderId;
  if (rootFolderName !== getRootFolderName(config, "PAINEL REDONDO", "50X50")) {
    targetFolderId = await findOrCreateFolder(drive, productFolderName, themeFolderId);
  }

  const probeName = `.banco-de-artes-upload-test-bypassed.txt`;
  const result = {
    ok: true,
    rootFolderName,
    rootFolderId,
    theme,
    themeFolderId,
    targetFolderId,
    probeName,
  };
  drivePreflightCache.set(cacheKey, { result, expiresAt: Date.now() + PREFLIGHT_CACHE_TTL_MS });
  return result;
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

  const rootFolderName = getRootFolderName(config, art.product, art.size);
  const rootFolderId = await findOrCreateFolder(drive, rootFolderName);
  const themeFolderId = await getThemeFolderId(config, drive, rootFolderId, art.theme || "Sem tema");
  
  let targetFolderId = themeFolderId;
  if (rootFolderName !== (config.driveFolderBolinhas || "BOLINHAS 50X50")) {
    const productFolderName = getProductFolderName(art.product, art.size);
    targetFolderId = await findOrCreateFolder(drive, productFolderName, themeFolderId);
  }

  let found = await findDriveImageByArtworkId(drive, targetFolderId, id);
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
      requestBody: { name: fileName, parents: [targetFolderId] },
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
  await supabaseAuthService.checkAndRefreshSession(config);
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
  const rootFolderName50 = getRootFolderName(config, "PAINEL REDONDO", "50X50");
  const rootFolderId50 = await findOrCreateFolder(drive, rootFolderName50);
  const rootFolderNameOther = getRootFolderName(config, "OTHER", "OTHER");
  const rootFolderIdOther = await findOrCreateFolder(drive, rootFolderNameOther);

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

    const CONCURRENCY_LIMIT = 5;
    for (let i = 0; i < rows.length; i += CONCURRENCY_LIMIT) {
      const chunk = rows.slice(i, i + CONCURRENCY_LIMIT);
      await Promise.all(chunk.map(async (row) => {
        let targetFolderId = null;
        let finalFileName = null;
        try {
          progress("Enviando arquivos", successes.length + failures.length, rows.length, row.fileName || `ID ${row.id}`);
          const normalized = normalizeArtworkRow(row, config);
          const rootFolderName = getRootFolderName(config, normalized.product, normalized.size);
          const rootFolderId = rootFolderName === rootFolderName50 ? rootFolderId50 : rootFolderIdOther;
          const themeFolderId = await getThemeFolderId(config, drive, rootFolderId, normalized.theme);
          
          targetFolderId = themeFolderId;
          if (rootFolderName !== rootFolderName50) {
            const productFolderName = getProductFolderName(normalized.product, normalized.size);
            targetFolderId = await findOrCreateFolder(drive, productFolderName, themeFolderId);
          }

          finalFileName = buildArtworkFilename({
            id: normalized.id,
            theme: normalized.theme,
            product: normalized.product,
            size: normalized.size,
            extension: path.extname(row.fileName || row.path || ".jpg") || ".jpg",
          });
          const uploaded = await drive.files.create({
            requestBody: { name: finalFileName, parents: [targetFolderId] },
            media: { mimeType: mimeTypeForFile(row.path || row.fileName), body: fs.createReadStream(row.path) },
            fields: "id,webViewLink,webContentLink",
            supportsAllDrives: true,
          });
          if (config.publicDriveUploads) {
            await drive.permissions.create({
              fileId: uploaded.data.id,
              requestBody: { type: "anyone", role: "reader" },
            }).catch(() => null);
          }
          const url = uploaded.data.webViewLink || uploaded.data.webContentLink || `https://drive.google.com/file/d/${uploaded.data.id}/view`;
          successes.push({ ...row, ...normalized, url, fileName: finalFileName, driveFileId: uploaded.data.id });
          incrementThemeCache(config, normalized.theme, rootFolderId);
          progress("Enviando arquivos", successes.length + failures.length, rows.length, `${finalFileName} enviado.`);
        } catch (error) {
          failures.push({ 
            ...row, 
            ok: false,
            localPath: row.path,
            fileName: finalFileName || row.fileName,
            driveFolderId: targetFolderId,
            error: error.message 
          });
          progress("Falha em arquivo", successes.length + failures.length, rows.length, `${row.fileName || row.id}: ${error.message}`);
        }
      }));
    }

    if (successes.length) {
      try {
        progress("Salvando Supabase", rows.length, rows.length, "Gravando artes no Supabase.");
        for (let i = 0; i < successes.length; i += CONCURRENCY_LIMIT) {
          const chunk = successes.slice(i, i + CONCURRENCY_LIMIT);
          await Promise.all(chunk.map(row => 
            options.persistArtwork({ ...row, user: config.operatorName || "Operador" })
          ));
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

function getRootFolderName(config, product, size) {
  if (size === "50X50" && normalizeText(product) === "PAINEL REDONDO") return config.driveFolderBolinhas || "BOLINHAS 50X50";
  return (config.driveFolderGeral === "PAINÉIS DE FESTA" ? "1poSJTWYybZB1kvRwBK4ZnpVTMtHCpUfE" : config.driveFolderGeral || "1poSJTWYybZB1kvRwBK4ZnpVTMtHCpUfE");
}

function getProductFolderName(product, size) {
  const p = normalizeText(product || "");
  if (p === "ROMANO") return "ROMANOS";
  if (p === "CENARIO") return "CENÁRIOS";
  if (p === "PAINEL" && size === "150X150") return "PAINÉIS 150";
  if (p === "PAINEL" && size === "150X360") return "PAINÉIS 360";
  if (p === "PAINEL REDONDO") return "PAINÉIS REDONDOS";
  if (p === "SACOLINHA") return "SACOLINHAS";
  if (p === "KIT MAIS ROMANO") return "KITS MAIS ROMANOS";
  if (p && !p.endsWith("S")) return p + "S";
  return p || "PRODUTOS";
}

function normalizeArtworkRow(row, config) {
  const { validateProduct } = require("../shared/rules");
  const product = validateProduct(row.product, config?.validProducts);
  // Need to import validateSize, wait, normalizeDimension is imported, but validateSize is not exposed?
  // Let me just import it or just use the basic one. Since validateBatchRows already validated it, maybe it's fine.
  return {
    id: String(row.id || "").trim(),
    theme: normalizeText(row.theme),
    product,
    size: normalizeDimension(row.size), // Size is validated in validateBatchRows before upload
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
    rootFolderIdBolinhas: cache.rootFolderIdBolinhas || "",
    rootFolderIdGeral: cache.rootFolderIdGeral || "",
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

function incrementThemeCache(config, theme, rootFolderId) {
  const folderCache = readDriveFolderCache(config);
  const key = `${rootFolderId}_${folderKey(theme)}`;
  if (folderCache.themes?.[key]) {
    folderCache.themes[key].imageCount = Number(folderCache.themes[key].imageCount || 0) + 1;
    writeDriveFolderCache(config, folderCache);
  }
}
function extractDriveFolderId(input) {
  if (!input) return null;
  const match = String(input).match(/folders\/([a-zA-Z0-9_-]{25,45})/);
  if (match) return match[1];
  const str = String(input).trim();
  if (/^[a-zA-Z0-9_-]{25,45}$/.test(str)) return str;
  return null;
}

async function findOrCreateFolder(drive, name, parentId = null) {
  const extractedId = extractDriveFolderId(name);
  if (extractedId) {
    try {
      const folder = await drive.files.get({ fileId: extractedId, fields: "id", supportsAllDrives: true });
      if (folder.data.id) return folder.data.id;
    } catch (e) {
      throw new Error(`Acesso negado ao Link/ID da pasta. Você compartilhou a pasta no Google Drive com o e-mail do bot (banco-de-artes-bot@...)? Detalhe: ${e.message}`);
    }
  }
  const cleanName = String(name || "").trim();
  const searchNames = [cleanName];
  if (cleanName.startsWith(". ")) {
    const withoutDot = cleanName.slice(2).trim();
    if (withoutDot) searchNames.push(withoutDot);
  } else if (cleanName !== "SEM TEMA" && cleanName !== "BOLINHAS 50X50" && cleanName !== "1poSJTWYybZB1kvRwBK4ZnpVTMtHCpUfE" && cleanName !== "OTHER") {
    searchNames.push(". " + cleanName);
  }

  const parentQuery = parentId ? ` and '${parentId}' in parents` : "";
  const nameQuery = searchNames.map(n => `name = '${escapeQuery(n)}'`).join(" or ");

  const result = await drive.files.list({
    q: `(${nameQuery}) and mimeType = 'application/vnd.google-apps.folder' and trashed = false${parentQuery}`,
    fields: "files(id,name,webViewLink)",
    pageSize: 1,
    corpora: "allDrives",
    includeItemsFromAllDrives: true,
    supportsAllDrives: true,
  });
  if (result.data.files?.[0]) return result.data.files[0].id;
  const created = await drive.files.create({
    requestBody: {
      name,
      mimeType: "application/vnd.google-apps.folder",
      parents: parentId ? [parentId] : undefined,
    },
    fields: "id",
    supportsAllDrives: true,
  });
  return created.data.id;
}

async function fetchInChunks(drive, parentIds, mimeTypeFilter, fields) {
  const chunkSize = 25;
  let allFiles = [];
  const chunks = [];
  for (let i = 0; i < parentIds.length; i += chunkSize) {
    chunks.push(parentIds.slice(i, i + chunkSize));
  }

  const results = [];
  const concurrency = 10;
  for (let i = 0; i < chunks.length; i += concurrency) {
    const batch = chunks.slice(i, i + concurrency);
    const promises = batch.map(async (chunk) => {
      const parentQuery = chunk.map(id => `'${id}' in parents`).join(' or ');
      const q = `trashed = false and (${parentQuery}) ${mimeTypeFilter ? `and ${mimeTypeFilter}` : ''}`;
      
      let pageToken = "";
      const files = [];
      do {
        const res = await drive.files.list({
          q,
          fields: `nextPageToken,files(${fields})`,
          pageSize: 1000,
          pageToken: pageToken || undefined,
          corpora: "allDrives",
          includeItemsFromAllDrives: true,
          supportsAllDrives: true,
        });
        if (res.data.files) files.push(...res.data.files);
        pageToken = res.data.nextPageToken || "";
      } while (pageToken);
      return files;
    });

    const batchResults = await Promise.all(promises);
    for (const br of batchResults) {
      results.push(...br);
    }
  }

  for (const res of results) {
    allFiles.push(res);
  }
  return allFiles;
}

async function syncThemeFolderCache(config, drive, roots) {
  const rootIds = [];
  if (roots.bolinhas) rootIds.push(roots.bolinhas);
  if (roots.geral && roots.geral !== roots.bolinhas) rootIds.push(roots.geral);
  if (rootIds.length === 0) return {};

  const themeFolders = await fetchInChunks(drive, rootIds, `mimeType = 'application/vnd.google-apps.folder'`, "id,name,parents,webViewLink");
  
  let currentParents = themeFolders.map(f => f.id);
  const allSubFolders = [];
  while (currentParents.length > 0) {
    const subs = await fetchInChunks(drive, currentParents, `mimeType = 'application/vnd.google-apps.folder'`, "id,name,parents");
    if (subs.length === 0) break;
    allSubFolders.push(...subs);
    currentParents = subs.map(f => f.id);
  }

  const allValidFolderIds = [...rootIds, ...themeFolders.map(f => f.id), ...allSubFolders.map(f => f.id)];
  const allImages = await fetchInChunks(drive, allValidFolderIds, `(mimeType contains 'image/' or name contains '.jpg' or name contains '.png' or name contains '.webp' or name contains '.tif') and mimeType != 'application/vnd.google-apps.shortcut' and mimeType != 'application/vnd.google-apps.folder'`, "id,parents");

  const allFolders = [...themeFolders, ...allSubFolders];

  const folderChildren = {};
  const folderMeta = {};
  const imageCounts = {};

  for (const f of allFolders) {
    folderMeta[f.id] = f;
    if (f.parents) {
      for (const p of f.parents) {
        if (!folderChildren[p]) folderChildren[p] = [];
        folderChildren[p].push(f.id);
      }
    }
  }

  for (const img of allImages) {
    if (img.parents) {
      for (const p of img.parents) {
        imageCounts[p] = (imageCounts[p] || 0) + 1;
      }
    }
  }

  const themes = {};

  for (const rootId of [roots.bolinhas, roots.geral]) {
    if (!rootId) continue;
    // Evitar processar duas vezes se roots forem iguais
    if (rootId === roots.geral && roots.geral === roots.bolinhas && Object.keys(themes).length > 0) continue;

    const themeFolderIds = folderChildren[rootId] || [];
    for (const themeId of themeFolderIds) {
      const themeMeta = folderMeta[themeId];
      if (!themeMeta) continue;

      function sumImages(nodeId) {
        let sum = imageCounts[nodeId] || 0;
        const children = folderChildren[nodeId] || [];
        for (const childId of children) {
          sum += sumImages(childId);
        }
        return sum;
      }
      function sumFolders(nodeId) {
        const children = folderChildren[nodeId] || [];
        let count = children.length;
        for (const childId of children) {
          count += sumFolders(childId);
        }
        return count;
      }

      const totalImages = sumImages(themeId);
      const totalFolders = sumFolders(themeId);

      const key = `${rootId}_${folderKey(themeMeta.name)}`;
      if (!themes[key]) {
        themes[key] = {
          id: themeId,
          name: themeMeta.name,
          parentId: rootId,
          url: themeMeta.webViewLink || driveFolderUrl(themeId),
          imageCount: totalImages,
          folderCount: totalFolders,
          lastSync: new Date().toISOString(),
        };
      } else {
        themes[key].imageCount += totalImages;
        themes[key].folderCount = (themes[key].folderCount || 0) + totalFolders;
      }
    }
  }

  return writeDriveFolderCache(config, {
    rootFolderIdBolinhas: roots.bolinhas,
    rootFolderIdGeral: roots.geral,
    themes,
    lastSync: new Date().toISOString(),
  });
}

async function getThemeFolderId(config, drive, rootFolderId, themeName) {
  const cache = readDriveFolderCache(config);
  const name = (themeName || "SEM TEMA").trim();
  const key = `${rootFolderId}_${folderKey(name)}`;
  if (cache.themes?.[key]?.id) return cache.themes[key].id;
  const id = await findOrCreateFolder(drive, name, rootFolderId);
  cache.themes = cache.themes || {};
  cache.themes[key] = {
    id,
    name,
    parentId: rootFolderId,
    url: driveFolderUrl(id),
    imageCount: Number(cache.themes[key]?.imageCount || 0),
    lastSync: new Date().toISOString(),
  };
  writeDriveFolderCache(config, cache);
  return id;
}

async function listDriveThemeFolders(config, appRoot, refresh = false) {
  const cache = readDriveFolderCache(config);
  if (!refresh && cache.themes && Object.keys(cache.themes).length > 0) return driveFolderPayload(config, cache);
  const { drive } = await services(config, appRoot);
  const rootFolderName50 = getRootFolderName(config, "PAINEL REDONDO", "50X50");
  const rootFolderId50 = await findOrCreateFolder(drive, rootFolderName50);
  const rootFolderNameOther = getRootFolderName(config, "OTHER", "OTHER");
  const rootFolderIdOther = await findOrCreateFolder(drive, rootFolderNameOther);
  
  const next = await syncThemeFolderCache(config, drive, {
    bolinhas: rootFolderId50,
    geral: rootFolderIdOther
  });
  return driveFolderPayload(config, next);
}

function driveFolderPayload(config, cache) {
  const allFolders = Object.values(cache.themes || {}).sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
  const foldersBolinhas = allFolders.filter(f => f.parentId === cache.rootFolderIdBolinhas);
  const foldersGeral = allFolders.filter(f => f.parentId === cache.rootFolderIdGeral);

  return {
    lastSync: cache.lastSync || "",
    bolinhas: {
      rootFolderId: cache.rootFolderIdBolinhas || "",
      rootFolderName: config.driveFolderBolinhas || "BOLINHAS 50X50",
      rootUrl: cache.rootFolderIdBolinhas ? driveFolderUrl(cache.rootFolderIdBolinhas) : "",
      folders: foldersBolinhas
    },
    geral: {
      rootFolderId: cache.rootFolderIdGeral || "",
      rootFolderName: (config.driveFolderGeral === "PAINÉIS DE FESTA" ? "1poSJTWYybZB1kvRwBK4ZnpVTMtHCpUfE" : config.driveFolderGeral || "1poSJTWYybZB1kvRwBK4ZnpVTMtHCpUfE"),
      rootUrl: cache.rootFolderIdGeral ? driveFolderUrl(cache.rootFolderIdGeral) : "",
      folders: foldersGeral
    }
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
    corpora: "allDrives",
    includeItemsFromAllDrives: true,
    supportsAllDrives: true,
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

async function verifyDriveFiles(config, appRoot, refs = []) {
  const { drive } = await services(config, appRoot);
  const results = [];
  for (const ref of refs) {
    const id = String(ref.id || "").trim();
    const driveFileId = String(ref.driveFileId || driveFileIdFromUrl(ref.url || ref.driveUrl || "")).trim();
    if (!driveFileId) {
      results.push({ id, ok: false, status: "missing_file_id", error: "ID do arquivo no Drive nao encontrado." });
      continue;
    }
    try {
      const { data } = await drive.files.get({
        fileId: driveFileId,
        fields: "id,name,trashed,webViewLink,webContentLink",
        supportsAllDrives: true,
      });
      results.push({
        id,
        ok: Boolean(data?.id && !data?.trashed),
        status: data?.trashed ? "trashed" : "found",
        driveFileId: data?.id || driveFileId,
        name: data?.name || "",
        url: data?.webViewLink || data?.webContentLink || ref.url || ref.driveUrl || "",
      });
    } catch (error) {
      results.push({ id, ok: false, status: "error", driveFileId, error: error.message });
    }
  }
  return results;
}

async function uploadArtworkFromBackup(config, appRoot, payload = {}, options = {}) {
  const { drive } = await services(config, appRoot);
  const id = String(payload.id || "").trim();
  const localImagePath = payload.localImagePath;
  if (!fs.existsSync(localImagePath)) {
    throw new Error("Arquivo local não encontrado para upload: " + localImagePath);
  }

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

  const rootFolderName = getRootFolderName(config, art.product, art.size);
  const rootFolderId = await findOrCreateFolder(drive, rootFolderName);
  const themeFolderId = await getThemeFolderId(config, drive, rootFolderId, art.theme || "Sem tema");
  
  let targetFolderId = themeFolderId;
  if (rootFolderName !== (config.driveFolderBolinhas || "BOLINHAS 50X50")) {
    const productFolderName = getProductFolderName(art.product, art.size);
    targetFolderId = await findOrCreateFolder(drive, productFolderName, themeFolderId);
  }

  const fileName = buildArtworkFilename({
    id,
    theme: art.theme,
    product: art.product,
    size: art.size,
    extension: path.extname(localImagePath) || ".jpg",
  });

  const result = await drive.files.create({
    requestBody: { name: fileName, parents: [targetFolderId] },
    media: { mimeType: mimeTypeForFile(localImagePath), body: fs.createReadStream(localImagePath) },
    fields: "id,name,webViewLink,webContentLink",
  });

  if (config.publicDriveUploads) {
    await drive.permissions.create({
      fileId: result.data.id,
      requestBody: { type: "anyone", role: "reader" },
    }).catch(() => null);
  }

  if (typeof options.persistArtwork !== "function") {
    throw new Error("Upload oficial requer persistência no banco. O Supabase não está configurado ou não pode ser gravado.");
  }

  const found = result.data;
  const url = found.webViewLink || found.webContentLink || `https://drive.google.com/file/d/${found.id}/view`;
  
  const persistPayload = { ...art, url, drive_url: url, driveFileId: found.id, fileName: found.name };
  console.log("PAYLOAD INDO PARA PERSISTARTWORK:", persistPayload);

  const updated = await options.persistArtwork(persistPayload);
    
  return { ok: true, uploaded: true, file: found, ...updated, url };
}

function escapeQuery(value) {
  return String(value).replace(/'/g, "\\'");
}

function getRawCredentials(config, appRoot) {
  const file = credentialsPath(config, appRoot);
  if (!fs.existsSync(file)) return null;
  try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return null; }
}

function getRawToken(config) {
  const file = tokenPath(config);
  if (!fs.existsSync(file)) return null;
  try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return null; }
}

function saveRawCredentials(config, appRoot, json) {
  if (!json) return;
  const file = copyLegacyCredentialsIfNeeded(config, appRoot); // ensures directory
  fs.writeFileSync(file, JSON.stringify(json, null, 2), "utf8");
}

function saveRawToken(config, json) {
  if (!json) return;
  const previous = getRawToken(config) || {};
  const merged = { ...previous, ...json };
  if (!json.refresh_token && previous.refresh_token) merged.refresh_token = previous.refresh_token;
  const file = tokenPath(config);
  fs.writeFileSync(file, JSON.stringify(merged, null, 2), "utf8");
  return merged;
}

module.exports = {
  configureRuntimeHooks,
  authStatus,
  authenticate,
  submitAuthCode,
  provision,
  uploadBatch,
  dashboardData,
  listArtworks,
  nextAvailableArtworkIds,
  updateArtwork,
  refreshArtworkUrlFromDrive,
  uploadArtworkFromBackup,
  deleteArtwork,
  lockStatus,
  testConnectivity,
  assertDriveUploadReady,
  syncThemeFolderCache,
  listDriveThemeFolders,
  findOrCreateFolder,
  copyLegacyCredentialsIfNeeded,
  tokenPath,
  credentialsPath,
  services,
  verifyDriveFiles,
  getRawCredentials,
  getRawToken,
  saveRawCredentials,
  saveRawToken,
};
