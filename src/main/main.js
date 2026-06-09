const path = require("node:path");
const fs = require("node:fs");
const { app, BrowserWindow, ipcMain, shell } = require("electron");
const { loadConfig, saveConfig, setRuntimeConfig } = require("./configStore");
const { listCandidateImages, chooseImageFolder, chooseMockupFile, openArtworkFolder } = require("./fileService");
const { buildProvisioningPlan } = require("./googleBlueprint");
const googleService = require("./googleService");
const userService = require("./userService");
const auditService = require("./auditService");
const { parseArtworkFilename, validateBatchRows } = require("../shared/rules");
const syncService = require("./syncService");
const photoshopService = require("./photoshopService");
const financeService = require("./financeService");
const supabaseService = require("./supabaseService");
const supabaseArtworkService = require("./supabaseArtworkService");
const supabaseCoordinationService = require("./supabaseCoordinationService");
const supabaseConfigService = require("./supabaseConfigService");
const supabaseErrorLogService = require("./supabaseErrorLogService");

let mainWindow;
let externalWindow;

const runtimeDir = path.join(process.cwd(), "runtime");
fs.mkdirSync(runtimeDir, { recursive: true });
app.setPath("userData", runtimeDir);
app.commandLine.appendSwitch("disable-gpu");
app.commandLine.appendSwitch("no-sandbox");
app.commandLine.appendSwitch("disable-http-cache");
app.commandLine.appendSwitch("disable-features", "NetworkServiceSandbox");

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
      },
    });
    externalWindow.on("closed", () => { externalWindow = null; });
  }
  externalWindow.loadURL(url);
  externalWindow.show();
  externalWindow.focus();
  return true;
}

app.whenReady().then(() => {
  registerIpc();
  createWindow();
  syncService.startPeriodicSync();

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
    const remote = await supabaseConfigService.loadAppConfig(config).catch(() => null);
    return remote ? setRuntimeConfig(remote) : config;
  });
  ipcMain.handle("config:save", async (_event, config) => saveEffectiveConfig(config));

  ipcMain.handle("files:scan-images", async (_event, folders = null) => {
    const config = loadConfig();
    const scopedConfig = Array.isArray(folders) && folders.length
      ? { ...config, localImageFolders: folders }
      : config;
    return listCandidateImages(app.getAppPath(), scopedConfig);
  });

  ipcMain.handle("files:choose-image-folder", async () => chooseImageFolder(mainWindow));
  ipcMain.handle("files:choose-mockup-file", async () => chooseMockupFile(mainWindow));
  ipcMain.handle("files:open-artwork-folder", (_event, payload) => openArtworkFolder(loadConfig(), payload?.type, payload?.id));

  ipcMain.handle("batch:parse-filenames", (_event, files) => {
    const config = loadConfig();
    return files.map((file) => {
      try {
        return {
          ...file,
          parsed: parseArtworkFilename(file.name, config.validProducts),
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
    const config = loadConfig();
    return validateBatchRows(rows, config.validProducts);
  });

  ipcMain.handle("google:provisioning-plan", () => buildProvisioningPlan(loadConfig()));

  ipcMain.handle("google:auth-status", () => googleService.authStatus(loadConfig(), app.getAppPath()));

  ipcMain.handle("google:authenticate", () => googleService.authenticate(loadConfig(), app.getAppPath()));

  ipcMain.handle("google:provision", async () => {
    const result = await googleService.provision(loadConfig(), app.getAppPath());
    result.config = await saveEffectiveConfig(result.config);
    return result;
  });
  ipcMain.handle("google:test-connectivity", () => googleService.testConnectivity(loadConfig(), app.getAppPath()));
  ipcMain.handle("google:drive-folders", (_event, refresh) => googleService.listDriveThemeFolders(loadConfig(), app.getAppPath(), Boolean(refresh)));
  ipcMain.handle("supabase:status", () => supabaseService.status(loadConfig()));

  ipcMain.handle("batch:upload", async (_event, rows) => {
    const actor = userService.currentActor(loadConfig());
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
    auditService.record(loadConfig(), actor, "OPERADOR", "UPLOAD_LOTE", `sucessos=${result.successes.length}, falhas=${result.failures.length}`);
    return result;
  });
  ipcMain.handle("photoshop:panel50-batch", async (_event, payload) => {
    const actor = userService.currentActor(loadConfig());
    const result = await photoshopService.runPanel50Batch(loadConfig(), app.getAppPath(), payload, actor, (progress) => {
      _event.sender.send("batch:upload-progress", progress);
    });
    auditService.record(loadConfig(), actor, "OPERADOR", "AUTOMACAO_PAINEL_50", `total=${result.items.length}, enviados=${result.counts.upload_ok || 0}`);
    return result;
  });
  ipcMain.handle("finance:clients", () => financeService.listClients(loadConfig()));
  ipcMain.handle("finance:preview", (_event, ids) => financeService.previewOrder(loadConfig(), ids));
  ipcMain.handle("finance:copy-order", async (_event, payload) => {
    const actor = userService.currentActor(loadConfig());
    const result = await financeService.copyOrder(loadConfig(), payload);
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
    auditService.record(loadConfig(), userService.currentActor(loadConfig()), "AUTH", "LOGIN", `provider=${result.provider}`);
    return { ...result, config: loadConfig() };
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
  ipcMain.handle("users:online", () => userService.onlineUsers(loadConfig()));
  ipcMain.handle("users:list", () => userService.listUsers(loadConfig()));
  ipcMain.handle("users:create", async (_event, payload) => {
    const actor = userService.currentActor(loadConfig());
    const user = await userService.createUser(loadConfig(), payload, actor);
    auditService.record(loadConfig(), actor, "ADMIN", "CRIAR_USUARIO", user.login);
    return user;
  });
  ipcMain.handle("users:set-active", async (_event, payload) => {
    const actor = userService.currentActor(loadConfig());
    const result = await userService.setUserActive(loadConfig(), payload.userId, payload.active, actor);
    auditService.record(loadConfig(), actor, "ADMIN", payload.active ? "ATIVAR_USUARIO" : "DESATIVAR_USUARIO", `login=${payload.userId}`);
    return result;
  });
  ipcMain.handle("users:update", async (_event, payload) => {
    const actor = userService.currentActor(loadConfig());
    const result = await userService.updateUser(loadConfig(), payload, actor);
    auditService.record(loadConfig(), actor, "ADMIN", "EDITAR_USUARIO", `login=${payload.userId}, novo_login=${payload.login || payload.userId}`);
    return result;
  });
  ipcMain.handle("users:reset-password", async (_event, payload) => {
    const actor = userService.currentActor(loadConfig());
    const result = await userService.resetPassword(loadConfig(), payload, actor);
    auditService.record(loadConfig(), actor, "ADMIN", "TROCAR_SENHA_USUARIO", `login=${payload.userId}`);
    return result;
  });
  ipcMain.handle("users:delete", async (_event, userId) => {
    const actor = userService.currentActor(loadConfig());
    const result = await userService.deleteUser(loadConfig(), userId, actor);
    auditService.record(loadConfig(), actor, "ADMIN", "APAGAR_USUARIO", `login=${userId}`);
    return result;
  });
  ipcMain.handle("reservations:list", () => userService.listReservations(loadConfig()));
  ipcMain.handle("reservations:create", async (_event, payload) => {
    const actor = userService.currentActor(loadConfig());
    const result = await userService.reserveIds(loadConfig(), payload, actor);
    auditService.record(loadConfig(), actor, "OPERADOR", "RESERVAR_IDS", `ids=${(result.ids || []).join(",")}`);
    return result;
  });
  ipcMain.handle("reservations:release", async (_event, id) => {
    const actor = userService.currentActor(loadConfig());
    const result = await userService.releaseReservation(loadConfig(), id, actor);
    auditService.record(loadConfig(), actor, "OPERADOR", "LIBERAR_RESERVA", `id=${id}`);
    return result;
  });
  ipcMain.handle("dashboard:data", () => {
    const config = loadConfig();
    return supabaseArtworkService.canRead(config)
      ? supabaseArtworkService.dashboardData(config)
      : googleService.dashboardData(config, app.getAppPath());
  });
  ipcMain.handle("artworks:list", () => {
    const config = loadConfig();
    return supabaseArtworkService.canRead(config)
      ? supabaseArtworkService.listArtworks(config)
      : googleService.listArtworks(config, app.getAppPath());
  });
  ipcMain.handle("artworks:update", async (_event, payload) => {
    const actor = userService.currentActor(loadConfig());
    if (!actor || actor.role !== "admin") throw new Error("Ação restrita ao admin.");
    const config = loadConfig();
    const result = supabaseArtworkService.canWrite(config)
      ? await supabaseArtworkService.updateArtwork(config, payload)
      : await googleService.updateArtwork(config, app.getAppPath(), payload);
    auditService.record(loadConfig(), actor, "OPERADOR", "EDITAR_ARTE", `id=${payload.id}`);
    return result;
  });
  ipcMain.handle("artworks:refresh-url", async (_event, payload) => {
    const actor = userService.currentActor(loadConfig());
    if (!actor || actor.role !== "admin") throw new Error("Ação restrita ao admin.");
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
    const actor = userService.currentActor(loadConfig());
    if (!actor || actor.role !== "admin") throw new Error("Ação restrita ao admin.");
    const config = loadConfig();
    const result = supabaseArtworkService.canWrite(config)
      ? await supabaseArtworkService.deleteArtwork(config, payload)
      : await googleService.deleteArtwork(config, app.getAppPath(), payload);
    auditService.record(loadConfig(), actor, "ADMIN", "EXCLUIR_ARTE", `id=${payload.id}`);
    return result;
  });
  ipcMain.handle("locks:status", async () => {
    const supabaseLockStatus = await userService.lockStatus(loadConfig());
    return supabaseLockStatus || googleService.lockStatus(loadConfig(), app.getAppPath());
  });
  ipcMain.handle("audit:list", () => auditService.list(loadConfig()));
  ipcMain.handle("sync:run", () => syncService.runSync());
  ipcMain.handle("app:open-external", (_event, url) => openInAppBrowser(url));
}

async function saveEffectiveConfig(config) {
  let saved = saveConfig(config);
  if (supabaseConfigService.canUseRemoteConfig(saved)) {
    saved = await supabaseConfigService.saveAppConfig(saved);
    saveConfig(saved);
  }
  return saved;
}
