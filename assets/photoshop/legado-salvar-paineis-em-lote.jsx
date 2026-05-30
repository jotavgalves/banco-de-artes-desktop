#target photoshop
app.bringToFront();

(function () {
    // =========================
    // TEMPLATE MAP (seu LOG)
    // =========================
    var GROUP_50  = "PAINEL 50X50";
    var GROUP_150 = "PAINEL 150X150";

    var SO_PATH_50  = [GROUP_50,  "PAINEL",           "PONHA O 150 NESSE SMART OBJECT"];
    var SO_PATH_150 = [GROUP_150, "MÁSCARA DE CORTE", "PONHA O 150 NESSE SMART OBJECT"];

    var CODE_GROUP_PATH_50  = [GROUP_50,  "CÓDIGO"]; // dentro: 1 TextLayer (ex "999")
    var CODE_GROUP_PATH_150 = [GROUP_150, "CÓDIGO"];

    // =========================
    // CONFIG
    // =========================
    var JPG_QUALITY   = 10;    // 0..12
    var PURGE_EVERY   = 15;    // caches a cada N artes
    var MIN_JPG_BYTES = 1024;  // integridade mínima

    // =========================
    // ESTADO / SEGURANÇA
    // =========================
    var oldDialogs = app.displayDialogs;
    var oldRuler   = app.preferences.rulerUnits;
    app.displayDialogs = DialogModes.NO;
    app.preferences.rulerUnits = Units.PIXELS;

    // =========================
    // UI (MENU)
    // =========================
    var ui = buildUI();
    if (!ui) { cleanup(); return; }

    var res = ui.show();
    if (res !== 1) { cleanup(); return; } // cancel

    var inputFolder  = ui.__data.inputFolder;
    var outputFolder = ui.__data.outputFolder;
    var startCode    = ui.__data.startCode;
    var do150        = ui.__data.do150;
    var do50         = ui.__data.do50;

    // Log persistente
    var logFile = new File(outputFolder.fsName + "/LOG_ERROS.txt");
    logFile.encoding = "UTF-8";

    // =========================
    // INPUT FILES
    // =========================
    var files = inputFolder.getFiles(function (f) {
        return (f instanceof File) && /\.(tif|tiff|jpg|jpeg)$/i.test(f.name);
    });

    if (!files || files.length === 0) {
        alert("Nenhum TIFF/JPEG encontrado na pasta de entrada.");
        cleanup();
        return;
    }

    // determinístico
    files.sort(function (a, b) {
        var an = a.name.toLowerCase(), bn = b.name.toLowerCase();
        return an < bn ? -1 : (an > bn ? 1 : 0);
    });

    // =========================
    // TEMPLATE
    // =========================
    var masterDoc = null;
    var masterOpenedByScript = false;

    if (app.documents.length > 0) {
        masterDoc = app.activeDocument;
    } else {
        var tpl = File.openDialog("Selecione o template (PSB/PSD)", "Photoshop Files:*.psb;*.psd");
        if (!tpl) { cleanup(); return; }
        masterDoc = app.open(tpl);
        masterOpenedByScript = true;
    }

    // =========================
    // VALIDAR TOP-LEVEL GROUPS NO MASTER
    // =========================
    var g150Master = findTopLevelLayerSetByName(masterDoc, GROUP_150);
    var g50Master  = findTopLevelLayerSetByName(masterDoc, GROUP_50);

    if (!g150Master) { abort("Grupo TOP-LEVEL não encontrado: " + GROUP_150); return; }
    if (!g50Master)  { abort("Grupo TOP-LEVEL não encontrado: " + GROUP_50);  return; }

    // validar alvos conforme seleção
    if (do150) {
        var so150Master = getLayerByPath(masterDoc, SO_PATH_150) || recursiveLayerSearch(masterDoc, SO_PATH_150[SO_PATH_150.length - 1]);
        if (!isSmartObjectLayer(so150Master)) { abort("SO 150 inválido/inexistente:\n" + SO_PATH_150.join(" > ")); return; }

        var cg150Master = getLayerByPath(masterDoc, CODE_GROUP_PATH_150) || recursiveLayerSearch(masterDoc, CODE_GROUP_PATH_150[CODE_GROUP_PATH_150.length - 1]);
        if (!cg150Master || cg150Master.typename !== "LayerSet" || !findFirstTextLayer(cg150Master)) {
            abort("Grupo/Camada de texto do código (150) não encontrada:\n" + CODE_GROUP_PATH_150.join(" > "));
            return;
        }
    }

    if (do50) {
        var so50Master = getLayerByPath(masterDoc, SO_PATH_50) || recursiveLayerSearch(masterDoc, SO_PATH_50[SO_PATH_50.length - 1]);
        if (!isSmartObjectLayer(so50Master)) { abort("SO 50 inválido/inexistente:\n" + SO_PATH_50.join(" > ")); return; }

        var cg50Master = getLayerByPath(masterDoc, CODE_GROUP_PATH_50) || recursiveLayerSearch(masterDoc, CODE_GROUP_PATH_50[CODE_GROUP_PATH_50.length - 1]);
        if (!cg50Master || cg50Master.typename !== "LayerSet" || !findFirstTextLayer(cg50Master)) {
            abort("Grupo/Camada de texto do código (50) não encontrada:\n" + CODE_GROUP_PATH_50.join(" > "));
            return;
        }
    }

    // =========================
    // PROGRESS UI
    // =========================
    var pui = createProgressUI(files.length);

    // =========================
    // LOOP
    // =========================
    var processedArts = 0, failedArts = 0;
    var code = startCode;

    for (var i = 0; i < files.length; i++) {
        var artFile = files[i];
        var workDoc = null;

        updateProgressUI(pui, i + 1, files.length, artFile.name, code);

        try {
            // código livre considerando outputs necessários
            code = findNextFreeCode(code, outputFolder, do150, do50);

            // duplicar template
            app.activeDocument = masterDoc;
            workDoc = masterDoc.duplicate("TMP_" + code, false);
            app.activeDocument = workDoc;

            // TOP-LEVEL groups no duplicado (garantia de não pegar errado)
            var g150 = findTopLevelLayerSetByName(workDoc, GROUP_150);
            var g50  = findTopLevelLayerSetByName(workDoc, GROUP_50);
            if (!g150) throw new Error("Grupo 150 TOP-LEVEL ausente no duplicado.");
            if (!g50)  throw new Error("Grupo 50 TOP-LEVEL ausente no duplicado.");

            // 1) aplicar arte/código nos grupos selecionados
            if (do150) {
                var so150 = getLayerByPath(workDoc, SO_PATH_150) || recursiveLayerSearch(workDoc, SO_PATH_150[SO_PATH_150.length - 1]);
                if (!isSmartObjectLayer(so150)) throw new Error("SO 150 inválido no duplicado.");

                normalizeAndRestore(so150, function () {
                    app.activeDocument = workDoc;
                    workDoc.activeLayer = so150;
                    replaceSmartObjectContents(artFile);
                });

                var cg150 = getLayerByPath(workDoc, CODE_GROUP_PATH_150) || recursiveLayerSearch(workDoc, CODE_GROUP_PATH_150[CODE_GROUP_PATH_150.length - 1]);
                var tx150 = cg150 ? findFirstTextLayer(cg150) : null;
                if (!tx150) throw new Error("TextLayer do código (150) não encontrado no duplicado.");

                normalizeAndRestore(tx150, function () {
                    tx150.textItem.contents = String(code);
                });
            }

            if (do50) {
                var so50 = getLayerByPath(workDoc, SO_PATH_50) || recursiveLayerSearch(workDoc, SO_PATH_50[SO_PATH_50.length - 1]);
                if (!isSmartObjectLayer(so50)) throw new Error("SO 50 inválido no duplicado.");

                normalizeAndRestore(so50, function () {
                    app.activeDocument = workDoc;
                    workDoc.activeLayer = so50;
                    replaceSmartObjectContents(artFile);
                });

                var cg50 = getLayerByPath(workDoc, CODE_GROUP_PATH_50) || recursiveLayerSearch(workDoc, CODE_GROUP_PATH_50[CODE_GROUP_PATH_50.length - 1]);
                var tx50 = cg50 ? findFirstTextLayer(cg50) : null;
                if (!tx50) throw new Error("TextLayer do código (50) não encontrado no duplicado.");

                normalizeAndRestore(tx50, function () {
                    tx50.textItem.contents = String(code);
                });
            }

            // 2) EXPORT com GARANTIA: antes de cada save, o outro grupo está invisível.
            var savedCount = 0;

            if (do150 && !do50) {
                showOnlyAndAssert(workDoc, g150, g50, "150");
                var f150 = new File(outputFolder.fsName + "/" + code + "_150.jpg");
                saveActiveDocAsJPEGWithIntegrity(workDoc, f150);
                savedCount++;

            } else if (do50 && !do150) {
                showOnlyAndAssert(workDoc, g50, g150, "50X50");
                var f50 = new File(outputFolder.fsName + "/" + code + "_50X50.jpg");
                saveActiveDocAsJPEGWithIntegrity(workDoc, f50);
                savedCount++;

            } else if (do150 && do50) {
                // salvar 150
                showOnlyAndAssert(workDoc, g150, g50, "150");
                var f150a = new File(outputFolder.fsName + "/" + code + "_150.jpg");
                saveActiveDocAsJPEGWithIntegrity(workDoc, f150a);
                savedCount++;

                // salvar 50
                showOnlyAndAssert(workDoc, g50, g150, "50X50");
                var f50a = new File(outputFolder.fsName + "/" + code + "_50X50.jpg");
                saveActiveDocAsJPEGWithIntegrity(workDoc, f50a);
                savedCount++;
            }

            if (savedCount === 0) throw new Error("Nenhum grupo selecionado para salvar.");

            processedArts++;
            code++; // só incrementa após sucesso total

        } catch (e) {
            failedArts++;
            appendLog(logFile, artFile, e);
        } finally {
            if (workDoc) safeClose(workDoc, SaveOptions.DONOTSAVECHANGES);
        }

        if ((i + 1) % PURGE_EVERY === 0) {
            try { app.purge(PurgeTarget.ALLCACHES); } catch (_) {}
        }
    }

    closeProgressUI(pui);

    if (masterOpenedByScript && masterDoc) safeClose(masterDoc, SaveOptions.DONOTSAVECHANGES);

    cleanup();

    var msg = "Finalizado.\nArtes processadas: " + processedArts + "\nFalhas: " + failedArts + "\nSaída: " + outputFolder.fsName;
    if (failedArts > 0) msg += "\n\nConsulte LOG_ERROS.txt na pasta de saída.";
    alert(msg);

    // =========================
    // VISIBILIDADE: FORÇA + ASSERT
    // =========================
    function showOnlyAndAssert(doc, showGroup, hideGroup, label) {
        app.activeDocument = doc;

        // Força cadeia de pais para o que vai aparecer
        forceVisibleWithParents(showGroup, true);
        // Garante ocultação do outro
        forceVisibleWithParents(hideGroup, false);

        // ASSERT duro: se isso falhar, NÃO salva.
        if (!showGroup.visible) throw new Error("VISIBILIDADE FALHOU: era pra mostrar " + label);
        if (hideGroup.visible)  throw new Error("VISIBILIDADE FALHOU: era pra esconder o outro (" + label + ")");

        // “tapa” extra: ajuda alguns builds a aplicar estado interno antes do save
        try { doc.activeLayer = showGroup; } catch (_) {}
    }

    function forceVisibleWithParents(layerSet, makeVisible) {
        if (!layerSet) return;

        if (makeVisible) {
            // sobe a cadeia ligando pais (LayerSet)
            var chain = [];
            var p = layerSet;
            while (p && p.typename === "LayerSet") {
                chain.push(p);
                p = p.parent;
            }
            for (var i = chain.length - 1; i >= 0; i--) {
                try { chain[i].allLocked = false; } catch (_) {}
                chain[i].visible = true;
            }
        } else {
            try { layerSet.allLocked = false; } catch (_) {}
            layerSet.visible = false;
        }
    }

    function saveActiveDocAsJPEGWithIntegrity(doc, outFile) {
        app.activeDocument = doc;
        saveActiveDocAsJPEG(outFile, JPG_QUALITY);
        if (!outFile.exists || outFile.length < MIN_JPG_BYTES) {
            throw new Error("JPEG não gravado ou corrompido: " + outFile.name);
        }
    }

    // =========================
    // NÃO REPETIR CÓDIGO
    // =========================
    function findNextFreeCode(codeStart, folder, need150, need50) {
        var c = codeStart;
        while (true) {
            var clash = false;
            if (need150 && (new File(folder.fsName + "/" + c + "_150.jpg").exists)) clash = true;
            if (!clash && need50 && (new File(folder.fsName + "/" + c + "_50X50.jpg").exists)) clash = true;
            if (!clash) return c;
            c++;
        }
    }

    // =========================
    // UI
    // =========================
    function buildUI() {
        try {
            var w = new Window("dialog", "Gerador de Mockups (50x50 / 150x150)", undefined, { closeButton: true });
            w.orientation = "column";
            w.alignChildren = "fill";
            w.__data = { inputFolder: null, outputFolder: null, startCode: null, do150: false, do50: false };

            // Entrada
            var pIn = w.add("panel", undefined, "Pasta de entrada (obrigatório)");
            pIn.orientation = "row";
            pIn.alignChildren = ["fill","center"];
            var inPath = pIn.add("edittext", undefined, "");
            inPath.characters = 55;
            inPath.enabled = false;
            var btnIn = pIn.add("button", undefined, "Selecionar...");
            btnIn.onClick = function () {
                var f = Folder.selectDialog("Selecione a pasta de ENTRADA");
                if (f) { w.__data.inputFolder = f; inPath.text = f.fsName; refreshOk(); }
            };

            // Saída
            var pOut = w.add("panel", undefined, "Pasta de saída (obrigatório)");
            pOut.orientation = "column";
            pOut.alignChildren = "fill";

            var rowMode = pOut.add("group"); rowMode.orientation = "row";
            var rbSelect = rowMode.add("radiobutton", undefined, "Indicar pasta existente");
            var rbCreate = rowMode.add("radiobutton", undefined, "Criar pasta dentro de...");
            rbCreate.value = true;

            var gSelect = pOut.add("group"); gSelect.orientation = "row"; gSelect.alignChildren = ["fill","center"];
            var outPath = gSelect.add("edittext", undefined, ""); outPath.characters = 55; outPath.enabled = false;
            var btnOut = gSelect.add("button", undefined, "Selecionar...");

            var gCreate = pOut.add("group"); gCreate.orientation = "row"; gCreate.alignChildren = ["fill","center"];
            var parentPath = gCreate.add("edittext", undefined, ""); parentPath.characters = 40; parentPath.enabled = false;
            var btnParent = gCreate.add("button", undefined, "Pasta pai...");
            gCreate.add("statictext", undefined, "Nome:");
            var outName = gCreate.add("edittext", undefined, "OUTPUT"); outName.characters = 12;

            var parentFolder = null, selectedOutFolder = null;

            btnOut.onClick = function () {
                var f = Folder.selectDialog("Selecione a pasta de SAÍDA");
                if (f) { selectedOutFolder = f; outPath.text = f.fsName; refreshOk(); }
            };
            btnParent.onClick = function () {
                var f = Folder.selectDialog("Selecione a pasta PAI");
                if (f) { parentFolder = f; parentPath.text = f.fsName; refreshOk(); }
            };

            function syncOutMode() {
                var selectMode = rbSelect.value === true;
                gSelect.enabled = selectMode;
                gCreate.enabled = !selectMode;
                refreshOk();
            }
            rbSelect.onClick = syncOutMode;
            rbCreate.onClick = syncOutMode;
            outName.onChanging = function () { refreshOk(); };

            // Código
            var pCode = w.add("panel", undefined, "Código inicial (obrigatório, somente números)");
            pCode.orientation = "row"; pCode.alignChildren = ["left","center"];
            var codeField = pCode.add("edittext", undefined, ""); codeField.characters = 14;
            codeField.onChanging = function () {
                var s = codeField.text;
                var filtered = s.replace(/[^\d]/g, "");
                if (filtered !== s) codeField.text = filtered;
                refreshOk();
            };

            // Grupos interessados
            var pGrp = w.add("panel", undefined, "Grupos interessados (marque ao menos 1)");
            pGrp.orientation = "column"; pGrp.alignChildren = "left";
            var cb150 = pGrp.add("checkbox", undefined, "PAINEL 150X150"); cb150.value = false;
            var cb50  = pGrp.add("checkbox", undefined, "PAINEL 50X50");   cb50.value = false;
            cb150.onClick = refreshOk;
            cb50.onClick  = refreshOk;

            // Botões
            var gBtns = w.add("group"); gBtns.alignment = "right";
            var btnCancel = gBtns.add("button", undefined, "Cancelar", { name: "cancel" });
            var btnOk     = gBtns.add("button", undefined, "Executar", { name: "ok" });
            btnOk.enabled = false;
            btnCancel.onClick = function () { w.close(0); };

            btnOk.onClick = function () {
                var outFinal = null;

                if (rbSelect.value) {
                    outFinal = selectedOutFolder;
                    if (!outFinal) { alert("Selecione uma pasta de saída."); return; }
                } else {
                    if (!parentFolder) { alert("Selecione a pasta pai para criar a saída."); return; }
                    var nm = trim(outName.text);
                    if (!nm) { alert("Nome da pasta de saída inválido."); return; }
                    if (/[\/\\:\*\?"<>\|]/.test(nm)) { alert("Nome de pasta contém caracteres inválidos."); return; }
                    outFinal = new Folder(parentFolder.fsName + "/" + nm);
                    if (!outFinal.exists) {
                        if (!outFinal.create()) { alert("Não foi possível criar a pasta:\n" + outFinal.fsName); return; }
                    }
                }

                if (!testWrite(outFinal)) { alert("Sem permissão de escrita:\n" + outFinal.fsName); return; }
                if (!w.__data.inputFolder) { alert("Selecione pasta de entrada."); return; }

                var c = codeField.text;
                if (!c || !/^\d+$/.test(c)) { alert("Código inicial deve ser somente números."); return; }
                if (!cb150.value && !cb50.value) { alert("Marque ao menos 1 grupo interessado."); return; }

                w.__data.outputFolder = outFinal;
                w.__data.startCode = parseInt(c, 10);
                w.__data.do150 = cb150.value;
                w.__data.do50  = cb50.value;

                w.close(1);
            };

            function refreshOk() {
                var ok = true;
                if (!w.__data.inputFolder) ok = false;

                if (rbSelect.value) {
                    if (!selectedOutFolder) ok = false;
                } else {
                    if (!parentFolder) ok = false;
                    var nm = trim(outName.text);
                    if (!nm) ok = false;
                    if (/[\/\\:\*\?"<>\|]/.test(nm)) ok = false;
                }

                var c = codeField.text;
                if (!c || !/^\d+$/.test(c)) ok = false;
                if (!cb150.value && !cb50.value) ok = false;

                btnOk.enabled = ok;
            }

            syncOutMode();
            refreshOk();
            return w;

        } catch (e) {
            alert("Falha ao criar UI.\n" + e.message);
            return null;
        }
    }

    function trim(s) { return String(s).replace(/^\s+|\s+$/g, ""); }

    function testWrite(folder) {
        var f = new File(folder.fsName + "/.__test_write.tmp");
        try { f.open("w"); f.write("ok"); f.close(); f.remove(); return true; }
        catch (e) { try { if (f.exists) f.remove(); } catch (_) {} return false; }
    }

    // =========================
    // LAYER SEARCH
    // =========================
    function stripAccents(str) {
        return String(str)
            .replace(/[àáâãäå]/gi, "a")
            .replace(/[èéêë]/gi,   "e")
            .replace(/[ìíîï]/gi,   "i")
            .replace(/[òóôõö]/gi,  "o")
            .replace(/[ùúûü]/gi,   "u")
            .replace(/[ç]/gi,      "c")
            .replace(/[ñ]/gi,      "n")
            .toUpperCase();
    }

    function findTopLevelLayerSetByName(doc, name) {
        var nn = stripAccents(name);
        for (var i = 0; i < doc.layers.length; i++) {
            var l = doc.layers[i];
            if (l.typename === "LayerSet" && stripAccents(l.name) === nn) return l;
        }
        return null;
    }

    function findDirectChildByName(container, name) {
        var layers = container.layers;
        var nn = stripAccents(name);
        for (var i = 0; i < layers.length; i++) {
            if (stripAccents(layers[i].name) === nn) return layers[i];
        }
        return null;
    }

    function getLayerByPath(doc, pathArr) {
        var cur = doc;
        for (var p = 0; p < pathArr.length; p++) {
            var next = findDirectChildByName(cur, pathArr[p]);
            if (!next) return null;
            cur = next;
        }
        return cur;
    }

    function recursiveLayerSearch(container, name) {
        var layers = container.layers;
        var nn = stripAccents(name);
        for (var i = 0; i < layers.length; i++) {
            var l = layers[i];
            if (stripAccents(l.name) === nn) return l;
            if (l.typename === "LayerSet") {
                var found = recursiveLayerSearch(l, name);
                if (found) return found;
            }
        }
        return null;
    }

    function findFirstTextLayer(layerSet) {
        var layers = layerSet.layers;
        for (var i = 0; i < layers.length; i++) {
            var l = layers[i];
            if (l.typename === "ArtLayer" && l.kind === LayerKind.TEXT) return l;
            if (l.typename === "LayerSet") {
                var hit = findFirstTextLayer(l);
                if (hit) return hit;
            }
        }
        return null;
    }

    function isSmartObjectLayer(l) {
        return l && l.typename === "ArtLayer" && l.kind === LayerKind.SMARTOBJECT;
    }

    // =========================
    // LOCK/VISIBLE RESTORE (para replace/text)
    // =========================
    function normalizeAndRestore(layer, action) {
        var wasLocked  = layer.allLocked;
        var wasVisible = layer.visible;

        var parents = [];
        var parent = layer.parent;
        while (parent && parent.typename === "LayerSet") {
            parents.push({ ref: parent, locked: parent.allLocked, visible: parent.visible });
            parent.allLocked = false;
            parent.visible = true;
            parent = parent.parent;
        }

        layer.allLocked = false;
        layer.visible = true;

        action();

        layer.allLocked = wasLocked;
        layer.visible = wasVisible;

        for (var i = parents.length - 1; i >= 0; i--) {
            parents[i].ref.allLocked = parents[i].locked;
            parents[i].ref.visible = parents[i].visible;
        }
    }

    // =========================
    // ACTIONS
    // =========================
    function replaceSmartObjectContents(file) {
        var id = stringIDToTypeID("placedLayerReplaceContents");
        var desc = new ActionDescriptor();
        desc.putPath(charIDToTypeID("null"), file);
        executeAction(id, desc, DialogModes.NO);
    }

    function saveActiveDocAsJPEG(outFile, quality) {
        var opt = new JPEGSaveOptions();
        opt.quality = Math.max(0, Math.min(12, quality));
        opt.embedColorProfile = true;
        opt.formatOptions = FormatOptions.STANDARDBASELINE;
        opt.matte = MatteType.NONE;
        app.activeDocument.saveAs(outFile, opt, true, Extension.LOWERCASE);
    }

    // =========================
    // PROGRESS UI
    // =========================
    function createProgressUI(total) {
        try {
            var win = new Window("palette", "Processando...", undefined, { closeButton: false });
            win.orientation = "column";
            win.alignChildren = "fill";
            var lbl = win.add("statictext", [0, 0, 560, 20], "Iniciando...");
            var bar = win.add("progressbar", [0, 0, 560, 20], 0, total);
            win.show();
            return { win: win, lbl: lbl, bar: bar };
        } catch (_) { return null; }
    }

    function updateProgressUI(pui, cur, total, fileName, code) {
        if (!pui) return;
        try {
            pui.lbl.text = "(" + cur + "/" + total + ") " + fileName + " | Código: " + code;
            pui.bar.value = cur - 1;
            pui.win.update();
        } catch (_) {}
    }

    function closeProgressUI(pui) {
        if (!pui) return;
        try { pui.win.close(); } catch (_) {}
    }

    // =========================
    // LOG / CLEANUP / ABORT
    // =========================
    function appendLog(f, artFile, e) {
        try {
            f.open("a");
            f.writeln(
                "[" + (new Date()).toUTCString() + "] " +
                artFile.name +
                " | " + (e && e.message ? e.message : String(e)) +
                " | linha: " + (e && e.line ? e.line : "n/d") +
                " | arquivo: " + (e && e.fileName ? e.fileName : "n/d")
            );
            f.close();
        } catch (_) {}
    }

    function safeClose(doc, saveOpt) { try { doc.close(saveOpt); } catch (_) {} }

    function abort(msg) {
        alert(msg);
        try { if (masterOpenedByScript && masterDoc) safeClose(masterDoc, SaveOptions.DONOTSAVECHANGES); } catch (_) {}
        cleanup();
    }

    function cleanup() {
        app.displayDialogs = oldDialogs;
        app.preferences.rulerUnits = oldRuler;
    }

})();