const { createSupabaseClient, isConfigured } = require("./supabaseService");
const supabaseAuthService = require("./supabaseAuthService");
const { normalizeConfig } = require("./configStore");
const { DEFAULT_GLOBAL_CONFIG } = require("../shared/defaults");

const APP_CONFIG_KEY = "app_config";

function session() {
  return supabaseAuthService.current();
}

function canUseRemoteConfig(config = {}) {
  return Boolean(isConfigured(config) && session()?.accessToken);
}

function client(config = {}) {
  const token = session()?.accessToken || "";
  return createSupabaseClient(config, token);
}

async function loadAppConfig(config = {}) {
  if (!canUseRemoteConfig(config)) return null;
  const supabase = client(config);
  const { data, error } = await supabase
    .from("system_settings")
    .select("value")
    .eq("key", APP_CONFIG_KEY)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data?.value || typeof data.value !== "object") return null;
  return normalizeConfig({ ...DEFAULT_GLOBAL_CONFIG, ...config, ...data.value });
}

async function saveAppConfig(config = {}) {
  if (!canUseRemoteConfig(config)) throw new Error("Login Supabase necessário para salvar configurações.");
  if (session()?.profile?.role !== "admin") throw new Error("Ação restrita ao admin.");
  const normalized = normalizeConfig({ ...DEFAULT_GLOBAL_CONFIG, ...config });
  const supabase = client(normalized);
  const { error } = await supabase
    .from("system_settings")
    .upsert({
      key: APP_CONFIG_KEY,
      value: normalized,
      updated_by: session()?.profile?.id || null,
      updated_at: new Date().toISOString(),
    }, { onConflict: "key" });
  if (error) throw new Error(error.message);
  return normalized;
}

async function migrateLocalConfigIfMissing(config = {}) {
  if (!canUseRemoteConfig(config)) return null;
  const remote = await loadAppConfig(config);
  if (remote) return remote;
  return saveAppConfig(config);
}

module.exports = {
  APP_CONFIG_KEY,
  canUseRemoteConfig,
  loadAppConfig,
  migrateLocalConfigIfMissing,
  saveAppConfig,
};
