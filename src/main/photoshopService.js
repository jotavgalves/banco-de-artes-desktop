const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { spawn } = require("node:child_process");
const googleService = require("./googleService");
const supabaseArtworkService = require("./supabaseArtworkService");
const supabaseCoordinationService = require("./supabaseCoordinationService");

const IMAGE_EXTENSIONS = new Set([".tif", ".tiff", ".jpg", ".jpeg", ".png"]);
const JOB_FILE = "painel50-job.json";
const JSX_FILE = "painel50-runner.jsx";
const STATUS_FILE = "painel50-status.json";
const DEFAULT_TIMEOUT_MS = 30 * 60 * 1000;
const MAX_PS_RETRIES = 3;
const RETRY_DELAY_MS = 5000;
const MIN_MOCKUP_BYTES = 1024;
const PRODUCT = "PAINEL REDONDO";
const SIZE = "50X50";
const DEFAULT_SOURCE_ROOT = "";
const DEFAULT_ORGANIZED_ROOT = "X:\\1 - TEMAS ORGANIZADOS";
const DEFAULT_DRIVE_LOCAL_ROOT = "X:\\2 - DRIVE";

function fixedDataDir(config) {
  const preferred = config.fixedDataFolder || "C:\\BancoDeArtes";
  fs.mkdirSync(preferred, { recursive: true });
  return preferred;
}

function automationDir(config) {
  const dir = path.join(fixedDataDir(config), "automacao-painel-50");
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function listInputImages(inputFolder) {
  if (!fs.existsSync(inputFolder)) return [];
  return fs.readdirSync(inputFolder, { withFileTypes: true })
    .filter((entry) => entry.isFile() && IMAGE_EXTENSIONS.has(path.extname(entry.name).toLowerCase()))
    .map((entry) => path.join(inputFolder, entry.name))
    .sort((a, b) => path.basename(a).localeCompare(path.basename(b), "pt-BR"));
}

function readJson(file, fallback) {
  if (!fs.existsSync(file)) return fallback;
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}

function writeJson(file, value) {
  fs.writeFileSync(file, JSON.stringify(value, null, 2), "utf8");
  return value;
}

function defaultMockupPath(appRoot) {
  const asset = path.join(appRoot, "assets", "photoshop", "mockup-painel-redondo-50x50.psb");
  if (fs.existsSync(asset)) return asset;
  const direct = path.join(appRoot, "AUTOMAÇÃO LOTEAMENTO E FORMATO.psb");
  if (fs.existsSync(direct)) return direct;
  const found = fs.readdirSync(appRoot, { withFileTypes: true })
    .filter((entry) => entry.isFile() && /\.(psb|psd)$/i.test(entry.name))
    .map((entry) => path.join(appRoot, entry.name))
    .find((file) => /automa/i.test(path.basename(file).normalize("NFD").replace(/[\u0300-\u036f]/g, "")));
  return found || direct;
}

function defaultInputFolder(appRoot) {
  return path.join(appRoot, "Teste");
}

function normalizeTheme(value) {
  return String(value || "ABC").trim().toUpperCase().replace(/\s+/g, " ");
}

function themeFromFolder(inputFolder, explicitTheme = "") {
  if (explicitTheme) return normalizeTheme(explicitTheme);
  const folderName = path.basename(inputFolder);
  const dashIndex = folderName.indexOf("-");
  const theme = dashIndex >= 0 ? folderName.slice(dashIndex + 1) : folderName;
  return normalizeTheme(theme);
}

function cleanFolderName(value) {
  return String(value || "")
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function parseManagedName(filePath) {
  const ext = path.extname(filePath);
  const stem = path.basename(filePath, ext);
  const parts = stem.split("_").map((part) => part.trim()).filter(Boolean);
  if (parts.length !== 4 || !/^\d+$/.test(parts[0])) return null;
  return {
    id: parts[0],
    theme: normalizeTheme(parts[1]),
    product: String(parts[2] || "").trim().toUpperCase(),
    size: String(parts[3] || "").trim().toUpperCase(),
  };
}

function managedArtworkName(id, theme, extension) {
  return `${id}_${theme}_${PRODUCT}_${SIZE}${extension.toLowerCase()}`;
}

function isFolderEmpty(folderPath) {
  if (!fs.existsSync(folderPath)) return false;
  const entries = fs.readdirSync(folderPath).filter((name) => !["thumbs.db", ".ds_store"].includes(name.toLowerCase()));
  return entries.length === 0;
}

function removeFolderIfEmpty(folderPath) {
  if (!isFolderEmpty(folderPath)) return false;
  for (const name of fs.readdirSync(folderPath)) {
    if (["thumbs.db", ".ds_store"].includes(name.toLowerCase())) {
      fs.rmSync(path.join(folderPath, name), { force: true });
    }
  }
  fs.rmdirSync(folderPath);
  return true;
}

function ensureUniqueTarget(targetPath, currentPath) {
  if (!fs.existsSync(targetPath)) return;
  if (path.resolve(targetPath).toLowerCase() === path.resolve(currentPath).toLowerCase()) return;
  throw new Error(`Ja existe um arquivo com o nome final: ${targetPath}`);
}

function jobKey(payload) {
  return crypto.createHash("sha1").update(JSON.stringify({
    inputFolder: payload.inputFolder,
    organizedRoot: payload.organizedRoot,
    driveLocalRoot: payload.driveLocalRoot,
    mockupPath: payload.mockupPath,
    theme: payload.theme,
  })).digest("hex").slice(0, 16);
}

async function runPanel50Batch(config, appRoot, payload = {}, actor = null, onProgress = () => {}) {
  const dir = automationDir(config);
  const stateFile = path.join(dir, JOB_FILE);
  const statusFile = path.join(dir, STATUS_FILE);
  const jsxFile = path.join(dir, JSX_FILE);
  const inputFolderValue = payload.inputFolder || config.panel50LastInputFolder || config.panel50SourceRoot || DEFAULT_SOURCE_ROOT;
  if (!inputFolderValue) throw new Error("Escolha uma pasta antes de executar a automação.");
  const inputFolder = path.resolve(inputFolderValue);
  const theme = themeFromFolder(inputFolder, payload.theme);
  const themeFolderName = cleanFolderName(theme);
  const organizedRoot = path.resolve(payload.organizedRoot || config.panel50OrganizedRoot || DEFAULT_ORGANIZED_ROOT);
  const driveLocalRoot = path.resolve(payload.driveLocalRoot || config.panel50DriveLocalRoot || payload.outputFolder || DEFAULT_DRIVE_LOCAL_ROOT);
  const mockupPath = path.resolve(payload.mockupPath || config.panel50MockupPath || defaultMockupPath(appRoot));
  const uploadAfter = payload.uploadAfter !== false;

  if (!fs.existsSync(mockupPath)) throw new Error(`Mockup nao encontrado: ${mockupPath}`);
  ensureDir(organizedRoot);
  ensureDir(driveLocalRoot);

  const key = jobKey({ inputFolder, organizedRoot, driveLocalRoot, mockupPath, theme });
  const previous = readJson(stateFile, null);
  const files = listInputImages(inputFolder);
  if (!files.length) {
    onProgress({ phase: "Sem imagens", current: 0, total: 0, detail: "Nenhuma imagem encontrada na pasta escolhida." });
    throw new Error("Nenhuma imagem encontrada na pasta escolhida.");
  }

  let job = previous?.key === key ? previous : null;
  if (!job) {
    job = {
      key,
      inputFolder,
      organizedRoot,
      driveLocalRoot,
      mockupPath,
      theme,
      product: PRODUCT,
      size: SIZE,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      items: files.map((file) => ({
        sourcePath: file,
        sourceName: path.basename(file),
        originalName: path.basename(file),
        id: parseManagedName(file)?.id || "",
        outputPath: "",
        status: "pending",
        error: "",
      })),
    };
  } else {
    const known = new Set(job.items.map((item) => item.sourcePath.toLowerCase()));
    const knownOriginalNames = new Set(job.items.map((item) => String(item.originalName || item.sourceName || "").toLowerCase()));
    const knownSourceNames = new Set(job.items.map((item) => String(item.sourceName || "").toLowerCase()));
    for (const file of files) {
      const name = path.basename(file).toLowerCase();
      if (!known.has(file.toLowerCase()) && !knownOriginalNames.has(name) && !knownSourceNames.has(name)) {
        job.items.push({ sourcePath: file, sourceName: path.basename(file), originalName: path.basename(file), id: parseManagedName(file)?.id || "", outputPath: "", status: "pending", error: "" });
      }
    }
  }

  const useSupabaseArtworks = supabaseArtworkService.canWrite(config);
  const needsId = job.items.filter((item) => !item.id);
  if (needsId.length) {
    const reserved = job.items.map((item) => item.id).filter(Boolean);
    const ids = useSupabaseArtworks
      ? await supabaseArtworkService.nextAvailableArtworkIds(config, needsId.length, reserved)
      : await googleService.nextAvailableArtworkIds(config, appRoot, needsId.length, reserved);
    needsId.forEach((item, index) => {
      item.id = ids[index];
    });
  }

  onProgress({ phase: "Renomeando bases", current: 0, total: job.items.length, detail: "Aplicando ID nos arquivos originais." });
  for (const [index, item] of job.items.entries()) {
    const currentPath = fs.existsSync(item.sourcePath)
      ? item.sourcePath
      : path.join(inputFolder, managedArtworkName(item.id, theme, path.extname(item.sourcePath || item.sourceName || ".tif")));
    if (!fs.existsSync(currentPath)) {
      if (item.status !== "upload_ok") {
        item.status = "error";
        item.error = "Arquivo base nao encontrado para mover.";
      }
      continue;
    }
    const extension = path.extname(currentPath);
    const baseIdFolder = ensureDir(path.join(organizedRoot, themeFolderName, String(item.id)));
    const mockupIdFolder = ensureDir(path.join(driveLocalRoot, themeFolderName, String(item.id)));
    const targetPath = path.join(baseIdFolder, managedArtworkName(item.id, theme, extension));
    ensureUniqueTarget(targetPath, currentPath);
    if (path.resolve(currentPath).toLowerCase() !== path.resolve(targetPath).toLowerCase()) {
      fs.renameSync(currentPath, targetPath);
    }
    item.sourcePath = targetPath;
    item.sourceName = path.basename(targetPath);
    const previousOutputPath = item.outputPath;
    const nextOutputPath = path.join(mockupIdFolder, managedArtworkName(item.id, theme, ".jpg"));
    if (previousOutputPath && fs.existsSync(previousOutputPath) && previousOutputPath.toLowerCase() !== nextOutputPath.toLowerCase()) {
      ensureUniqueTarget(nextOutputPath, previousOutputPath);
      fs.renameSync(previousOutputPath, nextOutputPath);
    }
    item.outputPath = nextOutputPath;
    item.error = "";
    onProgress({ phase: "Renomeando bases", current: index + 1, total: job.items.length, detail: item.sourceName });
  }

  job.updatedAt = new Date().toISOString();
  job.organizedRoot = organizedRoot;
  job.driveLocalRoot = driveLocalRoot;
  job.theme = theme;
  writeJson(stateFile, job);

  // ═══ PHOTOSHOP RETRY LOOP — Resilient to crashes ═══
  for (let attempt = 1; attempt <= MAX_PS_RETRIES; attempt++) {
    // Step A: Verify which mockups physically exist on disk already
    reconcilePhysicalMockups(job);

    // Step B: Filter only items that still need a mockup
    const toMockup = job.items.filter(
      (item) => item.status !== "error" && item.status !== "upload_ok" && item.status !== "mockup_ok"
        && (!fs.existsSync(item.outputPath) || fileSize(item.outputPath) < MIN_MOCKUP_BYTES)
    );
    if (!toMockup.length) break; // All mockups are done

    const isRetry = attempt > 1;
    const totalOriginal = job.items.filter((item) => item.status !== "error").length;
    const alreadyDone = totalOriginal - toMockup.length;

    onProgress({
      phase: "Photoshop",
      current: alreadyDone,
      total: totalOriginal,
      detail: isRetry
        ? `Retentativa ${attempt}/${MAX_PS_RETRIES} — ${toMockup.length} mockup(s) restante(s). ${alreadyDone} já gerado(s).`
        : `Preparando ${toMockup.length} mockups 50X50.`,
    });

    try {
      writeJson(statusFile, { phase: "starting", at: new Date().toISOString(), current: 0, total: toMockup.length });
      writeJson(jsxFile + ".job.json", { mockupPath, driveLocalRoot, items: toMockup });
      fs.writeFileSync(jsxFile, buildPhotoshopJsx(path.normalize(jsxFile + ".job.json"), path.normalize(statusFile)), "utf8");
      await runPhotoshopJsx(jsxFile, statusFile, toMockup.length, onProgress);

      // Success — apply results and break
      applyPartialResults(job, statusFile);
      reconcilePhysicalMockups(job);
      break;
    } catch (err) {
      // Crash detected — salvage whatever was generated before the crash
      applyPartialResults(job, statusFile);
      reconcilePhysicalMockups(job);
      writeJson(stateFile, { ...job, updatedAt: new Date().toISOString() });

      const savedCount = job.items.filter((item) => item.status === "mockup_ok" || item.status === "upload_ok").length;

      if (attempt === MAX_PS_RETRIES) {
        // All retries exhausted — do NOT throw, continue to upload what we have
        onProgress({
          phase: "Aviso",
          current: savedCount,
          total: totalOriginal,
          detail: `Photoshop falhou ${MAX_PS_RETRIES}x. ${savedCount} mockup(s) gerado(s) — prosseguindo com upload do que foi possível.`,
        });
      } else {
        onProgress({
          phase: "Recuperando",
          current: savedCount,
          total: totalOriginal,
          detail: `Crash detectado (${err.message || "erro COM"}). ${savedCount} mockup(s) salvos. Aguardando ${RETRY_DELAY_MS / 1000}s antes da tentativa ${attempt + 1}...`,
        });
        await sleep(RETRY_DELAY_MS);
      }
    }
  }

  // Final reconciliation after all attempts
  reconcilePhysicalMockups(job);
  writeJson(stateFile, { ...job, updatedAt: new Date().toISOString() });

  if (uploadAfter) {
    const existingIds = useSupabaseArtworks
      ? await supabaseArtworkService.usedArtworkIds(config)
      : new Set((await googleService.listArtworks(config, appRoot).catch(() => []))
        .map((row) => String(row.id || "").trim())
        .filter(Boolean));
    for (const item of job.items) {
      if (item.status === "mockup_ok" && existingIds.has(String(item.id))) {
        item.status = "upload_ok";
        item.error = "";
      }
    }
    const rows = job.items
      .filter((item) => item.status === "mockup_ok" && fs.existsSync(item.outputPath))
      .map((item) => ({
        id: item.id,
        theme,
        product: PRODUCT,
        size: SIZE,
        client: "",
        phone: "",
        fileName: path.basename(item.outputPath),
        path: item.outputPath,
      }));
    if (rows.length) {
      onProgress({
        phase: "Upload",
        current: 0,
        total: rows.length,
        detail: "Subindo mockups para Drive e Supabase.",
      });
      const uploadConfig = { ...config, operatorName: actor?.name || config.operatorName };
      const result = await googleService.uploadBatch(uploadConfig, appRoot, rows, onProgress, {
        persistArtwork: useSupabaseArtworks
          ? (artwork) => supabaseArtworkService.upsertImportedArtwork(uploadConfig, artwork)
          : null,
        usedArtworkIds: useSupabaseArtworks
          ? () => supabaseArtworkService.usedArtworkIds(uploadConfig)
          : null,
        acquireGlobalLock: useSupabaseArtworks
          ? () => supabaseCoordinationService.acquireOperationLock(uploadConfig, "CADASTRO_ARTE", 15)
          : null,
        releaseGlobalLock: useSupabaseArtworks
          ? (lock) => supabaseCoordinationService.releaseOperationLock(uploadConfig, lock?.id)
          : null,
      });
      const uploaded = new Set(result.successes.map((row) => String(row.id)));
      for (const item of job.items) {
        if (uploaded.has(String(item.id))) item.status = "upload_ok";
      }
      if (result.failures.length) {
        for (const failure of result.failures) {
          const item = job.items.find((row) => String(row.id) === String(failure.id));
          if (item) {
            item.status = "error";
            item.error = failure.error || "Falha no upload.";
          }
        }
      }
    }
  }

  job.updatedAt = new Date().toISOString();
  removeFolderIfEmpty(inputFolder);
  writeJson(stateFile, job);
  onProgress({ phase: "Concluido", current: job.items.filter((item) => item.status === "upload_ok").length, total: job.items.length, detail: "Automacao finalizada." });
  return summarizeJob(job);
}

// ═══ RESILIENCE HELPERS ═══

/**
 * Scan the disk for mockup JPGs that already exist and mark the corresponding
 * job items as "mockup_ok". This ensures that even if the status file was
 * never updated (e.g. hard crash), we don't re-generate existing work.
 */
function reconcilePhysicalMockups(job) {
  for (const item of job.items) {
    if (item.status === "upload_ok") continue; // already uploaded, don't downgrade
    if (item.status === "error" && !item.outputPath) continue; // truly broken
    if (item.outputPath && fs.existsSync(item.outputPath) && fileSize(item.outputPath) >= MIN_MOCKUP_BYTES) {
      item.status = "mockup_ok";
      item.error = "";
    }
  }
}

/**
 * Read the Photoshop status file (written by the JSX during execution) and
 * apply any partial results to the job. This captures progress that happened
 * between the last status-file write and the crash.
 */
function applyPartialResults(job, statusFile) {
  const psStatus = readJson(statusFile, {});
  if (!Array.isArray(psStatus.items)) return;
  for (const result of psStatus.items) {
    const item = job.items.find((row) => row.id === String(result.id));
    if (!item) continue;
    if (result.status === "mockup_ok") {
      if (item.status !== "upload_ok") {
        item.status = "mockup_ok";
        item.error = "";
      }
    } else if (result.status === "error") {
      item.status = "error";
      item.error = result.error || "Falha no Photoshop.";
    }
  }
}

/** Returns file size in bytes, or 0 if the file doesn't exist. */
function fileSize(filePath) {
  try {
    return fs.statSync(filePath).size;
  } catch {
    return 0;
  }
}

/** Simple async delay. */
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function summarizeJob(job) {
  const counts = job.items.reduce((acc, item) => {
    acc[item.status] = (acc[item.status] || 0) + 1;
    return acc;
  }, {});
  return { ...job, counts };
}

function runPhotoshopJsx(jsxFile, statusFile, total, onProgress) {
  return new Promise((resolve, reject) => {
    const command = [
      "$ErrorActionPreference='Stop';",
      "$app = New-Object -ComObject Photoshop.Application;",
      `$app.DoJavaScriptFile('${psQuote(jsxFile)}');`,
    ].join(" ");
    const child = spawn("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", command], { windowsHide: true });
    let stderr = "";
    child.stderr.on("data", (chunk) => { stderr += chunk.toString(); });
    child.on("error", reject);

    let lastAt = Date.now();
    const timer = setInterval(() => {
      const status = readJson(statusFile, {});
      if (status.at) lastAt = Date.parse(status.at) || lastAt;
      onProgress({
        phase: "Photoshop",
        current: Number(status.current || 0),
        total,
        detail: status.detail || status.phase || "Processando mockups.",
      });
      if (Date.now() - lastAt > DEFAULT_TIMEOUT_MS) {
        clearInterval(timer);
        child.kill();
        reject(new Error("Photoshop ficou sem progresso por muito tempo. A fila foi salva; feche documentos TMP no Photoshop e execute novamente para continuar."));
      }
    }, 1500);

    child.on("close", (code) => {
      clearInterval(timer);
      if (code === 0) resolve(true);
      else reject(new Error(stderr.trim() || `Photoshop retornou codigo ${code}.`));
    });
  });
}

function psQuote(value) {
  return String(value).replace(/'/g, "''");
}

function buildPhotoshopJsx(jobPath, statusPath) {
  return `#target photoshop
app.bringToFront();
(function () {
  var GROUP_50 = "PAINEL 50X50";
  var SO_PATH_50 = [GROUP_50, "PAINEL", "PONHA O 150 NESSE SMART OBJECT"];
  var CODE_GROUP_PATH_50 = [GROUP_50, "CÓDIGO"];
  var JOB_PATH = "${jsxString(jobPath)}";
  var STATUS_PATH = "${jsxString(statusPath)}";
  var JPG_QUALITY = 10;
  var MIN_JPG_BYTES = 1024;
  var oldDialogs = app.displayDialogs;
  var oldRuler = app.preferences.rulerUnits;
  app.displayDialogs = DialogModes.NO;
  app.preferences.rulerUnits = Units.PIXELS;
  var results = [];
  var masterDoc = null;
  try {
    var job = readJson(JOB_PATH);
    writeStatus({ phase: "Abrindo mockup", current: 0, total: job.items.length, detail: job.mockupPath, items: results });
    masterDoc = app.open(new File(job.mockupPath));
    var g50Master = findTopLevelLayerSetByName(masterDoc, GROUP_50);
    if (!g50Master) throw new Error("Grupo PAINEL 50X50 nao encontrado no mockup.");
    var so50Master = getLayerByPath(masterDoc, SO_PATH_50) || recursiveLayerSearch(masterDoc, SO_PATH_50[SO_PATH_50.length - 1]);
    if (!isSmartObjectLayer(so50Master)) throw new Error("Smart Object 50X50 nao encontrado.");
    var cg50Master = getLayerByPath(masterDoc, CODE_GROUP_PATH_50) || recursiveLayerSearch(masterDoc, CODE_GROUP_PATH_50[CODE_GROUP_PATH_50.length - 1]);
    if (!cg50Master || cg50Master.typename !== "LayerSet" || !findFirstTextLayer(cg50Master)) throw new Error("Texto do codigo 50X50 nao encontrado.");
    for (var i = 0; i < job.items.length; i++) {
      var item = job.items[i];
      var workDoc = null;
      try {
        var fileCode = codeFromFileName(item.sourceName) || String(item.id);
        writeStatus({ phase: "Processando", current: i, total: job.items.length, detail: item.sourceName + " -> " + fileCode, items: results });
        var outFile = new File(item.outputPath);
        if (outFile.exists && outFile.length >= MIN_JPG_BYTES) {
          results.push({ id: fileCode, status: "mockup_ok", outputPath: item.outputPath });
          continue;
        }
        app.activeDocument = masterDoc;
        workDoc = masterDoc.duplicate("TMP_" + fileCode, false);
        app.activeDocument = workDoc;
        var g50 = findTopLevelLayerSetByName(workDoc, GROUP_50);
        var so50 = getLayerByPath(workDoc, SO_PATH_50) || recursiveLayerSearch(workDoc, SO_PATH_50[SO_PATH_50.length - 1]);
        if (!g50 || !isSmartObjectLayer(so50)) throw new Error("Mockup duplicado sem grupo ou smart object 50X50.");
        normalizeAndRestore(so50, function () {
          app.activeDocument = workDoc;
          workDoc.activeLayer = so50;
          replaceSmartObjectContents(new File(item.sourcePath));
        });
        var cg50 = getLayerByPath(workDoc, CODE_GROUP_PATH_50) || recursiveLayerSearch(workDoc, CODE_GROUP_PATH_50[CODE_GROUP_PATH_50.length - 1]);
        var tx50 = cg50 ? findFirstTextLayer(cg50) : null;
        if (!tx50) throw new Error("TextLayer do codigo nao encontrado no duplicado.");
        normalizeAndRestore(tx50, function () { tx50.textItem.contents = fileCode; });
        forceOnly50(workDoc, g50);
        saveActiveDocAsJPEGWithIntegrity(workDoc, outFile);
        results.push({ id: fileCode, status: "mockup_ok", outputPath: item.outputPath });
      } catch (e) {
        results.push({ id: String(item.id), status: "error", error: e.message || String(e) });
      } finally {
        if (workDoc) safeClose(workDoc, SaveOptions.DONOTSAVECHANGES);
        writeStatus({ phase: "Processando", current: i + 1, total: job.items.length, detail: item.sourceName, items: results });
      }
      if ((i + 1) % 10 === 0) { try { app.purge(PurgeTarget.ALLCACHES); } catch (_) {} }
    }
  } catch (fatal) {
    writeStatus({ phase: "error", current: results.length, total: results.length, detail: fatal.message || String(fatal), items: results });
    throw fatal;
  } finally {
    if (masterDoc) safeClose(masterDoc, SaveOptions.DONOTSAVECHANGES);
    app.displayDialogs = oldDialogs;
    app.preferences.rulerUnits = oldRuler;
    writeStatus({ phase: "done", current: results.length, total: results.length, detail: "Finalizado", items: results });
  }
  function readJson(filePath) {
    var f = new File(filePath); f.encoding = "UTF-8"; f.open("r"); var text = f.read(); f.close(); return eval("(" + text + ")");
  }
  function writeStatus(obj) {
    obj.at = new Date().toUTCString();
    var f = new File(STATUS_PATH); f.encoding = "UTF-8"; f.open("w"); f.write(toJson(obj)); f.close();
  }
  function toJson(obj) {
    if (obj === null) return "null";
    if (obj instanceof Array) { var arr = []; for (var i = 0; i < obj.length; i++) arr.push(toJson(obj[i])); return "[" + arr.join(",") + "]"; }
    if (typeof obj === "object") { var parts = []; for (var k in obj) if (obj.hasOwnProperty(k)) parts.push(toJson(String(k)) + ":" + toJson(obj[k])); return "{" + parts.join(",") + "}"; }
    if (typeof obj === "number" || typeof obj === "boolean") return String(obj);
    return '"' + String(obj).replace(/\\\\/g, "\\\\\\\\").replace(/"/g, '\\\\"').replace(/\\r/g, "\\\\r").replace(/\\n/g, "\\\\n") + '"';
  }
  function stripAccents(str) { return String(str).replace(/[ÀÁÂÃÄÅ]/gi, "A").replace(/[ÈÉÊË]/gi, "E").replace(/[ÌÍÎÏ]/gi, "I").replace(/[ÒÓÔÕÖ]/gi, "O").replace(/[ÙÚÛÜ]/gi, "U").replace(/[Ç]/gi, "C").toUpperCase(); }
  function codeFromFileName(name) { var m = String(name || "").match(/^(\\d+)_/); return m ? m[1] : ""; }
  function findTopLevelLayerSetByName(doc, name) { var nn = stripAccents(name); for (var i = 0; i < doc.layers.length; i++) { var l = doc.layers[i]; if (l.typename === "LayerSet" && stripAccents(l.name) === nn) return l; } return null; }
  function findDirectChildByName(container, name) { var nn = stripAccents(name); for (var i = 0; i < container.layers.length; i++) if (stripAccents(container.layers[i].name) === nn) return container.layers[i]; return null; }
  function getLayerByPath(doc, pathArr) { var cur = doc; for (var p = 0; p < pathArr.length; p++) { cur = findDirectChildByName(cur, pathArr[p]); if (!cur) return null; } return cur; }
  function recursiveLayerSearch(container, name) { var nn = stripAccents(name); for (var i = 0; i < container.layers.length; i++) { var l = container.layers[i]; if (stripAccents(l.name) === nn) return l; if (l.typename === "LayerSet") { var found = recursiveLayerSearch(l, name); if (found) return found; } } return null; }
  function findFirstTextLayer(layerSet) { for (var i = 0; i < layerSet.layers.length; i++) { var l = layerSet.layers[i]; if (l.typename === "ArtLayer" && l.kind === LayerKind.TEXT) return l; if (l.typename === "LayerSet") { var hit = findFirstTextLayer(l); if (hit) return hit; } } return null; }
  function isSmartObjectLayer(l) { return l && l.typename === "ArtLayer" && l.kind === LayerKind.SMARTOBJECT; }
  function normalizeAndRestore(layer, action) { var wasLocked = layer.allLocked; var wasVisible = layer.visible; var parents = []; var parent = layer.parent; while (parent && parent.typename === "LayerSet") { parents.push({ ref: parent, locked: parent.allLocked, visible: parent.visible }); parent.allLocked = false; parent.visible = true; parent = parent.parent; } layer.allLocked = false; layer.visible = true; action(); layer.allLocked = wasLocked; layer.visible = wasVisible; for (var i = parents.length - 1; i >= 0; i--) { parents[i].ref.allLocked = parents[i].locked; parents[i].ref.visible = parents[i].visible; } }
  function forceOnly50(doc, group50) { app.activeDocument = doc; for (var i = 0; i < doc.layers.length; i++) if (doc.layers[i].typename === "LayerSet") doc.layers[i].visible = false; group50.visible = true; try { doc.activeLayer = group50; } catch (_) {} }
  function replaceSmartObjectContents(file) { var id = stringIDToTypeID("placedLayerReplaceContents"); var desc = new ActionDescriptor(); desc.putPath(charIDToTypeID("null"), file); executeAction(id, desc, DialogModes.NO); }
  function saveActiveDocAsJPEGWithIntegrity(doc, outFile) { app.activeDocument = doc; var opt = new JPEGSaveOptions(); opt.quality = JPG_QUALITY; opt.embedColorProfile = true; opt.formatOptions = FormatOptions.STANDARDBASELINE; opt.matte = MatteType.NONE; doc.saveAs(outFile, opt, true, Extension.LOWERCASE); if (!outFile.exists || outFile.length < MIN_JPG_BYTES) throw new Error("JPEG nao gravado ou corrompido: " + outFile.fsName); }
  function safeClose(doc, saveOpt) { try { doc.close(saveOpt); } catch (_) {} }
})();`;
}

function jsxString(value) {
  return String(value).replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

module.exports = {
  runPanel50Batch,
};
