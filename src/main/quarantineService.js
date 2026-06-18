const fs = require("node:fs");
const path = require("node:path");
const { app } = require("electron");

function userDataDir() {
  return typeof app?.getPath === "function" ? app.getPath("userData") : process.cwd();
}

function fixedDataDir(config) {
  const preferred = config?.fixedDataFolder || "C:\\BancoDeArtes";
  try {
    fs.mkdirSync(preferred, { recursive: true });
    return preferred;
  } catch {
    const fallback = path.join(userDataDir(), "shared-data");
    fs.mkdirSync(fallback, { recursive: true });
    return fallback;
  }
}

function getQuarantinePath(config = {}) {
  return path.join(fixedDataDir(config), "quarantine.json");
}

function listQuarantine(config = {}) {
  const filePath = getQuarantinePath(config);
  try {
    if (!fs.existsSync(filePath)) return [];
    const raw = fs.readFileSync(filePath, "utf8");
    return JSON.parse(raw);
  } catch (error) {
    console.warn("Failed to read quarantine list:", error);
    return [];
  }
}

function addToQuarantine(config = {}, items = []) {
  if (!items || items.length === 0) return;
  const currentList = listQuarantine(config);
  
  // Normalize new items
  const newItems = items.map(item => ({
    quarantineId: `${Date.now()}_${item.artId}`,
    timestamp: new Date().toISOString(),
    artId: item.artId || null,
    artName: item.artName || "Sem Nome",
    driveFolderId: item.driveFolderId || null,
    files: Array.isArray(item.files) ? item.files : []
  }));

  const updatedList = [...newItems, ...currentList]; // Prepend new items
  
  try {
    fs.writeFileSync(getQuarantinePath(config), JSON.stringify(updatedList, null, 2), "utf8");
  } catch (error) {
    console.error("Failed to save quarantine list:", error);
  }
}

function removeFromQuarantine(config = {}, quarantineId) {
  const currentList = listQuarantine(config);
  const updatedList = currentList.filter(item => item.quarantineId !== quarantineId);
  
  if (currentList.length === updatedList.length) return false;
  
  try {
    fs.writeFileSync(getQuarantinePath(config), JSON.stringify(updatedList, null, 2), "utf8");
    return true;
  } catch (error) {
    console.error("Failed to update quarantine list:", error);
    return false;
  }
}

module.exports = {
  listQuarantine,
  addToQuarantine,
  removeFromQuarantine
};
