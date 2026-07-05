// BANCO DE ARTES — UX Dashboard Patch v5
// Melhora interface sem alterar contratos IPC nem regras de negocio.
(function(){
  const $=(s,r=document)=>r.querySelector(s);
  const $$=(s,r=document)=>Array.from(r.querySelectorAll(s));
  function ready(fn){document.readyState==='loading'?document.addEventListener('DOMContentLoaded',fn,{once:true}):fn();}
  ready(()=>{document.documentElement.classList.add('ux-v5');enhanceNavigation();enhanceFinance();enhanceButtons();enhanceModals();enhanceTables();observeDynamicUi();});
  function enhanceNavigation(){
    const sidebar=$('.sidebar'); if(!sidebar) return;
    if(!$('.ux-sidebar-title')){const title=document.createElement('div');title.className='ux-sidebar-title';title.innerHTML='<span style="display:block;color:rgba(248,243,234,.48);font-size:10px;font-weight:800;letter-spacing:.14em;text-transform:uppercase;margin:4px 12px 10px;">Command Center</span>';const first=$('.sidebar-section-label',sidebar); if(first) sidebar.insertBefore(title,first);}
    $$('.nav-item').forEach(btn=>{if(btn.dataset.uxReady)return;btn.dataset.uxReady='true';const label=btn.querySelector('span:last-child')?.textContent?.trim()||'';btn.title=label;btn.addEventListener('click',()=>setTimeout(() => $$('.nav-item').forEach(i=>i.setAttribute('aria-current',i.classList.contains('active')?'page':'false')),40));});
  }
  function enhanceFinance(){
    const panel=$('.finance-panel'); if(!panel||$('.ux-finance-board',panel)) return;
    const board=document.createElement('div');board.className='ux-finance-board';board.innerHTML=`
      <article class="ux-fin-card"><span class="ux-fin-kicker">Clientes indexados</span><strong class="ux-fin-number" id="uxFinanceClients">0</strong><p>Base lida da pasta financeira configurada. Use busca por código ou nome no lançamento.</p></article>
      <article class="ux-fin-card"><span class="ux-fin-kicker">Fluxo rápido</span><div class="ux-fin-flow"><div class="ux-flow-step"><b>1</b><div><strong>Escolha o cliente</strong><span>Digite código ou nome. Se não existir, crie direto no modal.</span></div></div><div class="ux-flow-step"><b>2</b><div><strong>Adicione IDs das artes</strong><span>Prévia visual, validação e conferência antes de copiar.</span></div></div><div class="ux-flow-step"><b>3</b><div><strong>Copie o lançamento final</strong><span>Entrega pronta para colar no fluxo operacional.</span></div></div></div></article>
      <article class="ux-fin-card"><span class="ux-fin-kicker">Ações</span><p>O financeiro agora é uma área de lançamento, não uma tela vazia.</p><div class="ux-fin-actions"><button class="primary-button" type="button" data-ux-open-order>Novo pedido</button><button class="secondary-button" type="button" data-ux-refresh-finance>Atualizar clientes</button></div></article>`;
    const header=$('.panel-header',panel); header?.after(board); $('[data-ux-open-order]',board)?.addEventListener('click',()=>$('#openOrderModalButton')?.click()); $('[data-ux-refresh-finance]',board)?.addEventListener('click',()=>$('.nav-item[data-view="finance"]')?.click()); syncFinanceStats();
  }
  function syncFinanceStats(){const native=$('#financeClientCount');const ux=$('#uxFinanceClients'); if(native&&ux) ux.textContent=native.textContent||'0';}
  function enhanceButtons(){document.addEventListener('click',e=>{const button=e.target.closest('button'); if(!button||button.disabled||button.dataset.noBusy)return; const id=button.id||''; const should=/Button$|submit|save|copy|sync|upload|run|validate|refresh|reload|auth|provision/i.test(id)||button.classList.contains('primary-button'); if(!should)return; button.dataset.uxBusy='true'; setTimeout(()=>delete button.dataset.uxBusy,900);},true);}
  function enhanceModals(){
    const apply=()=>$$('.modal,.premium-modal').forEach(modal=>{if(modal.dataset.uxModalReady)return;modal.dataset.uxModalReady='true';modal.addEventListener('mousedown',e=>{if(e.target===modal){const close=modal.querySelector('.modal-close,#closeOrderModalButton,#confirmCancelButton,#closePreviewButton'); if(close&&modal.id!=='confirmModal') close.click();}});}); apply();
    document.addEventListener('keydown',e=>{if(e.key!=='Escape')return; const open=$$('.modal:not(.hidden),.premium-modal:not(.hidden)').at(-1); if(!open||open.id==='confirmModal')return; open.querySelector('.modal-close,#closeOrderModalButton,#closePreviewButton')?.click();});
  }
  function enhanceTables(){ $$('.table-wrap').forEach(w=>{if(w.dataset.uxTableReady)return;w.dataset.uxTableReady='true';w.setAttribute('tabindex','0');w.setAttribute('aria-label','Tabela com rolagem');}); }
  function polishFinanceCards(){ $$('.order-art-card').forEach(card=>{if(card.dataset.uxPolished)return;card.dataset.uxPolished='true';card.setAttribute('tabindex','0');}); const grid=$('#financeArtGrid'); if(grid&&!grid.dataset.uxLabelReady){grid.dataset.uxLabelReady='true';grid.setAttribute('aria-live','polite');}}
  function observeDynamicUi(){const obs=new MutationObserver(()=>{enhanceFinance();enhanceNavigation();enhanceModals();enhanceTables();syncFinanceStats();polishFinanceCards();}); obs.observe(document.body,{childList:true,subtree:true,attributes:true,attributeFilter:['class','style']}); setInterval(()=>{syncFinanceStats();polishFinanceCards();},1200);}
})();
