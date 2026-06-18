function formatKitPieceName(filename, kitId) {
  if (!filename) return "DESCONHECIDO";
  let name = filename.replace(/\.[^/.]+$/, ""); // strip extension
  const regex = new RegExp(`^${kitId}[\\s_\\-]*`, 'i');
  name = name.replace(regex, ""); // strip prefix ID
  name = name.replace(/[_\-]/g, " ").replace(/\s+/g, " ").trim(); // clean separators
  return name.toUpperCase();
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
  if ($("#financeBulkInput")) $("#financeBulkInput").value = "";
  const feedbackBox = $("#bulkInputFeedback");
  if (feedbackBox) {
    feedbackBox.innerHTML = "";
    feedbackBox.classList.add("hidden");
  }
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

let isSearchingFinance = false;

async function handleFinanceCodeKey(event) {
  if (event.key !== "Enter") return;
  if (isSearchingFinance) return;
  event.preventDefault();
  
  const input = event.currentTarget;
  const id = String(input.value || "").trim();
  if (!id) return;
  if (!/^\d+$/.test(id)) {
    toast("Digite apenas o código numérico da arte.");
    return;
  }
  
  isSearchingFinance = true;
  input.disabled = true;
  input.value = "";
  
  setBusy("Buscando arte...");
  try {
    const previewArray = await window.artBank.previewFinanceOrder([id]);
    const item = previewArray && previewArray[0];
    if (!item || !item.found) {
      toast(`Arte ${id} não encontrada no banco.`);
      return;
    }
    
    if (item.previews && item.previews.length > 1) {
      openKitModal(item);
    } else {
      const uid = id + "_" + Date.now();
      state.financeItems.push({ uid, id, quantity: 1, files: item.files });
      state.financePreview.push({ ...item, uid, quantity: 1, files: item.files });
      renderFinancePreview();
      updateFinanceSummary();
    }
  } catch (error) {
    toast(error.message);
  } finally {
    isSearchingFinance = false;
    if (input) {
      input.disabled = false;
      input.focus();
    }
    clearBusy();
  }
}

function openKitModal(item) {
  state.currentKit = item;
  const grid = $("#kitModalGrid");
  if (!grid) return;
  grid.innerHTML = item.previews.map((preview, index) => `
    <div class="kit-piece-card selected" data-index="${index}">
      <div class="kit-piece-thumb">
        <img src="${escapeHtml(preview.previewUrl)}" alt="${escapeHtml(preview.name)}" onclick="event.stopPropagation(); showPreview('${escapeHtml(preview.previewUrl)}')"/>
        <div class="kit-piece-badge"><svg viewBox="0 0 24 24"><path d="M9 16.2L4.8 12l-1.4 1.4L9 19 21 7l-1.4-1.4L9 16.2z"/></svg></div>
      </div>
      <div class="kit-piece-name">${escapeHtml(preview.name)}</div>
      <div class="field-actions" style="margin-top: 4px; justify-content: center;">
        <button type="button" class="tiny-button" onclick="event.stopPropagation(); changeKitQty(${index}, -1)">-</button>
        <span id="kitQty_${index}" style="font-size: 13px; font-weight: 800; min-width: 16px; text-align: center;">1</span>
        <button type="button" class="tiny-button" onclick="event.stopPropagation(); changeKitQty(${index}, 1)">+</button>
      </div>
    </div>
  `).join("");
  
  $$(".kit-piece-card").forEach(card => {
    card.addEventListener("click", () => {
      card.classList.toggle("selected");
    });
  });

  $("#kitModal")?.classList.remove("hidden");
  setTimeout(() => $("#kitModal")?.classList.add("is-open"), 20);
}

window.changeKitQty = function(index, delta) {
  const span = $(`#kitQty_${index}`);
  if (!span) return;
  let q = parseInt(span.textContent, 10) + delta;
  if (q < 1) q = 1;
  span.textContent = q;
};

$("#closeKitModalButton")?.addEventListener("click", closeKitModal);
$("#cancelKitModalButton")?.addEventListener("click", closeKitModal);
$("#confirmKitModalButton")?.addEventListener("click", confirmKitSelection);

function closeKitModal() {
  $("#kitModal")?.classList.remove("is-open");
  setTimeout(() => $("#kitModal")?.classList.add("hidden"), 160);
  state.currentKit = null;
}

function confirmKitSelection() {
  if (!state.currentKit) return;
  const cards = $(".kit-piece-card.selected");
  if (!cards.length) {
    toast("Selecione pelo menos um arquivo do kit.");
    return;
  }
  
  cards.forEach(card => {
    const index = parseInt(card.dataset.index, 10);
    const qtySpan = $(`#kitQty_${index}`);
    const quantity = qtySpan ? parseInt(qtySpan.textContent, 10) : 1;
    const preview = state.currentKit.previews[index];
    
    const uid = state.currentKit.id + "_" + Date.now() + "_" + index;
    const subItem = { uid, id: state.currentKit.id, quantity, files: [preview.path] };
    state.financeItems.push(subItem);
    state.financePreview.push({ ...state.currentKit, uid, quantity, files: [preview.path], previews: [preview] });
  });
  
  renderFinancePreview();
  updateFinanceSummary();
  closeKitModal();
}

async function refreshFinancePreview() {
  if (!state.financeItems.length) {
    state.financePreview = [];
    renderFinancePreview();
    updateFinanceSummary();
    return;
  }
  
  // Normalize legacy string items to new object structure
  state.financeItems = state.financeItems.map((item, index) => {
    if (typeof item === "string") {
      return { uid: item + "_" + Date.now() + "_" + index, id: item, quantity: 1, files: null };
    }
    return item;
  });

  try {
    renderFinancePreviewSkeleton();
    // Re-bind the UIDs and quantities to the preview results from the backend
    const uniqueIds = [...new Set(state.financeItems.map(i => i.id))];
    const rawPreviews = await window.artBank.previewFinanceOrder(uniqueIds);
    
    state.financePreview = state.financeItems.map(reqItem => {
      const backendData = rawPreviews.find(p => p.id === reqItem.id);
      if (!backendData) return { id: reqItem.id, uid: reqItem.uid, quantity: reqItem.quantity, found: false };
      
      const specificPreviews = reqItem.files ? backendData.previews.filter(p => reqItem.files.includes(p.path)) : backendData.previews;
      return {
        ...backendData,
        uid: reqItem.uid,
        quantity: reqItem.quantity,
        previews: specificPreviews.length ? specificPreviews : backendData.previews
      };
    });
    
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
  if (!grid) return;
  if (!state.financePreview.length) {
    grid.innerHTML = `<div class="order-empty">Digite um ID e aperte Enter para adicionar artes.</div>`;
    if ($("#financeSelectedCount")) $("#financeSelectedCount").textContent = "0 selecionadas";
    return;
  }
  grid.innerHTML = state.financePreview.map((item) => {
    const preview = item.previews?.[0];
    return `
      <article class="order-art-card ${item.found ? "" : "is-missing"}">
        <div class="order-art-thumb">${preview ? `<img src="${escapeHtml(preview.previewUrl)}" alt="${escapeHtml(preview.name)}" style="cursor:pointer" onclick="showPreview('${escapeHtml(preview.previewUrl)}')"/>` : `<span>Sem imagem</span>`}</div>
        <div class="order-art-meta">
          <strong>${escapeHtml(item.id)} ${item.quantity > 1 ? `<span class="tagOk">x${item.quantity}</span>` : ""}</strong>
          <span style="font-size:11px;word-break:break-all">${preview ? escapeHtml(preview.name) : escapeHtml(item.theme || "Não encontrado")}</span>
        </div>
        <div class="field-actions">
          <button class="tiny-button" type="button" onclick="changeFinanceItemQuantity('${escapeHtml(item.uid)}', -1)">-</button>
          <button class="tiny-button" type="button" onclick="changeFinanceItemQuantity('${escapeHtml(item.uid)}', 1)">+</button>
          <button class="tiny-button" type="button" onclick="removeFinanceItem('${escapeHtml(item.uid)}')">X</button>
        </div>
      </article>
    `;
  }).join("");
  checklist.classList.toggle("hidden", state.financePreview.length <= 1);
  checklist.innerHTML = state.financePreview.length > 1 ? state.financePreview.map((item) => `
    <label class="order-check-row">
      <input type="checkbox" checked data-finance-check="${escapeHtml(item.uid)}" />
      <span>${escapeHtml(item.id)} · ${item.previews?.[0] ? escapeHtml(item.previews[0].name) : escapeHtml(item.theme || "sem tema")}</span>
    </label>
  `).join("") : "";
  $$("[data-finance-check]").forEach((input) => input.addEventListener("change", updateFinanceSelectedCount));
  updateFinanceSelectedCount();
}

function selectedFinanceItems() {
  const checks = $("[data-finance-check]");
  if (!checks.length) return [...state.financeItems];
  const uids = checks.filter((input) => input.checked).map((input) => input.dataset.financeCheck);
  return state.financeItems.filter(item => uids.includes(item.uid));
}

function updateFinanceSelectedCount() {
  const total = selectedFinanceItems().length;
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

// Duplicated removeFinanceItem was here. Removing string version.

async function copyFinanceOrder() {
  const items = selectedFinanceItems();
  if (!items.length) return toast("Adicione pelo menos uma arte.");
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
      ids: items, // Passing the actual objects with {id, files, quantity}
    });
    toast(`Pedido lançado: ${result.copied.length} cópia(s) para ${result.client.label}.`);
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

// Start the application boot process when all modules are loaded.
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    if (typeof boot === 'function') boot();
  });
} else {
  if (typeof boot === 'function') boot();
}
