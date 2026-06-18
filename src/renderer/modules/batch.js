function populateBatchProductFilter() {
  const products = state.config?.validProducts || [];
  const select = $("#batchFilterProduct");
  if (select) select.innerHTML = `<option value="all">Todos os produtos</option>` + products.map(p => `<option value="${escapeHtml(p)}">${escapeHtml(p)}</option>`).join("");
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
   row.sizeError = false;
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
    if($("#batchRows")) $("#batchRows").innerHTML = `<tr><td colspan="9" style="text-align:center;padding:16px;color:var(--text-3)">Nenhuma arte no lote corresponde.</td></tr>`;
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
        </tr>`;
      }).join("");
    }
  } else if ($("#batchRows")) {
    $("#batchRows").innerHTML = `<tr><td colspan="9" class="batch-empty-cell">Nenhuma imagem carregada. Clique em Validar lote para ler a pasta configurada.</td></tr>`;
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
  if (row.valid) return `<span class="state-pill ok">Apta</span>`;
  return `<span class="state-pill review" title="${escapeHtml(row.errors?.join("; ") || "Pendente")}">Revisar</span>`;
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
      const productFilter = document.getElementById("panel50ProductFilter")?.value;
      const scanResult = productFilter
        ? await window.artBank.scanImages({ folders, target: productFilter })
        : await window.artBank.scanImages(folders);
      state.files = productFilter ? scanResult.files : scanResult;

      if (productFilter && scanResult.rejected.length) {
        showWarningModal({
          title: "Arquivos ignorados",
          message: `Havia ${scanResult.rejected.length} arquivo(s) diferente(s) do público-alvo selecionado. Eles foram ignorados e não receberão ID.`,
          files: scanResult.rejected,
        });
      }

      if (!state.files.length) {
        state.rows = [];
        renderRows();
        const message = "Nenhuma imagem válida encontrada na pasta configurada.";
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
    product: $("#panel50ProductFilter")?.value.trim() || "bolinha",
    uploadAfter: $("#panel50UploadAfter")?.checked !== false,
  };
  try {
    if (!payload.inputFolder) {
      toast("Escolha uma pasta antes de executar a automação.");
      return;
    }
    const targetScan = await window.artBank.scanImages({
      folders: [payload.inputFolder],
      target: payload.product,
    });
    if (targetScan.rejected.length) {
      showWarningModal({
        title: "Arquivos ignorados",
        message: `Havia ${targetScan.rejected.length} arquivo(s) diferente(s) do público-alvo selecionado. Eles foram ignorados, não serão contados e não receberão ID.`,
        files: targetScan.rejected,
      });
    }
    if (!targetScan.files.length) {
      const message = "Nenhuma imagem da pasta corresponde ao público-alvo selecionado.";
      setBatchActionStatus(message);
      toast(message);
      return;
    }
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
    if (result.rejectedFiles?.length) {
      showWarningModal({
        title: "Arquivos ignorados",
        message: `A automação confirmou ${result.rejectedFiles.length} arquivo(s) fora do público-alvo. Eles permaneceram na pasta original e não receberam ID.`,
        files: result.rejectedFiles,
      });
    }
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

function clearBatch() {
  state.rows = [];
  state.files = [];
  renderRows();
  setBatchActionStatus("Escolha uma pasta e valide para carregar as artes.");
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

function formatTime(value) {
  return new Date(value).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
}
