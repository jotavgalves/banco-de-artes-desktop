const { JSDOM } = require("jsdom");

const html = `<!DOCTYPE html><html><body></body></html>`;
const dom = new JSDOM(html);
const document = dom.window.document;

function getCommonDiff(files) {
  if (files.length < 2) return files.map(f => ({ prefix: [], mid: f.name.split(' '), suffix: [] }));
  
  const tokenized = files.map(f => f.name.split(' '));
  let i = 0;
  let maxPrefix = Math.min(...tokenized.map(t => t.length));
  
  while (i < maxPrefix) {
    const token = tokenized[0][i];
    const allMatch = tokenized.every(t => t[i] === token);
    if (!allMatch) break;
    i++;
  }
  
  let j = 0;
  let maxSuffix = Math.min(...tokenized.map(t => t.length - i));
  while (j < maxSuffix) {
    const token = tokenized[0][tokenized[0].length - 1 - j];
    const allMatch = tokenized.every(t => t[t.length - 1 - j] === token);
    if (!allMatch) break;
    j++;
  }
  
  return tokenized.map(t => ({
    prefix: t.slice(0, i).join(' '),
    mid: t.slice(i, t.length - j).join(' '),
    suffix: t.slice(t.length - j).join(' ')
  }));
}

function showLocalBackupPickerModal(files) {
  return new Promise((resolve) => {
    let selectedCardIndex = null;
    
    const modal = document.createElement("div");
    modal.className = "modal premium-modal is-open";
    modal.style.zIndex = "108";
    
    const card = document.createElement("div");
    card.className = "modal-card";
    // Removendo padding do card pai para alinhar tudo corretamente internamente
    card.style.cssText = "width: min(700px, calc(100vw - 28px)); max-height: calc(100vh - 28px); display: flex; flex-direction: column; padding: 0; border-radius: 28px; background: var(--surface, #fff); box-shadow: 0 30px 90px rgba(34,33,36,.35); border: 1px solid rgba(255,255,255,.9); gap: 0;";
    
    // Header
    const header = document.createElement("div");
    header.style.cssText = "display: flex; align-items: flex-start; justify-content: space-between; padding: 24px 24px 0 24px;";
    header.innerHTML = `
      <div>
        <span class="eyebrow" style="display: inline-block; background: var(--blueSoft, #eff6ff); color: var(--blue, #3b82f6); padding: 2px 8px; border-radius: 4px; text-transform: uppercase; letter-spacing: 0.05em; font-weight: 500; font-size: 12px; margin-bottom: 8px;">Ação requerida</span>
        <strong style="display: block; font-size: 20px; font-weight: 500; margin-top: 0; margin-bottom: 6px;">Selecione a Imagem Correta</strong>
      </div>
      <button aria-label="Fechar" class="ghost-button modal-close" id="closePickerBtn" style="margin-top: 0; align-self: flex-start;">
        <svg width="24" height="24" viewBox="0 0 24 24"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12 19 6.41z"/></svg>
      </button>
    `;
    
    const diffs = getCommonDiff(files);
    const hasIdenticalNames = diffs.every(d => !d.mid);
    
    const subtitleBlock = document.createElement("div");
    subtitleBlock.style.cssText = "padding: 0 24px;";
    
    const subtitle = document.createElement("p");
    subtitle.style.cssText = "color: var(--muted, #666); font-size: 13px; margin-bottom: 20px; line-height: 1.4;";
    if (hasIdenticalNames) {
      subtitle.innerHTML = `<strong style="color: var(--red, #e53e3e);">Atenção:</strong> Não foi possível identificar diferença entre os nomes dos arquivos — verifique manualmente antes de confirmar.`;
    } else {
      subtitle.textContent = "Mesma arte usada em dois produtos. Os nomes de arquivo abaixo só diferem no trecho destacado.";
    }
    
    const divider1 = document.createElement("div");
    divider1.style.cssText = "height: 1px; background: var(--line, #e2e8f0); margin-bottom: 20px;"; // 20px abaixo do divider
    
    subtitleBlock.appendChild(subtitle);
    subtitleBlock.appendChild(divider1);
    
    const content = document.createElement("div");
    content.style.cssText = "overflow-y: auto; padding: 0 24px; min-height: 0;";
    const grid = document.createElement("div");
    grid.style.cssText = "display: grid; grid-template-columns: repeat(auto-fill, minmax(180px, 1fr)); gap: 16px;";
    
    const optionLabels = ["A", "B", "C", "D", "E", "F", "G", "H", "I", "J"];
    const cardElements = [];
    
    const confirmBtn = document.createElement("button");
    confirmBtn.className = "primary-button";
    confirmBtn.textContent = "Confirmar seleção";
    confirmBtn.disabled = true;
    confirmBtn.onclick = () => {
      if (selectedCardIndex !== null) {
        document.body.removeChild(modal);
        resolve(files[selectedCardIndex]);
      }
    };
    
    files.forEach((file, index) => {
      const item = document.createElement("div");
      item.dataset.index = index;
      item.dataset.selected = "false";
      item.style.cssText = "position: relative; cursor: pointer; background: var(--surface, #fff); border-radius: 20px; padding: 12px; text-align: center; transition: all 0.2s cubic-bezier(0.175, 0.885, 0.32, 1.275); border: 2px solid var(--line, #e2e8f0); display: flex; flex-direction: column; box-shadow: 0 4px 12px rgba(34,33,36,0.02); overflow: hidden;";
      
      const optionBadge = document.createElement("div");
      optionBadge.textContent = "Opção " + (optionLabels[index] || (index+1));
      optionBadge.style.cssText = "position: absolute; top: 18px; left: 18px; background: rgba(0,0,0,0.6); color: #fff; padding: 4px 8px; border-radius: 8px; font-size: 11px; font-weight: 900; z-index: 10;";
      
      const checkOverlay = document.createElement("div");
      checkOverlay.className = "picker-check";
      checkOverlay.style.cssText = "position: absolute; top: 18px; right: 18px; width: 24px; height: 24px; background: var(--primary, #3b82f6); color: #fff; border-radius: 50%; display: none; place-items: center; z-index: 10; box-shadow: 0 4px 8px rgba(0,0,0,0.15);";
      checkOverlay.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>`;
      
      const imgWrapper = document.createElement("div");
      imgWrapper.style.cssText = "position: relative; width: 100%; aspect-ratio: 1; border-radius: 14px; overflow: hidden; background: linear-gradient(135deg, #f8fafc, #eefdff); margin-bottom: 12px;";
      
      const img = document.createElement("img");
      img.src = file.previewUrl || file.path; 
      img.style.cssText = "width: 100%; height: 100%; object-fit: cover;";
      
      imgWrapper.appendChild(img);
      
      const name = document.createElement("div");
      // Bug 2 fix: Removed word-break: break-all/break-word
      name.style.cssText = "font-family: monospace; font-size: 12px; line-height: 1.4; padding: 0 4px; text-align: left;";
      
      const diff = diffs[index];
      const prefixSpan = diff.prefix ? `<span style="color: var(--muted, #666);">${diff.prefix}</span>` : '';
      const suffixSpan = diff.suffix ? `<span style="color: var(--muted, #666);">${diff.suffix}</span>` : '';
      const midSpan = diff.mid ? `<span class="diff-mid" style="color: var(--primary, #3b82f6); font-weight: 700;">${diff.prefix ? ' ' : ''}${diff.mid}${diff.suffix ? ' ' : ''}</span>` : '';
      
      name.innerHTML = prefixSpan + midSpan + suffixSpan;
      
      item.appendChild(optionBadge);
      item.appendChild(checkOverlay);
      item.appendChild(imgWrapper);
      item.appendChild(name);
      
      item.onclick = () => {
        if (selectedCardIndex === index) return;
        
        if (selectedCardIndex !== null) {
          const prev = cardElements[selectedCardIndex];
          prev.dataset.selected = "false";
          prev.style.borderColor = "var(--line, #e2e8f0)";
          prev.querySelector(".picker-check").style.display = "none";
        }
        
        selectedCardIndex = index;
        item.dataset.selected = "true";
        item.style.borderColor = "var(--primary, #3b82f6)";
        checkOverlay.style.display = "grid";
        
        confirmBtn.disabled = false;
      };
      
      cardElements.push(item);
      grid.appendChild(item);
    });
    
    content.appendChild(grid);
    
    // Bottom Space Container
    const bottomSpace = document.createElement("div");
    bottomSpace.style.cssText = "margin-top: 20px;"; // Espaço da ultima linha até divisória
    
    const actions = document.createElement("div");
    actions.className = "confirm-actions";
    actions.style.cssText = "padding: 20px 24px 24px 24px; border-top: 1px solid var(--line, #e2e8f0); display: flex; justify-content: flex-end; gap: 10px;";
    
    const cancelBtn = document.createElement("button");
    cancelBtn.className = "secondary-button";
    cancelBtn.textContent = "Cancelar";
    cancelBtn.onclick = () => {
      document.body.removeChild(modal);
      resolve(null);
    };
    
    header.querySelector("#closePickerBtn").onclick = cancelBtn.onclick;
    
    actions.appendChild(cancelBtn);
    actions.appendChild(confirmBtn);
    
    bottomSpace.appendChild(actions);
    
    card.appendChild(header);
    card.appendChild(subtitleBlock);
    card.appendChild(content);
    card.appendChild(bottomSpace);
    modal.appendChild(card);
    
    document.body.appendChild(modal);
  });
}

// ================= TEST RUNNER =================

async function runTests() {
  const files = [
    { name: "182 - PAINEL REDONDO 150X150.png", path: "/a" },
    { name: "182 - PAINEL REDONDO 50X50.png", path: "/b" }
  ];
  
  // 1. Renderiza
  const promise = showLocalBackupPickerModal(files);
  
  // 2. Procura elementos
  const cards = document.querySelectorAll(".modal-card [data-selected]");
  const cardA = cards[0];
  const cardB = cards[1];
  
  let passed = true;
  const assert = (condition, msg) => {
    if (condition) console.log("PASS: " + msg);
    else { console.error("FAIL: " + msg); passed = false; }
  };
  
  const aMid = cardA.querySelector(".diff-mid");
  const bMid = cardB.querySelector(".diff-mid");
  
  assert(aMid !== null, "BUG 1 REGRESSÃO: Card A possui o destaque .diff-mid");
  assert(bMid !== null, "BUG 1 REGRESSÃO: Card B possui o destaque .diff-mid");
  if (aMid) assert(aMid.textContent.includes("150X150.png"), "Card A destacou o texto correto");
  if (bMid) assert(bMid.textContent.includes("50X50.png"), "Card B destacou o texto correto");
  
  if (!passed) process.exit(1);
}

runTests().catch(console.error);
