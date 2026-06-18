const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const sharp = require("sharp");
const googleService = require("../src/main/googleService");
const photoshopService = require("../src/main/photoshopService");
const {
  readImagePhysicalSize,
  validateDimensionsForTarget,
  inspectImageFiles,
} = require("../src/main/imageMeasurementService");

function dimensions(widthCm, heightCm) {
  return {
    widthCm,
    heightCm,
    hasReliableDpi: true,
    error: "",
  };
}

function assertTarget(target, width, height, expected, label) {
  assert.equal(
    validateDimensionsForTarget(dimensions(width, height), target).valid,
    expected,
    label,
  );
}

async function createImage(filePath, widthCm, heightCm, dpi = 100, includeDpi = true) {
  const width = Math.round((widthCm / 2.54) * dpi);
  const height = Math.round((heightCm / 2.54) * dpi);
  const base = sharp({
    create: {
      width,
      height,
      channels: 3,
      background: "#ffffff",
    },
  });
  let image = /\.tiff?$/i.test(filePath) ? base.tiff() : base.jpeg();
  if (includeDpi) image = image.withMetadata({ density: dpi });
  await image.toFile(filePath);
}

async function main() {
  assertTarget("bolinha", 57, 57, true, "Bolinha deve aceitar limite inferior.");
  assertTarget("bolinha", 59, 59, true, "Bolinha deve aceitar limite superior.");
  assertTarget("bolinha", 56.999, 58, false, "Bolinha deve recusar abaixo do limite.");
  assertTarget("bolinha", 59.001, 58, false, "Bolinha deve recusar acima do limite.");
  assertTarget("painel_150", 157, 159, true, "Painel quadrado deve aceitar tolerância.");
  assertTarget("painel_150", 162, 157, true, "Painel 163x158 deve aceitar tolerância.");
  assertTarget("painel_150", 157, 162, true, "Painel girado deve ser aceito.");
  assertTarget("painel_150", 160, 158, false, "Painel fora das duas faixas deve ser recusado.");
  assert.equal(
    validateDimensionsForTarget({ widthCm: null, heightCm: null, hasReliableDpi: false }, "bolinha").valid,
    false,
    "Imagem sem DPI deve ser recusada.",
  );

  const root = fs.mkdtempSync(path.join(os.tmpdir(), "banco-image-target-"));
  const inputFolder = path.join(root, "SKU - TESTE");
  const dataFolder = path.join(root, "data");
  const organizedRoot = path.join(root, "organizados");
  const driveRoot = path.join(root, "drive");
  const mockupPath = path.join(root, "mockup.psb");
  fs.mkdirSync(inputFolder, { recursive: true });
  fs.writeFileSync(mockupPath, "mockup", "utf8");

  const validA = path.join(inputFolder, "arte-a.jpg");
  const invalid = path.join(inputFolder, "arte-fora.jpg");
  const validB = path.join(inputFolder, "arte-b.tif");
  const noDpi = path.join(root, "sem-dpi.jpg");
  await createImage(validA, 58, 58);
  await createImage(invalid, 50, 50);
  await createImage(validB, 58.5, 58.5);
  await createImage(noDpi, 58, 58, 100, false);

  const measured = await readImagePhysicalSize(validA);
  assert.equal(measured.hasReliableDpi, true, "O DPI gravado deve ser reconhecido.");
  assert.ok(Math.abs(measured.widthCm - 58) < 0.02, "A largura física deve ser calculada pelo DPI.");

  const missingDpi = await readImagePhysicalSize(noDpi);
  assert.equal(missingDpi.hasReliableDpi, false, "Não deve existir DPI presumido.");

  const report = await inspectImageFiles([validA, invalid, validB, noDpi], "bolinha");
  assert.equal(report.valid.length, 2, "Somente as duas bolinhas válidas devem passar.");
  assert.deepEqual(
    report.rejected.map((item) => item.name).sort(),
    ["arte-fora.jpg", "sem-dpi.jpg"],
    "O relatório deve identificar os nomes recusados.",
  );

  const originalNextIds = googleService.nextAvailableArtworkIds;
  let requestedIdCount = -1;
  googleService.nextAvailableArtworkIds = async (_config, _appRoot, count) => {
    requestedIdCount = count;
    throw new Error("STOP_AFTER_ID_COUNT");
  };

  try {
    await assert.rejects(
      photoshopService.runPanel50Batch({
        fixedDataFolder: dataFolder,
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
        product: "bolinha",
        uploadAfter: false,
      }, { name: "Teste", login: "teste" }, () => {}),
      /STOP_AFTER_ID_COUNT/,
    );
    assert.equal(requestedIdCount, 2, "Arquivos recusados não podem contar na solicitação de IDs.");
    assert.equal(fs.existsSync(invalid), true, "Arquivo recusado deve permanecer na pasta original.");
  } finally {
    googleService.nextAvailableArtworkIds = originalNextIds;
    fs.rmSync(root, { recursive: true, force: true });
  }

  console.log("Validação física por público-alvo OK");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
