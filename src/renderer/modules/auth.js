async function recoverAdminAccess() {
  const form = $("#loginForm");
  form.elements.login.value = form.elements.login.value || "admin";
  form.elements.password.value = "";
  form.elements.password.placeholder = "Digite a chave de recuperação";
  form.elements.password.focus();
  toast("Digite a chave de recuperação no campo de senha e clique em Acessar.");
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
