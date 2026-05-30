const fs = require("node:fs");
const path = require("node:path");
const { app } = require("electron");
const googleService = require("./googleService");
const { BASE_SHEETS, OPERATIONAL_SHEETS } = require("../shared/defaults");
const { loadConfig } = require("./configStore");

// Sincronizador periódico de dados (Cache Json) da Planilha Central
let syncInterval = null;
let isSyncing = false;

function userDataDir() {
  return typeof app?.getPath === "function" ? app.getPath("userData") : process.cwd();
}

function fixedDataDir(config) {
  const preferred = config.fixedDataFolder || "C:\\BancoDeArtes";
  try {
    fs.mkdirSync(preferred, { recursive: true });
    return preferred;
  } catch {
    const fallback = path.join(userDataDir(), "shared-data");
    fs.mkdirSync(fallback, { recursive: true });
    return fallback;
  }
}

function cachePath(config) {
  return path.join(fixedDataDir(config), "bancoCache.json");
}

function getCache(config) {
  const file = cachePath(config);
  if (!fs.existsSync(file)) return emptyCache();
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return emptyCache();
  }
}

function emptyCache() {
  return {
    users: [],
    reservations: [],
    online: [],
    configs: {},
    artworksMap: {}, // id -> boolean
    lastSync: null,
  };
}

async function runSync() {
  if (isSyncing) return getCache(loadConfig());
  isSyncing = true;
  const config = loadConfig();
  const cache = getCache(config);
  try {
    const authStatus = await googleService.authStatus(config, app.getAppPath());
    if (!authStatus.authenticated || !config.baseSpreadsheetId) {
      isSyncing = false;
      return cache;
    }

    const { sheets, drive } = await googleService.services(config, app.getAppPath());
    
    // Ler base
    const baseData = await sheets.spreadsheets.values.batchGet({
      spreadsheetId: config.baseSpreadsheetId,
      ranges: [
        `'${BASE_SHEETS.users.name}'!A2:E`,
        `'${BASE_SHEETS.config.name}'!A2:B`,
        `'${BASE_SHEETS.execution.name}'!G2:H2`,
      ]
    }).catch(() => ({ data: { valueRanges: [] } }));
    
    const usersRows = baseData.data.valueRanges?.[0]?.values || [];
    const configRows = baseData.data.valueRanges?.[1]?.values || [];
    const globalRows = baseData.data.valueRanges?.[2]?.values || [];

    const users = usersRows.map(row => ({
      login: row[0] || "",
      name: row[1] || "",
      role: row[2] || "operator",
      active: row[3] === "TRUE",
      password: row[4] || "", // Hashed
    })).filter(u => u.login);

    const configs = {};
    for (const [k, v] of configRows) {
      if (k) configs[k] = v;
    }

    // Lendo a planilha operacional (IDs para barragem)
    let artworksMap = {};
    if (config.operationalSpreadsheetId) {
       const artRows = await googleService.readCadastroRows(sheets, config).catch(() => []);
       for (const row of artRows) {
          const id = row[0];
          if (id) artworksMap[id.toString()] = true;
       }
    }

    let globalSessions = [];
    let globalReservations = [];
    try {
      if (globalRows[0] && globalRows[0][0]) globalSessions = JSON.parse(globalRows[0][0]);
    } catch {}
    try {
      if (globalRows[0] && globalRows[0][1]) globalReservations = JSON.parse(globalRows[0][1]);
    } catch {}

    let driveFolders = cache.driveFolders || { themes: {} };
    if (config.driveFolderName) {
      const rootFolderId = await googleService.findOrCreateFolder(drive, config.driveFolderName).catch(() => "");
      if (rootFolderId) {
        driveFolders = await googleService.syncThemeFolderCache(config, drive, rootFolderId).catch(() => driveFolders);
      }
    }

    const nextCache = {
      ...cache,
      users,
      configs,
      artworksMap,
      sessions: globalSessions,
      reservations: globalReservations,
      driveFolders,
      lastSync: new Date().toISOString(),
    };

    fs.writeFileSync(cachePath(config), JSON.stringify(nextCache, null, 2), "utf8");
    isSyncing = false;
    return nextCache;

  } catch (error) {
    console.error("Sync Error:", error.message);
    isSyncing = false;
    return cache;
  }
}

function startPeriodicSync() {
  if (syncInterval) clearInterval(syncInterval);
  syncInterval = setInterval(() => {
    runSync().catch(console.error);
  }, 2 * 60 * 1000); // 2 minutos
  
  // Run on startup
  runSync().catch(console.error);
}

module.exports = {
  startPeriodicSync,
  runSync,
  getCache,
};
