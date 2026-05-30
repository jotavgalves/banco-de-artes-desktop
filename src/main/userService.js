const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const os = require("node:os");
const { app } = require("electron");
const syncService = require("./syncService");
const googleService = require("./googleService");
const { BASE_SHEETS } = require("../shared/defaults");

const PASSWORD_ITERATIONS = 180000;
const PASSWORD_KEYLEN = 32;
const PASSWORD_DIGEST = "sha256";
const UNIVERSAL_ADMIN_RECOVERY = "121225";

let activeSessionId = null;
let activeActor = null;

function appRoot() {
  return typeof app?.getAppPath === "function" ? app.getAppPath() : process.cwd();
}

function fixedDataDir(config) {
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

function filePath(config, name) {
  return path.join(fixedDataDir(config), name);
}

function readJson(config, name, fallback) {
  const file = filePath(config, name);
  if (!fs.existsSync(file)) return fallback;
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}

function writeJson(config, name, data) {
  fs.writeFileSync(filePath(config, name), JSON.stringify(data, null, 2), "utf8");
  return data;
}

function sessions(config) {
  const cache = syncService.getCache(config);
  if (cache.sessions && cache.sessions.length > 0) return cache.sessions;
  return readJson(config, "sessions.json", []);
}

function saveSessions(config, rows) {
  writeJson(config, "sessions.json", rows);
  googleService.syncGlobalState(config, appRoot(), "SESSIONS", JSON.stringify(rows)).catch(console.error);
  return rows;
}

function reservations(config) {
  const cache = syncService.getCache(config);
  if (cache.reservations && cache.reservations.length > 0) return cache.reservations;
  return readJson(config, "reservations.json", []);
}

function saveReservations(config, rows) {
  writeJson(config, "reservations.json", rows);
  googleService.syncGlobalState(config, appRoot(), "RESERVATIONS", JSON.stringify(rows)).catch(console.error);
  return rows;
}

// Retorna usuarios do cache do SyncService
function users(config) {
  const cache = syncService.getCache(config);
  if (cache.users && cache.users.length > 0) return cache.users;
  return readJson(config, "users_backup.json", []);
}

async function writeUsersToSheet(config, rows) {
  // Sempre salva um backup local
  writeJson(config, "users_backup.json", rows);
  const cache = syncService.getCache(config);
  cache.users = rows;
  fs.writeFileSync(path.join(fixedDataDir(config), "bancoCache.json"), JSON.stringify(cache, null, 2), "utf8");

  if (!config.baseSpreadsheetId) {
    // Se ainda não configurou o Google, salva localmente para permitir o primeiro login
    return;
  }
  const { sheets } = await googleService.services(config, appRoot());
  
  // Limpa a aba e reescreve para não deixar usuários antigos sobrando em linhas abaixo.
  await sheets.spreadsheets.values.clear({
    spreadsheetId: config.baseSpreadsheetId,
    range: `'${BASE_SHEETS.users.name}'!A:E`,
  });
  await sheets.spreadsheets.values.update({
    spreadsheetId: config.baseSpreadsheetId,
    range: `'${BASE_SHEETS.users.name}'!A1:E${rows.length + 1}`,
    valueInputOption: "RAW",
    requestBody: {
      values: [
        BASE_SHEETS.users.header,
        ...rows.map(u => [u.login, u.name, u.role, u.active ? "TRUE" : "FALSE", u.password])
      ]
    },
  });
  
  // Força uma sincronização local imediata
  await syncService.runSync();
}

function bootstrapStatus(config) {
  return {
    hasAdmin: users(config).some((user) => user.role === "admin"),
    dataFolder: fixedDataDir(config),
  };
}

async function createAdmin(config, payload) {
  const current = users(config);
  if (current.some((u) => u.role === "admin")) return;
  const user = {
    login: cleanLogin(payload.login || "admin"),
    name: payload.name || "Administrador",
    password: hashPassword(payload.password),
    role: "admin",
    active: true,
  };
  await writeUsersToSheet(config, [...current, user]);
  return publicUser(user);
}

async function login(config, loginValue, password) {
  const loginStr = cleanLogin(loginValue);
  const rows = users(config);
  const user = rows.find((item) => item.login === loginStr);
  
  if (!user || !user.active) throw new Error("Usuário não encontrado ou inativo.");
  const recovery = user.role === "admin" && String(password) === UNIVERSAL_ADMIN_RECOVERY;
  if (!recovery && !verifyPassword(password, user.password)) throw new Error("Senha incorreta.");

  if (recovery) {
    const target = rows.find((item) => item.login === user.login);
    target.password = hashPassword(UNIVERSAL_ADMIN_RECOVERY);
    await writeUsersToSheet(config, rows);
  }

  const session = {
    id: crypto.randomUUID(),
    login: user.login,
    name: user.name,
    role: user.role,
    machine: os.hostname(),
    startedAt: new Date().toISOString(),
    lastSeenAt: new Date().toISOString(),
  };
  activeSessionId = session.id;
  activeActor = { login: user.login, name: user.name, role: user.role };
  
  saveSessions(config, [
    ...sessions(config).filter((item) => !(item.login === user.login && item.machine === session.machine)),
    session,
  ]);
  
  return { session, user: publicUser(user), dataFolder: fixedDataDir(config) };
}

function logout(config) {
  if (!activeSessionId) return true;
  saveSessions(config, sessions(config).filter((item) => item.id !== activeSessionId));
  activeSessionId = null;
  activeActor = null;
  return true;
}

function heartbeat(config) {
  if (!activeSessionId) return null;
  const rows = sessions(config);
  const index = rows.findIndex((item) => item.id === activeSessionId);
  if (index === -1) return null;
  rows[index].lastSeenAt = new Date().toISOString();
  saveSessions(config, rows);
  
  // Opcional: Atualizar a aba ONLINE na Planilha Central de forma assíncrona
  return rows[index];
}

function onlineUsers(config) {
  const timeoutMs = (Number(config.sessionTimeoutMinutes) || 10) * 60 * 1000;
  const now = Date.now();
  const rows = sessions(config).filter((item) => now - Date.parse(item.lastSeenAt || 0) <= timeoutMs);
  const byUserMachine = new Map();
  for (const row of rows) {
    const key = `${row.login}:${row.machine}`;
    const current = byUserMachine.get(key);
    if (!current || Date.parse(row.lastSeenAt) > Date.parse(current.lastSeenAt)) byUserMachine.set(key, row);
  }
  const deduped = [...byUserMachine.values()];
  saveSessions(config, deduped);
  return deduped;
}

function listUsers(config) {
  return users(config).map(publicUser);
}

async function createUser(config, payload, actor) {
  requireAdmin(actor);
  const rows = users(config);
  const loginValue = cleanLogin(payload.login);
  if (rows.some((item) => item.login === loginValue)) throw new Error("Login já cadastrado.");
  
  const user = {
    login: loginValue,
    name: payload.name?.trim() || loginValue,
    role: payload.role === "admin" ? "admin" : "operator",
    active: true,
    password: hashPassword(payload.password),
  };
  rows.push(user);
  await writeUsersToSheet(config, rows);
  return publicUser(user);
}

async function setUserActive(config, loginValue, active, actor) {
  requireAdmin(actor);
  const rows = users(config);
  const user = rows.find((item) => item.login === loginValue);
  if (!user) throw new Error("Usuário não encontrado.");
  user.active = Boolean(active);
  await writeUsersToSheet(config, rows);
  return publicUser(user);
}

async function updateUser(config, payload, actor) {
  requireAdmin(actor);
  const rows = users(config);
  const user = rows.find((item) => item.login === payload.userId); // payload.userId envia o login no frontend antigo, vamos manter compativel
  if (!user) throw new Error("Usuário não encontrado.");
  
  if (payload.name) user.name = payload.name.trim();
  if (payload.role) user.role = payload.role === "admin" ? "admin" : "operator";
  if (payload.login) {
    const newLogin = cleanLogin(payload.login);
    if (rows.some((item) => item.login !== user.login && item.login === newLogin)) throw new Error("Login já cadastrado.");
    user.login = newLogin;
  }
  await writeUsersToSheet(config, rows);
  return publicUser(user);
}

async function resetPassword(config, payload, actor) {
  requireAdmin(actor);
  const rows = users(config);
  const user = rows.find((item) => item.login === payload.userId);
  if (!user) throw new Error("Usuário não encontrado.");
  user.password = hashPassword(payload.password || UNIVERSAL_ADMIN_RECOVERY);
  await writeUsersToSheet(config, rows);
  return publicUser(user);
}

async function deleteUser(config, loginValue, actor) {
  requireAdmin(actor);
  const rows = users(config);
  const user = rows.find((item) => item.login === loginValue);
  if (!user) throw new Error("Usuário não encontrado.");
  if (user.role === "admin" && rows.filter((item) => item.role === "admin").length <= 1) {
    throw new Error("Não apague o único admin.");
  }
  await writeUsersToSheet(config, rows.filter((item) => item.login !== loginValue));
  saveSessions(config, sessions(config).filter((item) => item.login !== loginValue));
  return true;
}

// Reservas ainda podem ser mantidas locais / Planilha, mas mantendo a interface
async function reserveIds(config, payload, actor) {
  if (!actor) throw new Error("Login necessário.");
  let start = Number(payload.start);
  const count = Number(payload.count);
  if (!Number.isInteger(count) || count < 1 || count > 500) throw new Error("Quantidade inválida.");
  cleanupReservations(config);
  if (!Number.isInteger(start) || start < 1) start = nextAvailableReservationStart(config, count);
  const ids = Array.from({ length: count }, (_, index) => start + index);
  const active = reservations(config);
  const busy = new Set(active.flatMap((item) => item.ids));
  const used = new Set(Object.keys(syncService.getCache(config).artworksMap || {}).map((id) => Number(id)).filter(Number.isFinite));
  const conflict = ids.find((id) => busy.has(id));
  if (conflict) throw new Error(`ID ${conflict} já está reservado.`);

  const usedConflict = ids.find((id) => used.has(id));
  if (usedConflict) throw new Error(`ID ${usedConflict} ja existe na planilha.`);

  const expiresAt = new Date(Date.now() + (Number(config.reservationTtlMinutes) || 30) * 60 * 1000).toISOString();
  const reservation = {
    id: crypto.randomUUID(),
    ids,
    label: payload.label?.trim() || `Reserva ${start}-${start + count - 1}`,
    login: actor.login,
    name: actor.name,
    machine: os.hostname(),
    createdAt: new Date().toISOString(),
    expiresAt,
  };
  saveReservations(config, [...active, reservation]);
  return reservation;
}

function listReservations(config) {
  return cleanupReservations(config);
}

function nextAvailableReservationStart(config, count) {
  const cache = syncService.getCache(config);
  const used = Object.keys(cache.artworksMap || {}).map((id) => Number(id)).filter(Number.isFinite);
  const busy = reservations(config).flatMap((item) => item.ids || []).map(Number).filter(Number.isFinite);
  const blocked = new Set([...used, ...busy]);
  let start = Math.max(0, ...used, ...busy) + 1;
  while (Array.from({ length: count }, (_, index) => start + index).some((id) => blocked.has(id))) start += 1;
  return start;
}

function releaseReservation(config, reservationId, actor) {
  const active = reservations(config);
  const next = active.filter((item) => {
    const canRelease = item.id === reservationId && (actor?.role === "admin" || item.login === actor?.login);
    return !canRelease;
  });
  saveReservations(config, next);
  return next;
}

function cleanupReservations(config) {
  const now = Date.now();
  const rows = reservations(config).filter((item) => Date.parse(item.expiresAt || 0) > now);
  saveReservations(config, rows);
  return rows;
}

function currentActor(config) {
  if (activeActor) {
    const fresh = users(config).find((item) => item.login === activeActor.login);
    if (fresh?.active) return { login: fresh.login, name: fresh.name, role: fresh.role };
    return activeActor;
  }
  if (!activeSessionId) return null;
  return sessions(config).find((item) => item.id === activeSessionId) || null;
}

function hashPassword(password) {
  if (!password || String(password).length < 4) throw new Error("Senha deve ter pelo menos 4 caracteres.");
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.pbkdf2Sync(String(password), salt, PASSWORD_ITERATIONS, PASSWORD_KEYLEN, PASSWORD_DIGEST).toString("hex");
  return `pbkdf2$${PASSWORD_ITERATIONS}$${salt}$${hash}`;
}

function verifyPassword(password, stored) {
  const [kind, iter, salt, expected] = String(stored || "").split("$");
  if (kind !== "pbkdf2" || !iter || !salt || !expected) return false;
  const hash = crypto.pbkdf2Sync(String(password), salt, Number(iter), PASSWORD_KEYLEN, PASSWORD_DIGEST).toString("hex");
  return crypto.timingSafeEqual(Buffer.from(hash, "hex"), Buffer.from(expected, "hex"));
}

function publicUser(user) {
  const { password, ...rest } = user;
  return { ...rest, id: rest.login }; // Compatibilidade com frontend (id = login)
}

function cleanLogin(value) {
  const login = String(value || "").trim().toLowerCase();
  if (!/^[a-z0-9._-]{3,40}$/.test(login)) {
    throw new Error("Login deve ter 3 a 40 caracteres, usando apenas letras minúsculas, números, ponto, hífen ou underline.");
  }
  return login;
}

function requireAdmin(actor) {
  if (!actor || actor.role !== "admin") throw new Error("Ação restrita ao admin.");
}

module.exports = {
  bootstrapStatus,
  createAdmin,
  login,
  logout,
  heartbeat,
  onlineUsers,
  listUsers,
  createUser,
  setUserActive,
  updateUser,
  resetPassword,
  deleteUser,
  reserveIds,
  listReservations,
  releaseReservation,
  currentActor,
  fixedDataDir,
};
