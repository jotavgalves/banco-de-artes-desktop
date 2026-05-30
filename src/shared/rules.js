function normalizeText(value) {
  return String(value || "").trim().toUpperCase().replace(/\s+/g, " ");
}

function normalizeDimension(value) {
  const text = normalizeText(value);
  if (!text) throw new Error("Dimensao vazia.");
  if (/^\d+$/.test(text)) return `${text}X${text}`;
  return text;
}

function validateProduct(value, validProducts) {
  const product = normalizeText(value);
  if (!product) throw new Error("Produto vazio.");
  if (/\d/.test(product)) throw new Error("O produto não pode conter números.");
  if (validProducts?.length && !validProducts.includes(product)) {
    throw new Error(`Produto inválido. Permitidos: ${validProducts.join(", ")}`);
  }
  return product;
}

function sizeOptionsForProduct(product, config = {}) {
  const normalized = normalizeText(product);
  const map = config.productSizes || {};
  return map[normalized] || [];
}

function parseArtworkFilename(filename, validProducts) {
  const stem = filename.replace(/\.[^.]+$/, "").trim();
  const parts = stem.split("_").map((part) => part.trim()).filter(Boolean);
  if (parts.length !== 4) {
    throw new Error("Nome inválido. Use: ID_TEMA_PRODUTO_DIMENSAO.jpg");
  }

  const [id, theme, product, dimension] = parts;
  if (!/^\d+$/.test(id)) {
    throw new Error("ID inválido. O primeiro campo deve ser numérico.");
  }

  return {
    id,
    theme: normalizeText(theme),
    product: validateProduct(product, validProducts),
    size: normalizeDimension(dimension),
  };
}

function buildArtworkFilename({ id, theme, product, size, extension = ".jpg" }) {
  const cleanExtension = extension.startsWith(".") ? extension : `.${extension}`;
  return [
    String(id).trim(),
    normalizeText(theme),
    normalizeText(product),
    normalizeDimension(size),
  ].join("_") + cleanExtension.toLowerCase();
}

function validateBatchRows(rows, validProducts) {
  const seenIds = new Map();
  return rows.map((row, index) => {
    const errors = [];
    let parsed = null;
    try {
      parsed = {
        id: String(row.id || "").trim(),
        theme: normalizeText(row.theme),
        product: validateProduct(row.product, validProducts),
        size: normalizeDimension(row.size),
        client: normalizeText(row.client),
        phone: String(row.phone || "").trim(),
      };
      if (!/^\d+$/.test(parsed.id)) errors.push("ID deve ser numérico");
      if (seenIds.has(parsed.id)) errors.push(`ID repetido na linha ${seenIds.get(parsed.id) + 1}`);
      seenIds.set(parsed.id, index);
    } catch (error) {
      errors.push(error.message);
    }

    return {
      ...row,
      parsed,
      valid: errors.length === 0,
      errors,
    };
  });
}

module.exports = {
  normalizeText,
  normalizeDimension,
  validateProduct,
  parseArtworkFilename,
  buildArtworkFilename,
  validateBatchRows,
  sizeOptionsForProduct,
};
