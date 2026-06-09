function buildProvisioningPlan(config) {
  return {
    driveFolder: {
      mode: "find-or-create",
      name: config.driveFolderName,
    },
  };
}

module.exports = {
  buildProvisioningPlan,
};
