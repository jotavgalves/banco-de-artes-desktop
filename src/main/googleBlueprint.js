const { BASE_SHEETS, OPERATIONAL_SHEETS } = require("../shared/defaults");

function buildProvisioningPlan(config) {
  return {
    baseSpreadsheet: {
      mode: config.baseSpreadsheetId ? "use-existing" : "find-or-create",
      name: config.baseSpreadsheetName,
      id: config.baseSpreadsheetId,
      sheets: Object.values(BASE_SHEETS),
    },
    operationalSpreadsheet: {
      mode: config.operationalSpreadsheetId ? "use-existing" : "needs-admin-target",
      id: config.operationalSpreadsheetId,
      sheets: [
        { name: config.cadastroSheetName, header: OPERATIONAL_SHEETS.cadastroHeader },
        { name: config.operationalLogsSheetName, header: OPERATIONAL_SHEETS.logsHeader },
      ],
    },
    driveFolder: {
      mode: "find-or-create",
      name: config.driveFolderName,
    },
  };
}

module.exports = {
  buildProvisioningPlan,
};
