const os = require("node:os");
const { createSupabaseClient } = require("./supabaseService");
const supabaseAuthService = require("./supabaseAuthService");

function isAvailable(config = {}) {
  return Boolean(config.supabaseEnabled && config.supabaseAuthMode !== "local" && supabaseAuthService.current()?.accessToken);
}

function client(config = {}) {
  const session = supabaseAuthService.current();
  if (!session?.accessToken) throw new Error("Login Supabase necessário.");
  return createSupabaseClient(config, session.accessToken);
}

async function heartbeat(config = {}, currentView = "") {
  if (!isAvailable(config)) return null;
  const session = supabaseAuthService.current();
  const profile = session.profile;
  const machine = os.hostname();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + (Number(config.sessionTimeoutMinutes) || 10) * 60 * 1000).toISOString();
  const supabase = client(config);

  const { data: existing, error: findError } = await supabase
    .from("presence")
    .select("id")
    .eq("user_id", profile.id)
    .eq("machine_id", machine)
    .limit(1);
  if (findError) throw new Error(findError.message);

  const payload = {
    current_view: String(currentView || "").slice(0, 80) || null,
    last_activity_at: now.toISOString(),
    expires_at: expiresAt,
  };

  if (existing?.length) {
    const { data, error } = await supabase
      .from("presence")
      .update(payload)
      .eq("user_id", profile.id)
      .eq("machine_id", machine)
      .select("id,user_id,machine_id,current_view,last_activity_at,expires_at")
      .limit(1)
      .single();
    if (error) throw new Error(error.message);
    return presenceFromRow(data, profile);
  }

  const { data, error } = await supabase
    .from("presence")
    .insert({
      user_id: profile.id,
      machine_id: machine,
      ...payload,
    })
    .select("id,user_id,machine_id,current_view,last_activity_at,expires_at")
    .single();
  if (error) throw new Error(error.message);
  return presenceFromRow(data, profile);
}

async function listOnline(config = {}) {
  if (!isAvailable(config)) return null;
  const supabase = client(config);
  const { data, error } = await supabase
    .from("presence")
    .select("id,user_id,machine_id,current_view,last_activity_at,expires_at,profiles:user_id(login,display_name,role)")
    .gt("expires_at", new Date().toISOString())
    .order("last_activity_at", { ascending: false });
  if (error) throw new Error(error.message);
  return (data || []).map((row) => presenceFromRow(row));
}

async function clear(config = {}) {
  if (!isAvailable(config)) return true;
  const session = supabaseAuthService.current();
  const { error } = await client(config)
    .from("presence")
    .delete()
    .eq("user_id", session.profile.id)
    .eq("machine_id", os.hostname());
  if (error) throw new Error(error.message);
  return true;
}

function presenceFromRow(row = {}, fallbackProfile = null) {
  const profile = Array.isArray(row.profiles) ? row.profiles[0] : row.profiles || fallbackProfile || {};
  return {
    id: row.id,
    provider: "supabase",
    login: profile.login || "",
    name: profile.display_name || profile.login || "",
    role: profile.role || "",
    machine: row.machine_id || "",
    currentView: row.current_view || "",
    lastSeenAt: row.last_activity_at || "",
    expiresAt: row.expires_at || "",
  };
}

module.exports = {
  clear,
  heartbeat,
  isAvailable,
  listOnline,
};
