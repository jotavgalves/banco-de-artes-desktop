async function refreshUsers() {
  const list = $("#userList");
  if (state.users && state.users.length > 0) {
    renderUserCards();
  } else if (list) {
    renderListSkeleton("#userList", 5);
  }

  try {
    state.users = await window.artBank.listUsers();
    renderUserCards();
  } catch (error) {
    if (!state.users || state.users.length === 0) {
      if (list) {
        list.innerHTML = `
          <div class="error-block">
            <svg viewBox="0 0 24 24"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z"/></svg>
            <strong>Conexão falhou</strong>
            <span>Não foi possível carregar os usuários no momento.</span>
            <button class="secondary-button" type="button" onclick="refreshUsers()">Tentar novamente</button>
          </div>
        `;
      }
    } else {
      toast("Falha ao atualizar usuários: " + error.message);
    }
  }
}

function renderUserCards() {
  const query = ($("#userSearchInput")?.value || "").toLowerCase();
  const filtered = state.users.filter(u => 
     u.name.toLowerCase().includes(query) || u.login.toLowerCase().includes(query)
  );
  
  if ($("#usersCountBadge")) $("#usersCountBadge").textContent = `${filtered.length} usuários`;
  
  const list = $("#userList");
  if (!list) return;

  const colorClasses = ["avatar-blue", "avatar-teal", "avatar-coral", "avatar-purple"];

  list.innerHTML = filtered.map((user) => {
    const initials = user.name.substring(0, 2).toUpperCase();
    const hash = Array.from(user.login).reduce((acc, char) => acc + char.charCodeAt(0), 0);
    const colorClass = colorClasses[hash % colorClasses.length];
    
    const roleBadge = user.role === "admin" 
        ? `<span class="badge admin-badge" style="background: #e0e7ff; color: #3730a3; font-size: 11px; padding: 2px 8px; border-radius: 999px; border: none; font-weight: 500;">Admin</span>` 
        : `<span class="badge operator-badge" style="background: #f3f4f6; color: #4b5563; font-size: 11px; padding: 2px 8px; border-radius: 999px; border: none; font-weight: 500;">Operador</span>`;
    const statusBadge = user.active 
        ? `<span class="badge active-badge" style="background: #dcfce7; color: #166534; font-size: 11px; padding: 2px 8px; border-radius: 999px; border: none; font-weight: 500;">Ativo</span>` 
        : `<span class="badge inactive-badge" style="background: #fee2e2; color: #991b1b; font-size: 11px; padding: 2px 8px; border-radius: 999px; border: none; font-weight: 500;">Inativo</span>`;
    
    return `
      <div class="user-card" data-user-card="${escapeHtml(user.login)}" style="display:flex; align-items:center; gap:16px; padding: 16px 0; border-bottom: 1px solid var(--border); cursor: pointer; transition: background-color 0.2s ease;">
        <div class="user-avatar ${colorClass}" style="width: 44px; height: 44px; border-radius: 50%; display:flex; align-items:center; justify-content:center; font-weight: 600; font-size: 14px;">${escapeHtml(initials)}</div>
        <div class="user-details" style="flex:1; display:flex; flex-direction:column; gap:4px;">
          <div style="display:flex; align-items:center; gap:8px;">
            <strong style="font-weight: 500; font-size: 15px; color: var(--text); margin: 0;">${escapeHtml(user.name)}</strong>
            <div class="user-badges" style="display:flex; gap:6px;">${roleBadge} ${statusBadge}</div>
          </div>
          <span class="user-login" style="font-size: 12px; color: var(--text-2); margin: 0;">${escapeHtml(user.login)}</span>
        </div>
        <div class="user-actions" style="display:flex; gap:8px;">
          <button class="icon-btn edit-btn user-action-btn-edit" title="Editar" aria-label="Editar usuario" style="padding: 8px; border-radius: 8px;">
            <svg viewBox="0 0 24 24" style="width:18px;height:18px;"><path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zm17.71-10.04a1.003 1.003 0 0 0 0-1.42l-2.5-2.5a1.003 1.003 0 0 0-1.42 0l-1.96 1.96 3.75 3.75 2.13-1.79z"/></svg>
          </button>
          <button class="icon-btn delete-btn user-action-btn-delete" data-del="${escapeHtml(user.login)}" title="Excluir" aria-label="Excluir usuario" style="padding: 8px; border-radius: 8px;">
            <svg viewBox="0 0 24 24" style="width:18px;height:18px;"><path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM8 9h8v10H8V9zm7.5-5-1-1h-5l-1 1H5v2h14V4h-3.5z"/></svg>
          </button>
        </div>
      </div>
    `;
  }).join("");

  $$("[data-user-card]").forEach(card => {
    card.addEventListener("click", () => {
      $$(".user-card").forEach(c => c.classList.remove("selected"));
      card.classList.add("selected");
      fillUserEditForm(state.users.find(u => u.login === card.dataset.userCard));
      setUsersTab("edit");
    });
  });

  $$(".delete-btn").forEach(btn => {
     btn.addEventListener("click", (e) => {
        e.stopPropagation();
        confirmAction({
          title: "Apagar usuário",
          message: "Tem certeza que deseja apagar este usuário?",
          destructive: true,
        }).then((ok) => {
          if (ok) deleteSelectedUser(btn.dataset.del);
        });
     });
  });
}

function setUsersTab(tab) {
  const form = $("#userActionForm");
  if (!form) return;
  const isEdit = tab === "edit";
  
  $("#tabNewUser").classList.toggle("active", !isEdit);
  $("#tabEditUser").classList.toggle("active", isEdit);
  
  form.elements.login.readOnly = isEdit;
  $("#editUserHint").textContent = isEdit && form.elements.login.value ? `Editando: ${form.elements.name.value}` : "Selecione um usuário na lista →";
  $("#editUserHint").style.display = isEdit ? "block" : "none";
  
  $("#btnCreateUser").style.display = isEdit ? "none" : "flex";
  $("#btnSaveUser").style.display = isEdit ? "flex" : "none";
  $("#btnToggleActive").style.display = isEdit ? "flex" : "none";

  if (!isEdit) {
     form.reset();
     form.elements.userId.value = "";
     $$(".user-card").forEach(c => c.classList.remove("selected"));
  }
}

function fillUserEditForm(user) {
  const form = $("#userActionForm");
  if (!user || !form) return;
  form.elements.userId.value = user.login;
  form.elements.login.value = user.login;
  form.elements.name.value = user.name;
  form.elements.password.value = "";
  form.elements.role.value = user.role;
  $("#btnToggleActive").textContent = user.active ? "Desativar" : "Ativar";
  $("#editUserHint").textContent = `Editando: ${user.name}`;
}

async function handleUserActionSubmit(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const isEdit = $("#tabEditUser").classList.contains("active");
  
  try {
     const payload = {
        userId: form.elements.userId.value,
        login: form.elements.login.value.trim().toLowerCase(),
        name: form.elements.name.value,
        role: form.elements.role.value,
        password: form.elements.password.value
     };
     
     if (isEdit) {
        if (!payload.userId) return toast("Selecione um usuário.");
        await window.artBank.updateUser(payload);
        if (payload.password) {
           await window.artBank.resetPassword(payload);
        }
        toast("Usuário atualizado no sistema central.");
     } else {
        await window.artBank.createUser(payload);
        toast("Usuário criado no sistema central.");
        form.reset();
     }
     await refreshUsers();
  } catch (error) {
     toast(error.message);
  }
}

async function toggleSelectedUserActive() {
  const form = $("#userActionForm");
  const userId = form.elements.userId.value;
  if (!userId) return toast("Selecione um usuário.");
  const user = state.users.find(u => u.login === userId);
  try {
    await window.artBank.setUserActive({ userId, active: !user.active });
    await refreshUsers();
    fillUserEditForm(state.users.find(u => u.login === userId));
  } catch (error) {
    toast(error.message);
  }
}

async function deleteSelectedUser(loginId) {
  let target = loginId;
  if(typeof loginId !== "string") {
     const form = $("#userActionForm");
     target = form.elements.userId.value;
  }
  if (!target) return toast("Selecione um usuário.");
  try {
    await window.artBank.deleteUser(target);
    await refreshUsers();
    setUsersTab("new");
    toast("Usuário apagado.");
  } catch (error) {
    toast(error.message);
  }
}

async function refreshLocks() {
  renderListSkeleton("#lockList", 2);
  let locks;
  try {
    locks = await window.artBank.lockStatus();
  } catch (error) {
    locks = { global: { status: "INDISPONÍVEL", note: friendlyError(error.message) }, local: { status: "LIVRE" } };
  }
  const global = locks.global || {};
  const local = locks.local || {};
  if($("#lockList")) {
    $("#lockList").innerHTML = `
      <div class="reservation-row"><div><strong>Global: ${escapeHtml(global.status || "-")}</strong><span>${escapeHtml(global.user || "")} ${escapeHtml(global.machine || "")} ${escapeHtml(global.note || "")}</span></div></div>
      <div class="reservation-row"><div><strong>Local: ${escapeHtml(local.status || "-")}</strong><span>${escapeHtml(local.user || "")} ${escapeHtml(local.startedAt || "")}</span></div></div>
    `;
  }
}

async function refreshAudit() {
  renderListSkeleton("#auditRows", 5);
  const rows = await window.artBank.auditList().catch(() => []);
  if($("#auditRows")) {
    $("#auditRows").innerHTML = rows.map((row) => `
      <div class="reservation-row"><div><strong>${escapeHtml(row.action)}</strong><span>${new Date(row.at).toLocaleString("pt-BR")} · ${escapeHtml(row.name)} · ${escapeHtml(row.details)}</span></div><span class="badge">${escapeHtml(row.type)}</span></div>
    `).join("") || `<div class="reservation-row"><span style="color:var(--text-3)">Nenhum log ainda.</span></div>`;
  }
}
