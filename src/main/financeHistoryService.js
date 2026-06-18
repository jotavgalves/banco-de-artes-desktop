const fs = require("node:fs");
const path = require("node:path");

function getHistoryPath(userDataPath) {
  return path.join(userDataPath, "finance_history.json");
}

function getHistory(userDataPath) {
  const filePath = getHistoryPath(userDataPath);
  try {
    if (!fs.existsSync(filePath)) return [];
    const raw = fs.readFileSync(filePath, "utf8");
    return JSON.parse(raw);
  } catch (error) {
    console.warn("Failed to read finance history:", error);
    return [];
  }
}

function saveHistory(userDataPath, order) {
  const history = getHistory(userDataPath);
  
  const newRecord = {
    id: Date.now().toString(),
    timestamp: new Date().toISOString(),
    clientQuery: order.clientQuery,
    newClientName: order.newClientName,
    items: order.items || []
  };

  history.unshift(newRecord); // Add to top

  try {
    fs.writeFileSync(getHistoryPath(userDataPath), JSON.stringify(history, null, 2), "utf8");
    return newRecord;
  } catch (error) {
    console.warn("Failed to save finance history:", error);
    return null;
  }
}

function deleteHistory(userDataPath, id) {
  let history = getHistory(userDataPath);
  history = history.filter(h => h.id !== id);
  try {
    fs.writeFileSync(getHistoryPath(userDataPath), JSON.stringify(history, null, 2), "utf8");
    return true;
  } catch (error) {
    console.warn("Failed to delete finance history:", error);
    return false;
  }
}

function purgeOldHistory(userDataPath, days = 3) {
  let history = getHistory(userDataPath);
  const now = new Date();
  
  const initialLength = history.length;
  history = history.filter(h => {
    if (!h.timestamp) return false;
    const recordDate = new Date(h.timestamp);
    const diffTime = Math.abs(now - recordDate);
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24)); 
    return diffDays <= days;
  });

  if (history.length < initialLength) {
    try {
      fs.writeFileSync(getHistoryPath(userDataPath), JSON.stringify(history, null, 2), "utf8");
      console.log(`Purged ${initialLength - history.length} old finance orders.`);
    } catch (error) {
      console.warn("Failed to purge finance history:", error);
    }
  }
}

module.exports = {
  getHistory,
  saveHistory,
  deleteHistory,
  purgeOldHistory
};