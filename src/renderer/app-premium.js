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
  artworkTools: false,
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
}

function clearBusy() {
  $("#globalOverlay")?.classList.add("hidden");
}

async function boot() {
  bindNavigation();
  bindActions();
  bindFilters();
  await loadConfig();
  await loadBootstrap();
  renderLoginMode();
  
  // Update cache initially
  if (state.config?.baseSpreadsheetId) {
    state.cache = await window.artBank.runSync().catch(() => state.cache);
  }
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
    $("#btnScanFiles")?.addEventListener("click", scanConfiguredFolders);
    $("#btnChooseFolder")?.addEventListener("click", chooseFolderAndScan);
    $("#btnNewBlankRow")?.addEventListener("click", addBlankRow);
    $("#removeSelectedButton")?.addEventListener("click", removeSelectedRows);
    $("#reloadArtworksButton")?.addEventListener("click", refreshArtworks);
    $("#validateRowsButton")?.addEventListener("click", validateRows);
    $("#submitBatchButton")?.addEventListener("click", uploadBatch);
    $("#runPanel50Button")?.addEventListener("click", runPanel50Automation);
    $("#choosePanel50Input")?.addEventListener("click", choosePanel50Input);
    $("#choosePanel50Organized")?.addEventListener("click", choosePanel50Organized);
    $("#choosePanel50DriveRoot")?.addEventListener("click", choosePanel50DriveRoot);
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
    $("#refreshDriveFoldersButton")?.addEventListener("click", () => refreshDriveFolders(true));
    $("#openDriveRootButton")?.addEventListener("click", openDriveRoot);
    $("#standardMode")?.addEventListener("click", () => setMode("standard"));
    $("#manualMode")?.addEventListener("click", () => setMode("manual"));
    $("#fillFromReservationButton")?.addEventListener("click", fillFromReservation);
    $("#parseNamesButton")?.addEventListener("click", parseStandardRows);
    $("#settingsForm")?.addEventListener("submit", saveSettings);
  $("#validateSheetButton")?.addEventListener("click", validateOperationalSheet);
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
    const savedTheme = localStorage.getItem("theme") || "dark";
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
    "Controle arquivos, reservas, equipe e planilhas com uma experiência desenhada para ritmo de produção.",
    "Encontre, valide e lance artes sem ficar alternando entre pastas, planilhas e mensagens soltas.",
    "A base oficial das artes, com rastreio visual, histórico de ações e publicação mais segura."
  ];
  const phrase = phrases[Math.floor(Math.random() * phrases.length)];
  if ($("#loginHeadline")) $("#loginHeadline").innerHTML = firstAccess ? "Primeiro acesso,<br/>operação pronta para escalar." : "Banco visual,<br/>produção sob controle.";
  if ($("#loginPhrase")) $("#loginPhrase").textContent = firstAccess
    ? "Crie o administrador inicial e libere a operação com usuários, auditoria, Google Sheets e Drive."
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
    $("#sidebarUser").textContent = `${state.user.name} (${state.user.role})`;
    
    if ($("#adminNav")) {
       $("#adminNav").style.display = state.user.role === "admin" ? "grid" : "none";
    }

    startHeartbeat();
    await refreshAll();
    toast("Login realizado.");
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
  startHeartbeat.timer = setInterval(async () => {
    await window.artBank.heartbeat();
    await refreshPresence();
    await refreshReservations();
  }, 30000);
}

function showView(view, title) {
  const subtitles = {
    dashboard: "Pulso da operação, integração Google, presença local e indicadores de acervo.",
    batch: "Fluxo guiado para escanear, validar, revisar e publicar artes com segurança.",
    artworks: "Banco visual com filtros, prévia rápida, histórico e ações de edição.",
    drive: "Pastas por tema, estrutura do acervo e sincronização com a raiz do Drive.",
    finance: "Monte pedidos por cliente, adicione artes por ID e gere lançamento operacional.",
    reservations: "Separe IDs antes da produção para evitar conflito entre operadores.",
    users: "Controle de equipe, perfis de acesso e status dos operadores.",
    audit: "Registro de ações, rastreabilidade e conferência da operação.",
    settings: "Parâmetros de integração, caminhos locais, regras e manutenção do sistema."
  };
  $$(".nav-item").forEach((item) => item.classList.toggle("active", item.dataset.view === view));
  $$(".view").forEach((panel) => panel.classList.remove("active"));
  $(`#${view}View`).classList.add("active");
  $("#viewTitle").textContent = title;
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

    await scanConfiguredFolders(false);
    window.artBank.getProvisioningPlan().then(plan => renderProvisioningPlan(plan));
  } finally {
    if (syncBtnSpan) syncBtnSpan.textContent = originalText;
    clearBusy();
  }
}

function renderExternalLinks() {
  const sheetId = state.config?.operationalSpreadsheetId;
  const baseSheetId = state.config?.baseSpreadsheetId;

  const dashLinks = [];
  if (sheetId) dashLinks.push({ label: "Planilha de Artes", url: `https://docs.google.com/spreadsheets/d/${sheetId}`, icon: '<svg viewBox="0 0 24 24"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6zM6 20V4h7v5h5v11H6z"/><path d="M8 13h8v2H8zm0 4h5v2H8z"/></svg>' });
  if (baseSheetId) dashLinks.push({ label: "Planilha Central", url: `https://docs.google.com/spreadsheets/d/${baseSheetId}`, icon: '<svg viewBox="0 0 24 24"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6zM6 20V4h7v5h5v11H6z"/><path d="M8 13h8v2H8zm0 4h5v2H8z"/></svg>' });

  const dashEl = $("#dashboardLinks");
  if (dashEl) {
     dashEl.innerHTML = dashLinks.map(l => `<a class="link-card" href="#" data-external="${escapeHtml(l.url)}">${l.icon}<span>${escapeHtml(l.label)}</span></a>`).join("");
  }

  const artLinks = [];
  if (sheetId) artLinks.push({ label: "Abrir Planilha", url: `https://docs.google.com/spreadsheets/d/${sheetId}`, icon: '<svg viewBox="0 0 24 24"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6zM6 20V4h7v5h5v11H6z"/><path d="M8 13h8v2H8zm0 4h5v2H8z"/></svg>' });
  const artEl = $("#artworksLinks");
  if(artEl) {
      artEl.innerHTML = artLinks.map(l => `<a class="link-card" href="#" data-external="${escapeHtml(l.url)}">${l.icon}<span>${escapeHtml(l.label)}</span></a>`).join("");
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
    baseSpreadsheetName: form.elements.baseSpreadsheetName?.value.trim(),
    baseSpreadsheetId: form.elements.baseSpreadsheetId?.value.trim(),
    operationalSpreadsheetId: form.elements.operationalSpreadsheetId?.value.trim(),
    cadastroSheetName: form.elements.cadastroSheetName?.value.trim(),
    operationalLogsSheetName: form.elements.operationalLogsSheetName?.value.trim(),
    driveFolderName: form.elements.driveFolderName?.value.trim(),
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

async function validateOperationalSheet() {
  const form = $("#settingsForm");
  const status = $("#sheetValidationStatus");
  if (!status) return;
  status.textContent = "Testando...";
  status.className = "inline-status";
  try {
    const result = await window.artBank.validateOperationalSpreadsheet(form.elements.operationalSpreadsheetId.value.trim());
    if (result.hasCadastro && result.detectedCadastroName) {
      form.elements.cadastroSheetName.value = result.detectedCadastroName;
      state.config = await window.artBank.saveConfig({
        ...readSettingsForm(),
        operationalSpreadsheetId: form.elements.operationalSpreadsheetId.value.trim(),
        cadastroSheetName: result.detectedCadastroName,
      });
      fillSettingsForm();
    }
    setTimeout(() => {
      status.textContent = result.hasCadastro ? `✓ Conectada` : `Erro (Sem aba)`;
      status.classList.add(result.hasCadastro ? "ok" : "warn");
      toast(result.message);
    }, 1200);
  } catch (error) {
    setTimeout(() => {
      status.textContent = "Erro";
      status.classList.add("error");
      toast(error.message);
    }, 1200);
  }
}

async function testConnectivity() {
  const box = $("#connectivityResults");
  const status = $("#sheetValidationStatus");
  if (status) {
    status.textContent = "Testando tudo...";
    status.className = "inline-status";
  }
  if (box) box.innerHTML = `<div class="diagnostic-item"><strong>Executando diagnóstico</strong><span>Conferindo token, planilhas, abas e Drive.</span></div>`;
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

function renderConfig() {
  if($("#noticeText")) {
    $("#noticeText").textContent =
      `Banco localizado em ${state.config.fixedDataFolder || "C:\\BancoDeArtes"}. Os dados oficiais estão no Sheets.`;
  }
}

async function refreshAuthStatus() {
  const status = await window.artBank.getAuthStatus();
  setTextAll(".metric-google-status", status.authenticated ? "OK" : "OFF");
  setTextAll(".metric-google-sub", status.authenticated ? "conectado" : "ação necessária");
  if ($("#authButton")) $("#authButton").textContent = status.authenticated ? "Google conectado" : "Conectar Google";
  if ($("#googleBadge")) $("#googleBadge").textContent = status.authenticated ? "Token válido" : "Sem token válido";
  if ($("#connectionMessage")) $("#connectionMessage").textContent = status.authenticated
    ? (status.missingScopes?.length ? `Faltam permissões: ${status.missingScopes.length}. Reconecte o Google.` : "Conta conectada. Planilhas ativas.")
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
  const items = [
    ["Planilha central", plan.baseSpreadsheet.mode, plan.baseSpreadsheet.id || plan.baseSpreadsheet.name],
    ["Planilha de artes", plan.operationalSpreadsheet.mode, plan.operationalSpreadsheet.id || "Defina ou crie no Google"],
    ["Pasta Drive", plan.driveFolder.mode, plan.driveFolder.name],
  ];
  if($("#provisioningPlan")) {
    $("#provisioningPlan").innerHTML = items.map(([label, mode, value]) => `
      <div class="plan-item"><strong>${escapeHtml(label)}</strong><span>${escapeHtml(value)}</span><span class="badge">${escapeHtml(mode)}</span></div>
    `).join("");
  }
}

async function refreshPresence() {
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
    list.innerHTML = `<div class="table-loading"><div class="spinner small"></div><span>${refresh ? "Sincronizando e limpando duplicadas..." : "Carregando pastas..."}</span></div>`;
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
  if (showLoading && $("#artworkRows")) {
    $("#artworkRows").innerHTML = `<tr><td colspan="9"><div class="table-loading"><div class="spinner small"></div><span>Atualizando direto da planilha...</span></div></td></tr>`;
  }
  if (force) {
    state.cache = await window.artBank.runSync().catch(() => state.cache);
  }
  state.artworks = await window.artBank.listArtworks().catch((error) => {
    if($("#artworkRows")) $("#artworkRows").innerHTML = `<tr><td colspan="9">${escapeHtml(friendlyError(error.message))}</td></tr>`;
    toast(error.message);
    return [];
  });
  if (!state.artworks.length) {
    if($("#artworkRows")) $("#artworkRows").innerHTML = `<tr><td colspan="9">Nenhuma arte carregada.</td></tr>`;
    return;
  }
  populateArtworkFilters();
  renderFilteredArtworks();
}

function populateArtworkFilters() {
  const themes = new Set();
  const products = new Set();
  const users = new Set();
  state.artworks.forEach((art) => {
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
  if (!filtered.length) {
    if($("#artworkRows")) $("#artworkRows").innerHTML = `<tr><td colspan="9" style="text-align:center;padding:20px;color:var(--text-3)">Nenhuma arte corresponde aos filtros.</td></tr>`;
    return;
  }
  if($("#artworkRows")) {
    $("#artworkRows").innerHTML = filtered.map((art) => `
      <tr data-art-row="${escapeHtml(art.id)}">
        <td>${artThumb(art.url)}</td>
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
  $$("[data-preview-drive]").forEach((button) => button.addEventListener("click", () => openDrivePreview(button.dataset.previewDrive)));
  $$("[data-art-field]").forEach((input) => input.addEventListener("change", () => input.classList.add("dirty")));
  $$("[data-save-art]").forEach((button) => button.addEventListener("click", () => saveArtworkEdit(button.dataset.saveArt)));
  $$("[data-delete-art]").forEach((button) => button.addEventListener("click", () => deleteArtwork(button.dataset.deleteArt)));
}

function toggleArtworkTools() {
  if (state.user?.role !== "admin") {
    toast("Ferramentas de edição restritas ao admin.");
    return;
  }
  state.artworkTools = !state.artworkTools;
  $("#artworkToolsButton")?.classList.toggle("active", state.artworkTools);
  $("#artworksView")?.classList.toggle("editing", state.artworkTools);
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
  return `<div class="row-actions">
    <button class="icon-btn" data-save-art="${escapeHtml(id)}" title="Salvar alterações" aria-label="Salvar alterações">
      <svg viewBox="0 0 24 24"><path d="M17 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V7l-4-4zM12 19a3 3 0 1 1 0-6 3 3 0 0 1 0 6zM6 8V5h9v3H6z"/></svg>
    </button>
    <button class="icon-btn delete-btn" data-delete-art="${escapeHtml(id)}" title="Excluir arte" aria-label="Excluir arte">
      <svg viewBox="0 0 24 24"><path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM8 9h8v10H8V9zm7.5-5-1-1h-5l-1 1H5v2h14V4h-3.5z"/></svg>
    </button>
  </div>`;
}

async function saveArtworkEdit(id) {
  const row = $(`[data-art-row="${CSS.escape(String(id))}"]`);
  if (!row) return;
  const payload = { id };
  row.querySelectorAll("[data-art-field]").forEach((input) => {
    payload[input.dataset.artField] = input.value;
  });
  const button = row.querySelector("[data-save-art]");
  const original = button?.textContent || "Salvar";
  try {
    if (button) {
      button.disabled = true;
      button.textContent = "Salvando...";
    }
    const updated = await window.artBank.updateArtwork(payload);
    state.artworks = state.artworks.map((art) => String(art.id) === String(id) ? { ...art, ...updated } : art);
    row.querySelectorAll(".dirty").forEach((input) => input.classList.remove("dirty"));
    await refreshDashboardData();
    toast(`Arte ${id} atualizada na planilha.`);
  } catch (error) {
    toast(error.message);
  } finally {
    if (button) {
      button.disabled = false;
      button.textContent = original;
    }
  }
}

async function deleteArtwork(id) {
  if (!state.artworkTools) return;
  const art = state.artworks.find((item) => String(item.id) === String(id));
  const label = art ? `${art.id} - ${art.theme}` : `ID ${id}`;
  const confirmed = await confirmAction({
    title: "Excluir arte",
    message: `Excluir a arte ${label} da planilha? Esta ação remove a linha da aba de artes.`,
    destructive: true,
  });
  if (!confirmed) return;
  try {
    await window.artBank.deleteArtwork({ id });
    state.artworks = state.artworks.filter((item) => String(item.id) !== String(id));
    renderFilteredArtworks();
    await refreshDashboardData();
    toast(`Arte ${id} excluída da planilha.`);
  } catch (error) {
    toast(error.message);
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

async function chooseFolderAndScan() {
  const folder = await window.artBank.chooseImageFolder();
  if (!folder) return;
  state.config = await window.artBank.saveConfig({ ...state.config, localImageFolders: [folder] });
  fillSettingsForm();
  await scanConfiguredFolders();
}

async function scanConfiguredFolders(showMessage = true) {
  state.files = await window.artBank.scanImages();
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
  } else {
    if($("#batchRows")) {
      $("#batchRows").innerHTML = filteredIndices.map((index) => {
        const row = state.rows[index];
        return `<tr>
          <td><input type="checkbox" data-select-row="${index}" ${row.selected ? "checked" : ""} /></td>
          <td>${status(row)}</td>
          <td>${batchThumbCell(row, index)}</td>
          <td title="${escapeHtml(row.path || "")}">${escapeHtml(row.fileName)}</td>
          <td>${cell(index, "id", row.id, editable)}</td>
          <td>${cell(index, "theme", row.theme, editable)}</td>
          <td>${productCell(index, row.product, editable, products)}</td>
          <td>${sizeCell(index, row.product, row.size, editable)}</td>
          <td>${cell(index, "client", row.client || "", editable)}</td>
          <td>${cell(index, "phone", row.phone || "", editable)}</td>
          <td><div class="row-actions"><button class="tiny-button" data-upload-one="${index}">Enviar</button><button class="tiny-button" data-remove-one="${index}">×</button></div></td>
        </tr>`;
      }).join("");
    }
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
    row.valid = validateRowLocal(row);
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

function fillFromReservation() {
  const reservation = state.reservations[0];
  if (!reservation) return toast("Não há reserva ativa.");
  state.rows = state.rows.map((row, index) => {
     const r = { ...row, id: reservation.ids[index] || row.id };
     r.valid = validateRowLocal(r);
     return r;
  });
  setMode("manual");
  toast("IDs da primeira reserva aplicados.");
}

function cell(index, field, value, editable) {
  if (!editable) return escapeHtml(value || "-");
  return `<input data-row="${index}" data-field="${field}" value="${escapeHtml(value)}" />`;
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
  setBusy("Validando lote...");
  const button = $("#validateRowsButton");
  const original = button?.textContent || "Validar lote";
  if (button) {
    button.disabled = true;
    button.textContent = "Validando...";
  }
  try {
  state.rows = (await window.artBank.validateBatch(state.rows)).map((row) => {
    let combined = { ...row, ...(row.parsed || {}) };
    combined.valid = validateRowLocal(combined);
    return combined;
  });
  renderRows();
  toast("Lote validado. (Checagem Cloud + Cache)");
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
    updatePanel50ThemePreview();
  }
}

async function choosePanel50Organized() {
  const folder = await window.artBank.chooseImageFolder();
  if (folder && $("#panel50OrganizedRoot")) $("#panel50OrganizedRoot").value = folder;
}

async function choosePanel50DriveRoot() {
  const folder = await window.artBank.chooseImageFolder();
  if (folder && $("#panel50DriveRoot")) $("#panel50DriveRoot").value = folder;
}

async function choosePanel50Mockup() {
  const file = await window.artBank.chooseMockupFile();
  if (file && $("#panel50MockupPath")) $("#panel50MockupPath").value = file;
}

function fillPanel50AutomationForm() {
  const sourceRoot = state.config?.panel50SourceRoot || "";
  if ($("#panel50InputFolder") && !$("#panel50InputFolder").value) {
    $("#panel50InputFolder").value = state.config?.panel50LastInputFolder || sourceRoot;
  }
  if ($("#panel50Theme") && !$("#panel50Theme").value) {
    $("#panel50Theme").value = detectPanel50Theme($("#panel50InputFolder")?.value);
  }
  if ($("#panel50OrganizedRoot")) $("#panel50OrganizedRoot").value = state.config?.panel50OrganizedRoot || "X:\\1 - TEMAS ORGANIZADOS";
  if ($("#panel50DriveRoot")) $("#panel50DriveRoot").value = state.config?.panel50DriveLocalRoot || "X:\\2 - DRIVE";
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
  if ($("#panel50DetectedTheme")) $("#panel50DetectedTheme").textContent = theme ? `Tema: ${theme}` : "Tema: detectado pela pasta SKU";
}

async function runPanel50Automation() {
  const button = $("#runPanel50Button");
  const original = button?.textContent || "Executar / retomar";
  const payload = {
    inputFolder: $("#panel50InputFolder")?.value.trim(),
    organizedRoot: $("#panel50OrganizedRoot")?.value.trim(),
    driveLocalRoot: $("#panel50DriveRoot")?.value.trim(),
    theme: $("#panel50Theme")?.value.trim(),
    uploadAfter: $("#panel50UploadAfter")?.checked !== false,
  };
  try {
    if (button) {
      button.disabled = true;
      button.textContent = "Executando...";
    }
    state.config = await window.artBank.saveConfig({
      ...state.config,
      panel50LastInputFolder: payload.inputFolder,
      panel50OrganizedRoot: payload.organizedRoot,
      panel50DriveLocalRoot: payload.driveLocalRoot,
    });
    renderPanel50Progress({ phase: "Preparando", current: 0, total: 1, detail: "Conferindo IDs livres e criando fila." });
    const result = await window.artBank.runPanel50Batch(payload);
    const ok = result.counts?.upload_ok || 0;
    const mockups = result.counts?.mockup_ok || 0;
    const errors = result.counts?.error || 0;
    renderPanel50Progress({ phase: "Concluido", current: ok || mockups, total: result.items?.length || 0, detail: `${ok} enviados, ${mockups} prontos, ${errors} erro(s).` });
    toast(`Automação finalizada: ${ok} enviados, ${mockups} prontos, ${errors} erros.`);
    await refreshArtworks({ force: true });
    await refreshDriveFolders(true);
  } catch (error) {
    renderPanel50Progress({ phase: "Erro", current: 0, total: 1, detail: friendlyError(error.message), error: true });
    toast(error.message);
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
    renderUploadProgress({ phase: "Iniciando envio", current: 0, total: rows.length, detail: "Preparando arquivos.", etaMs: 0 });
    if($("#submitBatchButton")) $("#submitBatchButton").disabled = true;
    if($("#uploadHint")) $("#uploadHint").textContent = "Enviando com lock global...";
    const result = await window.artBank.uploadBatch(rows);
    if($("#uploadHint")) $("#uploadHint").textContent = `${result.successes.length} enviadas, ${result.failures.length} falhas.`;
    
    // Atualiza cache rapidamente apos envio
    state.cache = await window.artBank.runSync().catch(() => state.cache);
    
    await refreshArtworks({ force: true });
    await refreshDashboardData();
    toast("Envio finalizado.");
  } catch (error) {
    renderUploadProgress({ phase: "Falha no envio", current: 0, total: rows.length, detail: friendlyError(error.message), etaMs: 0, error: true });
    if($("#uploadHint")) $("#uploadHint").textContent = friendlyError(error.message);
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
    state.financePreview = await window.artBank.previewFinanceOrder(state.financeItems);
    renderFinancePreview();
    updateFinanceSummary(state.financePreview);
  } catch (error) {
    toast(error.message);
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

async function copyFinanceOrder() {
  const ids = selectedFinanceIds();
  if (!ids.length) return toast("Adicione pelo menos uma arte.");
  const clientQuery = $("#financeClientInput")?.value.trim();
  if (!clientQuery) return toast("Escolha ou informe o cliente.");
  const button = $("#financeCopyButton");
  const original = button?.textContent || "Lançar Pedido";
  try {
    if (button) {
      button.disabled = true;
      button.textContent = "Lançando...";
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
  }
}

function clearBatch() {
  state.rows = [];
  state.files = [];
  renderRows();
}

function addBlankRow() {
  if (!state.config?.allowManualBatch) {
    toast("Cadastro manual desativado nas configurações.");
    return;
  }
  state.rows.push({
    selected: true,
    fileName: "Cadastro manual",
    path: "",
    previewUrl: "",
    id: "",
    theme: "",
    product: "",
    size: "",
    client: "",
    phone: "",
    valid: false,
    errors: ["Preencha os campos obrigatórios."],
  });
  setMode("manual");
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

function openLocalPreview(row) {
  if(!$("#previewModal")) return;
  $("#previewModal").classList.remove("hidden");
  $("#drivePreviewFrame").classList.add("hidden");
  $("#localPreviewImage").classList.remove("hidden");
  $("#localPreviewImage").src = row.previewUrl || row.originalUrl || "";
}

function openDrivePreview(url) {
  if (!url || !$("#previewModal")) return toast("Esta arte não tem URL.");
  $("#previewModal").classList.remove("hidden");
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

function artThumb(url) {
  const preview = imagePreviewUrl(url);
  if (!preview) return `<span style="color:var(--text-3);font-size:11px">-</span>`;
  return `<button class="thumb-button" data-preview-drive="${escapeHtml(url)}"><img class="art-thumb" src="${escapeHtml(preview)}" alt="Prévia" /></button>`;
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
  const text = String(message || "");
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
