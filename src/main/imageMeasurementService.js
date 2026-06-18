const fs = require("node:fs");
const path = require("node:path");
const sharp = require("sharp");
const UTIF = require("utif");
const { imageSizeFromFile } = require("image-size/fromFile");

const CM_PER_INCH = 2.54;

const TARGET_RULES = Object.freeze({
  bolinha: Object.freeze({
    label: "Bolinha 58x58 cm",
    ranges: Object.freeze([
      Object.freeze({ minWidth: 57, maxWidth: 59, minHeight: 57, maxHeight: 59 }),
    ]),
  }),
  painel_150: Object.freeze({
    label: "Painel 158x158 ou 163x158 cm",
    ranges: Object.freeze([
      Object.freeze({ minWidth: 157, maxWidth: 159, minHeight: 157, maxHeight: 159 }),
      Object.freeze({ minWidth: 162, maxWidth: 164, minHeight: 157, maxHeight: 159, allowRotation: true }),
    ]),
  }),
});

function rationalValue(value) {
  if (!Array.isArray(value) || !value.length) return Number(value) || 0;
  if (value.length >= 2 && Number(value[1])) return Number(value[0]) / Number(value[1]);
  return Number(value[0]) || 0;
}

function readTiffResolution(filePath) {
  if (![".tif", ".tiff"].includes(path.extname(filePath).toLowerCase())) return null;
  try {
    const ifd = UTIF.decode(fs.readFileSync(filePath))?.[0];
    if (!ifd) return null;
    const rawX = rationalValue(ifd.t282);
    const rawY = rationalValue(ifd.t283) || rawX;
    const unit = Number(ifd.t296?.[0] || ifd.t296 || 2);
    if (!(rawX > 0) || !(rawY > 0)) return null;
    if (unit === 3) {
      return { dpiX: rawX * CM_PER_INCH, dpiY: rawY * CM_PER_INCH, source: "tiff-tags" };
    }
    if (unit === 2) {
      return { dpiX: rawX, dpiY: rawY, source: "tiff-tags" };
    }
    return null;
  } catch {
    return null;
  }
}

async function readImagePhysicalSize(filePath) {
  let pixelSize;
  try {
    pixelSize = await imageSizeFromFile(filePath);
  } catch (error) {
    return {
      widthPx: 0,
      heightPx: 0,
      widthCm: null,
      heightCm: null,
      dpiX: null,
      dpiY: null,
      hasReliableDpi: false,
      source: "image-size",
      error: `Não foi possível ler o tamanho da imagem: ${error.message}`,
    };
  }

  let metadata = {};
  try {
    metadata = await sharp(filePath, { limitInputPixels: false }).metadata();
  } catch {}

  let widthPx = Number(pixelSize.width || metadata.width || 0);
  let heightPx = Number(pixelSize.height || metadata.height || 0);
  const metadataHasPhysicalUnit = metadata.resolutionUnit === "inch"
    || metadata.resolutionUnit === "cm";
  let dpiX = metadataHasPhysicalUnit ? Number(metadata.density || 0) : 0;
  let dpiY = dpiX;
  let source = "image-size+sharp";

  const tiffResolution = readTiffResolution(filePath);
  if (tiffResolution) {
    dpiX = tiffResolution.dpiX;
    dpiY = tiffResolution.dpiY;
    source = `image-size+${tiffResolution.source}`;
  }

  const orientation = Number(metadata.orientation || pixelSize.orientation || 1);
  if (orientation >= 5 && orientation <= 8) {
    [widthPx, heightPx] = [heightPx, widthPx];
    [dpiX, dpiY] = [dpiY, dpiX];
  }

  const hasReliableDpi = Number.isFinite(dpiX) && dpiX > 0
    && Number.isFinite(dpiY) && dpiY > 0;

  if (!widthPx || !heightPx || !hasReliableDpi) {
    return {
      widthPx,
      heightPx,
      widthCm: null,
      heightCm: null,
      dpiX: hasReliableDpi ? dpiX : null,
      dpiY: hasReliableDpi ? dpiY : null,
      dpi: hasReliableDpi && dpiX === dpiY ? dpiX : null,
      hasReliableDpi: false,
      source,
      error: !widthPx || !heightPx
        ? "Largura ou altura em pixels não encontrada."
        : "DPI físico ausente ou inválido.",
    };
  }

  return {
    widthPx,
    heightPx,
    widthCm: (widthPx / dpiX) * CM_PER_INCH,
    heightCm: (heightPx / dpiY) * CM_PER_INCH,
    dpiX,
    dpiY,
    dpi: dpiX === dpiY ? dpiX : null,
    hasReliableDpi: true,
    source,
    error: "",
  };
}

function inRange(width, height, range) {
  return width >= range.minWidth && width <= range.maxWidth
    && height >= range.minHeight && height <= range.maxHeight;
}

function formatPhysicalSize(dimensions) {
  if (!dimensions?.hasReliableDpi) return "DPI físico ausente ou inválido";
  return `${dimensions.widthCm.toFixed(2)}x${dimensions.heightCm.toFixed(2)} cm`;
}

function validateDimensionsForTarget(dimensions, target) {
  const rule = TARGET_RULES[target];
  if (!rule) {
    return {
      valid: true,
      reason: "",
      actualSize: "",
      expectedSize: "",
      targetLabel: "",
    };
  }
  if (!dimensions?.hasReliableDpi
    || !Number.isFinite(dimensions.widthCm)
    || !Number.isFinite(dimensions.heightCm)) {
    return {
      valid: false,
      reason: dimensions?.error || "DPI físico ausente ou inválido",
      actualSize: dimensions?.error || "DPI físico ausente ou inválido",
      expectedSize: rule.label,
      targetLabel: rule.label,
    };
  }

  const width = dimensions.widthCm;
  const height = dimensions.heightCm;
  const valid = rule.ranges.some((range) => (
    inRange(width, height, range)
    || (range.allowRotation && inRange(height, width, range))
  ));

  return {
    valid,
    reason: valid ? "" : `${formatPhysicalSize(dimensions)} — esperado: ${rule.label}`,
    actualSize: formatPhysicalSize(dimensions),
    expectedSize: rule.label,
    targetLabel: rule.label,
  };
}

async function inspectImageFiles(filePaths, target) {
  const inspected = await Promise.all(filePaths.map(async (filePath) => {
    const dimensions = await readImagePhysicalSize(filePath);
    const validation = validateDimensionsForTarget(dimensions, target);
    return {
      path: filePath,
      name: path.basename(filePath),
      dimensions,
      valid: validation.valid,
      reason: validation.reason,
      actualSize: validation.actualSize,
      expectedSize: validation.expectedSize,
    };
  }));

  return {
    valid: inspected.filter((item) => item.valid),
    rejected: inspected.filter((item) => !item.valid),
  };
}

module.exports = {
  TARGET_RULES,
  readImagePhysicalSize,
  validateDimensionsForTarget,
  formatPhysicalSize,
  inspectImageFiles,
};
