const os = require("node:os");
const { createSupabaseClient } = require("./supabaseService");
const supabaseAuthService = require("./supabaseAuthService");

function isAvailable(config = {}) {
  return Boolean(supabaseAuthService.current()?.accessToken && config.supabaseAuthMode !== "local");
}

function currentProfile() {
  const session = supabaseAuthService.current();
  if (!session?.profile?.id) throw new Error("Perfil Supabase não disponível.");
  return session.profile;
}

function client(config = {}) {
  const session = supabaseAuthService.current();
  if (!session?.accessToken) throw new Error("Login Supabase necessário.");
  return createSupabaseClient(config, session.accessToken);
}

async function listReservations(config = {}) {
  const supabase = client(config);
  const { data, error } = await supabase
    .from("id_reservations")
    .select("id,ids,range_start,range_end,status,machine_id,expires_at,created_at,owner_id,profiles:owner_id(login,display_name)")
    .eq("status", "active")
    .gt("expires_at", new Date().toISOString())
    .order("expires_at", { ascending: true });
  if (error) throw new Error(error.message);
  return (data || []).map(reservationFromRow);
}

async function reserveIds(config = {}, payload = {}, actor = null) {
  const supabase = client(config);
  const profile = currentProfile();
  const count = Number(payload.count);
  if (!Number.isInteger(count) || count < 1 || count > 500) throw new Error("Quantidade inválida.");

  const lock = await acquireOperationLock(config, "RESERVA_ID", 1);
  try {
    const used = await usedArtworkIds(supabase);
    const active = await activeReservationRows(supabase);
    const busy = new Set(active.flatMap((item) => item.ids || []).map(Number).filter(Number.isFinite));
    const blocked = new Set([...used, ...busy]);
    let start = Number(payload.start);
    if (!Number.isInteger(start) || start < 1) start = nextAvailableStart(blocked, count);
    const ids = Array.from({ length: count }, (_, index) => start + index);

    const busyConflict = ids.find((id) => busy.has(id));
    if (busyConflict) throw new Error(`ID ${busyConflict} já está reservado.`);
    const usedConflict = ids.find((id) => used.has(id));
    if (usedConflict) throw new Error(`ID ${usedConflict} já existe no Supabase.`);

    const minutes = Number(config.reservationTtlMinutes) || 5;
    const expiresAt = new Date(Date.now() + minutes * 60 * 1000).toISOString();
    const { data, error } = await supabase
      .from("id_reservations")
      .insert({
        owner_id: profile.id,
        machine_id: os.hostname(),
        range_start: ids[0],
        range_end: ids[ids.length - 1],
        ids,
        status: "active",
        expires_at: expiresAt,
      })
      .select("id,ids,range_start,range_end,status,machine_id,expires_at,created_at,owner_id")
      .single();
    if (error) throw new Error(error.message);
    return {
      ...reservationFromRow({ ...data, profiles: { login: actor?.login || profile.login, display_name: actor?.name || profile.display_name } }),
      label: payload.label?.trim() || `Reserva ${ids[0]}-${ids[ids.length - 1]}`,
      provider: "supabase",
    };
  } finally {
    await releaseOperationLock(config, lock?.id).catch(() => null);
  }
}

async function releaseReservation(config = {}, reservationId = "") {
  const supabase = client(config);
  const profile = currentProfile();
  const { error } = await supabase
    .from("id_reservations")
    .update({
      status: "released",
      released_by: profile.id,
      released_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", reservationId)
    .eq("status", "active");
  if (error) throw new Error(error.message);
  return listReservations(config);
}

async function lockStatus(config = {}) {
  const supabase = client(config);
  const { data, error } = await supabase
    .from("operation_locks")
    .select("id,operation_type,status,machine_id,expires_at,last_progress_at,created_at,owner_id,profiles:owner_id(login,display_name)")
    .eq("status", "active")
    .gt("expires_at", new Date().toISOString())
    .order("expires_at", { ascending: true })
    .limit(10);
  if (error) throw new Error(error.message);
  const locks = data || [];
  const first = locks[0];
  if (!first) return { global: { status: "LIVRE", provider: "supabase" }, active: [] };
  const profile = Array.isArray(first.profiles) ? first.profiles[0] : first.profiles;
  return {
    global: {
      status: "OCUPADO",
      provider: "supabase",
      user: profile?.display_name || profile?.login || "",
      machine: first.machine_id || "",
      startedAt: first.created_at || "",
      token: first.id || "",
      note: first.operation_type || "",
      expiresAt: first.expires_at || "",
    },
    active: locks.map((row) => {
      const rowProfile = Array.isArray(row.profiles) ? row.profiles[0] : row.profiles;
      return {
        id: row.id,
        operationType: row.operation_type,
        user: rowProfile?.display_name || rowProfile?.login || "",
        machine: row.machine_id,
        createdAt: row.created_at,
        expiresAt: row.expires_at,
      };
    }),
  };
}

async function acquireOperationLock(config = {}, operationType = "CADASTRO_ARTE", ttlMinutes = 15) {
  const supabase = client(config);
  const profile = currentProfile();
  const now = new Date().toISOString();
  const { data: active, error: activeError } = await supabase
    .from("operation_locks")
    .select("id,operation_type,machine_id,expires_at,created_at,owner_id,profiles:owner_id(login,display_name)")
    .eq("operation_type", operationType)
    .eq("status", "active")
    .gt("expires_at", now)
    .order("expires_at", { ascending: true })
    .limit(1);
  if (activeError) throw new Error(activeError.message);
  const busy = active?.[0];
  if (busy) {
    const busyProfile = Array.isArray(busy.profiles) ? busy.profiles[0] : busy.profiles;
    const opName = operationType === "CADASTRO_ARTE" ? "cadastro" : "operação";
    throw new Error(`Existe outr${opName === 'cadastro' ? 'o' : 'a'} ${opName} em andamento por ${busyProfile?.display_name || busyProfile?.login || "outro usuário"}.`);
  }

  const expiresAt = new Date(Date.now() + (Number(ttlMinutes) || 15) * 60 * 1000).toISOString();
  const { data, error } = await supabase
    .from("operation_locks")
    .insert({
      operation_type: operationType,
      owner_id: profile.id,
      machine_id: os.hostname(),
      status: "active",
      expires_at: expiresAt,
      last_progress_at: now,
    })
    .select("id,token,operation_type,expires_at")
    .single();
  if (error) throw new Error(error.message);
  return data;
}

async function releaseOperationLock(config = {}, lockId = "") {
  if (!lockId) return false;
  const supabase = client(config);
  const profile = currentProfile();
  const { error } = await supabase
    .from("operation_locks")
    .update({
      status: "released",
      released_by: profile.id,
      released_at: new Date().toISOString(),
      last_progress_at: new Date().toISOString(),
    })
    .eq("id", lockId)
    .eq("status", "active");
  if (error) throw new Error(error.message);
  return true;
}

async function usedArtworkIds(supabase) {
  const ids = new Set();
  const pageSize = 1000;
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await supabase
      .from("artworks")
      .select("id")
      .in("status", ["active", "trash"])
      .range(from, from + pageSize - 1);
    if (error) throw new Error(error.message);
    for (const row of data || []) ids.add(Number(row.id));
    if (!data || data.length < pageSize) break;
  }
  return ids;
}

async function activeReservationRows(supabase) {
  const { data, error } = await supabase
    .from("id_reservations")
    .select("id,ids,range_start,range_end,status,machine_id,expires_at,created_at,owner_id")
    .eq("status", "active")
    .gt("expires_at", new Date().toISOString());
  if (error) throw new Error(error.message);
  return data || [];
}

function nextAvailableStart(blocked, count) {
  let start = Math.max(0, ...Array.from(blocked)) + 1;
  while (Array.from({ length: count }, (_, index) => start + index).some((id) => blocked.has(id))) {
    start += 1;
  }
  return start;
}

function reservationFromRow(row = {}) {
  const ids = (row.ids || []).map(Number).filter(Number.isFinite);
  const start = Number(row.range_start || ids[0] || 0);
  const end = Number(row.range_end || ids[ids.length - 1] || start);
  const profile = Array.isArray(row.profiles) ? row.profiles[0] : row.profiles;
  return {
    id: row.id,
    ids,
    label: `Reserva ${start}-${end}`,
    login: profile?.login || "",
    name: profile?.display_name || profile?.login || "Operador",
    machine: row.machine_id || "",
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    provider: "supabase",
  };
}

module.exports = {
  acquireOperationLock,
  isAvailable,
  listReservations,
  lockStatus,
  releaseOperationLock,
  releaseReservation,
  reserveIds,
};
