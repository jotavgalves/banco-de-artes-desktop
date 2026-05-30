const path = require("node:path");
const fs = require("node:fs");
const { app, BrowserWindow, ipcMain, shell } = require("electron");
const { loadConfig, saveConfig } = require("./configStore");
const { listCandidateImages, chooseImageFolder, chooseMockupFile } = require("./fileService");
const { buildProvisioningPlan } = require("./googleBlueprint");
const googleService = require("./googleService");
const userService = require("./userService");
const auditService = require("./auditService");
const { parseArtworkFilename, validateBatchRows } = require("../shared/rules");
const syncService = require("./syncService");
const photoshopService = require("./photoshopService");
const financeService = require("./financeService");

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

function registerIpc() {
  ipcMain.handle("config:get", () => loadConfig());
  ipcMain.handle("config:save", (_event, config) => saveConfig(config));

  ipcMain.handle("files:scan-images", async () => {
    const config = loadConfig();
    return listCandidateImages(app.getAppPath(), config);
  });

  ipcMain.handle("files:choose-image-folder", async () => chooseImageFolder(mainWindow));
  ipcMain.handle("files:choose-mockup-file", async () => chooseMockupFile(mainWindow));

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
    saveConfig(result.config);
    return result;
  });
  ipcMain.handle("google:validate-operational", (_event, spreadsheetId) => googleService.validateOperationalSpreadsheet(loadConfig(), app.getAppPath(), spreadsheetId));
  ipcMain.handle("google:test-connectivity", () => googleService.testConnectivity(loadConfig(), app.getAppPath()));
  ipcMain.handle("google:drive-folders", (_event, refresh) => googleService.listDriveThemeFolders(loadConfig(), app.getAppPath(), Boolean(refresh)));

  ipcMain.handle("batch:upload", async (_event, rows) => {
    const actor = userService.currentActor(loadConfig());
    const cfg = { ...loadConfig(), operatorName: actor?.name || loadConfig().operatorName };
    const result = await googleService.uploadBatch(cfg, app.getAppPath(), rows, (progress) => {
      _event.sender.send("batch:upload-progress", progress);
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
  ipcMain.handle("auth:login", (_event, payload) => userService.login(loadConfig(), payload.login, payload.password));
  ipcMain.handle("auth:logout", () => userService.logout(loadConfig()));
  ipcMain.handle("auth:heartbeat", () => userService.heartbeat(loadConfig()));
  ipcMain.handle("users:online", () => userService.onlineUsers(loadConfig()));
  ipcMain.handle("users:list", () => userService.listUsers(loadConfig()));
  ipcMain.handle("users:create", async (_event, payload) => {
    const actor = userService.currentActor(loadConfig());
    const user = await userService.createUser(loadConfig(), payload, actor);
    auditService.record(loadConfig(), actor, "ADMIN", "CRIAR_USUARIO", user.login);
    return user;
  });
  ipcMain.handle("users:set-active", (_event, payload) => userService.setUserActive(loadConfig(), payload.userId, payload.active, userService.currentActor(loadConfig())));
  ipcMain.handle("users:update", (_event, payload) => userService.updateUser(loadConfig(), payload, userService.currentActor(loadConfig())));
  ipcMain.handle("users:reset-password", (_event, payload) => userService.resetPassword(loadConfig(), payload, userService.currentActor(loadConfig())));
  ipcMain.handle("users:delete", (_event, userId) => userService.deleteUser(loadConfig(), userId, userService.currentActor(loadConfig())));
  ipcMain.handle("reservations:list", () => userService.listReservations(loadConfig()));
  ipcMain.handle("reservations:create", (_event, payload) => userService.reserveIds(loadConfig(), payload, userService.currentActor(loadConfig())));
  ipcMain.handle("reservations:release", (_event, id) => userService.releaseReservation(loadConfig(), id, userService.currentActor(loadConfig())));
  ipcMain.handle("dashboard:data", () => googleService.dashboardData(loadConfig(), app.getAppPath()));
  ipcMain.handle("artworks:list", () => googleService.listArtworks(loadConfig(), app.getAppPath()));
  ipcMain.handle("artworks:update", async (_event, payload) => {
    const actor = userService.currentActor(loadConfig());
    if (!actor || actor.role !== "admin") throw new Error("Ação restrita ao admin.");
    const result = await googleService.updateArtwork(loadConfig(), app.getAppPath(), payload);
    auditService.record(loadConfig(), actor, "OPERADOR", "EDITAR_ARTE", `id=${payload.id}`);
    return result;
  });
  ipcMain.handle("artworks:delete", async (_event, payload) => {
    const actor = userService.currentActor(loadConfig());
    if (!actor || actor.role !== "admin") throw new Error("Ação restrita ao admin.");
    const result = await googleService.deleteArtwork(loadConfig(), app.getAppPath(), payload);
    auditService.record(loadConfig(), actor, "ADMIN", "EXCLUIR_ARTE", `id=${payload.id}`);
    return result;
  });
  ipcMain.handle("locks:status", () => googleService.lockStatus(loadConfig(), app.getAppPath()));
  ipcMain.handle("audit:list", () => auditService.list(loadConfig()));
  ipcMain.handle("sync:run", () => syncService.runSync());
  ipcMain.handle("app:open-external", (_event, url) => openInAppBrowser(url));
}
