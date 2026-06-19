async function loadConfig() {
  state.config = await window.artBank.getConfig();
  fillSettingsForm();
  renderConfig();
  populateBatchProductFilter();
  renderExternalLinks();
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
    driveFolderGeral: form.elements.driveFolderGeral?.value.trim(),
    driveFolderBolinhas: form.elements.driveFolderBolinhas?.value.trim(),
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
