const fs = require("node:fs");
const path = require("node:path");
const { app } = require("electron");
const googleService = require("./googleService");
const supabaseArtworkService = require("./supabaseArtworkService");
const { loadConfig } = require("./configStore");

// Sincronizador periódico de dados do cache local.
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
    const nextCache = await runOfficialSync(config, cache);
    isSyncing = false;
    return nextCache;
  } catch (error) {
    console.error("Sync Error:", error.message);
    isSyncing = false;
    return cache;
  }
}

async function runOfficialSync(config, cache) {
  let artworksMap = cache.artworksMap || {};
  if (supabaseArtworkService.canRead(config)) {
    const artworks = await supabaseArtworkService.listArtworks(config).catch(() => []);
    artworksMap = {};
    for (const row of artworks) {
      const id = String(row.id || "").trim();
      if (id) artworksMap[id] = row.theme || true;
    }
  }

  let driveFolders = cache.driveFolders || { themes: {} };
  const authStatus = await googleService.authStatus(config, app.getAppPath()).catch(() => ({ authenticated: false }));
  if (authStatus.authenticated && config.driveFolderName) {
    const { drive } = await googleService.services(config, app.getAppPath());
    const rootFolderId = await googleService.findOrCreateFolder(drive, config.driveFolderName).catch(() => "");
    if (rootFolderId) {
      driveFolders = await googleService.syncThemeFolderCache(config, drive, rootFolderId).catch(() => driveFolders);
    }
  }

  const nextCache = {
    ...cache,
    users: [],
    reservations: cache.reservations || [],
    sessions: cache.sessions || [],
    configs: {},
    artworksMap,
    driveFolders,
    source: "supabase",
    lastSync: new Date().toISOString(),
  };
  fs.writeFileSync(cachePath(config), JSON.stringify(nextCache, null, 2), "utf8");
  return nextCache;
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
