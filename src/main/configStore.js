const fs = require("node:fs");
const path = require("node:path");
const { app } = require("electron");
const { DEFAULT_GLOBAL_CONFIG } = require("../shared/defaults");

const BOOTSTRAP_KEYS = new Set([
  "fixedDataFolder",
  "supabaseEnabled",
  "supabaseUrl",
  "supabasePublishableKey",
  "supabaseReadMode",
  "supabaseAuthMode",
  "supabaseAuthEmailDomain",
  "supabaseAdminUsersFunctionName",
]);

let runtimeConfig = null;

function userDataDir() {
  return typeof app?.getPath === "function" ? app.getPath("userData") : process.cwd();
}

function dataDir() {
  const dir = path.join(userDataDir(), "data");
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function configPath() {
  return path.join(dataDir(), "config.json");
}

function loadConfig() {
  if (runtimeConfig) return normalizeConfig(runtimeConfig);
  return loadLocalConfig();
}

function loadLocalConfig() {
  const file = configPath();
  if (!fs.existsSync(file)) {
    writeBootstrapFile(DEFAULT_GLOBAL_CONFIG);
    return { ...DEFAULT_GLOBAL_CONFIG };
  }

  try {
    const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
    return normalizeConfig({ ...DEFAULT_GLOBAL_CONFIG, ...parsed });
  } catch {
    return normalizeConfig({ ...DEFAULT_GLOBAL_CONFIG });
  }
}

function saveConfig(config) {
  const merged = normalizeConfig({ ...DEFAULT_GLOBAL_CONFIG, ...config });
  runtimeConfig = merged;
  saveLocalBootstrap(merged);
  return merged;
}

function saveLocalConfig(config) {
  const merged = normalizeConfig({ ...DEFAULT_GLOBAL_CONFIG, ...config });
  fs.writeFileSync(configPath(), JSON.stringify(merged, null, 2), "utf8");
  return merged;
}

function saveLocalBootstrap(config) {
  const current = loadLocalConfig();
  writeBootstrapFile({ ...current, ...config });
}

function setRuntimeConfig(config) {
  runtimeConfig = normalizeConfig({ ...DEFAULT_GLOBAL_CONFIG, ...config });
  return runtimeConfig;
}

function bootstrapConfig(config = {}) {
  const bootstrap = {};
  for (const key of BOOTSTRAP_KEYS) {
    bootstrap[key] = config[key] ?? DEFAULT_GLOBAL_CONFIG[key];
  }
  return bootstrap;
}

function writeBootstrapFile(config) {
  fs.writeFileSync(configPath(), JSON.stringify(bootstrapConfig(config), null, 2), "utf8");
}

function normalizeConfig(config) {
  const legacyPlaceholderFolder = (value) => /SKU\s*-\s*ATESTE$/i.test(String(value || "").trim());
  const supabaseReadModes = new Set(["supabase-readonly", "supabase"]);
  const supabaseAuthModes = new Set(["local", "hybrid", "supabase"]);
  return {
    ...config,
    panel50SourceRoot: legacyPlaceholderFolder(config.panel50SourceRoot) ? "" : config.panel50SourceRoot,
    panel50LastInputFolder: legacyPlaceholderFolder(config.panel50LastInputFolder) ? "" : config.panel50LastInputFolder,
    supabaseEnabled: Boolean(config.supabaseEnabled),
    supabaseUrl: String(config.supabaseUrl || "").trim(),
    supabasePublishableKey: String(config.supabasePublishableKey || "").trim(),
    supabaseReadMode: supabaseReadModes.has(config.supabaseReadMode) ? config.supabaseReadMode : DEFAULT_GLOBAL_CONFIG.supabaseReadMode,
    supabaseAuthMode: supabaseAuthModes.has(config.supabaseAuthMode) ? config.supabaseAuthMode : DEFAULT_GLOBAL_CONFIG.supabaseAuthMode,
    supabaseAuthEmailDomain: String(config.supabaseAuthEmailDomain || DEFAULT_GLOBAL_CONFIG.supabaseAuthEmailDomain).trim().toLowerCase(),
    supabaseAdminUsersFunctionName: String(config.supabaseAdminUsersFunctionName || DEFAULT_GLOBAL_CONFIG.supabaseAdminUsersFunctionName).trim() || DEFAULT_GLOBAL_CONFIG.supabaseAdminUsersFunctionName,
    acceptedExtensions: Array.from(new Set([
      ...(config.acceptedExtensions || []),
      ...DEFAULT_GLOBAL_CONFIG.acceptedExtensions,
    ].map((ext) => String(ext).toLowerCase()))),
    validProducts: Array.from(new Set([
      ...(config.validProducts || []),
      ...DEFAULT_GLOBAL_CONFIG.validProducts,
    ].map((product) => String(product).toUpperCase()))),
    productSizes: {
      ...DEFAULT_GLOBAL_CONFIG.productSizes,
      ...(config.productSizes || {}),
    },
  };
}

module.exports = {
  BOOTSTRAP_KEYS,
  loadConfig,
  loadLocalConfig,
  saveConfig,
  saveLocalBootstrap,
  saveLocalConfig,
  setRuntimeConfig,
  normalizeConfig,
  configPath,
};
