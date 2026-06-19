const { createSupabaseClient, isConfigured } = require("./supabaseService");
const supabaseAuthService = require("./supabaseAuthService");
const { normalizeDimension, normalizeText } = require("../shared/rules");

function canRead(config = {}) {
  return Boolean(config.supabaseEnabled && isConfigured(config) && ["supabase-readonly", "supabase"].includes(config.supabaseReadMode));
}

function canWrite(config = {}) {
  return Boolean(config.supabaseEnabled && isConfigured(config) && config.supabaseReadMode === "supabase" && supabaseAuthService.current()?.accessToken);
}

function client(config = {}) {
  const token = supabaseAuthService.current()?.accessToken || "";
  return createSupabaseClient(config, token);
}

async function listArtworks(config = {}) {
  const supabase = client(config);
  const { data, error } = await supabase
    .from("artworks")
    .select("id,theme,product,size,client,phone,created_at,updated_at,status,drive_url,metadata,created_by")
    .in("status", ["active", "trash"])
    .order("id", { ascending: false });
  if (error) throw new Error(error.message);
  return (data || []).map(artworkFromRow);
}

async function dashboardData(config = {}) {
  const artworks = await listArtworks(config);
  const active = artworks.filter((item) => item.status !== "trash");
  const byUser = {};
  const byTheme = {};
  let maxId = 0;
  for (const art of active) {
    const id = Number(art.id);
    if (Number.isFinite(id)) maxId = Math.max(maxId, id);
    const theme = art.theme || "SEM TEMA";
    const user = art.user || "SEM USUARIO";
    byTheme[theme] = (byTheme[theme] || 0) + 1;
    byUser[user] = (byUser[user] || 0) + 1;
  }
  return {
    totalArtworks: active.length,
    nextId: maxId + 1,
    topTheme: topEntry(byTheme),
    byUser: Object.entries(byUser).sort((a, b) => b[1] - a[1]),
    byTheme: Object.entries(byTheme).sort((a, b) => b[1] - a[1]),
  };
}

async function nextAvailableArtworkIds(config = {}, count, reserved = []) {
  const needed = Number(count);
  if (!Number.isInteger(needed) || needed < 1) return [];
  const supabase = client(config);
  const used = new Set((reserved || []).map((id) => String(id).trim()).filter(Boolean));
  const { data, error } = await supabase
    .from("artworks")
    .select("id")
    .in("status", ["active", "trash"]);
  if (error) throw new Error(error.message);
  for (const row of data || []) used.add(String(row.id));
  const ids = [];
  let next = Math.max(0, ...Array.from(used).map((id) => Number(id)).filter(Number.isFinite)) + 1;
  while (ids.length < needed) {
    const value = String(next);
    if (!used.has(value)) {
      ids.push(value);
      used.add(value);
    }
    next += 1;
  }
  return ids;
}

async function usedArtworkIds(config = {}) {
  const supabase = client(config);
  const used = new Set();
  const { data, error } = await supabase
    .from("artworks")
    .select("id")
    .in("status", ["active", "trash"]);
  if (error) throw new Error(error.message);
  for (const row of data || []) used.add(String(row.id));
  return used;
}

async function updateArtwork(config = {}, payload = {}) {
  if (!canWrite(config)) throw new Error("Supabase oficial com login necessário para editar arte.");
  const id = Number(payload.id);
  if (!Number.isInteger(id) || id < 1) throw new Error("ID inválido.");
  const supabase = client(config);
  const profile = supabaseAuthService.current()?.profile;
  const next = {
    updated_by: profile?.id || null,
    updated_at: new Date().toISOString(),
  };

  if ("theme" in payload) next.theme = normalizeText(payload.theme);
  if ("product" in payload) next.product = normalizeText(payload.product);
  if ("size" in payload) next.size = normalizeDimension(payload.size);
  if ("client" in payload) next.client = normalizeText(payload.client);
  if ("phone" in payload) next.phone = String(payload.phone || "").trim();
  if ("status" in payload) next.status = payload.status;
  
  if ("url" in payload || "drive_url" in payload) {
    next.drive_url = String(payload.url || payload.drive_url || "").trim();
  }
  const response = await supabase
    .from("artworks")
    .update(next)
    .eq("id", id)
    .select("id,theme,product,size,client,phone,created_at,updated_at,status,drive_url,metadata");

  console.log("SUPABASE UPDATE RESULT:", { id, next, response });

  if (response.error) throw new Error(response.error.message);
  
  if (!response.data || response.data.length === 0) {
    throw new Error(`Nenhuma linha foi atualizada no Supabase (ID ${id}) — verifique RLS ou se a arte existe.`);
  }

  const rowData = Array.isArray(response.data) ? response.data[0] : response.data;
  
  await recordEvent(config, id, "artwork_updated", { fields: Object.keys(next) }).catch(() => null);
  return artworkFromRow(rowData);
}

async function deleteArtwork(config = {}, payload = {}) {
  if (!canWrite(config)) throw new Error("Supabase oficial com login necessário para apagar arte.");
  const id = Number(payload.id);
  if (!Number.isInteger(id) || id < 1) throw new Error("ID inválido.");
  const profile = supabaseAuthService.current()?.profile;
  const deleteAfter = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
  const supabase = client(config);
  const { data, error } = await supabase
    .from("artworks")
    .update({
      status: "trash",
      deleted_at: new Date().toISOString(),
      deleted_by: profile?.id || null,
      delete_after: deleteAfter,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id)
    .select("id,theme,product,size,client,phone,created_at,updated_at,status,drive_url,metadata")
    .single();
  if (error) throw new Error(error.message);
  await recordEvent(config, id, "artwork_trashed", { delete_after: deleteAfter }).catch(() => null);
  return { ok: true, id: String(id), deleteAfter, ...artworkFromRow(data) };
}

async function upsertImportedArtwork(config = {}, artwork = {}) {
  if (!canWrite(config)) throw new Error("Supabase oficial com login necessário para cadastrar arte.");
  const supabase = client(config);
  const profile = supabaseAuthService.current()?.profile;
  const id = Number(artwork.id);
  if (!Number.isInteger(id) || id < 1) throw new Error("ID inválido.");
  const row = {
    id,
    theme: normalizeText(artwork.theme),
    product: normalizeText(artwork.product),
    size: normalizeDimension(artwork.size),
    client: normalizeText(artwork.client),
    phone: String(artwork.phone || "").trim(),
    drive_url: String(artwork.url || artwork.drive_url || "").trim(),
    drive_file_id: artwork.driveFileId || null,
    drive_file_name: artwork.fileName || null,
    created_by: profile?.id || null,
    updated_by: profile?.id || null,
    operator_edit_until: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
    status: "active",
    metadata: {
      source: "app_upload",
      legacy_user: artwork.user || profile?.display_name || "",
      imported_at: new Date().toISOString(),
    },
  };
  const { data, error } = await supabase
    .from("artworks")
    .insert(row)
    .select("id,theme,product,size,client,phone,created_at,updated_at,status,drive_url,metadata")
    .single();
  if (error) throw new Error(error.message);
  await recordEvent(config, id, "artwork_created", { source: "app_upload" }).catch(() => null);
  return artworkFromRow(data);
}

async function recordEvent(config = {}, artworkId, eventType, payload = {}) {
  const supabase = client(config);
  const profile = supabaseAuthService.current()?.profile;
  await supabase.from("artwork_events").insert({
    artwork_id: Number(artworkId),
    event_type: eventType,
    actor_id: profile?.id || null,
    payload,
  });
}

function artworkFromRow(row = {}) {
  const meta = row.metadata || {};
  return {
    rowNumber: "",
    id: String(row.id || ""),
    theme: row.theme || "",
    product: row.product || "",
    size: row.size || "",
    client: row.client || "",
    user: meta.legacy_user || "",
    phone: row.phone || "",
    date: row.created_at || "",
    url: row.drive_url || "",
    status: row.status || "active",
    provider: "supabase",
  };
}

function topEntry(map) {
  return Object.entries(map).sort((a, b) => b[1] - a[1])[0] || ["-", 0];
}

module.exports = {
  canRead,
  canWrite,
  dashboardData,
  deleteArtwork,
  listArtworks,
  nextAvailableArtworkIds,
  updateArtwork,
  upsertImportedArtwork,
  usedArtworkIds,
};
