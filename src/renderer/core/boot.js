async function boot() {
  installErrorLogging();
  bindNavigation();
  bindActions();
  bindFilters();
  await loadConfig();
  await loadBootstrap();

  let result = await window.artBank.currentSession();
  if (!result) result = await window.artBank.autoLoginDesktop();

  if (result && state.bootstrap.hasAdmin) {
    state.session = result.session;
    state.user = result.user;
    
    $("#loginScreen").classList.add("hidden");
    $("#appShell").classList.remove("hidden");
    $("#appShell").classList.remove("locked");
    const providerLabel = result.provider === "supabase" ? "Supabase" : "Local";
    $("#sidebarUser").textContent = `${state.user.name} (${state.user.role}) - ${providerLabel}`;
    
    if ($("#adminNav")) $("#adminNav").style.display = state.user.role === "admin" ? "grid" : "none";

    startHeartbeat();
    showView("artworks", "Banco de Artes");

    // Start background sync without awaiting so UI renders immediately
    initialDataLoad();
  } else {
    renderLoginMode();
  }
}

async function initialDataLoad() {
  const syncBtnSpan = $("#forceSyncButton span");
  if (syncBtnSpan) syncBtnSpan.textContent = "Sincronizando...";
  
  // Sincroniza dados em paralelo e silenciosamente
  try {
    state.cache = await window.artBank.runSync().catch(() => state.cache);
    await Promise.allSettled([
      refreshUsers(),
      refreshArtworks().then(() => refreshDashboardData()),
      refreshReservations(),
      refreshDriveFolders(),
      typeof refreshOrders === 'function' ? refreshOrders() : Promise.resolve(),
      refreshPresence()
    ]);
  } finally {
    if (syncBtnSpan) syncBtnSpan.textContent = "Sincronizar dados";
  }
}


function bindNavigation() {
  $$(".nav-item").forEach((button) => {
    button.addEventListener("click", () => {
      const view = button.dataset.view;
      showView(view, button.querySelector("span:last-child").textContent.trim());
      
      if (view === "batch") {
        window.artBank.runSync().then(c => { state.cache = c; }).catch(e => console.error(e));
        if (state.rows && state.rows.length) {
           state.rows.forEach(r => r.valid = validateRowLocal(r));
           renderRows();
        }
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

  // Auto-refresh silent trigger for views
  if (view === "users") refreshUsers();
  else if (view === "artworks") refreshArtworks();
  else if (view === "drive") refreshDriveFolders();
  else if (view === "reservations") refreshReservations();
  else if (view === "finance") {
    if (typeof refreshFinanceClients === "function") refreshFinanceClients();
    if (typeof refreshFinancePreview === "function") refreshFinancePreview();
  }
  else if (view === "audit") {
    if (typeof refreshAudit === "function") refreshAudit();
  }
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
