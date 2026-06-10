const state = {
  config: null,
  session: null,
  user: null,
  files: [],
  rows: [],
  reservations: [],
  users: [],
  online: [],
  artworks: [],
  driveFolders: null,
  artworkSort: "desc",
  artworkViewMode: "cards",
  artworkTools: false,
  artworkSelection: new Set(),
  brokenArtworkImageIds: new Set(),
  currentFindArtworkId: "",
  uploadStartedAt: 0,
  mode: "standard",
  panel50ThemeTouched: false,
  financeItems: [],
  financePreview: [],
  financeClients: [],
  financeClientMatch: null,
  confirmResolver: null,
  bootstrap: null,
  cache: { artworksMap: {}, configs: {}, users: [] },
};

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => Array.from(document.querySelectorAll(selector));
const setTextAll = (selector, value) => $$(selector).forEach((element) => { element.textContent = value; });

function setBusy(message = "Carregando...") {
  if ($("#globalOverlayText")) $("#globalOverlayText").textContent = message;
  $("#globalOverlay")?.classList.remove("hidden");
  startActionProgress(message, "Preparando...", 8);
}

function clearBusy() {
  $("#globalOverlay")?.classList.add("hidden");
  finishActionProgress();
}

function startActionProgress(title = "Processando", detail = "Aguarde...", percent = 5) {
  const box = $("#globalProgress");
  if (!box) return;
  $("#globalProgressTitle").textContent = title;
  $("#globalProgressDetail").textContent = detail;
  updateActionProgress(percent);
  box.classList.remove("hidden");
  clearInterval(startActionProgress.timer);
  let value = Math.max(5, Number(percent || 5));
  startActionProgress.timer = setInterval(() => {
    value = Math.min(92, value + Math.max(1, Math.round((95 - value) * 0.08)));
    updateActionProgress(value);
  }, 650);
}

function updateActionProgress(percent = 0, detail = "") {
  const value = Math.max(0, Math.min(100, Math.round(Number(percent || 0))));
  if ($("#globalProgressBar")) $("#globalProgressBar").style.width = `${value}%`;
  if ($("#globalProgressPercent")) $("#globalProgressPercent").textContent = `${value}%`;
  if (detail && $("#globalProgressDetail")) $("#globalProgressDetail").textContent = detail;
}

function finishActionProgress(detail = "Concluído.") {
  const box = $("#globalProgress");
  if (!box) return;
  clearInterval(startActionProgress.timer);
  updateActionProgress(100, detail);
  clearTimeout(finishActionProgress.timer);
  finishActionProgress.timer = setTimeout(() => box.classList.add("hidden"), 450);
}

async function boot() {
  installErrorLogging();
  bindNavigation();
  bindActions();
  bindFilters();
  await loadConfig();
  await loadBootstrap();
  renderLoginMode();
  
  state.cache = await window.artBank.runSync().catch(() => state.cache);
}

function bindNavigation() {
  $$(".nav-item").forEach((button) => {
    button.addEventListener("click", async () => {
      const view = button.dataset.view;
      showView(view, button.querySelector("span:last-child").textContent.trim());
      if (view === "artworks") {
        await refreshArtworks({ force: true, showLoading: true });
        await refreshDashboardData();
      }
      if (view === "batch") {
        toast("Sincronizando cache...");
        state.cache = await window.artBank.runSync().catch(() => state.cache);
        if (state.rows.length) {
           state.rows.forEach(r => r.valid = validateRowLocal(r));
           renderRows();
        }
      }
      if (view === "drive") {
        await refreshDriveFolders(false);
      }
      if (view === "finance") {
        await refreshFinanceClients();
        await refreshFinancePreview();
      }
    });
  });
}

function bindActions() {
    $("#loginForm")?.addEventListener("submit", handleLogin);
    $("#recoverAdminButton")?.addEventListener("click", recoverAdminAccess);
    $("#logoutButton")?.addEventListener("click", logout);
    $("#forceSyncButton")?.addEventListener("click", refreshAll);
    $("#authButton")?.addEventListener("click", authenticateGoogle);
    $("#provisionButton")?.addEventListener("click", provisionGoogle);
    $("#removeSelectedButton")?.addEventListener("click", removeSelectedRows);
    $("#reloadArtworksButton")?.addEventListener("click", refreshArtworks);
    $("#refreshMissingArtworkImagesButton")?.addEventListener("click", refreshMissingArtworkImages);
    $("#saveAllArtworksButton")?.addEventListener("click", saveAllArtworkEdits);
    $("#deleteSelectedArtworksButton")?.addEventListener("click", deleteSelectedArtworks);
    $("#selectAllArtworks")?.addEventListener("change", toggleAllVisibleArtworks);
    $("#validateRowsButton")?.addEventListener("click", validateRows);
    $("#submitBatchButton")?.addEventListener("click", uploadBatch);
    $("#runPanel50Button")?.addEventListener("click", runPanel50Automation);
    $("#choosePanel50Input")?.addEventListener("click", choosePanel50Input);
    $("#panel50InputFolder")?.addEventListener("input", updatePanel50ThemePreview);
    $("#panel50Theme")?.addEventListener("input", () => {
      state.panel50ThemeTouched = true;
      updatePanel50ThemePreview();
    });
    $("#openOrderModalButton")?.addEventListener("click", openOrderModal);
    $("#closeOrderModalButton")?.addEventListener("click", closeOrderModal);
    $("#clearOrderButton")?.addEventListener("click", clearFinanceOrder);
    $("#financeCodeInput")?.addEventListener("keydown", handleFinanceCodeKey);
    $("#financeClientInput")?.addEventListener("input", handleFinanceClientInput);
    $("#financeNewClientName")?.addEventListener("input", updateFinanceSummary);
    $("#financeCopyButton")?.addEventListener("click", copyFinanceOrder);
    $("#confirmCancelButton")?.addEventListener("click", () => resolveConfirm(false));
    $("#confirmOkButton")?.addEventListener("click", () => resolveConfirm(true));
    $("#closeFindArtworkButton")?.addEventListener("click", closeFindArtworkModal);
    $("#findDriveLocalButton")?.addEventListener("click", () => openArtworkLocation("drive-local"));
    $("#findOrganizedLocalButton")?.addEventListener("click", () => openArtworkLocation("organized"));
    $("#localPreviewImage")?.addEventListener("error", showPreviewFallback);
    $("#refreshDriveFoldersButton")?.addEventListener("click", () => refreshDriveFolders(true));
    $("#openDriveRootButton")?.addEventListener("click", openDriveRoot);
    $("#standardMode")?.addEventListener("click", () => setMode("standard"));
    $("#manualMode")?.addEventListener("click", () => setMode("manual"));
    $("#fillFromReservationButton")?.addEventListener("click", fillFromReservation);
    $("#settingsForm")?.addEventListener("submit", saveSettings);
  $("#testConnectivityButton")?.addEventListener("click", testConnectivity);
  $("#artworkToolsButton")?.addEventListener("click", toggleArtworkTools);
  window.artBank.onUploadProgress?.((progress) => {
    renderUploadProgress(progress);
    renderPanel50Progress(progress);
  });
  
  // Theme Toggle
  const themeToggle = $("#themeToggle");
  if(themeToggle) {
    themeToggle.addEventListener("click", () => {
       const html = document.documentElement;
       const current = html.getAttribute("data-theme") || "dark";
       const next = current === "dark" ? "light" : "dark";
       html.setAttribute("data-theme", next);
       localStorage.setItem("theme", next);
    });
    const savedTheme = localStorage.getItem("theme") || "light";
    document.documentElement.setAttribute("data-theme", savedTheme);
  }
  
  // User Tab Actions
  $("#tabNewUser")?.addEventListener("click", () => setUsersTab("new"));
  $("#tabEditUser")?.addEventListener("click", () => setUsersTab("edit"));
  $("#userActionForm")?.addEventListener("submit", handleUserActionSubmit);
  $("#btnSaveUser")?.addEventListener("click", () => $("#userActionForm")?.requestSubmit());
  $("#btnToggleActive")?.addEventListener("click", toggleSelectedUserActive);
  $("#btnDeleteUser")?.addEventListener("click", deleteSelectedUser);

  $("#reservationForm").addEventListener("submit", createReservation);
  $("#closePreviewButton").addEventListener("click", closePreview);
  
  $$(".copy-btn").forEach(btn => {
     btn.addEventListener("click", (e) => {
        e.preventDefault();
        const input = btn.previousElementSibling;
        if (input && input.value) {
           navigator.clipboard.writeText(input.value);
           const original = btn.textContent;
           btn.textContent = "Copiado";
           setTimeout(() => btn.textContent = original, 1500);
        }
     });
  });
}

async function recoverAdminAccess() {
  const form = $("#loginForm");
  form.elements.login.value = form.elements.login.value || "admin";
  form.elements.password.value = "";
  form.elements.password.placeholder = "Digite a chave de recuperação";
  form.elements.password.focus();
  toast("Digite a chave de recuperação no campo de senha e clique em Acessar.");
}
async function loadConfig() {
  state.config = await window.artBank.getConfig();
  fillSettingsForm();
  renderConfig();
  populateBatchProductFilter();
  renderExternalLinks();
}

async function loadBootstrap() {
  state.bootstrap = await window.artBank.bootstrapStatus();
  if ($("#dataFolderHint")) $("#dataFolderHint").textContent = `Dados locais: ${state.bootstrap.dataFolder}`;
}

function renderLoginMode() {
  const firstAccess = !state.bootstrap.hasAdmin;
  const phrases = [
    "Um acervo visual com IDs protegidos, prévias rápidas, Drive e auditoria em uma operação só.",
    "Cadastre, revise e publique artes com fluxo guiado, menos retrabalho e mais confiança operacional.",
    "Controle arquivos, reservas, equipe e Drive com uma experiência desenhada para ritmo de produção.",
    "Encontre, valide e lance artes sem alternar entre pastas, Drive e mensagens soltas.",
    "A base oficial das artes, com rastreio visual, histórico de ações e publicação mais segura."
  ];
  const phrase = phrases[Math.floor(Math.random() * phrases.length)];
  if ($("#loginHeadline")) $("#loginHeadline").innerHTML = firstAccess ? "Primeiro acesso,<br/>operação pronta para escalar." : "Banco visual,<br/>produção sob controle.";
  if ($("#loginPhrase")) $("#loginPhrase").textContent = firstAccess
    ? "Crie o administrador inicial e libere a operação com usuários, auditoria, Supabase e Drive."
    : phrase;
  if ($("#loginModeLabel")) $("#loginModeLabel").textContent = firstAccess ? "Primeiro acesso" : "Acesso";
  if ($("#loginTitle")) $("#loginTitle").textContent = firstAccess ? "Criar administrador" : "Entrar no sistema";
  if ($("#loginHelp")) $("#loginHelp").textContent = firstAccess
    ? "Defina o primeiro admin. Depois disso, a entrada vira acesso interno seguro."
    : "Entre com seu acesso interno para operar artes, pedidos, Drive e auditoria.";
  if ($("#adminNameField")) $("#adminNameField").style.display = firstAccess ? "block" : "none";
  if ($("#firstAccessCard")) $("#firstAccessCard").style.display = firstAccess ? "grid" : "none";
  
  const span = $("#loginSubmit span");
  if(span) span.textContent = firstAccess ? "Criar admin" : "Acessar";
}

async function handleLogin(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const payload = {
    login: form.elements.login.value.trim().toLowerCase(),
    name: form.elements.name?.value.trim() || "",
    password: form.elements.password.value,
  };
  
  const submitBtn = $("#loginSubmit");
  const span = submitBtn?.querySelector("span");
  const originalText = span ? span.textContent : "Acessar";
  if (span) span.textContent = "Carregando...";
  if (submitBtn) submitBtn.disabled = true;

  try {
    if (!state.bootstrap.hasAdmin) {
      await window.artBank.createAdmin(payload);
      await loadBootstrap();
    }
    const result = await window.artBank.login(payload);
    state.session = result.session;
    state.user = result.user;
    
    // Mostra o overlay antes de renderizar o shell
    $("#globalOverlay").classList.remove("hidden");
    
    $("#loginScreen").classList.add("hidden");
    $("#appShell").classList.remove("hidden");
    $("#appShell").classList.remove("locked");
    const providerLabel = result.provider === "supabase" ? "Supabase" : "Local";
    $("#sidebarUser").textContent = `${state.user.name} (${state.user.role}) · ${providerLabel}`;
    
    if ($("#adminNav")) {
       $("#adminNav").style.display = state.user.role === "admin" ? "grid" : "none";
    }

    startHeartbeat();
    await refreshAll();
    toast(`Login realizado via ${providerLabel}.`);
  } catch (error) {
    toast(error.message);
  } finally {
    if (span) span.textContent = originalText;
    if (submitBtn) submitBtn.disabled = false;
  }
}

async function logout() {
  await window.artBank.logout();
  state.session = null;
  state.user = null;
  $("#loginScreen").classList.remove("hidden");
  $("#appShell").classList.add("locked");
  $("#appShell").classList.add("hidden");
}

function startHeartbeat() {
  clearInterval(startHeartbeat.timer);
  window.artBank.heartbeat(currentViewName()).then(refreshPresence).catch(() => null);
  startHeartbeat.timer = setInterval(async () => {
    await window.artBank.heartbeat(currentViewName());
    await refreshPresence();
    await refreshReservations();
  }, 30000);
}

function currentViewName() {
  return $(".view.active")?.id?.replace(/View$/, "") || "";
}

function installErrorLogging() {
  if (installErrorLogging.installed) return;
  installErrorLogging.installed = true;
  window.addEventListener("error", (event) => {
    reportClientError({
      source: "renderer",
      message: event.message,
      stack: event.error?.stack || "",
      context: { filename: event.filename, line: event.lineno, column: event.colno, view: currentViewName() },
    });
  });
  window.addEventListener("unhandledrejection", (event) => {
    const reason = event.reason || {};
    reportClientError({
      source: "renderer",
      message: reason.message || String(reason),
      stack: reason.stack || "",
      context: { type: "unhandledrejection", view: currentViewName() },
    });
  });
}

function reportClientError(payload = {}) {
  if (!window.artBank?.recordError) return;
  clearTimeout(reportClientError.timer);
  reportClientError.timer = setTimeout(() => {
    window.artBank.recordError({ level: "error", ...payload }).catch(() => null);
  }, 250);
}

function showView(view, title) {
  const subtitles = {
    dashboard: "Acompanhe artes, IDs, Drive, pedidos e equipe em um painel com aparência de catálogo premium.",
    batch: "Lotes com Photoshop, Drive e Supabase, mantendo validação de arquivos, IDs e envio oficial.",
    artworks: "Acervo de artes com prévias, códigos, filtros, edição e ações administrativas.",
    drive: "Estrutura de temas no Google Drive com busca, contagem de imagens e acesso rápido.",
    finance: "Monte pedidos por cliente, adicione artes por ID e gere o lançamento operacional.",
    reservations: "Trave sequências antes do cadastro para evitar conflito entre operadores.",
    users: "Perfis, permissões e presença da equipe com controle interno de acesso.",
    audit: "Rastreabilidade das ações críticas sem poluir a operação principal.",
    settings: "Conexões, pastas locais, cache, Photoshop e regras do sistema."
  };
  const titles = {
    dashboard: "Operação visual da Armazém.",
    batch: "Lotes com Photoshop, Drive e Supabase.",
    artworks: "Acervo de artes em vitrine operacional.",
    drive: "Temas locais e nuvem organizados.",
    finance: "Pedidos por cliente e IDs.",
    reservations: "Reserva segura de sequência.",
    users: "Equipe, perfis e permissões.",
    audit: "Timeline de ações críticas.",
    settings: "Sistema e integrações."
  };
  $$(".nav-item").forEach((item) => item.classList.toggle("active", item.dataset.view === view));
  $$(".view").forEach((panel) => panel.classList.remove("active"));
  $(`#${view}View`).classList.add("active");
  if ($("#viewEyebrow")) $("#viewEyebrow").textContent = title;
  $("#viewTitle").textContent = titles[view] || title;
  if ($("#viewSubtitle")) $("#viewSubtitle").textContent = subtitles[view] || "Visão operacional do Banco de Artes.";
}

async function refreshAll() {
  const syncBtnSpan = $("#forceSyncButton span");
  const originalText = syncBtnSpan?.textContent || "Sincronizar dados";
  if (syncBtnSpan) syncBtnSpan.textContent = "Sincronizando...";
  setBusy("Sincronizando dados...");

  try {
    // Sync core logic in background without blocking the UI fully
    window.artBank.runSync().then(c => { state.cache = c; }).catch(e => console.error(e));
    await loadConfig();
    
    // Fire non-blocking UI refreshes concurrently
    await Promise.all([
      refreshAuthStatus(),
      refreshPresence(),
      refreshReservations(),
      refreshUsers(),
      refreshArtworks().then(() => refreshDashboardData()),
      refreshLocks(),
      refreshAudit()
    ]);

    clearBatch();
    window.artBank.getProvisioningPlan().then(plan => renderProvisioningPlan(plan));
  } finally {
    if (syncBtnSpan) syncBtnSpan.textContent = originalText;
    clearBusy();
  }
}

function renderExternalLinks() {
  const dashLinks = [];

  const dashEl = $("#dashboardLinks");
  if (dashEl) {
     dashEl.innerHTML = dashLinks.map(l => `<a class="link-card" href="#" data-external="${escapeHtml(l.url)}">${l.icon}<span>${escapeHtml(l.label)}</span></a>`).join("");
  }

  $$("[data-external]").forEach(el => el.addEventListener("click", (e) => {
    e.preventDefault();
    const url = el.dataset.external;
    if (window.artBank.openExternal) window.artBank.openExternal(url);
    else window.open(url, "_blank");
  }));
}

function fillSettingsForm() {
  const form = $("#settingsForm");
  if (!form) return;
  for (const [key, value] of Object.entries(state.config)) {
    const field = form.elements[key];
    if (!field) continue;
    if (field.type === "checkbox") field.checked = Boolean(value);
    else if (key === "productSizes") field.value = formatProductSizes(value);
    else if (Array.isArray(value)) field.value = value.join("\n");
    else field.value = value ?? "";
  }
  fillPanel50AutomationForm();
}

function readSettingsForm() {
  const form = $("#settingsForm");
  return {
    ...state.config,
    fixedDataFolder: form.elements.fixedDataFolder?.value.trim() || "C:\\BancoDeArtes",
    panel50SourceRoot: form.elements.panel50SourceRoot?.value.trim(),
    panel50OrganizedRoot: form.elements.panel50OrganizedRoot?.value.trim(),
    panel50DriveLocalRoot: form.elements.panel50DriveLocalRoot?.value.trim(),
    panel50MockupPath: form.elements.panel50MockupPath?.value.trim(),
    credentialsPath: form.elements.credentialsPath?.value.trim(),
    driveFolderName: form.elements.driveFolderName?.value.trim(),
    supabaseEnabled: form.elements.supabaseEnabled?.checked,
    supabaseUrl: form.elements.supabaseUrl?.value.trim(),
    supabasePublishableKey: form.elements.supabasePublishableKey?.value.trim(),
    supabaseReadMode: form.elements.supabaseReadMode?.value || "supabase",
    supabaseAuthMode: form.elements.supabaseAuthMode?.value || "local",
    supabaseAuthEmailDomain: form.elements.supabaseAuthEmailDomain?.value.trim() || "bancodeartes.local",
    financialClientRoot: form.elements.financialClientRoot?.value.trim(),
    localImageFolders: lines(form.elements.localImageFolders?.value),
    validProducts: lines(form.elements.validProducts?.value).map((item) => item.toUpperCase()),
    productSizes: parseProductSizes(form.elements.productSizes?.value),
    publicDriveUploads: form.elements.publicDriveUploads?.checked,
    allowManualBatch: form.elements.allowManualBatch?.checked,
    maintenanceMode: form.elements.maintenanceMode?.checked,
  };
}

async function saveSettings(event) {
  event.preventDefault();
  const btn = $("#btnSaveSettings");
  const originalText = btn.textContent;
  btn.textContent = "Salvando...";
  setBusy("Salvando configuracoes...");
  try {
  state.config = await window.artBank.saveConfig(readSettingsForm());
  fillSettingsForm();
  renderConfig();
  await refreshAll();
  btn.textContent = "✓ Salvo";
  setTimeout(() => btn.textContent = originalText, 1500);
  } finally {
    clearBusy();
  }
}

async function testConnectivity() {
  const box = $("#connectivityResults");
  const status = $("#connectionValidationStatus");
  if (status) {
    status.textContent = "Testando tudo...";
    status.className = "inline-status";
  }
  if (box) box.innerHTML = `<div class="diagnostic-item"><strong>Executando diagnóstico</strong><span>Conferindo login, Supabase e Drive.</span></div>`;
  try {
    const result = await window.artBank.testConnectivity();
    if (box) {
      box.innerHTML = result.checks.map((item) => `
        <div class="diagnostic-item ${item.ok ? "ok" : "error"}">
          <strong>${escapeHtml(item.label)}</strong>
          <span>${escapeHtml(item.detail)}</span>
        </div>
      `).join("");
    }
    if (status) {
      status.textContent = result.ok ? "Tudo conectado" : "Há pendências";
      status.classList.add(result.ok ? "ok" : "warn");
    }
    toast(result.ok ? "Conectividade validada." : "Diagnóstico encontrou pendências.");
  } catch (error) {
    if (box) box.innerHTML = `<div class="diagnostic-item error"><strong>Falha no diagnóstico</strong><span>${escapeHtml(friendlyError(error.message))}</span></div>`;
    if (status) {
      status.textContent = "Erro";
      status.classList.add("error");
    }
    toast(error.message);
  }
}

async function refreshSupabaseStatus() {
  const box = $("#supabaseStatusBox");
  if (!box || !window.artBank.supabaseStatus) return;
  const result = await window.artBank.supabaseStatus();
  box.className = `diagnostic-item ${result.ok ? "ok" : (result.enabled ? "warn" : "")}`;
  box.innerHTML = `
    <strong>${result.ok ? "Supabase pronto" : "Supabase em preparação"}</strong>
    <span>${escapeHtml(result.message)}${result.url ? ` · ${escapeHtml(result.url)}` : ""}</span>
  `;
}

function renderConfig() {
  if($("#noticeText")) {
    const officialData = state.config.supabaseEnabled ? "Supabase" : "base local";
    $("#noticeText").textContent =
      `Banco localizado em ${state.config.fixedDataFolder || "C:\\BancoDeArtes"}. Dados oficiais: ${officialData}.`;
  }
  refreshSupabaseStatus().catch(() => null);
}

async function refreshAuthStatus() {
  const status = await window.artBank.getAuthStatus();
  setTextAll(".metric-google-status", status.authenticated ? "OK" : "OFF");
  setTextAll(".metric-google-sub", status.authenticated ? "Drive conectado" : "ação necessária");
  if ($("#authButton")) $("#authButton").textContent = status.authenticated ? "Google conectado" : "Conectar Google";
  if ($("#googleBadge")) $("#googleBadge").textContent = status.authenticated ? "Token válido" : "Sem token válido";
  if ($("#connectionMessage")) $("#connectionMessage").textContent = status.authenticated
    ? (status.missingScopes?.length ? `Faltam permissões: ${status.missingScopes.length}. Reconecte o Google.` : "Conta conectada. Drive ativo.")
    : status.message || "Conecte uma conta Google.";
  if ($("#tokenPathBox")) $("#tokenPathBox").textContent = `Token: ${status.tokenPath || "-"}
Credencial: ${status.credentialsPath || "-"}`;
  if ($("#noticeTitle")) $("#noticeTitle").textContent = status.authenticated ? "Google conectado" : "Google precisa de atenção";
  if ($("#noticeState")) {
    $("#noticeState").textContent = status.authenticated ? "" : "Configurar";
    $("#noticeState").classList.toggle("hidden", Boolean(status.authenticated));
  }
}
async function authenticateGoogle() {
  try {
    toast("Abrindo OAuth no navegador...");
    const status = await window.artBank.authenticateGoogle();
    await refreshAuthStatus();
    toast(status.message || "Google conectado.");
  } catch (error) {
    toast(friendlyError(error.message));
  }
}

async function provisionGoogle() {
  try {
    toast("Preparando bases na nuvem...");
    const result = await window.artBank.provisionGoogle();
    state.config = await window.artBank.getConfig();
    fillSettingsForm();
    await refreshAll();
    toast(`Bases prontas.`);
  } catch (error) {
    toast(friendlyError(error.message));
  }
}

async function refreshDashboardData() {
  const artworks = state.artworks || [];
  let maxId = 0;
  const byUser = {};
  const byTheme = {};
  
  for (const art of artworks) {
    const id = Number(art.id);
    if (Number.isFinite(id)) maxId = Math.max(maxId, id);
    const theme = art.theme || "SEM TEMA";
    const user = art.user || "SEM USUARIO";
    byTheme[theme] = (byTheme[theme] || 0) + 1;
    byUser[user] = (byUser[user] || 0) + 1;
  }
  
  const topThemeEntry = Object.entries(byTheme).sort((a, b) => b[1] - a[1])[0] || ["-", 0];
  const sortedUsers = Object.entries(byUser).sort((a, b) => b[1] - a[1]);
  
  const data = {
    totalArtworks: artworks.length,
    nextId: nextAvailableDashboardId(maxId),
    topTheme: topThemeEntry,
    byUser: sortedUsers,
  };

  if($("#metricTotalArtworks")) $("#metricTotalArtworks").textContent = data.totalArtworks || 0;
  if($("#metricNextId")) $("#metricNextId").textContent = data.nextId || 1;
  const [theme, count] = data.topTheme;
  if($("#topThemeText")) $("#topThemeText").textContent = count > 0 ? `${theme} (${count})` : "-";
  if($("#byUserList")) {
    $("#byUserList").innerHTML = (data.byUser || []).slice(0, 6).map(([user, qtd]) =>
      `<div class="plan-item"><strong>${escapeHtml(user)}</strong><span>${qtd}</span></div>`
    ).join("") || `<span style="color:var(--text-3)">Sem cadastros ainda.</span>`;
  }
}

// MODIFICADO: ID livre agora considera reservas ativas em tempo real.
function nextAvailableDashboardId(maxId) {
  const reserved = new Set((state.reservations || []).flatMap((reservation) => reservation.ids || []).map(Number));
  let next = Math.max(1, Number(maxId || 0) + 1);
  while (reserved.has(next)) next += 1;
  return next;
}

function renderProvisioningPlan(plan) {
  const usesSupabaseOfficial = state.config?.supabaseEnabled && state.config?.supabaseReadMode === "supabase";
  const items = usesSupabaseOfficial
    ? [
      ["Base oficial", "use-existing", "Supabase"],
      ["Pasta Drive", plan.driveFolder.mode, plan.driveFolder.name],
    ]
    : [
      ["Base local", "use-existing", state.config?.fixedDataFolder || "C:\\BancoDeArtes"],
      ["Pasta Drive", plan.driveFolder.mode, plan.driveFolder.name],
    ];
  const modeLabel = (mode) => ({
    "use-existing": "Existente",
    "find-or-create": "Buscar/criar",
    "create": "Criar",
    "missing": "Pendente",
  }[mode] || mode || "-");
  if($("#provisioningPlan")) {
    $("#provisioningPlan").innerHTML = items.map(([label, mode, value]) => `
      <div class="plan-item provisioning-item">
        <strong>${escapeHtml(label)}</strong>
        <span class="provisioning-value" title="${escapeHtml(value)}">${escapeHtml(value)}</span>
        <span class="badge provisioning-status" title="${escapeHtml(mode)}">${escapeHtml(modeLabel(mode))}</span>
      </div>
    `).join("");
  }
}

function renderListSkeleton(selector, count = 4) {
  const box = $(selector);
  if (!box) return;
  box.innerHTML = Array.from({ length: count }).map(() => `
    <div class="reservation-row skeleton-card skeleton-list-item" aria-hidden="true">
      <div>
        <div class="skeleton skeleton-line wide"></div>
        <div class="skeleton skeleton-line"></div>
      </div>
      <div class="skeleton skeleton-line short"></div>
    </div>
  `).join("");
}

async function refreshPresence() {
  renderListSkeleton("#onlineList", 3);
  state.online = await window.artBank.onlineUsers();
  if($("#onlineCount")) $("#onlineCount").textContent = `${state.online.length} online`;
  if($("#onlineList")) {
    $("#onlineList").innerHTML = state.online.map((item) => `
      <div class="person-row"><div><strong>${escapeHtml(item.name)}</strong><span>${escapeHtml(item.login)} em ${escapeHtml(item.machine)}</span></div><span class="state-pill ok">online</span></div>
    `).join("") || `<div class="person-row"><span style="color:var(--text-3)">Ninguém online.</span></div>`;
  }
}

// ---- USUÁRIOS LOGIC ----
async function refreshUsers() {
  renderListSkeleton("#userList", 5);
  state.users = await window.artBank.listUsers();
  renderUserCards();
}

function renderUserCards() {
  const query = ($("#userSearchInput")?.value || "").toLowerCase();
  const filtered = state.users.filter(u => 
     u.name.toLowerCase().includes(query) || u.login.toLowerCase().includes(query)
  );
  
  if ($("#usersCountBadge")) $("#usersCountBadge").textContent = `${filtered.length} usuário(s)`;
  
  const list = $("#userList");
  if (!list) return;

  const colors = ["avatar-blue", "avatar-teal", "avatar-coral", "avatar-purple"];

  list.innerHTML = filtered.map((user, idx) => {
    const initials = user.name.substring(0, 2).toUpperCase();
    const color = colors[idx % colors.length];
    const roleBadge = user.role === "admin" ? `<span class="badge admin-badge">Admin</span>` : `<span class="badge operator-badge">Operador</span>`;
    const statusBadge = user.active ? `<span class="badge active-badge">Ativo</span>` : `<span class="badge inactive-badge">Inativo</span>`;
    
    return `
      <div class="user-card" data-user-card="${escapeHtml(user.login)}">
        <div class="user-avatar ${color}">${escapeHtml(initials)}</div>
        <div class="user-details">
          <strong>${escapeHtml(user.name)}</strong>
          <div class="user-badges">${roleBadge} ${statusBadge}</div>
          <span class="user-login">${escapeHtml(user.login)}</span>
        </div>
        <div class="user-actions">
          <button class="icon-btn edit-btn" title="Editar" aria-label="Editar usuario">
            <svg viewBox="0 0 24 24"><path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zm17.71-10.04a1.003 1.003 0 0 0 0-1.42l-2.5-2.5a1.003 1.003 0 0 0-1.42 0l-1.96 1.96 3.75 3.75 2.13-1.79z"/></svg>
          </button>
          <button class="icon-btn delete-btn" data-del="${escapeHtml(user.login)}" title="Excluir" aria-label="Excluir usuario">
            <svg viewBox="0 0 24 24"><path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM8 9h8v10H8V9zm7.5-5-1-1h-5l-1 1H5v2h14V4h-3.5z"/></svg>
          </button>
        </div>
      </div>
    `;
  }).join("");

  $$("[data-user-card]").forEach(card => {
    card.addEventListener("click", () => {
      $$(".user-card").forEach(c => c.classList.remove("selected"));
      card.classList.add("selected");
      fillUserEditForm(state.users.find(u => u.login === card.dataset.userCard));
      setUsersTab("edit");
    });
  });

  $$(".delete-btn").forEach(btn => {
     btn.addEventListener("click", (e) => {
        e.stopPropagation();
        confirmAction({
          title: "Apagar usuário",
          message: "Tem certeza que deseja apagar este usuário?",
          destructive: true,
        }).then((ok) => {
          if (ok) deleteSelectedUser(btn.dataset.del);
        });
     });
  });
}

function setUsersTab(tab) {
  const form = $("#userActionForm");
  if (!form) return;
  const isEdit = tab === "edit";
  
  $("#tabNewUser").classList.toggle("active", !isEdit);
  $("#tabEditUser").classList.toggle("active", isEdit);
  
  form.elements.login.readOnly = isEdit;
  $("#editUserHint").textContent = isEdit && form.elements.login.value ? `Editando: ${form.elements.name.value}` : "Selecione um usuário na lista →";
  $("#editUserHint").style.display = isEdit ? "block" : "none";
  
  $("#btnCreateUser").style.display = isEdit ? "none" : "flex";
  $("#btnSaveUser").style.display = isEdit ? "flex" : "none";
  $("#btnToggleActive").style.display = isEdit ? "flex" : "none";

  if (!isEdit) {
     form.reset();
     form.elements.userId.value = "";
     $$(".user-card").forEach(c => c.classList.remove("selected"));
  }
}

function fillUserEditForm(user) {
  const form = $("#userActionForm");
  if (!user || !form) return;
  form.elements.userId.value = user.login;
  form.elements.login.value = user.login;
  form.elements.name.value = user.name;
  form.elements.password.value = "";
  form.elements.role.value = user.role;
  $("#btnToggleActive").textContent = user.active ? "Desativar" : "Ativar";
  $("#editUserHint").textContent = `Editando: ${user.name}`;
}

async function handleUserActionSubmit(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const isEdit = $("#tabEditUser").classList.contains("active");
  
  try {
     const payload = {
        userId: form.elements.userId.value,
        login: form.elements.login.value.trim().toLowerCase(),
        name: form.elements.name.value,
        role: form.elements.role.value,
        password: form.elements.password.value
     };
     
     if (isEdit) {
        if (!payload.userId) return toast("Selecione um usuário.");
        await window.artBank.updateUser(payload);
        if (payload.password) {
           await window.artBank.resetPassword(payload);
        }
        toast("Usuário atualizado no sistema central.");
     } else {
        await window.artBank.createUser(payload);
        toast("Usuário criado no sistema central.");
        form.reset();
     }
     await refreshUsers();
  } catch (error) {
     toast(error.message);
  }
}

async function toggleSelectedUserActive() {
  const form = $("#userActionForm");
  const userId = form.elements.userId.value;
  if (!userId) return toast("Selecione um usuário.");
  const user = state.users.find(u => u.login === userId);
  try {
    await window.artBank.setUserActive({ userId, active: !user.active });
    await refreshUsers();
    fillUserEditForm(state.users.find(u => u.login === userId));
  } catch (error) {
    toast(error.message);
  }
}

async function deleteSelectedUser(loginId) {
  let target = loginId;
  if(typeof loginId !== "string") {
     const form = $("#userActionForm");
     target = form.elements.userId.value;
  }
  if (!target) return toast("Selecione um usuário.");
  try {
    await window.artBank.deleteUser(target);
    await refreshUsers();
    setUsersTab("new");
    toast("Usuário apagado.");
  } catch (error) {
    toast(error.message);
  }
}

// ---- BATCH LOGIC ----

async function refreshReservations() {
  renderListSkeleton("#reservationList", 4);
  state.reservations = await window.artBank.listReservations();
  const reservedIds = state.reservations.reduce((sum, item) => sum + item.ids.length, 0);
  if($("#metricReserved")) $("#metricReserved").textContent = reservedIds;
  
  const metric = document.querySelector(".reserved-metric");
  if(metric) metric.classList.toggle("has-reservations", reservedIds > 0);
  
  if($("#reservationList")) {
    $("#reservationList").innerHTML = state.reservations.map((item) => `
      <div class="reservation-row reservation-card">
        <div><strong>${escapeHtml(item.label)}</strong><span>${rangeLabel(item.ids)} · ${escapeHtml(item.name)} · expira ${formatTime(item.expiresAt)}</span></div>
        <button class="tiny-button" data-release="${item.id}">Liberar</button>
      </div>
    `).join("") || `<div class="reservation-row"><span style="color:var(--text-3)">Nenhuma reserva ativa.</span></div>`;
  }
  $$("[data-release]").forEach((button) => button.addEventListener("click", async () => {
    await window.artBank.releaseReservation(button.dataset.release);
    await refreshReservations();
  }));
  await refreshDashboardData();
}

async function createReservation(event) {
  event.preventDefault();
  const form = event.currentTarget;
  try {
    await window.artBank.createReservation({
      start: form.elements.start.value,
      count: form.elements.count.value,
      label: form.elements.label.value,
    });
    form.reset();
    await refreshReservations();
    await refreshDashboardData();
    toast("IDs reservados na nuvem.");
  } catch (error) {
    toast(error.message);
  }
}

async function refreshLocks() {
  renderListSkeleton("#lockList", 2);
  let locks;
  try {
    locks = await window.artBank.lockStatus();
  } catch (error) {
    locks = { global: { status: "INDISPONÍVEL", note: friendlyError(error.message) }, local: { status: "LIVRE" } };
  }
  const global = locks.global || {};
  const local = locks.local || {};
  if($("#lockList")) {
    $("#lockList").innerHTML = `
      <div class="reservation-row"><div><strong>Global: ${escapeHtml(global.status || "-")}</strong><span>${escapeHtml(global.user || "")} ${escapeHtml(global.machine || "")} ${escapeHtml(global.note || "")}</span></div></div>
      <div class="reservation-row"><div><strong>Local: ${escapeHtml(local.status || "-")}</strong><span>${escapeHtml(local.user || "")} ${escapeHtml(local.startedAt || "")}</span></div></div>
    `;
  }
}

async function refreshAudit() {
  renderListSkeleton("#auditRows", 5);
  const rows = await window.artBank.auditList().catch(() => []);
  if($("#auditRows")) {
    $("#auditRows").innerHTML = rows.map((row) => `
      <div class="reservation-row"><div><strong>${escapeHtml(row.action)}</strong><span>${new Date(row.at).toLocaleString("pt-BR")} · ${escapeHtml(row.name)} · ${escapeHtml(row.details)}</span></div><span class="badge">${escapeHtml(row.type)}</span></div>
    `).join("") || `<div class="reservation-row"><span style="color:var(--text-3)">Nenhum log ainda.</span></div>`;
  }
}

async function refreshDriveFolders(refresh = false) {
  const list = $("#driveFolderList");
  if (list) {
    list.innerHTML = Array.from({ length: 8 }).map(() => `
      <article class="drive-card skeleton-card" aria-hidden="true">
        <div class="skeleton skeleton-line wide"></div>
        <div class="skeleton skeleton-line"></div>
        <div class="skeleton skeleton-line short"></div>
      </article>
    `).join("");
  }
  try {
    state.driveFolders = await window.artBank.listDriveFolders(Boolean(refresh));
    renderDriveFolders();
  } catch (error) {
    if (list) list.innerHTML = `<div class="diagnostic-item error"><strong>Falha ao carregar Drive</strong><span>${escapeHtml(friendlyError(error.message))}</span></div>`;
    toast(error.message);
  }
}

function renderDriveFolders() {
  const data = state.driveFolders || { folders: [] };
  const query = ($("#driveSearch")?.value || "").toLowerCase().trim();
  const folders = (data.folders || []).filter((folder) => !query || String(folder.name || "").toLowerCase().includes(query));
  if ($("#driveSummary")) {
    $("#driveSummary").innerHTML = `
      <div class="drive-summary-card"><span>Pasta raiz</span><strong title="${escapeHtml(data.rootFolderName || "-")}">${escapeHtml(data.rootFolderName || "-")}</strong></div>
      <div class="drive-summary-card"><span>Temas</span><strong>${folders.length} / ${(data.folders || []).length}</strong></div>
      <div class="drive-summary-card"><span>Cache</span><strong>${data.lastSync ? new Date(data.lastSync).toLocaleString("pt-BR") : "Ainda nao sincronizado"}</strong></div>
    `;
  }
  if ($("#driveFolderList")) {
    $("#driveFolderList").innerHTML = folders.map((folder) => `
      <article class="drive-card">
        <div class="drive-card-head">
          <div class="drive-folder-icon"><svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M10 4l2 2h8c1.1 0 2 .9 2 2v10c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2h6z"/></svg></div>
          <div><strong title="${escapeHtml(folder.name || "-")}">${escapeHtml(folder.name || "-")}</strong><span>${Number(folder.imageCount || 0)} imagem(ns)</span></div>
        </div>
        <button class="secondary-button wide" data-open-drive-folder="${escapeHtml(folder.url)}">Abrir pasta</button>
      </article>
    `).join("") || `<div class="diagnostic-item"><strong>Nenhuma pasta de tema encontrada</strong><span>Use Sincronizar pastas para atualizar o cache do Drive.</span></div>`;
  }
  $$("[data-open-drive-folder]").forEach((button) => button.addEventListener("click", () => {
    window.artBank.openExternal(button.dataset.openDriveFolder);
  }));
}

function openDriveRoot() {
  const url = state.driveFolders?.rootUrl;
  if (!url) return toast("Sincronize as pastas primeiro.");
  window.artBank.openExternal(url);
}

async function refreshArtworks(options = {}) {
  const { force = false, showLoading = false } = options;
  if (showLoading || force) startActionProgress("Carregando banco visual", "Lendo base oficial e cache.", 12);
  if (showLoading && $("#artworkRows")) {
    renderArtworkSkeleton();
  }
  if (force) {
    updateActionProgress(32, "Sincronizando cache local.");
    state.cache = await window.artBank.runSync().catch(() => state.cache);
  }
  updateActionProgress(58, "Carregando artes cadastradas.");
  state.artworks = await window.artBank.listArtworks().catch((error) => {
    if($("#artworkRows")) $("#artworkRows").innerHTML = `<tr><td colspan="10">${escapeHtml(friendlyError(error.message))}</td></tr>`;
    if ($("#artworkCardGrid")) $("#artworkCardGrid").innerHTML = `<div class="empty-state-block">Falha ao carregar: ${escapeHtml(friendlyError(error.message))}</div>`;
    toast(error.message);
    if (showLoading || force) finishActionProgress("Falha ao carregar banco visual.");
    return [];
  });
  if (!state.artworks.length) {
    if($("#artworkRows")) $("#artworkRows").innerHTML = `<tr><td colspan="10">Nenhuma arte carregada.</td></tr>`;
    if ($("#artworkCardGrid")) $("#artworkCardGrid").innerHTML = `<div class="empty-state-block">Nenhuma arte carregada.</div>`;
    if (showLoading || force) finishActionProgress("Nenhuma arte carregada.");
    return;
  }
  populateArtworkFilters();
  renderFilteredArtworks();
  if (showLoading || force) finishActionProgress("Banco visual carregado.");
}

function populateArtworkFilters() {
  const themes = new Set();
  const products = new Set();
  const users = new Set();
  state.artworks.filter(isArtworkCatalogVisible).forEach((art) => {
    if (art.theme) themes.add(art.theme);
    if (art.product) products.add(art.product);
    if (art.user) users.add(art.user);
  });
  const themeSelect = $("#artworkFilterTheme");
  const productSelect = $("#artworkFilterProduct");
  const userSelect = $("#artworkFilterUser");
  if (themeSelect) themeSelect.innerHTML = `<option value="all">Todos os temas</option>` + Array.from(themes).sort().map(t => `<option value="${escapeHtml(t)}">${escapeHtml(t)}</option>`).join("");
  if (productSelect) productSelect.innerHTML = `<option value="all">Todos os produtos</option>` + Array.from(products).sort().map(p => `<option value="${escapeHtml(p)}">${escapeHtml(p)}</option>`).join("");
  if (userSelect) userSelect.innerHTML = `<option value="all">Cadastrado por</option>` + Array.from(users).sort().map(u => `<option value="${escapeHtml(u)}">${escapeHtml(u)}</option>`).join("");
}

function renderFilteredArtworks() {
  const query = ($("#artworkSearch")?.value || "").toLowerCase().trim();
  const theme = $("#artworkFilterTheme")?.value || "all";
  const product = $("#artworkFilterProduct")?.value || "all";
  const user = $("#artworkFilterUser")?.value || "all";
  state.artworkSort = $("#artworkSort")?.value || state.artworkSort || "desc";
  const filtered = state.artworks.filter((art) => {
    if (!isArtworkCatalogVisible(art)) return false;
    if (query && !(art.id||"").toString().toLowerCase().includes(query) && !(art.theme||"").toLowerCase().includes(query) && !(art.product||"").toLowerCase().includes(query) && !(art.user||"").toLowerCase().includes(query)) return false;
    if (theme !== "all" && String(art.theme||"") !== theme) return false;
    if (product !== "all" && String(art.product||"") !== product) return false;
    if (user !== "all" && String(art.user||"") !== user) return false;
    return true;
  }).sort((a, b) => {
    const left = Number(a.id || 0);
    const right = Number(b.id || 0);
    return state.artworkSort === "asc" ? left - right : right - left;
  });
  state.visibleArtworkIds = filtered.map((art) => String(art.id));
  syncArtworkViewMode();
  const mode = currentArtworkViewMode();
  if (!filtered.length) {
    if($("#artworkRows")) $("#artworkRows").innerHTML = `<tr><td colspan="10" style="text-align:center;padding:20px;color:var(--text-3)">Nenhuma arte corresponde aos filtros.</td></tr>`;
    if ($("#artworkCardGrid")) $("#artworkCardGrid").innerHTML = `<div class="empty-state-block">Nenhuma arte corresponde aos filtros.</div>`;
    syncArtworkBulkControls();
    return;
  }
  if (mode === "cards") {
    renderArtworkCards(filtered);
    if ($("#artworkRows")) $("#artworkRows").innerHTML = "";
  } else {
    if ($("#artworkCardGrid")) $("#artworkCardGrid").innerHTML = "";
    renderArtworkTable(filtered);
  }
  $$("[data-preview-drive]").forEach((button) => button.addEventListener("click", () => {
    const art = state.artworks.find((item) => String(item.id) === String(button.dataset.previewId));
    openDrivePreview(button.dataset.previewDrive, art);
  }));
  $$("[data-select-art]").forEach((input) => input.addEventListener("change", () => {
    const id = String(input.dataset.selectArt);
    if (input.checked) state.artworkSelection.add(id);
    else state.artworkSelection.delete(id);
    syncArtworkBulkControls();
  }));
  $$("[data-art-field]").forEach((input) => input.addEventListener("input", () => {
    input.classList.add("dirty");
    input.closest("tr")?.classList.add("has-dirty-fields");
    syncArtworkBulkControls();
  }));
  $$("[data-save-art]").forEach((button) => button.addEventListener("click", () => saveArtworkEdit(button.dataset.saveArt)));
  $$("[data-delete-art]").forEach((button) => button.addEventListener("click", () => deleteArtwork(button.dataset.deleteArt)));
  $$("[data-find-art]").forEach((button) => button.addEventListener("click", () => openFindArtworkModal(button.dataset.findArt)));
  $$("[data-refresh-art-url]").forEach((button) => button.addEventListener("click", () => refreshArtworkUrl(button.dataset.refreshArtUrl)));
  syncArtworkBulkControls();
}

function isArtworkCatalogVisible(art) {
  return String(art?.status || "active").toLowerCase() !== "trash";
}

function renderArtworkTable(artworks) {
  const rows = $("#artworkRows");
  if (!rows) return;
  rows.innerHTML = artworks.map((art) => `
    <tr data-art-row="${escapeHtml(art.id)}" class="${state.artworkSelection.has(String(art.id)) ? "is-selected" : ""}">
      <td class="art-select-cell"><input type="checkbox" data-select-art="${escapeHtml(art.id)}" ${state.artworkSelection.has(String(art.id)) ? "checked" : ""} aria-label="Selecionar arte ${escapeHtml(art.id)}" /></td>
      <td>${artThumb(art)}</td>
      <td>${escapeHtml(art.id)}</td>
      <td>${artCell(art.id, "theme", art.theme)}</td>
      <td>${artCell(art.id, "product", art.product)}</td>
      <td>${artCell(art.id, "size", art.size)}</td>
      <td>${artCell(art.id, "client", art.client)}</td>
      <td>${artCell(art.id, "user", art.user)}</td>
      <td>${escapeHtml(art.date || "-")}</td>
      <td>${artActions(art.id)}</td>
    </tr>
  `).join("");
}

function currentArtworkViewMode() {
  return state.artworkTools ? "table" : state.artworkViewMode;
}

function syncArtworkViewMode() {
  const mode = currentArtworkViewMode();
  $("#artworkCardGrid")?.classList.toggle("hidden", mode !== "cards");
  $("#artworkTableWrap")?.classList.toggle("hidden", mode !== "table");
  $$("[data-artwork-view-mode]").forEach((button) => {
    button.classList.toggle("active", button.dataset.artworkViewMode === state.artworkViewMode);
    button.disabled = state.artworkTools && button.dataset.artworkViewMode === "cards";
  });
}

function renderArtworkSkeleton() {
  if ($("#artworkCardGrid")) {
    $("#artworkCardGrid").innerHTML = Array.from({ length: 10 }).map(() => `
      <article class="artwork-card skeleton-card" aria-hidden="true">
        <div class="skeleton skeleton-thumb"></div>
        <div class="skeleton skeleton-line wide"></div>
        <div class="skeleton skeleton-line"></div>
        <div class="skeleton skeleton-line short"></div>
      </article>
    `).join("");
  }
  if ($("#artworkRows")) {
    $("#artworkRows").innerHTML = Array.from({ length: 6 }).map(() => `
      <tr class="skeleton-row"><td colspan="10"><div class="skeleton skeleton-line wide"></div></td></tr>
    `).join("");
  }
  syncArtworkViewMode();
}

function renderArtworkCards(artworks) {
  const grid = $("#artworkCardGrid");
  if (!grid) return;
  grid.innerHTML = artworks.map((art) => {
    const preview = imagePreviewUrl(art.url);
    return `
      <article class="artwork-card" data-art-card="${escapeHtml(art.id)}">
        <button class="artwork-card-preview ${preview ? "" : "is-empty"}" type="button" ${preview ? `data-preview-drive="${escapeHtml(art.url)}" data-preview-id="${escapeHtml(art.id)}"` : ""} aria-label="Abrir prévia da arte ${escapeHtml(art.id)}">
          ${preview ? `<img src="${escapeHtml(preview)}" alt="Prévia da arte ${escapeHtml(art.id)}" loading="lazy" onload="markArtworkImageLoaded('${escapeHtml(art.id)}')" onerror="markArtworkImageBroken('${escapeHtml(art.id)}', this.parentElement);this.remove();" />` : `<span>Sem prévia</span>`}
          <span class="artwork-card-id">#${escapeHtml(art.id || "-")}</span>
        </button>
        <div class="artwork-card-body">
          <strong title="${escapeHtml(art.theme || "Sem tema")}">${escapeHtml(art.theme || "Sem tema")}</strong>
          <span>${escapeHtml(art.product || "Sem produto")} · ${escapeHtml(art.size || "Sem tamanho")}</span>
          <div class="artwork-card-meta">
            <small>${escapeHtml(art.client || "Sem cliente")}</small>
            <small>${escapeHtml(art.date || "-")}</small>
          </div>
        </div>
      </article>
    `;
  }).join("");
}

function markArtworkImageBroken(id, previewButton) {
  state.brokenArtworkImageIds.add(String(id));
  previewButton?.classList.add("is-empty", "has-image-error");
  if (previewButton && !previewButton.querySelector(".artwork-image-error")) {
    const message = document.createElement("span");
    message.className = "artwork-image-error";
    message.textContent = "Imagem indisponível";
    previewButton.appendChild(message);
  }
}

function markArtworkImageLoaded(id) {
  state.brokenArtworkImageIds.delete(String(id));
}

function toggleArtworkTools() {
  if (state.user?.role !== "admin") {
    toast("Ferramentas de edição restritas ao admin.");
    return;
  }
  state.artworkTools = !state.artworkTools;
  $("#artworkToolsButton")?.classList.toggle("active", state.artworkTools);
  $("#artworksView")?.classList.toggle("editing", state.artworkTools);
  $("#saveAllArtworksButton")?.classList.toggle("hidden", !state.artworkTools);
  $("#deleteSelectedArtworksButton")?.classList.toggle("hidden", !state.artworkTools);
  if (!state.artworkTools) state.artworkSelection.clear();
  syncArtworkViewMode();
  renderFilteredArtworks();
  toast(state.artworkTools ? "Edição e exclusão de artes ativadas." : "Ferramentas de artes desativadas.");
}

function artCell(id, field, value) {
  if (!state.artworkTools) return escapeHtml(value || "-");
  return artEditInput(id, field, value);
}

function artEditInput(id, field, value) {
  return `<input class="table-input" data-art-id="${escapeHtml(id)}" data-art-field="${field}" value="${escapeHtml(value || "")}" />`;
}

function artActions(id) {
  if (!state.artworkTools) return `<span class="muted">-</span>`;
  return `<div class="row-actions artwork-actions">
    <button class="icon-btn" data-find-art="${escapeHtml(id)}" title="Encontrar arquivos locais" aria-label="Encontrar arquivos locais">
      <svg viewBox="0 0 24 24"><path d="M10 4H4a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-8l-2-2zm2 10h2v2h-2v2l-4-3 4-3v2h5v2h-5v-2z"/></svg>
    </button>
    <button class="icon-btn" data-refresh-art-url="${escapeHtml(id)}" title="Atualizar URL pelo Drive" aria-label="Atualizar URL pelo Drive">
      <svg viewBox="0 0 24 24"><path d="M17.65 6.35A7.95 7.95 0 0 0 12 4V1L7 6l5 5V7a5 5 0 1 1-4.9 6H4.05a8 8 0 1 0 13.6-6.65z"/></svg>
    </button>
    <button class="icon-btn" data-save-art="${escapeHtml(id)}" title="Salvar alterações" aria-label="Salvar alterações">
      <svg viewBox="0 0 24 24"><path d="M17 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V7l-4-4zM12 19a3 3 0 1 1 0-6 3 3 0 0 1 0 6zM6 8V5h9v3H6z"/></svg>
    </button>
    <button class="icon-btn delete-btn" data-delete-art="${escapeHtml(id)}" title="Excluir arte" aria-label="Excluir arte">
      <svg viewBox="0 0 24 24"><path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM8 9h8v10H8V9zm7.5-5-1-1h-5l-1 1H5v2h14V4h-3.5z"/></svg>
    </button>
  </div>`;
}

async function saveArtworkEdit(id, options = {}) {
  const row = $(`[data-art-row="${CSS.escape(String(id))}"]`);
  if (!row) return;
  const payload = { id };
  row.querySelectorAll("[data-art-field]").forEach((input) => {
    payload[input.dataset.artField] = input.value;
  });
  const button = row.querySelector("[data-save-art]");
  try {
    if (options.showProgress !== false) startActionProgress(`Salvando ID ${id}`, "Gravando na base oficial.", 14);
    if (button) {
      button.disabled = true;
      button.classList.add("is-loading");
    }
    updateActionProgress(42, "Enviando alterações para a base oficial.");
    const updated = await window.artBank.updateArtwork(payload);
    updateActionProgress(72, "Confirmando gravação e atualizando cache.");
    state.artworks = state.artworks.map((art) => String(art.id) === String(id) ? { ...art, ...updated } : art);
    row.querySelectorAll(".dirty").forEach((input) => input.classList.remove("dirty"));
    row.classList.remove("has-dirty-fields");
    syncArtworkBulkControls();
    if (options.syncAfter !== false) state.cache = await window.artBank.runSync().catch(() => state.cache);
    await refreshDashboardData();
    if (options.showProgress !== false) finishActionProgress(`ID ${id} salvo.`);
    toast(`Arte ${id} atualizada na base oficial.`);
  } catch (error) {
    if (options.showProgress !== false) finishActionProgress("Falha ao salvar.");
    toast(error.message);
  } finally {
    if (button) {
      button.disabled = false;
      button.classList.remove("is-loading");
    }
  }
}

async function saveAllArtworkEdits() {
  const rows = $$("[data-art-row].has-dirty-fields");
  if (!rows.length) return toast("Nenhuma alteração pendente.");
  const button = $("#saveAllArtworksButton");
  try {
    if (button) button.disabled = true;
    startActionProgress("Salvando alterações", `${rows.length} linha(s) pendente(s).`, 10);
    let saved = 0;
    for (const row of rows) {
      updateActionProgress(10 + Math.round((saved / rows.length) * 70), `Salvando ID ${row.dataset.artRow}.`);
      await saveArtworkEdit(row.dataset.artRow, { syncAfter: false, showProgress: false });
      saved += 1;
    }
    updateActionProgress(84, "Sincronizando cache.");
    state.cache = await window.artBank.runSync().catch(() => state.cache);
    await refreshArtworks({ force: true });
    finishActionProgress("Alterações salvas.");
    toast(`${saved} arte(s) salva(s) na base oficial.`);
  } finally {
    if (button) button.disabled = false;
  }
}

async function deleteArtwork(id) {
  if (!state.artworkTools) return;
  const art = state.artworks.find((item) => String(item.id) === String(id));
  const label = art ? `${art.id} - ${art.theme}` : `ID ${id}`;
  const confirmed = await confirmAction({
    title: "Excluir arte",
    message: `Excluir a arte ${label} da base oficial?`,
    destructive: true,
  });
  if (!confirmed) return;
  try {
    startActionProgress(`Excluindo ID ${id}`, "Removendo da base oficial.", 18);
    await window.artBank.deleteArtwork({ id });
    updateActionProgress(70, "Atualizando cache local.");
    state.artworks = state.artworks.filter((item) => String(item.id) !== String(id));
    state.cache = await window.artBank.runSync().catch(() => state.cache);
    renderFilteredArtworks();
    await refreshDashboardData();
    finishActionProgress("Arte excluída.");
    toast(`Arte ${id} excluída da base oficial.`);
  } catch (error) {
    finishActionProgress("Falha ao excluir.");
    toast(error.message);
  }
}

async function deleteSelectedArtworks() {
  if (!state.artworkTools) return;
  const ids = [...state.artworkSelection];
  if (!ids.length) return toast("Selecione uma ou mais artes.");
  const confirmed = await confirmAction({
    title: "Excluir artes selecionadas",
    message: `Excluir ${ids.length} arte(s) da base oficial?`,
    destructive: true,
  });
  if (!confirmed) return;
  const button = $("#deleteSelectedArtworksButton");
  try {
    if (button) button.disabled = true;
    startActionProgress("Excluindo selecionadas", `${ids.length} arte(s) selecionada(s).`, 10);
    let deleted = 0;
    for (const id of ids) {
      updateActionProgress(10 + Math.round((deleted / ids.length) * 72), `Excluindo ID ${id}.`);
      await window.artBank.deleteArtwork({ id });
      state.artworks = state.artworks.filter((item) => String(item.id) !== String(id));
      state.artworkSelection.delete(String(id));
      deleted += 1;
    }
    updateActionProgress(88, "Sincronizando cache.");
    state.cache = await window.artBank.runSync().catch(() => state.cache);
    renderFilteredArtworks();
    await refreshDashboardData();
    finishActionProgress("Artes excluídas.");
    toast(`${ids.length} arte(s) excluída(s).`);
  } catch (error) {
    finishActionProgress("Falha ao excluir.");
    toast(error.message);
  } finally {
    if (button) button.disabled = false;
  }
}

function toggleAllVisibleArtworks(event) {
  if (!state.artworkTools) {
    event.currentTarget.checked = false;
    return;
  }
  const checked = event.currentTarget.checked;
  (state.visibleArtworkIds || []).forEach((id) => {
    if (checked) state.artworkSelection.add(String(id));
    else state.artworkSelection.delete(String(id));
  });
  renderFilteredArtworks();
}

function syncArtworkBulkControls() {
  const selected = state.artworkSelection.size;
  const dirty = $$("[data-art-row].has-dirty-fields").length;
  const deleteButton = $("#deleteSelectedArtworksButton");
  const saveButton = $("#saveAllArtworksButton");
  if (deleteButton) {
    deleteButton.disabled = !state.artworkTools || selected === 0;
    const label = deleteButton.querySelector("span");
    if (label) label.textContent = selected ? `Excluir ${selected}` : "Excluir selecionadas";
  }
  if (saveButton) {
    saveButton.disabled = !state.artworkTools || dirty === 0;
    const label = saveButton.querySelector("span");
    if (label) label.textContent = dirty ? `Salvar ${dirty}` : "Salvar tudo";
  }
  const selectAll = $("#selectAllArtworks");
  if (selectAll) {
    const visible = state.visibleArtworkIds || [];
    selectAll.disabled = !state.artworkTools || !visible.length;
    selectAll.checked = Boolean(visible.length) && visible.every((id) => state.artworkSelection.has(String(id)));
  }
}

function openFindArtworkModal(id) {
  state.currentFindArtworkId = String(id || "");
  const art = state.artworks.find((item) => String(item.id) === state.currentFindArtworkId);
  if ($("#findArtworkTitle")) $("#findArtworkTitle").textContent = `Encontrar ID ${state.currentFindArtworkId}`;
  if ($("#findArtworkMeta")) $("#findArtworkMeta").textContent = art ? `${art.theme || "Sem tema"} · ${art.product || "Sem produto"}` : "Escolha onde procurar este ID.";
  $("#findArtworkModal")?.classList.remove("hidden");
}

function closeFindArtworkModal() {
  $("#findArtworkModal")?.classList.add("hidden");
  state.currentFindArtworkId = "";
}

async function openArtworkLocation(type) {
  const id = state.currentFindArtworkId;
  if (!id) return;
  try {
    startActionProgress("Encontrando arte", type === "drive-local" ? "Procurando no Drive local." : "Procurando em artes locais.", 20);
    const result = await window.artBank.openArtworkFolder({ type, id });
    finishActionProgress("Pasta aberta.");
    closeFindArtworkModal();
    toast(`Pasta aberta: ${result.folder}`);
  } catch (error) {
    finishActionProgress("Não encontrado.");
    toast(friendlyError(error.message));
  }
}

async function refreshArtworkUrl(id, allowUpload = false) {
  const art = state.artworks.find((item) => String(item.id) === String(id));
  if (!art) return toast(`Arte ${id} não encontrada na tabela.`);
  const button = $(`[data-refresh-art-url="${CSS.escape(String(id))}"]`);
  try {
    startActionProgress(`Atualizando thumb ${id}`, allowUpload ? "Subindo arquivo e gravando URL." : "Procurando imagem no Drive.", 12);
    if (button) {
      button.disabled = true;
      button.classList.add("is-loading");
    }
    updateActionProgress(38, "Consultando Drive.");
    const result = await window.artBank.refreshArtworkUrl({ ...art, allowUpload });
    if (result.needsUpload) {
      finishActionProgress("Imagem não encontrada no Drive.");
      const confirmed = await confirmAction({
        title: "Imagem não encontrada no Drive",
        message: `${result.message} Posso subir o arquivo local correspondente e atualizar a base oficial?`,
      });
      if (!confirmed) return;
      return refreshArtworkUrl(id, true);
    }
    updateActionProgress(72, "Atualizando visualização e cache.");
    state.artworks = state.artworks.map((item) => String(item.id) === String(id) ? { ...item, ...result } : item);
    state.brokenArtworkImageIds.delete(String(id));
    state.cache = await window.artBank.runSync().catch(() => state.cache);
    renderFilteredArtworks();
    finishActionProgress("Thumb atualizada.");
    toast(result.uploaded ? `Arte ${id} enviada ao Drive e atualizada.` : `URL da arte ${id} atualizada.`);
  } catch (error) {
    finishActionProgress("Falha ao atualizar thumb.");
    toast(friendlyError(error.message));
  } finally {
    if (button) {
      button.disabled = false;
      button.classList.remove("is-loading");
    }
  }
}

function artworkNeedsImageRefresh(art) {
  const preview = imagePreviewUrl(art?.url);
  return !preview || !String(art?.url || "").trim() || state.brokenArtworkImageIds.has(String(art?.id));
}

async function refreshMissingArtworkImages() {
  const button = $("#refreshMissingArtworkImagesButton");
  const targets = (state.artworks || []).filter((art) => isArtworkCatalogVisible(art) && artworkNeedsImageRefresh(art));
  if (!targets.length) {
    toast("Todas as artes carregadas já têm imagem visível.");
    return;
  }
  const confirmed = await confirmAction({
    title: "Atualizar imagens do acervo",
    message: `Vou tentar atualizar ${targets.length} arte(s) sem imagem visível. Isso pode levar alguns minutos.`,
  });
  if (!confirmed) return;
  try {
    if (button) button.disabled = true;
    startActionProgress("Atualizando imagens", `${targets.length} arte(s) sem prévia.`, 8);
    let updated = 0;
    for (const art of targets) {
      updateActionProgress(8 + Math.round((updated / targets.length) * 82), `Procurando imagem do ID ${art.id}.`);
      try {
        const result = await window.artBank.refreshArtworkUrl({ ...art, allowUpload: false });
        if (!result.needsUpload) {
          state.artworks = state.artworks.map((item) => String(item.id) === String(art.id) ? { ...item, ...result } : item);
          state.brokenArtworkImageIds.delete(String(art.id));
          updated += 1;
        }
      } catch (_) {
        // Mantem o lote seguindo mesmo se uma arte especifica falhar.
      }
    }
    updateActionProgress(94, "Sincronizando cache.");
    state.cache = await window.artBank.runSync().catch(() => state.cache);
    renderFilteredArtworks();
    finishActionProgress("Atualização finalizada.");
    toast(`${updated} imagem(ns) atualizada(s).`);
  } finally {
    if (button) button.disabled = false;
  }
}

function populateBatchProductFilter() {
  const products = state.config?.validProducts || [];
  const select = $("#batchFilterProduct");
  if (select) select.innerHTML = `<option value="all">Todos os produtos</option>` + products.map(p => `<option value="${escapeHtml(p)}">${escapeHtml(p)}</option>`).join("");
}

function bindFilters() {
  $("#userSearchInput")?.addEventListener("input", renderUserCards);
  $("#artworkSearch")?.addEventListener("input", renderFilteredArtworks);
  $("#artworkFilterTheme")?.addEventListener("change", renderFilteredArtworks);
  $("#artworkFilterProduct")?.addEventListener("change", renderFilteredArtworks);
  $("#artworkFilterUser")?.addEventListener("change", renderFilteredArtworks);
  $("#artworkSort")?.addEventListener("change", renderFilteredArtworks);
  $$("[data-artwork-view-mode]").forEach((button) => button.addEventListener("click", () => {
    state.artworkViewMode = button.dataset.artworkViewMode || "cards";
    renderFilteredArtworks();
  }));
  $("#artworkClearFilters")?.addEventListener("click", () => {
    $("#artworkSearch").value = "";
    $("#artworkFilterTheme").value = "all";
    $("#artworkFilterProduct").value = "all";
    $("#artworkFilterUser").value = "all";
    renderFilteredArtworks();
  });
  $("#batchSearch")?.addEventListener("input", renderRows);
  $("#batchFilterStatus")?.addEventListener("change", renderRows);
  $("#batchFilterProduct")?.addEventListener("change", renderRows);
  $("#batchClearFilters")?.addEventListener("click", () => {
    $("#batchSearch").value = "";
    $("#batchFilterStatus").value = "all";
    $("#batchFilterProduct").value = "all";
    renderRows();
  });
  $("#driveSearch")?.addEventListener("input", renderDriveFolders);
}

async function scanConfiguredFolders(showMessage = true) {
  const folders = selectedBatchFolders();
  if (!folders.length) {
    state.files = [];
    state.rows = [];
    renderRows();
    setBatchActionStatus("Escolha uma pasta antes de validar o lote.");
    if (showMessage) toast("Escolha uma pasta antes de validar o lote.");
    return;
  }
  state.files = await window.artBank.scanImages(folders);
  if (!state.files.length) {
    state.rows = [];
    renderRows();
    setBatchActionStatus("Nenhuma imagem encontrada na pasta configurada.");
    if (showMessage) toast("Nenhuma imagem encontrada na pasta configurada.");
    return;
  }
  await parseStandardRows();
  if (showMessage) toast(`${state.files.length} imagens encontradas.`);
}

async function parseStandardRows() {
  const parsed = await window.artBank.parseFilenames(state.files);
  state.rows = parsed.map((file) => {
     let valid = file.valid;
     let errors = file.errors || [];
     if (file.parsed?.id && state.cache.artworksMap?.[file.parsed.id]) {
        valid = false;
        errors.push("ID já existe na nuvem (Cache).");
     }
     return {
        selected: true,
        fileName: file.name,
        path: file.path,
        previewUrl: file.previewUrl,
        originalUrl: file.originalUrl || file.previewUrl,
        id: file.parsed?.id || "",
        theme: file.parsed?.theme || "",
        product: file.parsed?.product || "",
        size: file.parsed?.size || "",
        client: "",
        phone: "",
        valid: valid,
        errors: errors,
     };
  });
  renderRows();
}

function validateRowLocal(row) {
   let isValid = true;
   row.errors = [];
   if (!row.id) { isValid = false; row.errors.push("Falta ID."); }
   if (row.id && state.cache.artworksMap?.[row.id]) { isValid = false; row.errors.push("ID já existe na nuvem (Cache)."); }
   if (row.reservationStatus === "outside") { isValid = false; row.errors.push("ID fora da reserva ativa."); }
   if (row.reservationStatus === "missing") { isValid = false; row.errors.push("ID reservado ainda não informado."); }
   if (!row.theme) { isValid = false; row.errors.push("Falta Tema."); }
   if (!row.product) { isValid = false; row.errors.push("Falta Produto."); }
   return isValid;
}

function setMode(mode) {
  state.mode = mode;
  if($("#standardMode")) $("#standardMode").classList.toggle("active", mode === "standard");
  if($("#manualMode")) $("#manualMode").classList.toggle("active", mode === "manual");
  renderRows();
}

function renderRows() {
  const editable = state.mode === "manual";
  const products = state.config.validProducts || [];
  const query = ($("#batchSearch")?.value || "").toLowerCase().trim();
  const statusFilter = $("#batchFilterStatus")?.value || "all";
  const productFilter = $("#batchFilterProduct")?.value || "all";

  const filteredIndices = [];
  state.rows.forEach((row, index) => {
    if (query && !(row.fileName||"").toLowerCase().includes(query) && !(row.id||"").toString().toLowerCase().includes(query) && !(row.theme||"").toLowerCase().includes(query) && !(row.product||"").toLowerCase().includes(query) && !(row.client||"").toLowerCase().includes(query)) return;
    if (statusFilter === "ok" && !row.valid) return;
    if (statusFilter === "error" && row.valid) return;
    if (statusFilter === "selected" && !row.selected) return;
    if (productFilter !== "all" && String(row.product||"").toUpperCase() !== productFilter.toUpperCase()) return;
    filteredIndices.push(index);
  });

  if (!filteredIndices.length && state.rows.length) {
    if($("#batchRows")) $("#batchRows").innerHTML = `<tr><td colspan="11" style="text-align:center;padding:16px;color:var(--text-3)">Nenhuma arte no lote corresponde.</td></tr>`;
  } else if (filteredIndices.length) {
    if($("#batchRows")) {
      $("#batchRows").innerHTML = filteredIndices.map((index) => {
        const row = state.rows[index];
        return `<tr>
          <td><input type="checkbox" data-select-row="${index}" ${row.selected ? "checked" : ""} /></td>
          <td>${status(row)}</td>
          <td>${batchThumbCell(row, index)}</td>
          <td title="${escapeHtml(row.path || "")}">${escapeHtml(row.fileName)}</td>
          <td>${cell(index, "id", row.id, editable, row)}</td>
          <td>${cell(index, "theme", row.theme, editable, row)}</td>
          <td>${productCell(index, row.product, editable, products)}</td>
          <td>${sizeCell(index, row.product, row.size, editable)}</td>
          <td>${cell(index, "client", row.client || "", editable, row)}</td>
          <td>${cell(index, "phone", row.phone || "", editable, row)}</td>
          <td><div class="row-actions"><button class="tiny-button" data-upload-one="${index}">Enviar</button><button class="tiny-button" data-remove-one="${index}">×</button></div></td>
        </tr>`;
      }).join("");
    }
  } else if ($("#batchRows")) {
    $("#batchRows").innerHTML = `<tr><td colspan="11" class="batch-empty-cell">Nenhuma imagem carregada. Clique em Validar lote para ler a pasta configurada.</td></tr>`;
  }
  bindBatchInputs();
  renderSummary();
}

function batchThumbCell(row, index) {
  const src = row.previewUrl || row.originalUrl || localFileUrl(row.path);
  if (!src) {
    return `<button class="thumb-button thumb-empty" type="button" title="Sem prévia"><span>IMG</span></button>`;
  }
  return `
    <button class="thumb-button batch-thumb-button" type="button" data-preview-local="${index}" title="Abrir prévia">
      <img class="thumb art-thumb" src="${escapeHtml(src)}" alt="Prévia de ${escapeHtml(row.fileName || "arte")}" onerror="this.closest('button').classList.add('thumb-empty');this.remove();" />
      <span>IMG</span>
    </button>`;
}

function localFileUrl(filePath) {
  const text = String(filePath || "").trim();
  if (!text) return "";
  if (/^(file|https?|data):/i.test(text)) return text;
  const normalized = text.replaceAll("\\", "/");
  if (/^[A-Za-z]:\//.test(normalized)) return `file:///${encodeURI(normalized)}`;
  if (normalized.startsWith("//")) return `file:${encodeURI(normalized)}`;
  return encodeURI(normalized);
}

function bindBatchInputs() {
  $$("[data-row]").forEach((input) => input.addEventListener("input", () => {
    const row = state.rows[Number(input.dataset.row)];
    row[input.dataset.field] = input.value;
    if (input.dataset.field === "product") {
      applyProductSizeRule(row);
      renderRows();
      return;
    }
    if (input.dataset.field === "id") updateReservationStatus(row);
    row.valid = validateRowLocal(row);
    input.classList.toggle("is-invalid", fieldHasError(row, input.dataset.field));
    input.title = fieldHasError(row, input.dataset.field) ? (row.errors || []).join("; ") : "";
    renderSummary();
  }));
  $$("[data-select-row]").forEach((input) => input.addEventListener("change", () => {
    state.rows[Number(input.dataset.selectRow)].selected = input.checked;
    renderSummary();
  }));
  $$("[data-preview-local]").forEach((el) => el.addEventListener("click", () => openLocalPreview(state.rows[Number(el.dataset.previewLocal)])));
  $$("[data-remove-one]").forEach((button) => button.addEventListener("click", () => {
    state.rows.splice(Number(button.dataset.removeOne), 1);
    renderRows();
  }));
  $$("[data-upload-one]").forEach((button) => button.addEventListener("click", () => uploadOne(Number(button.dataset.uploadOne))));
}

async function fillFromReservation() {
  if (!state.reservations.length) {
    await refreshReservations().catch(() => null);
  }
  const reservation = state.reservations[0];
  if (!reservation) return toast("Não há reserva ativa.");
  const reserved = new Set((reservation.ids || []).map((id) => String(id)));
  const typed = new Set(state.rows.map((row) => String(row.id || "").trim()).filter(Boolean));
  let matching = 0;
  let outside = 0;
  state.rows = state.rows.map((row) => {
     const id = String(row.id || "").trim();
     const r = { ...row, reservationStatus: "" };
     updateReservationStatus(r, reservation);
     if (id && reserved.has(id)) {
       matching += 1;
     } else if (id) {
       outside += 1;
     }
     r.valid = validateRowLocal(r);
     return r;
  });
  const missing = [...reserved].filter((id) => !typed.has(id)).length;
  setMode("manual");
  const message = `Reserva ${reservation.label || ""}: ${matching} ID(s) batem, ${outside} fora da reserva, ${missing} reservado(s) sem linha.`;
  setBatchActionStatus(message);
  toast(message);
}

function cell(index, field, value, editable, row = {}) {
  const invalid = fieldHasError(row, field);
  if (!editable) return escapeHtml(value || "-");
  return `<input class="batch-field ${invalid ? "is-invalid" : ""}" data-row="${index}" data-field="${field}" value="${escapeHtml(value)}" title="${invalid ? escapeHtml(row.errors?.join("; ") || "Campo inválido") : ""}" />`;
}

function productCell(index, value, editable, products) {
  if (!editable) return escapeHtml(value || "-");
  const options = products.map((product) => `<option value="${escapeHtml(product)}"></option>`).join("");
  return `<input list="products-${index}" data-row="${index}" data-field="product" value="${escapeHtml(value || "")}" /><datalist id="products-${index}">${options}</datalist>`;
}

function sizeCell(index, product, value, editable) {
  if (!editable) return escapeHtml(value || "-");
  const sizes = (state.config.productSizes || {})[String(product || "").toUpperCase()] || [];
  const options = sizes.map((size) => `<option value="${escapeHtml(size)}">${escapeHtml(size)}</option>`).join("");
  return `<input list="sizes-${index}" data-row="${index}" data-field="size" value="${escapeHtml(value || "")}" /><datalist id="sizes-${index}">${options}</datalist>`;
}

function status(row) {
  if (row.valid) return `<span class="state-pill ok">OK</span>`;
  return `<span class="state-pill error" title="${escapeHtml(row.errors?.join("; ") || "Pendente")}">REVER</span>`;
}

async function validateRows() {
  setBusy("Lendo e validando lote...");
  const button = $("#validateRowsButton");
  const original = button?.textContent || "Validar lote";
  if (button) {
    button.disabled = true;
    button.textContent = "Validando...";
  }
  try {
    if (state.mode === "standard" || !state.rows.length) {
      const folders = selectedBatchFolders();
      if (!folders.length) {
        state.rows = [];
        renderRows();
        const message = "Escolha uma pasta antes de validar o lote.";
        setBatchActionStatus(message);
        toast(message);
        return;
      }
      state.files = await window.artBank.scanImages(folders);
      if (!state.files.length) {
        state.rows = [];
        renderRows();
        const message = "Nenhuma imagem encontrada na pasta configurada.";
        setBatchActionStatus(message);
        toast(message);
        return;
      }
      await parseStandardRows();
    }
    state.rows = (await window.artBank.validateBatch(state.rows)).map((row) => {
      let combined = { ...row, ...(row.parsed || {}) };
      combined.valid = validateRowLocal(combined);
      return combined;
    });
    renderRows();
    const valid = state.rows.filter((row) => row.valid).length;
    const invalid = state.rows.length - valid;
    const message = `${valid} arte(s) apta(s) para subir, ${invalid} com pendência.`;
    setBatchActionStatus(message);
    toast(message);
  } catch (error) {
    const message = friendlyError(error.message);
    setBatchActionStatus(message);
    toast(message);
  } finally {
    if (button) {
      button.disabled = false;
      button.textContent = original;
    }
    clearBusy();
  }
}

async function uploadBatch() {
  const readyRows = state.rows.filter((row) => row.valid && row.selected);
  if (!readyRows.length) return toast("Valide e marque as artes antes de enviar.");
  await doUpload(readyRows);
}

async function uploadOne(index) {
  const row = state.rows[index];
  if (!row?.valid) return toast("Valide esta arte antes de enviar.");
  await doUpload([row]);
}

async function choosePanel50Input() {
  const folder = await window.artBank.chooseImageFolder();
  if (folder && $("#panel50InputFolder")) {
    $("#panel50InputFolder").value = folder;
    clearBatch();
    setBatchActionStatus("Pasta selecionada. Clique em Validar lote para carregar as artes.");
    updatePanel50ThemePreview();
  }
}

async function choosePanel50Mockup() {
  const file = await window.artBank.chooseMockupFile();
  if (file && $("#panel50MockupPath")) $("#panel50MockupPath").value = file;
}

function fillPanel50AutomationForm() {
  if ($("#panel50InputFolder") && !$("#panel50InputFolder").value) {
    $("#panel50InputFolder").value = usableBatchPath(state.config?.panel50LastInputFolder);
  }
  if ($("#panel50Theme") && !$("#panel50Theme").value) {
    $("#panel50Theme").value = detectPanel50Theme($("#panel50InputFolder")?.value);
  }
  updatePanel50ThemePreview();
}

function detectPanel50Theme(inputFolder) {
  const folder = String(inputFolder || "").split(/[\\/]/).filter(Boolean).pop() || "";
  const dashIndex = folder.indexOf("-");
  const theme = dashIndex >= 0 ? folder.slice(dashIndex + 1) : folder;
  return theme.trim().replace(/\s+/g, " ").toUpperCase();
}

function updatePanel50ThemePreview() {
  const autoTheme = detectPanel50Theme($("#panel50InputFolder")?.value);
  if ($("#panel50Theme") && !state.panel50ThemeTouched) $("#panel50Theme").value = autoTheme;
  const theme = $("#panel50Theme")?.value.trim().toUpperCase() || autoTheme;
  if ($("#panel50DetectedTheme")) $("#panel50DetectedTheme").textContent = theme ? `Tema: ${theme}` : "Tema: escolha uma pasta";
}

async function runPanel50Automation() {
  const button = $("#runPanel50Button");
  const original = button?.textContent || "Executar / retomar";
  const payload = {
    inputFolder: $("#panel50InputFolder")?.value.trim(),
    organizedRoot: $("#panel50OrganizedRoot")?.value.trim(),
    driveLocalRoot: $("#panel50DriveRoot")?.value.trim(),
    mockupPath: $("#panel50MockupPath")?.value.trim(),
    theme: $("#panel50Theme")?.value.trim(),
    uploadAfter: $("#panel50UploadAfter")?.checked !== false,
  };
  try {
    startActionProgress("Renomeando e enviando", "Preparando automação.", 8);
    if (button) {
      button.disabled = true;
      button.textContent = "Executando...";
    }
    const nextConfig = {
      ...state.config,
      panel50LastInputFolder: payload.inputFolder,
    };
    if (payload.organizedRoot) nextConfig.panel50OrganizedRoot = payload.organizedRoot;
    if (payload.driveLocalRoot) nextConfig.panel50DriveLocalRoot = payload.driveLocalRoot;
    if (payload.mockupPath) nextConfig.panel50MockupPath = payload.mockupPath;
    state.config = await window.artBank.saveConfig(nextConfig);
    renderPanel50Progress({ phase: "Preparando", current: 0, total: 1, detail: "Conferindo IDs livres e criando fila." });
    const result = await window.artBank.runPanel50Batch(payload);
    const ok = result.counts?.upload_ok || 0;
    const mockups = result.counts?.mockup_ok || 0;
    const errors = result.counts?.error || 0;
    renderPanel50Progress({ phase: "Concluido", current: ok || mockups, total: result.items?.length || 0, detail: `${ok} enviados, ${mockups} prontos, ${errors} erro(s).` });
    finishActionProgress("Automação finalizada.");
    toast(`Automação finalizada: ${ok} enviados, ${mockups} prontos, ${errors} erros.`);
    await refreshArtworks({ force: true });
    await refreshDriveFolders(true);
  } catch (error) {
    const message = friendlyError(error.message);
    const noImages = message.toLowerCase().includes("nenhuma imagem");
    renderPanel50Progress({
      phase: noImages ? "Sem imagens" : "Erro",
      current: 0,
      total: noImages ? 0 : 1,
      detail: message,
      error: !noImages,
    });
    finishActionProgress(noImages ? "Sem imagens para processar." : "Falha na automação.");
    toast(message);
  } finally {
    if (button) {
      button.disabled = false;
      button.textContent = original;
    }
  }
}

async function doUpload(rows) {
  try {
    if (state.config?.maintenanceMode) {
      toast("Sistema em manutenção. Upload bloqueado temporariamente.");
      return;
    }
    state.uploadStartedAt = Date.now();
    startActionProgress("Enviando artes", `${rows.length} arte(s) selecionada(s).`, 8);
    renderUploadProgress({ phase: "Iniciando envio", current: 0, total: rows.length, detail: "Preparando arquivos.", etaMs: 0 });
    if($("#submitBatchButton")) $("#submitBatchButton").disabled = true;
    if($("#uploadHint")) $("#uploadHint").textContent = "Enviando com lock global...";
    const result = await window.artBank.uploadBatch(rows);
    if($("#uploadHint")) $("#uploadHint").textContent = `${result.successes.length} enviadas, ${result.failures.length} falhas.`;
    finishActionProgress("Envio finalizado.");
    
    // Atualiza cache rapidamente apos envio
    state.cache = await window.artBank.runSync().catch(() => state.cache);
    
    await refreshArtworks({ force: true });
    await refreshDashboardData();
    toast("Envio finalizado.");
  } catch (error) {
    renderUploadProgress({ phase: "Falha no envio", current: 0, total: rows.length, detail: friendlyError(error.message), etaMs: 0, error: true });
    if($("#uploadHint")) $("#uploadHint").textContent = friendlyError(error.message);
    finishActionProgress("Falha no envio.");
    toast(error.message);
  } finally {
    if($("#submitBatchButton")) $("#submitBatchButton").disabled = false;
  }
}

function renderUploadProgress(progress = {}) {
  const total = Number(progress.total || 0);
  const current = Number(progress.current || 0);
  const percent = total ? Math.min(100, Math.round((current / total) * 100)) : 0;
  if ($("#uploadState")) $("#uploadState").textContent = progress.phase || "Enviando";
  if ($("#uploadProgressBar")) $("#uploadProgressBar").style.width = `${percent}%`;
  if ($("#uploadHint")) $("#uploadHint").textContent = progress.detail || `${current}/${total}`;
  if ($("#uploadEta")) {
    $("#uploadEta").textContent = progress.etaMs ? `ETA ${formatDuration(progress.etaMs)}` : `${percent}%`;
  }
  $("#uploadTracker")?.classList.toggle("error", Boolean(progress.error));
  updateActionProgress(percent, progress.detail || progress.phase || "Enviando.");
}

function renderPanel50Progress(progress = {}) {
  if (!$("#panel50State")) return;
  const total = Number(progress.total || 0);
  const current = Number(progress.current || 0);
  const percent = total ? Math.min(100, Math.round((current / total) * 100)) : 0;
  $("#panel50State").textContent = progress.phase || "Processando";
  $("#panel50Hint").textContent = progress.detail || `${current}/${total}`;
  $("#panel50Count").textContent = total ? `${current}/${total}` : "-";
  $("#panel50ProgressBar").style.width = `${percent}%`;
  $("#panel50ProgressBar").parentElement?.parentElement?.classList.toggle("error", Boolean(progress.error));
  $("#panel50ProgressBar").parentElement?.parentElement?.classList.toggle("empty", total === 0 && !progress.error);
  updateActionProgress(percent, progress.detail || progress.phase || "Processando.");
}

async function refreshFinanceClients() {
  try {
    state.financeClients = await window.artBank.listFinanceClients();
    if ($("#financeClientCount")) $("#financeClientCount").textContent = state.financeClients.length;
    renderClientSuggestions();
    updateFinanceSummary();
  } catch (error) {
    toast(error.message);
  }
}

// NOVO: Modal premium de lançamento de pedido.
async function openOrderModal() {
  await refreshFinanceClients();
  $("#orderModal")?.classList.remove("hidden");
  setTimeout(() => $("#orderModal")?.classList.add("is-open"), 20);
  $("#financeClientInput")?.focus();
}

function closeOrderModal() {
  $("#orderModal")?.classList.remove("is-open");
  setTimeout(() => $("#orderModal")?.classList.add("hidden"), 160);
}

function clearFinanceOrder() {
  state.financeItems = [];
  state.financePreview = [];
  if ($("#financeCodeInput")) $("#financeCodeInput").value = "";
  renderFinancePreview();
  updateFinanceSummary();
}

function handleFinanceClientInput() {
  renderClientSuggestions();
  updateFinanceSummary();
}

function renderClientSuggestions() {
  const box = $("#financeClientSuggestions");
  const query = $("#financeClientInput")?.value.trim() || "";
  if (!box) return;
  const normalizedQuery = query.toUpperCase();
  const matches = query
    ? state.financeClients.filter((client) => client.label.toUpperCase().includes(normalizedQuery) || client.code === query).slice(0, 8)
    : state.financeClients.slice(0, 6);
  state.financeClientMatch = query
    ? state.financeClients.find((client) => client.label.toUpperCase() === normalizedQuery || client.code === query) || null
    : null;
  box.innerHTML = matches.map((client) => `
    <button type="button" class="client-suggestion" data-client="${escapeHtml(client.label)}">
      <strong>${escapeHtml(client.label)}</strong>
      <span>${escapeHtml(client.path)}</span>
    </button>
  `).join("");
  box.classList.toggle("hidden", !query && !matches.length);
  $$(".client-suggestion").forEach((button) => button.addEventListener("click", () => {
    $("#financeClientInput").value = button.dataset.client;
    state.financeClientMatch = state.financeClients.find((client) => client.label === button.dataset.client) || null;
    box.classList.add("hidden");
    updateFinanceSummary();
  }));
  $("#financeNewClientWrap")?.classList.toggle("hidden", !query || Boolean(matches.length));
}

async function handleFinanceCodeKey(event) {
  if (event.key !== "Enter") return;
  event.preventDefault();
  const input = event.currentTarget;
  const id = String(input.value || "").trim();
  if (!id) return;
  if (!/^\d+$/.test(id)) {
    toast("Digite apenas o código numérico da arte.");
    return;
  }
  if (!state.financeItems.includes(id)) state.financeItems.push(id);
  input.value = "";
  await refreshFinancePreview();
}

async function refreshFinancePreview() {
  if (!state.financeItems.length) {
    state.financePreview = [];
    renderFinancePreview();
    updateFinanceSummary();
    return;
  }
  try {
    renderFinancePreviewSkeleton();
    state.financePreview = await window.artBank.previewFinanceOrder(state.financeItems);
    renderFinancePreview();
    updateFinanceSummary(state.financePreview);
  } catch (error) {
    toast(error.message);
  }
}

function renderFinancePreviewSkeleton() {
  const grid = $("#financeArtGrid");
  const checklist = $("#financeChecklist");
  const count = Math.min(4, Math.max(1, state.financeItems.length));
  if (grid) {
    grid.innerHTML = Array.from({ length: count }).map(() => `
      <article class="order-art-card skeleton-card" aria-hidden="true">
        <div class="skeleton skeleton-thumb"></div>
        <div class="skeleton skeleton-line wide"></div>
        <div class="skeleton skeleton-line short"></div>
      </article>
    `).join("");
  }
  if (checklist) {
    checklist.classList.remove("hidden");
    checklist.innerHTML = Array.from({ length: count }).map(() => `
      <div class="order-check-row skeleton-card" aria-hidden="true">
        <div class="skeleton skeleton-line wide"></div>
        <div class="skeleton skeleton-line short"></div>
      </div>
    `).join("");
  }
}

function renderFinancePreview() {
  const grid = $("#financeArtGrid");
  const checklist = $("#financeChecklist");
  if (!grid || !checklist) return;
  if (!state.financePreview.length) {
    grid.innerHTML = `<div class="order-empty">Digite um ID e aperte Enter para adicionar artes.</div>`;
    checklist.classList.add("hidden");
    checklist.innerHTML = "";
    if ($("#financeSelectedCount")) $("#financeSelectedCount").textContent = "0 selecionadas";
    return;
  }
  grid.innerHTML = state.financePreview.map((item) => {
    const preview = item.previews?.[0];
    return `
      <article class="order-art-card ${item.found ? "" : "is-missing"}">
        <div class="order-art-thumb">${preview ? `<img src="${escapeHtml(preview.previewUrl)}" alt="${escapeHtml(preview.name)}" />` : `<span>Sem imagem</span>`}</div>
        <div class="order-art-meta">
          <strong>${escapeHtml(item.id)}</strong>
          <span>${escapeHtml(item.theme || "Não encontrado")}</span>
        </div>
        <button class="tiny-button" type="button" onclick="removeFinanceItem('${escapeHtml(item.id)}')">Remover</button>
      </article>
    `;
  }).join("");
  checklist.classList.toggle("hidden", state.financePreview.length <= 1);
  checklist.innerHTML = state.financePreview.length > 1 ? state.financePreview.map((item) => `
    <label class="order-check-row">
      <input type="checkbox" checked data-finance-check="${escapeHtml(item.id)}" />
      <span>${escapeHtml(item.id)} · ${escapeHtml(item.theme || "sem tema")}</span>
    </label>
  `).join("") : "";
  $$("[data-finance-check]").forEach((input) => input.addEventListener("change", updateFinanceSelectedCount));
  updateFinanceSelectedCount();
}

function selectedFinanceIds() {
  const checks = $$("[data-finance-check]");
  if (!checks.length) return [...state.financeItems];
  return checks.filter((input) => input.checked).map((input) => input.dataset.financeCheck);
}

function updateFinanceSelectedCount() {
  const total = selectedFinanceIds().length;
  if ($("#financeSelectedCount")) $("#financeSelectedCount").textContent = `${total} selecionada${total === 1 ? "" : "s"}`;
}

function updateFinanceSummary(items = null) {
  const box = $("#financeSummary");
  if (!box) return;
  const client = $("#financeClientInput")?.value.trim();
  const newClientName = $("#financeNewClientName")?.value.trim();
  const found = client ? state.financeClients.find((item) => item.label.toUpperCase().includes(client.toUpperCase()) || item.code === client) : null;
  const total = state.financeItems.length;
  const missing = items ? items.filter((item) => !item.found).length : 0;
  const clientText = found ? `Cliente: ${found.label}` : client && newClientName ? `Novo cliente: ${client} - ${newClientName}` : client ? "Cliente ainda não localizado" : "Escolha um cliente";
  box.textContent = `${clientText}. ${total} arte(s) no pedido${missing ? `, ${missing} não encontrada(s)` : ""}.`;
}

function removeFinanceItem(id) {
  state.financeItems = state.financeItems.filter((item) => item !== String(id));
  refreshFinancePreview();
}
window.removeFinanceItem = removeFinanceItem;

window.artBank.onFinanceCopyProgress?.((progress) => {
  const container = $("#financeProgressContainer");
  const text = $("#financeProgressText");
  const percent = $("#financeProgressPercent");
  const fill = $("#financeProgressFill");
  if (container && text && percent && fill) {
    container.classList.remove("hidden");
    const pct = progress.total > 0 ? Math.round((progress.current / progress.total) * 100) : 0;
    percent.textContent = `${pct}%`;
    fill.style.width = `${pct}%`;
    text.textContent = `Copiando: ${progress.filename || 'arquivo...'}`;
  }
});

async function copyFinanceOrder() {
  const ids = selectedFinanceIds();
  if (!ids.length) return toast("Adicione pelo menos uma arte.");
  const clientQuery = $("#financeClientInput")?.value.trim();
  if (!clientQuery) return toast("Escolha ou informe o cliente.");
  const button = $("#financeCopyButton");
  const original = button?.textContent || "Lançar Pedido";
  const container = $("#financeProgressContainer");
  const fill = $("#financeProgressFill");
  const percent = $("#financeProgressPercent");
  try {
    if (button) {
      button.disabled = true;
      button.textContent = "Lançando...";
    }
    if (container && fill && percent) {
      container.classList.remove("hidden");
      fill.style.width = "0%";
      percent.textContent = "0%";
    }
    const result = await window.artBank.copyFinanceOrder({
      clientQuery,
      newClientName: $("#financeNewClientName")?.value.trim(),
      ids,
    });
    toast(`Pedido lançado: ${result.copied.length} imagem(ns) para ${result.client.label}.`);
    updateFinanceSummary(result.items);
    closeOrderModal();
  } catch (error) {
    toast(error.message);
  } finally {
    if (button) {
      button.disabled = false;
      button.textContent = original;
    }
    if (container) {
      container.classList.add("hidden");
    }
  }
}

function clearBatch() {
  state.rows = [];
  state.files = [];
  renderRows();
  setBatchActionStatus("Escolha uma pasta e valide para carregar as artes.");
}

function removeSelectedRows() {
  state.rows = state.rows.filter((row) => !row.selected);
  renderRows();
}

function renderSummary() {
  const total = state.rows.filter((row) => row.selected).length;
  const valid = state.rows.filter((row) => row.valid && row.selected).length;
  if($("#summaryTotal")) $("#summaryTotal").textContent = total;
  if($("#summaryValid")) $("#summaryValid").textContent = valid;
  if($("#summaryInvalid")) $("#summaryInvalid").textContent = total - valid;
}

function setBatchActionStatus(message) {
  if ($("#batchActionStatus")) $("#batchActionStatus").textContent = message;
}

function selectedBatchFolders() {
  const folder = usableBatchPath($("#panel50InputFolder")?.value);
  return folder ? [folder] : [];
}

function usableBatchPath(value) {
  const text = String(value || "").trim();
  if (!text) return "";
  if (/SKU\s*-\s*ATESTE$/i.test(text)) return "";
  return text;
}

function updateReservationStatus(row, reservation = state.reservations[0]) {
  if (!reservation) {
    row.reservationStatus = "";
    return;
  }
  const id = String(row.id || "").trim();
  if (!id) {
    row.reservationStatus = "";
    return;
  }
  const reserved = new Set((reservation.ids || []).map((item) => String(item)));
  row.reservationStatus = reserved.has(id) ? "match" : "outside";
}

function fieldHasError(row, field) {
  const errors = (row.errors || []).join(" ").toLowerCase();
  if (field === "id") return /id|reserva|cache|repetido/.test(errors);
  if (field === "theme") return errors.includes("tema");
  if (field === "product") return errors.includes("produto");
  if (field === "size") return errors.includes("dimens");
  return false;
}

function openLocalPreview(row) {
  if(!$("#previewModal")) return;
  if ($("#previewTitle")) $("#previewTitle").textContent = row.fileName || "Prévia local";
  if ($("#previewMeta")) $("#previewMeta").textContent = row.path || "Arquivo local";
  $("#previewModal").classList.remove("hidden");
  hidePreviewFallback();
  $("#drivePreviewFrame").classList.add("hidden");
  $("#localPreviewImage").classList.remove("hidden");
  $("#localPreviewImage").src = row.previewUrl || row.originalUrl || "";
}

function openDrivePreview(url, art = null) {
  if (!url || !$("#previewModal")) return toast("Esta arte não tem URL.");
  if ($("#previewTitle")) $("#previewTitle").textContent = art ? `ID ${art.id} · ${art.theme || "Sem tema"}` : "Prévia da arte";
  if ($("#previewMeta")) $("#previewMeta").textContent = art ? `${art.product || "Sem produto"} · ${art.size || "Sem tamanho"}` : "Imagem cadastrada";
  $("#previewModal").classList.remove("hidden");
  hidePreviewFallback();
  $("#drivePreviewFrame").src = "about:blank";
  $("#drivePreviewFrame").classList.add("hidden");
  $("#localPreviewImage").classList.remove("hidden");
  $("#localPreviewImage").src = imagePreviewUrl(url);
}

function closePreview() {
  if(!$("#previewModal")) return;
  $("#previewModal").classList.add("hidden");
  $("#drivePreviewFrame").src = "about:blank";
  $("#localPreviewImage").src = "";
  hidePreviewFallback();
}

function showPreviewFallback() {
  $("#localPreviewImage")?.classList.add("hidden");
  $("#drivePreviewFrame")?.classList.add("hidden");
  $("#previewFallback")?.classList.remove("hidden");
}

function hidePreviewFallback() {
  $("#previewFallback")?.classList.add("hidden");
}

function lines(value) {
  return String(value || "").split(/\r?\n|,/).map((item) => item.trim()).filter(Boolean);
}

function formatProductSizes(map = {}) {
  return Object.entries(map).map(([product, sizes]) => `${product}: ${sizes.join(", ")}`).join("\n");
}

function parseProductSizes(value) {
  const map = {};
  for (const line of String(value || "").split(/\r?\n/)) {
    const [product, sizes] = line.split(":");
    if (!product || !sizes) continue;
    map[product.trim().toUpperCase()] = sizes.split(",").map((item) => item.trim().toUpperCase()).filter(Boolean);
  }
  return map;
}

function applyProductSizeRule(row) {
  const product = String(row.product || "").trim().toUpperCase();
  if (product === "KIT" || product === "KIT MAIS ROMANO") row.size = "PADRÃO";
  if (product === "PAINEL REDONDO") row.size = "50X50";
  if (product === "PAINEL") row.size = "150X150";
  row.valid = validateRowLocal(row);
}

function artThumb(artOrUrl) {
  const art = typeof artOrUrl === "object" && artOrUrl !== null ? artOrUrl : { url: artOrUrl, id: "" };
  const preview = imagePreviewUrl(art.url);
  const empty = `
    <button class="thumb-button thumb-empty" type="button" title="Sem prévia">
      <svg class="thumb-empty-icon" viewBox="0 0 24 24"><path d="M21 19V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2zM8.5 11.5l2.5 3.01L14.5 10l4.5 6H5l3.5-4.5z"/></svg>
    </button>`;
  if (!preview) return empty;
  return `
    <button class="thumb-button thumb-loading" data-preview-drive="${escapeHtml(art.url)}" data-preview-id="${escapeHtml(art.id || "")}" title="Abrir prévia">
      <img class="art-thumb" src="${escapeHtml(preview)}" alt="Prévia da arte ${escapeHtml(art.id || "")}" onload="this.closest('button').classList.remove('thumb-loading')" onerror="this.closest('button').classList.remove('thumb-loading');this.closest('button').classList.add('thumb-empty');this.remove();" />
      <svg class="thumb-empty-icon" viewBox="0 0 24 24"><path d="M21 19V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2zM8.5 11.5l2.5 3.01L14.5 10l4.5 6H5l3.5-4.5z"/></svg>
    </button>`;
}

function imagePreviewUrl(url) {
  const value = String(url || "").trim();
  if (!value) return "";
  const id = driveFileId(value);
  if (id) return `https://drive.google.com/thumbnail?id=${encodeURIComponent(id)}&sz=w1600`;
  return value;
}

function driveFileId(url) {
  const text = String(url || "");
  return text.match(/\/file\/d\/([^/]+)/)?.[1]
    || text.match(/[?&]id=([^&]+)/)?.[1]
    || "";
}

function rangeLabel(ids) {
  if (!ids.length) return "sem IDs";
  return ids.length === 1 ? `ID ${ids[0]}` : `IDs ${ids[0]}-${ids[ids.length - 1]} (${ids.length})`;
}

function formatTime(value) {
  return new Date(value).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
}

function timeUntil(value) {
  const ms = Date.parse(value || 0) - Date.now();
  if (!Number.isFinite(ms) || ms <= 0) return "expirando";
  return formatDuration(ms);
}

function formatDuration(ms) {
  const totalSeconds = Math.max(1, Math.round(Number(ms || 0) / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return minutes ? `${minutes}min ${seconds}s` : `${seconds}s`;
}

function toast(message) {
  const box = $("#toast") || $("#globalToast");
  if(!box) return;
  box.textContent = friendlyError(message);
  box.classList.add("show");
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => box.classList.remove("show"), 3200);
}

// NOVO: Confirmação customizada para substituir dialogs nativos.
function confirmAction({ title = "Confirmar ação", message = "", destructive = false } = {}) {
  return new Promise((resolve) => {
    state.confirmResolver = resolve;
    $("#confirmTitle").textContent = title;
    $("#confirmMessage").textContent = message;
    $("#confirmOkButton").textContent = destructive ? "Excluir" : "Confirmar";
    $("#confirmOkButton").classList.toggle("danger-button", Boolean(destructive));
    $("#confirmModal")?.classList.remove("hidden");
    setTimeout(() => $("#confirmModal")?.classList.add("is-open"), 20);
    $("#confirmCancelButton")?.focus();
  });
}

function resolveConfirm(value) {
  $("#confirmModal")?.classList.remove("is-open");
  setTimeout(() => $("#confirmModal")?.classList.add("hidden"), 160);
  const resolver = state.confirmResolver;
  state.confirmResolver = null;
  if (resolver) resolver(Boolean(value));
}

function friendlyError(message) {
  let text = String(message || "");
  text = text.replace(/^Error invoking remote method '[^']+':\s*/i, "");
  text = text.replace(/^Error:\s*/i, "");
  if (text.includes("Nenhuma imagem TIFF/JPG/PNG encontrada")) {
    return "Nenhuma imagem encontrada na pasta escolhida.";
  }
  if (text.includes("missing required authentication credential") || text.includes("Expected OAuth")) {
    return "Google não conectado. Use Conectar Google ou coloque token.json válido na pasta fixa.";
  }
  if (text.includes("invalid_grant")) return "Token Google expirado ou revogado. Conecte novamente.";
  if (text.includes("redirect_uri_mismatch")) return "OAuth recusado: ajuste o redirect URI no projeto Google.";
  return text;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

boot();
