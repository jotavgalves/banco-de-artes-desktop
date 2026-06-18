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
  const data = state.driveFolders || {};
  const bolinhas = data.bolinhas || { folders: [] };
  const geral = data.geral || { folders: [] };
  
  const query = ($("#driveSearch")?.value || "").toLowerCase().trim();
  
  const bFolders = bolinhas.folders.filter((f) => !query || String(f.name || "").toLowerCase().includes(query));
  const gFolders = geral.folders.filter((f) => !query || String(f.name || "").toLowerCase().includes(query));
  
  const totalShown = bFolders.length + gFolders.length;
  const totalTotal = bolinhas.folders.length + geral.folders.length;

  if ($("#driveSummary")) {
    $("#driveSummary").innerHTML = `
      <div class="drive-summary-card"><span>Raízes</span><strong title="Bolinhas e Geral">2 Pastas</strong></div>
      <div class="drive-summary-card"><span>Temas</span><strong>${totalShown} / ${totalTotal}</strong></div>
      <div class="drive-summary-card"><span>Cache</span><strong>${data.lastSync ? new Date(data.lastSync).toLocaleString("pt-BR") : "Ainda nao sincronizado"}</strong></div>
    `;
  }
  if ($("#driveFolderList")) {
    const activeTab = document.querySelector("#driveTabs button.active")?.dataset.driveTab || "bolinhas";
    const renderItems = (list) => {
      return list.map((folder) => `
        <article class="drive-card" style="display: flex; flex-direction: column; gap: 12px; min-width: 0; overflow: hidden;">
          <div class="drive-card-head" style="display: flex; align-items: center; gap: 10px; width: 100%; min-width: 0;">
            <div class="drive-folder-icon"><svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M10 4l2 2h8c1.1 0 2 .9 2 2v10c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2h6z"/></svg></div>
            <div class="drive-card-info" style="display: flex; flex-direction: column; gap: 2px; min-width: 0; flex: 1;">
              <strong style="line-height: 1.2; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; display: block; width: 100%;" title="${escapeHtml(folder.name || "-")}">${escapeHtml(folder.name || "-")}</strong>
              <span style="white-space: nowrap; overflow: hidden; text-overflow: ellipsis; display: block; width: 100%;">${Number(folder.imageCount || 0)} imagem(ns)${folder.folderCount ? ` e ${folder.folderCount} subpasta(s)` : ""}</span>
            </div>
          </div>
          <button class="secondary-button wide" style="width: 100%; margin-top: auto; display: block;" data-open-drive-folder="${escapeHtml(folder.url)}">Abrir pasta</button>
        </article>
      `).join("");
    };

    let html = "";
    if (activeTab === "bolinhas") {
      html = renderItems(bFolders);
    } else {
      html = renderItems(gFolders);
    }
    
    $("#driveFolderList").innerHTML = html || `<div class="diagnostic-item"><strong>Nenhuma pasta de tema encontrada</strong><span>Nenhum resultado para a aba atual ou busca.</span></div>`;
  }
  $$("[data-open-drive-folder]").forEach((button) => button.addEventListener("click", () => {
    window.artBank.openExternal(button.dataset.openDriveFolder);
  }));
}

// Add event listener binding for tabs
document.addEventListener("click", (e) => {
  const driveTabBtn = e.target.closest("#driveTabs button");
  if (driveTabBtn) {
    $$("#driveTabs button").forEach(b => b.classList.remove("active"));
    driveTabBtn.classList.add("active");
    renderDriveFolders();
  }
});

function openDriveRoot() {
  const data = state.driveFolders || {};
  const urlGeral = data.geral?.rootUrl;
  const urlBolinhas = data.bolinhas?.rootUrl;
  if (!urlGeral && !urlBolinhas) return toast("Sincronize as pastas primeiro.");
  if (urlGeral) window.artBank.openExternal(urlGeral);
  if (urlBolinhas) window.artBank.openExternal(urlBolinhas);
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
