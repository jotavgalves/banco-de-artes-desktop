const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { app } = require("electron");
const { createSupabaseClient, isConfigured } = require("./supabaseService");
const supabaseAuthService = require("./supabaseAuthService");

function userDataDir() {
  return typeof app?.getPath === "function" ? app.getPath("userData") : process.cwd();
}

function fixedDataDir(config) {
  const preferred = config.fixedDataFolder || "C:\\BancoDeArtes";
  try {
    fs.mkdirSync(preferred, { recursive: true });
    return preferred;
  } catch {
    const fallback = path.join(userDataDir(), "shared-data");
    fs.mkdirSync(fallback, { recursive: true });
    return fallback;
  }
}

function logsPath(config) {
  return path.join(fixedDataDir(config), "audit.json");
}

function readLogs(config) {
  const file = logsPath(config);
  if (!fs.existsSync(file)) return [];
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return [];
  }
}

function writeLogs(config, rows) {
  fs.writeFileSync(logsPath(config), JSON.stringify(rows.slice(-1000), null, 2), "utf8");
}

function record(config, actor, type, action, details = "") {
  const row = buildLogRow(actor, type, action, details);
  const rows = readLogs(config);
  rows.push(row);
  writeLogs(config, rows);
  return recordSupabase(config, row).catch(() => false);
}

async function list(config, limit = 120) {
  const supabaseRows = await listSupabase(config, limit).catch(() => null);
  if (Array.isArray(supabaseRows)) return supabaseRows;
  return readLogs(config).slice(-limit).reverse();
}

function buildLogRow(actor, type, action, details = "") {
  return {
    id: cryptoId(),
    at: new Date().toISOString(),
    type,
    action,
    details: detailsToText(details),
    login: actor?.login || "sistema",
    name: actor?.name || "Sistema",
    role: actor?.role || "system",
    machine: os.hostname(),
  };
}

async function recordSupabase(config, row) {
  const session = supabaseAuthService.current();
  if (!isConfigured(config) || !session?.accessToken || !session?.profile?.id) return false;
  const supabase = createSupabaseClient(config, session.accessToken);
  const { error } = await supabase.from("audit_logs").insert({
    actor_id: session.profile.id,
    action: row.action,
    entity_type: row.type,
    entity_id: entityIdFromDetails(row.details),
    details: {
      text: row.details,
      login: row.login,
      name: row.name,
      role: row.role,
    },
    machine_id: row.machine,
  });
  if (error) throw new Error(error.message);
  return true;
}

async function listSupabase(config, limit = 120) {
  const session = supabaseAuthService.current();
  if (!isConfigured(config) || !session?.accessToken) return null;
  const supabase = createSupabaseClient(config, session.accessToken);
  const { data, error } = await supabase
    .from("audit_logs")
    .select("id,action,entity_type,entity_id,details,machine_id,created_at,profiles:actor_id(login,display_name,role)")
    .order("created_at", { ascending: false })
    .limit(Number(limit) || 120);
  if (error) throw new Error(error.message);
  return (data || []).map(logFromSupabase);
}

function logFromSupabase(row = {}) {
  const profile = Array.isArray(row.profiles) ? row.profiles[0] : row.profiles;
  const details = row.details || {};
  return {
    id: row.id,
    at: row.created_at,
    type: row.entity_type || "",
    action: row.action || "",
    details: details.text || (row.entity_id ? `id=${row.entity_id}` : ""),
    login: profile?.login || details.login || "",
    name: profile?.display_name || details.name || "Sistema",
    role: profile?.role || details.role || "",
    machine: row.machine_id || "",
    provider: "supabase",
  };
}

function detailsToText(details) {
  if (details == null) return "";
  if (typeof details === "string") return details;
  try {
    return JSON.stringify(details);
  } catch {
    return String(details);
  }
}

function entityIdFromDetails(details = "") {
  const text = String(details || "");
  return text.match(/\bid=([^,\s]+)/)?.[1] || "";
}

function cryptoId() {
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

module.exports = {
  record,
  list,
};
