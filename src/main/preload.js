const { contextBridge, ipcRenderer } = require("electron");

function injectUxPatch() {
  const inject = () => {
    if (!document.head || !document.body || document.documentElement.dataset.uxPatchInjected) return;
    document.documentElement.dataset.uxPatchInjected = "true";

    const css = document.createElement("link");
    css.rel = "stylesheet";
    css.href = "./ux-dashboard-patch.css";
    document.head.appendChild(css);

    const js = document.createElement("script");
    js.src = "./ux-dashboard-patch.js";
    js.defer = true;
    document.body.appendChild(js);
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", inject, { once: true });
  } else {
    inject();
  }
}

injectUxPatch();

contextBridge.exposeInMainWorld("artBank", {
  getConfig: () => ipcRenderer.invoke("config:get"),
  saveConfig: (config) => ipcRenderer.invoke("config:save", config),
  scanImages: () => ipcRenderer.invoke("files:scan-images"),
  chooseImageFolder: () => ipcRenderer.invoke("files:choose-image-folder"),
  chooseMockupFile: () => ipcRenderer.invoke("files:choose-mockup-file"),
  validateBatch: (rows) => ipcRenderer.invoke("batch:validate", rows),
  parseFilenames: (files) => ipcRenderer.invoke("batch:parse-filenames", files),
  getProvisioningPlan: () => ipcRenderer.invoke("google:provisioning-plan"),
  getAuthStatus: () => ipcRenderer.invoke("google:auth-status"),
  authenticateGoogle: () => ipcRenderer.invoke("google:authenticate"),
  provisionGoogle: () => ipcRenderer.invoke("google:provision"),
  validateOperationalSpreadsheet: (spreadsheetId) => ipcRenderer.invoke("google:validate-operational", spreadsheetId),
  testConnectivity: () => ipcRenderer.invoke("google:test-connectivity"),
  listDriveFolders: (refresh) => ipcRenderer.invoke("google:drive-folders", refresh),
  uploadBatch: (rows) => ipcRenderer.invoke("batch:upload", rows),
  runPanel50Batch: (payload) => ipcRenderer.invoke("photoshop:panel50-batch", payload),
  listFinanceClients: () => ipcRenderer.invoke("finance:clients"),
  previewFinanceOrder: (ids) => ipcRenderer.invoke("finance:preview", ids),
  copyFinanceOrder: (payload) => ipcRenderer.invoke("finance:copy-order", payload),
  onUploadProgress: (callback) => ipcRenderer.on("batch:upload-progress", (_event, payload) => callback(payload)),
  bootstrapStatus: () => ipcRenderer.invoke("auth:bootstrap-status"),
  createAdmin: (payload) => ipcRenderer.invoke("auth:create-admin", payload),
  login: (payload) => ipcRenderer.invoke("auth:login", payload),
  logout: () => ipcRenderer.invoke("auth:logout"),
  heartbeat: () => ipcRenderer.invoke("auth:heartbeat"),
  onlineUsers: () => ipcRenderer.invoke("users:online"),
  listUsers: () => ipcRenderer.invoke("users:list"),
  createUser: (payload) => ipcRenderer.invoke("users:create", payload),
  setUserActive: (payload) => ipcRenderer.invoke("users:set-active", payload),
  updateUser: (payload) => ipcRenderer.invoke("users:update", payload),
  resetPassword: (payload) => ipcRenderer.invoke("users:reset-password", payload),
  deleteUser: (userId) => ipcRenderer.invoke("users:delete", userId),
  listReservations: () => ipcRenderer.invoke("reservations:list"),
  createReservation: (payload) => ipcRenderer.invoke("reservations:create", payload),
  releaseReservation: (id) => ipcRenderer.invoke("reservations:release", id),
  dashboardData: () => ipcRenderer.invoke("dashboard:data"),
  listArtworks: () => ipcRenderer.invoke("artworks:list"),
  updateArtwork: (payload) => ipcRenderer.invoke("artworks:update", payload),
  deleteArtwork: (payload) => ipcRenderer.invoke("artworks:delete", payload),
  lockStatus: () => ipcRenderer.invoke("locks:status"),
  auditList: () => ipcRenderer.invoke("audit:list"),
  runSync: () => ipcRenderer.invoke("sync:run"),
  openExternal: (url) => ipcRenderer.invoke("app:open-external", url),
});
