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

function nextAvailableDashboardId(maxId) {
  const reserved = new Set((state.reservations || []).flatMap((reservation) => reservation.ids || []).map(Number));
  let next = Math.max(1, Number(maxId || 0) + 1);
  while (reserved.has(next)) next += 1;
  return next;
}

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

async function refreshArtworks(options = {}) {
  const { force = false, showLoading = false } = options;
  const isFirstLoad = !state.artworks || state.artworks.length === 0;
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
    if($("#artworkRows")) $("#artworkRows").innerHTML = `<tr><td colspan="9">${escapeHtml(friendlyError(error.message))}</td></tr>`;
    if ($("#artworkCardGrid")) $("#artworkCardGrid").innerHTML = `<div class="empty-state-block">Falha ao carregar: ${escapeHtml(friendlyError(error.message))}</div>`;
    toast(error.message);
    if (showLoading || force) finishActionProgress("Falha ao carregar banco visual.");
    return [];
  });
  if (!state.artworks.length) {
    if($("#artworkRows")) $("#artworkRows").innerHTML = `<tr><td colspan="9">Nenhuma arte carregada.</td></tr>`;
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
    if($("#artworkRows")) $("#artworkRows").innerHTML = `<tr><td colspan="9" style="text-align:center;padding:20px;color:var(--text-3)">Nenhuma arte corresponde aos filtros.</td></tr>`;
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
      <td title="${escapeHtml(art.size || "")}">${artCell(art.id, "size", art.size)}</td>
      <td title="${escapeHtml(art.client || "")}">${artCell(art.id, "client", art.client)}</td>
      <td title="${escapeHtml(art.user || "")}">${artCell(art.id, "user", art.user)}</td>
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
      <tr class="skeleton-row"><td colspan="9"><div class="skeleton skeleton-line wide"></div></td></tr>
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

function removeSelectedRows() {
  state.rows = state.rows.filter((row) => !row.selected);
  renderRows();
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
