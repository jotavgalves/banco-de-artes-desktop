const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const googleService = require("../src/main/googleService");
const photoshopService = require("../src/main/photoshopService");

async function main() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "banco-preflight-"));
  const inputFolder = path.join(root, "SKU - TESTE");
  const organizedRoot = path.join(root, "organizados");
  const driveRoot = path.join(root, "drive-local");
  const mockupPath = path.join(root, "mockup.psb");
  fs.mkdirSync(inputFolder, { recursive: true });
  fs.writeFileSync(path.join(inputFolder, "901_TESTE_PAINEL REDONDO_50X50.tif"), "fake-tif", "utf8");
  fs.writeFileSync(mockupPath, "fake-psb", "utf8");

  const original = googleService.assertDriveUploadReady;
  googleService.assertDriveUploadReady = async () => {
    throw new Error("preflight fake falhou");
  };

  try {
    let failedEarly = false;
    try {
      await photoshopService.runPanel50Batch({
        fixedDataFolder: path.join(root, "data"),
        panel50OrganizedRoot: organizedRoot,
        panel50DriveLocalRoot: driveRoot,
        panel50MockupPath: mockupPath,
        supabaseEnabled: false,
      }, root, {
        inputFolder,
        organizedRoot,
        driveLocalRoot: driveRoot,
        mockupPath,
        theme: "TESTE",
        uploadAfter: true,
      }, { name: "Teste", login: "teste" }, () => {});
    } catch (error) {
      failedEarly = /Preflight|preflight fake/i.test(error.message);
    }

    const sourceStillThere = fs.existsSync(path.join(inputFolder, "901_TESTE_PAINEL REDONDO_50X50.tif"));
    const movedFile = path.join(organizedRoot, "TESTE", "901", "901_TESTE_PAINEL REDONDO_50X50.tif");
    const moved = fs.existsSync(movedFile);
    if (!failedEarly) throw new Error("A automacao nao falhou no preflight.");
    if (!sourceStillThere) throw new Error("A arte saiu da pasta origem antes do preflight aprovar.");
    if (moved) throw new Error("A arte foi movida mesmo com preflight falhando.");
    console.log("Preflight order check OK");
  } finally {
    googleService.assertDriveUploadReady = original;
    fs.rmSync(root, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
