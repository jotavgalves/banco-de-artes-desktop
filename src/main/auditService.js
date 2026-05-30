const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { app } = require("electron");

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

function logsPath(config) {
  return path.join(fixedDataDir(config), "audit.json");
}

function readLogs(config) {
  const file = logsPath(config);
  if (!fs.existsSync(file)) return [];
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return [];
  }
}

function writeLogs(config, rows) {
  fs.writeFileSync(logsPath(config), JSON.stringify(rows.slice(-1000), null, 2), "utf8");
}

function record(config, actor, type, action, details = "") {
  const rows = readLogs(config);
  rows.push({
    id: cryptoId(),
    at: new Date().toISOString(),
    type,
    action,
    details,
    login: actor?.login || "sistema",
    name: actor?.name || "Sistema",
    role: actor?.role || "system",
    machine: os.hostname(),
  });
  writeLogs(config, rows);
}

function list(config, limit = 120) {
  return readLogs(config).slice(-limit).reverse();
}

function cryptoId() {
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

module.exports = {
  record,
  list,
};
