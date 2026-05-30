const fs = require("node:fs");
const path = require("node:path");
const { app } = require("electron");
const { DEFAULT_GLOBAL_CONFIG } = require("../shared/defaults");

function dataDir() {
  const dir = path.join(app.getPath("userData"), "data");
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function configPath() {
  return path.join(dataDir(), "config.json");
}

function loadConfig() {
  const file = configPath();
  if (!fs.existsSync(file)) {
    saveConfig(DEFAULT_GLOBAL_CONFIG);
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
  fs.writeFileSync(configPath(), JSON.stringify(merged, null, 2), "utf8");
  return merged;
}

function normalizeConfig(config) {
  return {
    ...config,
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
  loadConfig,
  saveConfig,
  configPath,
};
