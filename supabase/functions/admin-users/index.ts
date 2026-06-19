import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type AdminPayload = {
  action: "create" | "update" | "reset-password" | "set-active" | "delete";
  login?: string;
  userId?: string;
  name?: string;
  role?: "admin" | "operator";
  password?: string;
  active?: boolean;
  emailDomain?: string;
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function errorMessage(error: unknown) {
  if (error instanceof Error) return error.message;
  if (error && typeof error === "object" && "message" in error) return String((error as { message?: unknown }).message);
  return String(error);
}

function cleanLogin(value = "") {
  const login = String(value).trim().toLowerCase();
  if (!/^[a-z0-9._-]{3,40}$/.test(login)) throw new Error("Login invalido.");
  return login;
}

function emailForLogin(login: string, domain = "bancodeartes.local") {
  return `${cleanLogin(login)}@${String(domain || "bancodeartes.local").trim().toLowerCase()}`;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Metodo invalido." }, 405);

  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const authHeader = req.headers.get("Authorization") ?? "";

  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
  });
  const adminClient = createClient(supabaseUrl, serviceRoleKey);

  const { data: authData, error: authError } = await userClient.auth.getUser();
  if (authError || !authData.user) return json({ error: "Login Supabase necessario." }, 401);

  const { data: actor, error: actorError } = await adminClient
    .from("profiles")
    .select("id,role,active")
    .eq("auth_user_id", authData.user.id)
    .maybeSingle();
  if (actorError) return json({ error: actorError.message }, 500);
  if (!actor?.active || actor.role !== "admin") return json({ error: "Acao restrita ao admin." }, 403);

  let payload: AdminPayload;
  try {
    payload = await req.json();
  } catch {
    return json({ error: "JSON invalido." }, 400);
  }

  try {
    const lookupLogin = cleanLogin(payload.userId || payload.login || "");
    const login = cleanLogin(payload.login || lookupLogin);
    const email = emailForLogin(login, payload.emailDomain);
    const displayName = String(payload.name || login).trim();
    const role = payload.role === "admin" ? "admin" : "operator";

    if (payload.action === "create") {
      if (!payload.password || String(payload.password).length < 6) throw new Error("Senha temporaria deve ter pelo menos 6 caracteres.");
      const created = await adminClient.auth.admin.createUser({
        email,
        password: String(payload.password),
        email_confirm: true,
        user_metadata: { login, name: displayName },
        app_metadata: { role },
      });
      if (created.error && !/already|registered|exists/i.test(created.error.message)) throw created.error;
      const authUser = created.data.user ?? await findAuthUserByEmail(adminClient, email);
      if (!authUser?.id) throw created.error ?? new Error("Usuario Auth nao encontrado apos criacao.");
      await upsertProfile(adminClient, {
        login,
        email,
        displayName,
        role,
        active: true,
        authUserId: authUser.id,
        mustChangePassword: true,
      });
      return json({ ok: true, login, email });
    }

    const { data: profile } = await adminClient
      .from("profiles")
      .select("id,auth_user_id,login,technical_email,role")
      .eq("login", lookupLogin)
      .maybeSingle();
    if (!profile) throw new Error("Perfil nao encontrado.");

    if (payload.action === "update") {
      const nextLogin = cleanLogin(payload.login || profile.login);
      const nextEmail = emailForLogin(nextLogin, payload.emailDomain);
      if (nextLogin !== profile.login) {
        const { data: existing, error: existingError } = await adminClient
          .from("profiles")
          .select("id")
          .eq("login", nextLogin)
          .maybeSingle();
        if (existingError) throw existingError;
        if (existing && existing.id !== profile.id) throw new Error("Login ja cadastrado.");
      }
      if (profile.auth_user_id) {
        const updatedAuth = await adminClient.auth.admin.updateUserById(profile.auth_user_id, {
          email: nextEmail,
          user_metadata: { login: nextLogin, name: displayName },
          app_metadata: { role },
        });
        if (updatedAuth.error) throw updatedAuth.error;
      }
      const { error: profileError } = await adminClient
        .from("profiles")
        .update({
          login: nextLogin,
          technical_email: nextEmail,
          display_name: displayName,
          role,
          active: payload.active !== false,
          auth_user_id: profile.auth_user_id,
          must_change_password: false,
          updated_at: new Date().toISOString(),
        })
        .eq("id", profile.id);
      if (profileError) throw profileError;
      return json({ ok: true, login: nextLogin, email: nextEmail });
    }

    if (payload.action === "reset-password") {
      if (!profile.auth_user_id) throw new Error("Perfil sem usuario Auth vinculado.");
      if (!payload.password || String(payload.password).length < 6) throw new Error("Nova senha deve ter pelo menos 6 caracteres.");
      const updated = await adminClient.auth.admin.updateUserById(profile.auth_user_id, {
        password: String(payload.password),
      });
      if (updated.error) throw updated.error;
      await adminClient.from("profiles").update({ must_change_password: true, updated_at: new Date().toISOString() }).eq("id", profile.id);
      return json({ ok: true });
    }

    if (payload.action === "set-active") {
      await adminClient.from("profiles").update({ active: Boolean(payload.active), updated_at: new Date().toISOString() }).eq("id", profile.id);
      return json({ ok: true });
    }

    if (payload.action === "delete") {
      if (profile.auth_user_id) {
        const { error: unlinkError } = await adminClient.from("profiles").update({ auth_user_id: null }).eq("id", profile.id);
        if (unlinkError) throw unlinkError;

        const deleted = await adminClient.auth.admin.deleteUser(profile.auth_user_id);
        if (deleted.error) throw deleted.error;
      }
      await adminClient.from("profiles").update({ active: false, deleted_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq("id", profile.id);
      return json({ ok: true });
    }

    return json({ error: "Acao desconhecida." }, 400);
  } catch (error) {
    return json({ error: errorMessage(error) }, 400);
  }
});

async function upsertProfile(client: ReturnType<typeof createClient>, input: {
  login: string;
  email: string;
  displayName: string;
  role: "admin" | "operator";
  active: boolean;
  authUserId?: string | null;
  mustChangePassword: boolean;
}) {
  const { error } = await client.from("profiles").upsert({
    login: input.login,
    technical_email: input.email,
    display_name: input.displayName,
    role: input.role,
    active: input.active,
    auth_user_id: input.authUserId,
    must_change_password: input.mustChangePassword,
    deleted_at: null,
    updated_at: new Date().toISOString(),
  }, { onConflict: "login" });
  if (error) throw error;
}

async function findAuthUserByEmail(client: ReturnType<typeof createClient>, email: string) {
  for (let page = 1; page <= 20; page += 1) {
    const { data, error } = await client.auth.admin.listUsers({ page, perPage: 100 });
    if (error) throw error;
    const found = data.users.find((user) => user.email?.toLowerCase() === email.toLowerCase());
    if (found) return found;
    if (data.users.length < 100) break;
  }
  return null;
}
