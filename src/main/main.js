const path = require("node:path");
const fs = require("node:fs");
const { app, BrowserWindow, ipcMain, shell } = require("electron");
const { loadConfig, saveConfig, setRuntimeConfig } = require("./configStore");
const {
  listCandidateImages,
  filterCandidateImagesByTarget,
  chooseImageFolder,
  chooseMockupFile,
  openArtworkFolder,
} = require("./fileService");
const { buildProvisioningPlan } = require("./googleBlueprint");
const googleService = require("./googleService");
const userService = require("./userService");
const auditService = require("./auditService");
const quarantineService = require("./quarantineService");
const errorLogService = require("./errorLogService");
const { parseArtworkFilename, validateBatchRows } = require("../shared/rules");
const syncService = require("./syncService");
const photoshopService = require("./photoshopService");
const financeService = require("./financeService");
const supabaseService = require("./supabaseService");
const supabaseArtworkService = require("./supabaseArtworkService");
const supabaseCoordinationService = require("./supabaseCoordinationService");
const supabaseConfigService = require("./supabaseConfigService");
const supabaseErrorLogService = require("./supabaseErrorLogService");
const financeHistoryService = require("./financeHistoryService");

let mainWindow;
let externalWindow;

googleService.configureRuntimeHooks({
  currentActor: () => userService.currentActor(loadConfig()),
  openExternal: (url) => shell.openExternal(url),
  loadRemoteGoogleCredentials: (config) => supabaseConfigService.loadGoogleCredentials(config),
  saveRemoteGoogleCredentials: (config, credentials, token) => supabaseConfigService.saveGoogleCredentials(config, credentials, token),
});

const runtimeDir = path.join(process.cwd(), "runtime");
fs.mkdirSync(runtimeDir, { recursive: true });
const cacheDir = path.join(runtimeDir, "cache", `run-${process.pid}`);
fs.mkdirSync(cacheDir, { recursive: true });
app.setPath("userData", runtimeDir);
app.commandLine.appendSwitch("disable-gpu");
app.commandLine.appendSwitch("disable-http-cache");
app.commandLine.appendSwitch("disk-cache-dir", cacheDir);
app.commandLine.appendSwitch("disable-gpu-shader-disk-cache");

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1480,
    height: 920,
    minWidth: 1080,
    minHeight: 720,
    title: "Banco de Artes",
    backgroundColor: "#101318",
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  mainWindow.loadFile(path.join(__dirname, "../renderer/index-premium.html"));
  mainWindow.once("ready-to-show", () => mainWindow.show());
}

function openInAppBrowser(url) {
  if (!externalWindow || externalWindow.isDestroyed()) {
    externalWindow = new BrowserWindow({
      width: 1280,
      height: 860,
      minWidth: 900,
      minHeight: 640,
      title: "Banco de Artes - Navegação",
      autoHideMenuBar: true,
      backgroundColor: "#101318",
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    });
    externalWindow.on("closed", () => { externalWindow = null; });
  }
  externalWindow.loadURL(url);
  externalWindow.show();
  externalWindow.focus();
  return true;
}

app.whenReady().then(async () => {
  registerIpc();
  createWindow();
  syncService.startPeriodicSync();
  financeHistoryService.purgeOldHistory(app.getPath("userData"), 3);

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

process.on("uncaughtException", (error) => {
  supabaseErrorLogService.record(loadConfig(), {
    source: "main",
    message: error.message,
    stack: error.stack,
    context: { type: "uncaughtException" },
  }).catch((logError) => console.warn(`Log de erro falhou: ${logError.message}`));
});

process.on("unhandledRejection", (reason) => {
  const error = reason instanceof Error ? reason : new Error(String(reason));
  supabaseErrorLogService.record(loadConfig(), {
    source: "main",
    message: error.message,
    stack: error.stack,
    context: { type: "unhandledRejection" },
  }).catch((logError) => console.warn(`Log de erro falhou: ${logError.message}`));
});

function registerIpc() {
  ipcMain.handle("config:get", async () => {
    const config = loadConfig();
    const actor = userService.currentActor(config);
    if (!actor) return publicConfig(config);
    const remote = await supabaseConfigService.loadAppConfig(config).catch(() => null);
    return remote ? setRuntimeConfig(remote) : config;
  });
  ipcMain.handle("config:save", async (_event, config) => {
    requireAdmin();
    return saveEffectiveConfig(config);
  });

  ipcMain.handle("files:scan-images", async (_event, request = null) => {
    requireActor();
    const config = loadConfig();
    const folders = Array.isArray(request) ? request : request?.folders;
    const target = Array.isArray(request) ? "" : String(request?.target || "");
    const scopedConfig = Array.isArray(folders) && folders.length
      ? { ...config, localImageFolders: folders }
      : config;
    const files = await listCandidateImages(app.getAppPath(), scopedConfig);
    if (!target) return files;
    return filterCandidateImagesByTarget(files, target);
  });

  ipcMain.handle("files:choose-image-folder", async () => {
    requireActor();
    return chooseImageFolder(mainWindow);
  });
  ipcMain.handle("files:choose-mockup-file", async () => {
    requireActor();
    return chooseMockupFile(mainWindow);
  });
  ipcMain.handle("files:open-artwork-folder", (_event, payload) => {
    requireActor();
    return openArtworkFolder(loadConfig(), payload?.type, payload?.id);
  });

  ipcMain.handle("files:recover-thumb", async (_event, fullPath) => {
    requireActor();
    const ext = require("path").extname(fullPath).toLowerCase();
    const { thumbnailForFile } = require("./fileService");
    return await thumbnailForFile(fullPath, ext);
  });

  ipcMain.handle("batch:parse-filenames", (_event, files) => {
    requireActor();
    const config = loadConfig();
    return files.map((file) => {
      try {
        return {
          ...file,
          parsed: parseArtworkFilename(file.name, config),
          valid: true,
          errors: [],
        };
      } catch (error) {
        return {
          ...file,
          parsed: null,
          valid: false,
          errors: [error.message],
        };
      }
    });
  });

  ipcMain.handle("batch:validate", (_event, rows) => {
    requireActor();
    const config = loadConfig();
    return validateBatchRows(rows, config);
  });

  ipcMain.handle("google:provisioning-plan", () => {
    requireActor();
    return buildProvisioningPlan(loadConfig());
  });

  ipcMain.handle("google:auth-status", () => {
    requireActor();
    return googleService.authStatus(loadConfig(), app.getAppPath());
  });

  ipcMain.handle("google:authenticate", async () => {
    requireAdmin();
    const config = loadConfig();
    const result = await googleService.authenticate(config, app.getAppPath(), (url) => shell.openExternal(url));
    const sync = result.authenticated
      ? await persistGoogleCredentials(config, true)
      : { synced: false };
    return { ...result, supabaseTokenSynced: sync.synced };
  });
  ipcMain.handle("google:submit-auth-code", async (_event, code) => {
    requireAdmin();
    const config = loadConfig();
    const result = await googleService.submitAuthCode(config, app.getAppPath(), code);
    if (result.authenticated) {
      await persistGoogleCredentials(config, true);
    }
    return result;
  });

  ipcMain.handle("google:provision", async () => {
    requireAdmin();
    const result = await googleService.provision(loadConfig(), app.getAppPath());
    result.config = await saveEffectiveConfig(result.config);
    return result;
  });
  ipcMain.handle("google:test-connectivity", () => {
    requireActor();
    return googleService.testConnectivity(loadConfig(), app.getAppPath());
  });
  ipcMain.handle("google:drive-folders", (_event, refresh) => {
    requireActor();
    return googleService.listDriveThemeFolders(loadConfig(), app.getAppPath(), Boolean(refresh));
  });
  ipcMain.handle("supabase:status", () => {
    requireActor();
    return supabaseService.status(loadConfig());
  });

  ipcMain.handle("quarantine:list", () => {
    requireActor();
    return quarantineService.listQuarantine(loadConfig());
  });

  ipcMain.handle("quarantine:remove", (_event, id) => {
    requireActor();
    return quarantineService.removeFromQuarantine(loadConfig(), id);
  });

  ipcMain.handle("batch:upload", async (_event, rows) => {
    const actor = requireActor();
    const cfg = { ...loadConfig(), operatorName: actor?.name || loadConfig().operatorName };
    const useSupabaseArtworks = supabaseArtworkService.canWrite(cfg);
    const result = await googleService.uploadBatch(cfg, app.getAppPath(), rows, (progress) => {
      _event.sender.send("batch:upload-progress", progress);
    }, {
      persistArtwork: useSupabaseArtworks
        ? (artwork) => supabaseArtworkService.upsertImportedArtwork(cfg, artwork)
        : null,
      usedArtworkIds: useSupabaseArtworks
        ? () => supabaseArtworkService.usedArtworkIds(cfg)
        : null,
      acquireGlobalLock: useSupabaseArtworks
        ? () => supabaseCoordinationService.acquireOperationLock(cfg, "CADASTRO_ARTE", 15)
        : null,
      releaseGlobalLock: useSupabaseArtworks
        ? (lock) => supabaseCoordinationService.releaseOperationLock(cfg, lock?.id)
        : null,
    });
    
    if (result.failures && result.failures.length > 0) {
      const itemsToQuarantine = result.failures.map(f => ({
        artId: f.id,
        artName: f.fileName || `ID ${f.id}`,
        driveFolderId: f.driveFolderId || null,
        files: [{
          localPath: f.localPath,
          fileName: f.fileName,
          error: f.error
        }]
      }));
      quarantineService.addToQuarantine(cfg, itemsToQuarantine);
      result.quarantinedFiles = itemsToQuarantine;
    } else {
      result.quarantinedFiles = [];
    }

    auditService.record(loadConfig(), actor, "OPERADOR", "UPLOAD_LOTE", `sucessos=${result.successes.length}, falhas=${result.failures.length}`);
    return result;
  });
  ipcMain.handle("photoshop:panel50-batch", async (_event, payload) => {
    const actor = requireActor();
    const result = await photoshopService.runPanel50Batch(loadConfig(), app.getAppPath(), payload, actor, (progress) => {
      _event.sender.send("batch:upload-progress", progress);
    });
    auditService.record(loadConfig(), actor, "OPERADOR", "AUTOMACAO_PAINEL_50", `total=${result.items.length}, enviados=${result.counts.upload_ok || 0}`);
    return result;
  });
  ipcMain.handle("finance:clients", () => {
    requireActor();
    return financeService.listClients(loadConfig());
  });
  ipcMain.handle("finance:preview", async (_event, ids) => {
    requireActor();
    console.log("[finance:preview] START ids=", ids);
    const t0 = Date.now();
    try {
      const result = await financeService.previewOrder(loadConfig(), ids);
      console.log("[finance:preview] DONE in", Date.now() - t0, "ms, results=", result?.length);
      return result;
    } catch (err) {
      console.error("[finance:preview] ERROR in", Date.now() - t0, "ms:", err);
      throw err;
    }
  });
  
  ipcMain.handle("finance:measure-dimensions", (_event, folderPath) => {
    requireActor();
    return financeService.batchMeasureDimensionsCm(folderPath);
  });
  ipcMain.handle("finance:copy-order", async (event, payload) => {
    const actor = requireActor();
    const result = await financeService.copyOrder(loadConfig(), payload, (progress) => {
      event.sender.send("finance:copy-progress", progress);
    });
    auditService.record(loadConfig(), actor, "OPERADOR", "FINANCEIRO_COPIAR_PEDIDO", `cliente=${result.client.label}, itens=${result.copied.length}`);
    return result;
  });

  ipcMain.handle("auth:bootstrap-status", () => userService.bootstrapStatus(loadConfig()));
  ipcMain.handle("auth:create-admin", (_event, payload) => userService.createAdmin(loadConfig(), payload));
  ipcMain.handle("auth:login", async (_event, payload) => {
    const result = await userService.login(loadConfig(), payload.login, payload.password);
    const remoteConfig = await supabaseConfigService.migrateLocalConfigIfMissing(loadConfig()).catch((error) => {
      console.warn(`Config Supabase indisponível: ${error.message}`);
      return null;
    });
    if (remoteConfig) saveConfig(remoteConfig);
    
    try {
      const googleSync = await supabaseConfigService.loadGoogleCredentials(loadConfig());
      if (googleSync && googleSync.credentials && googleSync.token) {
        googleService.saveRawCredentials(loadConfig(), app.getAppPath(), googleSync.credentials);
        googleService.saveRawToken(loadConfig(), googleSync.token);
      }
    } catch (err) {
      console.warn("Falha ao puxar credenciais do Google do Supabase:", err.message);
    }
    
    auditService.record(loadConfig(), userService.currentActor(loadConfig()), "AUTH", "LOGIN", `provider=${result.provider}`);
    return { ...result, config: loadConfig() };
  });

  ipcMain.handle("auth:current-session", async () => {
    const actor = userService.currentActor(loadConfig());
    if (actor) {
      return { user: actor, session: { id: "local-memory", expiresAt: actor.expiresAt }, provider: actor.provider };
    }
    return null;
  });

  ipcMain.handle("auth:auto-login-desktop", async () => {
    const os = require("os");
    const fs = require("fs");
    const path = require("path");
    const desktopPath = path.join(os.homedir(), "Desktop", "autologin.txt");
    if (!fs.existsSync(desktopPath)) return null;
    try {
      const content = fs.readFileSync(desktopPath, "utf-8").trim().split(/\r?\n/).map(l => l.trim());
      if (content.length > 0 && content[0]) {
        const payload = { login: content[0], password: content[1] || "" };
        const result = await userService.login(loadConfig(), payload.login, payload.password);
        auditService.record(loadConfig(), result.user, "AUTH", "AUTO_LOGIN_DESKTOP", `provider=${result.provider}`);
        return { ...result, config: loadConfig() };
      }
    } catch (e) {
      console.warn("Auto login desktop failed:", e.message);
    }
    return null;
  });

  ipcMain.handle("auth:logout", async () => {
    const actor = userService.currentActor(loadConfig());
    auditService.record(loadConfig(), actor, "AUTH", "LOGOUT", "");
    return userService.logout(loadConfig());
  });
  ipcMain.handle("auth:heartbeat", (_event, currentView) => userService.heartbeat(loadConfig(), currentView));
  ipcMain.handle("errors:record", async (_event, payload) => {
    try {
      return await supabaseErrorLogService.record(loadConfig(), payload);
    } catch (error) {
      console.warn(`Log de erro Supabase falhou: ${error.message}`);
      return { ok: false, message: error.message };
    }
  });
  ipcMain.handle("users:online", () => {
    requireActor();
    return userService.onlineUsers(loadConfig());
  });
  ipcMain.handle("users:list", () => {
    requireActor();
    return userService.listUsers(loadConfig());
  });
  ipcMain.handle("users:create", async (_event, payload) => {
    const actor = requireAdmin();
    const user = await userService.createUser(loadConfig(), payload, actor);
    auditService.record(loadConfig(), actor, "ADMIN", "CRIAR_USUARIO", user.login);
    return user;
  });
  ipcMain.handle("users:set-active", async (_event, payload) => {
    const actor = requireAdmin();
    const result = await userService.setUserActive(loadConfig(), payload.userId, payload.active, actor);
    auditService.record(loadConfig(), actor, "ADMIN", payload.active ? "ATIVAR_USUARIO" : "DESATIVAR_USUARIO", `login=${payload.userId}`);
    return result;
  });
  ipcMain.handle("users:update", async (_event, payload) => {
    const actor = requireAdmin();
    const result = await userService.updateUser(loadConfig(), payload, actor);
    auditService.record(loadConfig(), actor, "ADMIN", "EDITAR_USUARIO", `login=${payload.userId}, novo_login=${payload.login || payload.userId}`);
    return result;
  });
  ipcMain.handle("users:reset-password", async (_event, payload) => {
    const actor = requireAdmin();
    const result = await userService.resetPassword(loadConfig(), payload, actor);
    auditService.record(loadConfig(), actor, "ADMIN", "TROCAR_SENHA_USUARIO", `login=${payload.userId}`);
    return result;
  });
  ipcMain.handle("users:delete", async (_event, userId) => {
    const actor = requireAdmin();
    const result = await userService.deleteUser(loadConfig(), userId, actor);
    auditService.record(loadConfig(), actor, "ADMIN", "APAGAR_USUARIO", `login=${userId}`);
    return result;
  });
  ipcMain.handle("reservations:list", () => {
    requireActor();
    return userService.listReservations(loadConfig());
  });
  ipcMain.handle("reservations:create", async (_event, payload) => {
    const actor = requireActor();
    const result = await userService.reserveIds(loadConfig(), payload, actor);
    auditService.record(loadConfig(), actor, "OPERADOR", "RESERVAR_IDS", `ids=${(result.ids || []).join(",")}`);
    return result;
  });
  ipcMain.handle("reservations:release", async (_event, id) => {
    const actor = requireActor();
    const result = await userService.releaseReservation(loadConfig(), id, actor);
    auditService.record(loadConfig(), actor, "OPERADOR", "LIBERAR_RESERVA", `id=${id}`);
    return result;
  });
  ipcMain.handle("dashboard:data", () => {
    requireActor();
    const config = loadConfig();
    return supabaseArtworkService.canRead(config)
      ? supabaseArtworkService.dashboardData(config)
      : googleService.dashboardData(config, app.getAppPath());
  });
  ipcMain.handle("artworks:list", () => {
    requireActor();
    const config = loadConfig();
    return supabaseArtworkService.canRead(config)
      ? supabaseArtworkService.listArtworks(config)
      : googleService.listArtworks(config, app.getAppPath());
  });
  ipcMain.handle("artworks:update", async (_event, payload) => {
    const actor = requireAdmin();
    const config = loadConfig();
    const result = supabaseArtworkService.canWrite(config)
      ? await supabaseArtworkService.updateArtwork(config, payload)
      : await googleService.updateArtwork(config, app.getAppPath(), payload);
    auditService.record(loadConfig(), actor, "OPERADOR", "EDITAR_ARTE", `id=${payload.id}`);
    return result;
  });
  ipcMain.handle("artworks:refresh-url", async (_event, payload) => {
    const actor = requireAdmin();
    const config = loadConfig();
    const result = await googleService.refreshArtworkUrlFromDrive(config, app.getAppPath(), payload, {
      persistArtwork: supabaseArtworkService.canWrite(config)
        ? (artwork) => supabaseArtworkService.updateArtwork(config, artwork)
        : null,
    });
    auditService.record(loadConfig(), actor, "OPERADOR", "ATUALIZAR_URL_ARTE", `id=${payload.id}, uploaded=${Boolean(result.uploaded)}`);
    return result;
  });
  ipcMain.handle("artworks:delete", async (_event, payload) => {
    const actor = requireAdmin();
    const config = loadConfig();
    const result = supabaseArtworkService.canWrite(config)
      ? await supabaseArtworkService.deleteArtwork(config, payload)
      : await googleService.deleteArtwork(config, app.getAppPath(), payload);
    auditService.record(loadConfig(), actor, "ADMIN", "EXCLUIR_ARTE", `id=${payload.id}`);
    return result;
  });
  ipcMain.handle("locks:status", async () => {
    requireActor();
    const supabaseLockStatus = await userService.lockStatus(loadConfig());
    return supabaseLockStatus || googleService.lockStatus(loadConfig(), app.getAppPath());
  });
  ipcMain.handle("audit:list", () => {
    requireActor();
    return auditService.list(loadConfig());
  });
  ipcMain.handle("sync:run", () => {
    requireActor();
    return syncService.runSync();
  });
  ipcMain.handle("app:open-external", (_event, url) => {
    requireActor();
    return shell.openExternal(safeExternalUrl(url)).then(() => true);
  });
}

async function saveEffectiveConfig(config) {
  let saved = saveConfig(config);
  if (supabaseConfigService.canUseRemoteConfig(saved)) {
    saved = await supabaseConfigService.saveAppConfig(saved);
    saveConfig(saved);
  }
  return saved;
}

async function persistGoogleCredentials(config, required = false) {
  try {
    const credentials = googleService.getRawCredentials(config, app.getAppPath());
    const token = googleService.getRawToken(config);
    if (!credentials || !token) {
      if (required) throw new Error("Credenciais ou token Google não encontrados para salvar no Supabase.");
      return { synced: false };
    }
    await supabaseConfigService.saveGoogleCredentials(config, credentials, token);
    return { synced: true };
  } catch (error) {
    if (required) throw error;
    console.warn("Falha ao salvar credenciais do Google no Supabase:", error.message);
    return { synced: false, error: error.message };
  }
}

function currentActor() {
  return userService.currentActor(loadConfig());
}

function requireActor() {
  const actor = currentActor();
  if (!actor) throw new Error("Login necessário.");
  return actor;
}

function requireAdmin() {
  const actor = requireActor();
  if (actor.role !== "admin") throw new Error("Ação restrita ao admin.");
  return actor;
}

function publicConfig(config = {}) {
  return {
    supabaseEnabled: Boolean(config.supabaseEnabled),
    supabaseReadMode: config.supabaseReadMode,
    supabaseAuthMode: config.supabaseAuthMode,
    supabaseAuthEmailDomain: config.supabaseAuthEmailDomain,
    acceptedExtensions: config.acceptedExtensions,
    validProducts: config.validProducts,
    productSizes: config.productSizes,
    maintenanceMode: Boolean(config.maintenanceMode),
  };
}

function safeExternalUrl(url) {
  const parsed = new URL(String(url || ""));
  if (!["http:", "https:"].includes(parsed.protocol)) {
    throw new Error("Link externo bloqueado.");
  }
  return parsed.toString();
}
