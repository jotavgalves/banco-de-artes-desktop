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
  if ($("#headerSpinner")) {
    $("#headerSpinner").classList.remove("hidden");
    $("#headerSpinner").title = `${title}: ${detail}`;
  }
}

function updateActionProgress(percent = 0, detail = "") {
  if ($("#headerSpinner") && detail) {
    $("#headerSpinner").title = detail;
  }
}

function finishActionProgress(detail = "Concluído.") {
  if ($("#headerSpinner")) {
    $("#headerSpinner").classList.add("hidden");
  }
}

function toast(message, type = "info") {
  // Ensure toast container exists
  let container = $("#toastContainer");
  if (!container) {
    container = document.createElement("div");
    container.id = "toastContainer";
    container.style.position = "fixed";
    container.style.bottom = "20px";
    container.style.left = "50%";
    container.style.transform = "translateX(-50%)";
    container.style.zIndex = "130";
    document.body.appendChild(container);
  }

  const toastEl = document.createElement("div");
  toastEl.className = "toast";
  if (type === "success") toastEl.classList.add("success");
  else if (type === "error") toastEl.classList.add("error");
  toastEl.textContent = friendlyError(message);
  container.appendChild(toastEl);
  // Trigger reflow for transition
  void toastEl.offsetWidth;
  toastEl.classList.add("show");
  // Auto-remove after timeout
  setTimeout(() => {
    toastEl.classList.remove("show");
    setTimeout(() => toastEl.remove(), 300);
  }, 3500);
}

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

function friendlyError(error) {
  let text = String((error && error.message) ? error.message : (error || "Erro desconhecido"));
  text = text.replace(/^Error invoking remote method '[^']+':\s*/i, "");
  text = text.replace(/^Error:\s*/i, "");
  if (text.includes("No handler registered for")) {
    return "Falha de comunicação (novo recurso detectado). Reinicie o aplicativo completamente (feche e abra novamente) para carregar o novo código do backend.";
  }
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

function showWarningModal({ title = "Aviso", message = "", files = [] } = {}) {
  const modal = $("#warningModal");
  if (!modal) return;

  $("#warningTitle").textContent = title;
  $("#warningMessage").textContent = message;

  const fileList = $("#warningFileList");
  if (fileList) {
    fileList.innerHTML = files.map((file) => {
      const reasonParts = String(file.reason || "").split(/\s+—\s+esperado:\s+/i);
      const actualSize = file.actualSize || reasonParts[0] || "Medida não identificada";
      const expectedSize = file.expectedSize || reasonParts[1] || "Público-alvo selecionado";
      return `
      <div class="warning-file-item">
        <strong class="warning-file-name" title="${escapeHtml(file.name)}">${escapeHtml(file.name)}</strong>
        <div class="warning-file-measurements">
          <span class="warning-measurement">
            <small>Medida encontrada</small>
            <b>${escapeHtml(actualSize)}</b>
          </span>
          <span class="warning-measurement warning-measurement-expected">
            <small>Esperado</small>
            <b>${escapeHtml(expectedSize)}</b>
          </span>
        </div>
      </div>
    `;
    }).join("");
  }

  modal.classList.remove("hidden");
  setTimeout(() => modal.classList.add("is-open"), 20);

  const okBtn = $("#warningOkButton");
  if (okBtn) {
    okBtn.onclick = () => {
      modal.classList.remove("is-open");
      setTimeout(() => modal.classList.add("hidden"), 160);
    };
  }
}

window.showWarningModal = showWarningModal;
