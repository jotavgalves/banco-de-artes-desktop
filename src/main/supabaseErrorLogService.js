const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { app } = require("electron");
const { createSupabaseClient } = require("./supabaseService");
const supabaseAuthService = require("./supabaseAuthService");

function dataDir(config = {}) {
  const preferred = config.fixedDataFolder || "C:\\BancoDeArtes";
  try {
    fs.mkdirSync(preferred, { recursive: true });
    return preferred;
  } catch {
    const fallback = path.join(typeof app?.getPath === "function" ? app.getPath("userData") : process.cwd(), "shared-data");
    fs.mkdirSync(fallback, { recursive: true });
    return fallback;
  }
}

async function record(config = {}, entry = {}) {
  const normalized = normalize(entry);
  const session = supabaseAuthService.current();
  if (config.supabaseEnabled && config.supabaseAuthMode !== "local" && session?.accessToken) {
    const supabase = createSupabaseClient(config, session.accessToken);
    const { error } = await supabase.from("error_logs").insert({
      level: normalized.level,
      source: normalized.source,
      message: normalized.message,
      stack: normalized.stack || null,
      context: normalized.context,
      user_id: session.profile?.id || null,
      machine_id: os.hostname(),
    });
    if (!error) return { ok: true, provider: "supabase" };
    writeLocal(config, { ...normalized, supabaseError: error.message });
    throw new Error(error.message);
  }
  writeLocal(config, normalized);
  return { ok: true, provider: "local" };
}

function writeLocal(config = {}, entry = {}) {
  const file = path.join(dataDir(config), "error_logs.json");
  let rows = [];
  try {
    rows = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    rows = [];
  }
  rows.push({
    ...entry,
    machineId: os.hostname(),
    createdAt: new Date().toISOString(),
  });
  fs.writeFileSync(file, JSON.stringify(rows.slice(-500), null, 2), "utf8");
}

function normalize(entry = {}) {
  return {
    level: ["debug", "info", "warn", "error"].includes(entry.level) ? entry.level : "error",
    source: String(entry.source || "app").slice(0, 80),
    message: String(entry.message || "Erro sem mensagem.").slice(0, 2000),
    stack: entry.stack ? String(entry.stack).slice(0, 8000) : "",
    context: safeContext(entry.context),
  };
}

function safeContext(value) {
  if (!value || typeof value !== "object") return {};
  try {
    return JSON.parse(JSON.stringify(value)).slice ? {} : JSON.parse(JSON.stringify(value));
  } catch {
    return {};
  }
}

module.exports = {
  record,
};
