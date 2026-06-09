const { createClient } = require("@supabase/supabase-js");
const WebSocket = require("ws");

const CONFIGURED_SCHEMA_VERSION = "2026-06-05-initial";

function safeConfig(config = {}) {
  return {
    enabled: Boolean(config.supabaseEnabled),
    url: String(config.supabaseUrl || "").trim(),
    publishableKey: String(config.supabasePublishableKey || "").trim(),
    readMode: config.supabaseReadMode || "google",
    schemaVersion: config.supabaseSchemaVersion || CONFIGURED_SCHEMA_VERSION,
  };
}

function isConfigured(config = {}) {
  const cfg = safeConfig(config);
  return Boolean(cfg.enabled && cfg.url && cfg.publishableKey);
}

function maskedKey(key = "") {
  const text = String(key || "");
  if (!text) return "";
  if (text.length <= 12) return `${text.slice(0, 4)}...`;
  return `${text.slice(0, 12)}...${text.slice(-4)}`;
}

function createSupabaseClient(config = {}, accessToken = "") {
  const cfg = safeConfig(config);
  if (!cfg.url) throw new Error("URL do Supabase não configurada.");
  if (!cfg.publishableKey) throw new Error("Chave publicável do Supabase não configurada.");
  return createClient(cfg.url, cfg.publishableKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
    realtime: {
      transport: WebSocket,
    },
    global: accessToken
      ? { headers: { Authorization: `Bearer ${accessToken}` } }
      : undefined,
  });
}

async function status(config = {}) {
  const cfg = safeConfig(config);
  const response = {
    enabled: cfg.enabled,
    configured: isConfigured(config),
    readMode: cfg.readMode,
    schemaVersion: cfg.schemaVersion,
    url: cfg.url,
    publishableKey: maskedKey(cfg.publishableKey),
    ok: false,
    message: "Supabase desativado.",
  };

  if (!cfg.enabled) return response;
  if (!response.configured) {
    return {
      ...response,
      message: "Informe URL e chave publicável do Supabase.",
    };
  }

  try {
    const supabase = createSupabaseClient(config);
    const { error } = await supabase
      .from("system_settings")
      .select("key")
      .limit(1);
    if (error) {
      return {
        ...response,
        message: error.message,
      };
    }
    return {
      ...response,
      ok: true,
      message: "Supabase conectado.",
    };
  } catch (error) {
    return {
      ...response,
      message: error.message,
    };
  }
}

module.exports = {
  CONFIGURED_SCHEMA_VERSION,
  createSupabaseClient,
  isConfigured,
  safeConfig,
  status,
};
