const os = require("node:os");
const crypto = require("node:crypto");
const { createSupabaseClient, isConfigured } = require("./supabaseService");

let activeSupabase = null;

function authMode(config = {}) {
  return config.supabaseAuthMode || "local";
}

function isAuthEnabled(config = {}) {
  return isConfigured(config) && authMode(config) !== "local";
}

function technicalEmailForLogin(config = {}, login = "") {
  const value = String(login || "").trim().toLowerCase();
  if (value.includes("@")) return value;
  const domain = String(config.supabaseAuthEmailDomain || "bancodeartes.local").trim().toLowerCase();
  return `${value}@${domain}`;
}

async function signIn(config = {}, loginValue = "", password = "") {
  if (!isAuthEnabled(config)) throw new Error("Auth do Supabase não está ativo.");
  const email = technicalEmailForLogin(config, loginValue);
  const supabase = createSupabaseClient(config);
  const { data, error } = await supabase.auth.signInWithPassword({ email, password: String(password || "") });
  if (error) throw new Error(friendlyAuthError(error.message));
  const session = data.session;
  const authUser = data.user;
  if (!session?.access_token || !authUser?.id) throw new Error("Supabase não retornou sessão válida.");

  const authed = createSupabaseClient(config, session.access_token);
  let profile = await findProfile(authed, authUser.id, email);
  if (profile && !profile.auth_user_id) {
    const { error: claimError } = await authed
      .from("profiles")
      .update({ auth_user_id: authUser.id, updated_at: new Date().toISOString() })
      .eq("id", profile.id);
    if (claimError) throw new Error(`Não consegui vincular o perfil Supabase: ${claimError.message}`);
    profile = await findProfile(authed, authUser.id, email);
  }
  if (!profile) throw new Error(`Usuário autenticou, mas não há perfil vinculado para ${email}.`);
  if (!profile.active) throw new Error("Usuário desativado no Supabase.");

  activeSupabase = {
    accessToken: session.access_token,
    refreshToken: session.refresh_token,
    expiresAt: session.expires_at,
    authUserId: authUser.id,
    email,
    profile,
  };

  return {
    provider: "supabase",
    session: {
      id: crypto.createHash("sha256").update(session.access_token).digest("hex").slice(0, 32),
      provider: "supabase",
      login: profile.login,
      name: profile.display_name,
      role: profile.role,
      machine: os.hostname(),
      startedAt: new Date().toISOString(),
      lastSeenAt: new Date().toISOString(),
      supabaseAuthUserId: authUser.id,
      expiresAt: session.expires_at ? new Date(session.expires_at * 1000).toISOString() : null,
    },
    user: publicProfile(profile),
  };
}

async function findProfile(supabase, authUserId, email) {
  const byAuth = await supabase
    .from("profiles")
    .select("id,auth_user_id,login,technical_email,display_name,role,active,must_change_password")
    .eq("auth_user_id", authUserId)
    .maybeSingle();
  if (byAuth.error) throw new Error(byAuth.error.message);
  if (byAuth.data) return byAuth.data;

  const claimable = await supabase
    .from("profiles")
    .select("id,auth_user_id,login,technical_email,display_name,role,active,must_change_password")
    .is("auth_user_id", null)
    .eq("technical_email", email)
    .maybeSingle();
  if (claimable.error) throw new Error(claimable.error.message);
  return claimable.data || null;
}

function current() {
  return activeSupabase;
}

async function listProfiles(config = {}) {
  if (!activeSupabase?.accessToken) throw new Error("Login Supabase necessário.");
  const supabase = createSupabaseClient(config, activeSupabase.accessToken);
  const { data, error } = await supabase
    .from("profiles")
    .select("id,auth_user_id,login,technical_email,display_name,role,active,must_change_password")
    .order("display_name", { ascending: true });
  if (error) throw new Error(error.message);
  return (data || []).map(publicProfile);
}

async function adminUserAction(config = {}, payload = {}) {
  if (!activeSupabase?.accessToken) throw new Error("Login Supabase necessário.");
  const functionName = config.supabaseAdminUsersFunctionName || "admin-users";
  const url = `${String(config.supabaseUrl || "").replace(/\/$/, "")}/functions/v1/${functionName}`;
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: config.supabasePublishableKey,
      Authorization: `Bearer ${activeSupabase.accessToken}`,
    },
    body: JSON.stringify({
      ...payload,
      emailDomain: config.supabaseAuthEmailDomain || "bancodeartes.local",
    }),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok || body.error) throw new Error(body.error || `Função ${functionName} retornou erro ${response.status}.`);
  return body;
}

function logout() {
  activeSupabase = null;
}

function publicProfile(profile) {
  return {
    id: profile.login,
    login: profile.login,
    name: profile.display_name,
    role: profile.role,
    active: profile.active,
    technicalEmail: profile.technical_email,
    supabaseProfileId: profile.id,
    supabaseAuthUserId: profile.auth_user_id,
    mustChangePassword: profile.must_change_password,
  };
}

function friendlyAuthError(message = "") {
  const text = String(message || "");
  if (/invalid login credentials/i.test(text)) return "Login ou senha do Supabase incorretos.";
  if (/email not confirmed/i.test(text)) return "E-mail do usuário ainda não foi confirmado no Supabase.";
  return text || "Falha no login Supabase.";
}

module.exports = {
  adminUserAction,
  authMode,
  current,
  isAuthEnabled,
  listProfiles,
  logout,
  signIn,
  technicalEmailForLogin,
};
