const app = document.getElementById("app");

// ---------------------------------------------------------------------------
// API helper
// ---------------------------------------------------------------------------
async function api(path, options = {}) {
  const res = await fetch(path, {
    method: options.method || "GET",
    headers: options.body ? { "Content-Type": "application/json" } : undefined,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  if (res.status === 204) return null;
  let data = null;
  try {
    data = await res.json();
  } catch {}
  if (!res.ok) throw new Error((data && data.error) || `Request failed (${res.status})`);
  return data;
}

// ---------------------------------------------------------------------------
// Toasts
// ---------------------------------------------------------------------------
function toast(message, type = "success") {
  let stack = document.querySelector(".toast-stack");
  if (!stack) {
    stack = document.createElement("div");
    stack.className = "toast-stack";
    document.body.appendChild(stack);
  }
  const el = document.createElement("div");
  el.className = `toast ${type}`;
  el.textContent = message;
  stack.appendChild(el);
  setTimeout(() => el.remove(), 4500);
}

function escapeHtml(str) {
  return String(str ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------
function navigate(path) {
  history.pushState({}, "", path);
  render();
}
window.addEventListener("popstate", render);

async function render() {
  const path = location.pathname;
  const guildMatch = path.match(/^\/g\/([0-9]+)/);

  let session;
  try {
    session = await api("/api/session");
  } catch {
    session = { user: null };
  }

  if (!session.user) {
    renderLogin();
    return;
  }

  if (guildMatch) {
    renderGuildDashboard(guildMatch[1], session.user);
  } else {
    renderGuildPicker(session.user);
  }
}

// ---------------------------------------------------------------------------
// Login screen
// ---------------------------------------------------------------------------
function renderLogin() {
  app.innerHTML = `
    <div class="center-screen">
      <div class="login-card">
        <div class="logo"><img src="/logo.png" alt="StatHive" /></div>
        <h1>StatHive Dashboard</h1>
        <p>Manage your FiveM status cards and bot appearance for every server you admin — right from the browser.</p>
        <a class="btn btn-primary btn-block" href="/auth/login">Login with Discord</a>
      </div>
    </div>
  `;
}

// ---------------------------------------------------------------------------
// Guild picker
// ---------------------------------------------------------------------------
async function renderGuildPicker(user) {
  app.innerHTML = `
    <div class="topbar">
      <div class="topbar-left"><a class="brand" href="/"><span class="logo-sm"><img src="/logo.png" alt="" /></span> StatHive</a></div>
      <div class="topbar-right">${userChip(user)}<a class="btn btn-ghost btn-sm" href="/auth/logout">Log out</a></div>
    </div>
    <div class="page">
      <div class="page-header">
        <div><h1>Your servers</h1><p>Pick a server to manage its statuses and bot appearance.</p></div>
      </div>
      <div id="guild-grid" class="guild-grid"><div class="spinner" style="margin: 40px auto;"></div></div>
    </div>
  `;

  try {
    const guilds = await api("/api/guilds");
    const grid = document.getElementById("guild-grid");
    if (guilds.length === 0) {
      grid.outerHTML = `<div class="empty-state">No servers found where you're an admin <em>and</em> the bot is installed. Invite the bot to a server you manage, then refresh.</div>`;
      return;
    }
    grid.innerHTML = guilds
      .map(
        (g) => `
      <a class="guild-card" href="/g/${g.id}" data-nav>
        ${g.icon ? `<img src="${g.icon}" alt="" />` : `<div class="fallback-icon">${escapeHtml(g.name[0] || "?")}</div>`}
        <div class="name">${escapeHtml(g.name)}</div>
      </a>`
      )
      .join("");
  } catch (err) {
    document.getElementById("guild-grid").outerHTML = `<div class="banner error">${escapeHtml(err.message)}</div>`;
  }
}

function userChip(user) {
  const avatar = user.avatar
    ? `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png`
    : `https://cdn.discordapp.com/embed/avatars/0.png`;
  return `<div class="user-chip"><img src="${avatar}" alt="" />${escapeHtml(user.username)}</div>`;
}

// ---------------------------------------------------------------------------
// Guild dashboard
// ---------------------------------------------------------------------------
let activeTab = "statuses";

async function renderGuildDashboard(guildId, user) {
  app.innerHTML = `<div class="center-screen"><div class="spinner"></div></div>`;

  let guild;
  try {
    guild = await api(`/api/guilds/${guildId}`);
  } catch (err) {
    app.innerHTML = `<div class="center-screen"><div class="card" style="max-width:420px;text-align:center;">
      <p style="color:var(--text-dim);margin-bottom:16px;">${escapeHtml(err.message)}</p>
      <a class="btn btn-secondary" href="/" data-nav>Back to server list</a>
    </div></div>`;
    return;
  }

  app.innerHTML = `
    <div class="topbar">
      <div class="topbar-left">
        <a class="brand" href="/" data-nav><span class="logo-sm"><img src="/logo.png" alt="" /></span> StatHive</a>
        <span class="crumb-sep">/</span>
        <div class="guild-chip">${guild.icon ? `<img src="${guild.icon}" alt="" />` : ""}${escapeHtml(guild.name)}</div>
      </div>
      <div class="topbar-right">${userChip(user)}<a class="btn btn-ghost btn-sm" href="/auth/logout">Log out</a></div>
    </div>
    <div class="page">
      <div class="tabs">
        <div class="tab ${activeTab === "statuses" ? "active" : ""}" data-tab="statuses">Statuses</div>
        <div class="tab ${activeTab === "profile" ? "active" : ""}" data-tab="profile">Bot Profile</div>
      </div>
      <div id="tab-content"></div>
    </div>
  `;

  document.querySelectorAll(".tab").forEach((t) =>
    t.addEventListener("click", () => {
      activeTab = t.dataset.tab;
      renderGuildDashboard(guildId, user);
    })
  );

  if (activeTab === "statuses") renderStatusesTab(guildId);
  else renderProfileTab(guildId);
}

// ---------------------------------------------------------------------------
// Statuses tab
// ---------------------------------------------------------------------------
async function renderStatusesTab(guildId) {
  const content = document.getElementById("tab-content");
  content.innerHTML = `
    <div class="page-header">
      <div><h1 style="font-size:17px;">Tracked statuses</h1><p>Every FiveM server status card posted in this server.</p></div>
      <button class="btn btn-primary" id="new-status-btn">+ New Status</button>
    </div>
    <div id="status-list" class="status-list"><div class="spinner" style="margin: 30px auto;"></div></div>
  `;
  document.getElementById("new-status-btn").addEventListener("click", () => openStatusModal(guildId));

  try {
    const statuses = await api(`/api/guilds/${guildId}/statuses`);
    const list = document.getElementById("status-list");
    if (statuses.length === 0) {
      list.outerHTML = `<div class="empty-state">No statuses tracked yet. Click <strong>New Status</strong> to add your first FiveM server.</div>`;
      return;
    }
    list.innerHTML = statuses.map(statusCardHtml).join("");
    statuses.forEach((s) => {
      document.getElementById(`edit-${s.messageId}`)?.addEventListener("click", () => openStatusModal(guildId, s));
      document.getElementById(`del-${s.messageId}`)?.addEventListener("click", () => deleteStatusConfirm(guildId, s));
    });
  } catch (err) {
    document.getElementById("status-list").outerHTML = `<div class="banner error">${escapeHtml(err.message)}</div>`;
  }
}

function statusCardHtml(s) {
  const target = s.serverCode || s.serverAddress || "unknown";
  const lastChecked = s.lastCheckedAt ? new Date(s.lastCheckedAt).toLocaleString() : "never";
  return `
    <div class="status-card">
      <div class="info">
        <div class="name">${escapeHtml(s.serverName)}</div>
        <div class="meta">
          <span>🎯 ${escapeHtml(target)}</span>
          <span>#${escapeHtml(s.channelId)}</span>
          <span>Last checked: ${escapeHtml(lastChecked)}</span>
        </div>
      </div>
      <div class="actions">
        <button class="btn btn-secondary btn-sm" id="edit-${s.messageId}">Edit</button>
        <button class="btn btn-danger btn-sm" id="del-${s.messageId}">Delete</button>
      </div>
    </div>`;
}

async function deleteStatusConfirm(guildId, status) {
  if (!confirm(`Delete the status card for "${status.serverName}"? This removes the message from Discord too.`)) return;
  try {
    await api(`/api/guilds/${guildId}/statuses/${status.messageId}`, { method: "DELETE" });
    toast("Status deleted.");
    renderStatusesTab(guildId);
  } catch (err) {
    toast(err.message, "error");
  }
}

async function openStatusModal(guildId, existing = null) {
  const backdrop = document.createElement("div");
  backdrop.className = "modal-backdrop";
  backdrop.innerHTML = `
    <div class="modal">
      <h2>${existing ? "Edit status" : "New status"}</h2>
      <div id="modal-banner"></div>
      <form id="status-form">
        <div class="field">
          <label>Channel</label>
          <select name="channelId" ${existing ? "disabled" : ""} required>
            <option value="">Loading channels...</option>
          </select>
          ${existing ? `<div class="hint">Channel can't be changed after creation — delete and recreate to move it.</div>` : ""}
        </div>
        <div class="field">
          <label>Server name</label>
          <input type="text" name="serverName" value="${escapeHtml(existing?.serverName || "")}" required />
        </div>
        <div class="field-row">
          <div class="field">
            <label>Server IP:Port</label>
            <input type="text" name="serverAddress" placeholder="1.2.3.4:30120" value="${escapeHtml(existing?.serverAddress || "")}" />
          </div>
          <div class="field">
            <label>CFX join code</label>
            <input type="text" name="cfxCode" placeholder="cfx.re/join/abc123" value="${escapeHtml(existing?.serverCode || "")}" />
          </div>
        </div>
        <div class="field-row">
          <div class="field"><label>Thumbnail URL</label><input type="url" name="thumbnail" value="${escapeHtml(existing?.thumbnail || "")}" /></div>
          <div class="field"><label>Banner URL</label><input type="url" name="banner" value="${escapeHtml(existing?.banner || "")}" /></div>
        </div>
        <div class="field">
          <label>Footer text</label>
          <input type="text" name="footerText" placeholder="Last updated" value="${escapeHtml(existing?.footerText || "")}" />
        </div>
        <div class="field">
          <label>Custom buttons <span style="font-weight:400;color:var(--text-faint);">(up to 5, optional)</span></label>
          <div class="button-rows" id="button-rows"></div>
          <button type="button" class="btn btn-secondary btn-sm" id="add-button-row" style="margin-top:10px;">+ Add button</button>
        </div>
        <div class="modal-actions">
          <button type="button" class="btn btn-ghost" id="cancel-modal">Cancel</button>
          <button type="submit" class="btn btn-primary" id="submit-modal">${existing ? "Save changes" : "Create status"}</button>
        </div>
      </form>
    </div>
  `;
  document.body.appendChild(backdrop);
  backdrop.addEventListener("click", (e) => { if (e.target === backdrop) backdrop.remove(); });
  document.getElementById("cancel-modal").addEventListener("click", () => backdrop.remove());

  // Button rows
  const rowsEl = document.getElementById("button-rows");
  function addButtonRow(label = "", url = "") {
    if (rowsEl.children.length >= 5) return;
    const row = document.createElement("div");
    row.className = "button-row";
    row.innerHTML = `
      <input type="text" placeholder="Label" class="btn-label" value="${escapeHtml(label)}" />
      <input type="url" placeholder="https://..." class="btn-url" value="${escapeHtml(url)}" />
      <button type="button" class="icon-btn remove-row">✕</button>
    `;
    row.querySelector(".remove-row").addEventListener("click", () => row.remove());
    rowsEl.appendChild(row);
  }
  (existing?.customButtons || []).forEach((b) => addButtonRow(b.label, b.url));
  document.getElementById("add-button-row").addEventListener("click", () => addButtonRow());

  // Load channels
  const channelSelect = backdrop.querySelector('select[name="channelId"]');
  try {
    const channels = await api(`/api/guilds/${guildId}/channels`);
    channelSelect.innerHTML =
      `<option value="">Select a channel...</option>` +
      channels.map((c) => `<option value="${c.id}" ${existing?.channelId === c.id ? "selected" : ""}>#${escapeHtml(c.name)}</option>`).join("");
  } catch (err) {
    channelSelect.innerHTML = `<option value="">Failed to load channels</option>`;
  }

  document.getElementById("status-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const formData = new FormData(e.target);
    const buttons = Array.from(rowsEl.children).map((row) => ({
      label: row.querySelector(".btn-label").value.trim(),
      url: row.querySelector(".btn-url").value.trim(),
    }));
    const body = {
      channelId: existing ? existing.channelId : formData.get("channelId"),
      serverName: formData.get("serverName"),
      serverAddress: formData.get("serverAddress"),
      cfxCode: formData.get("cfxCode"),
      thumbnail: formData.get("thumbnail"),
      banner: formData.get("banner"),
      footerText: formData.get("footerText"),
      buttons,
    };
    const submitBtn = document.getElementById("submit-modal");
    submitBtn.disabled = true;
    submitBtn.textContent = existing ? "Saving..." : "Creating...";
    try {
      if (existing) {
        await api(`/api/guilds/${guildId}/statuses/${existing.messageId}`, { method: "PATCH", body });
        toast("Status updated.");
      } else {
        await api(`/api/guilds/${guildId}/statuses`, { method: "POST", body });
        toast("Status created.");
      }
      backdrop.remove();
      renderStatusesTab(guildId);
    } catch (err) {
      document.getElementById("modal-banner").innerHTML = `<div class="banner error">${escapeHtml(err.message)}</div>`;
      submitBtn.disabled = false;
      submitBtn.textContent = existing ? "Save changes" : "Create status";
    }
  });
}

// ---------------------------------------------------------------------------
// Bot profile tab
// ---------------------------------------------------------------------------
async function renderProfileTab(guildId) {
  const content = document.getElementById("tab-content");
  content.innerHTML = `
    <div class="page-header">
      <div><h1 style="font-size:17px;">Bot profile for this server</h1><p>Custom nickname and status-card avatar — only affects this server.</p></div>
    </div>
    <div class="card" style="max-width:520px;">
      <div id="profile-banner"></div>
      <div class="profile-preview">
        <img id="avatar-preview" class="avatar-preview" style="display:none;" alt="" />
        <div id="avatar-fallback" class="avatar-fallback">🐝</div>
        <div>
          <div style="font-weight:700;" id="preview-name">StatHive</div>
          <div style="font-size:12.5px;color:var(--text-dim);">Preview of the name/avatar used on new status cards</div>
        </div>
      </div>
      <form id="profile-form">
        <div class="field">
          <label>Nickname (also shown in the member list)</label>
          <input type="text" name="name" id="profile-name" maxlength="32" placeholder="Default bot name" />
        </div>
        <div class="field">
          <label>Avatar URL (used on status cards)</label>
          <input type="url" name="avatarUrl" id="profile-avatar" placeholder="https://..." />
          <div class="hint">Discord doesn't allow bots to have a per-server avatar on their real account, so this image is used specifically on this server's status cards instead.</div>
        </div>
        <div class="modal-actions" style="justify-content:flex-start;">
          <button type="submit" class="btn btn-primary" id="save-profile">Save</button>
          <button type="button" class="btn btn-secondary" id="reset-profile">Reset to defaults</button>
        </div>
      </form>
    </div>
  `;

  const nameInput = document.getElementById("profile-name");
  const avatarInput = document.getElementById("profile-avatar");
  const preview = document.getElementById("avatar-preview");
  const fallback = document.getElementById("avatar-fallback");
  const previewName = document.getElementById("preview-name");

  function updatePreview() {
    const url = avatarInput.value.trim();
    if (url) {
      preview.src = url;
      preview.style.display = "block";
      fallback.style.display = "none";
    } else {
      preview.style.display = "none";
      fallback.style.display = "flex";
    }
    previewName.textContent = nameInput.value.trim() || "StatHive";
  }
  nameInput.addEventListener("input", updatePreview);
  avatarInput.addEventListener("input", updatePreview);

  try {
    const profile = await api(`/api/guilds/${guildId}/profile`);
    nameInput.value = profile.name || "";
    avatarInput.value = profile.avatarUrl || "";
    updatePreview();
  } catch (err) {
    document.getElementById("profile-banner").innerHTML = `<div class="banner error">${escapeHtml(err.message)}</div>`;
  }

  document.getElementById("profile-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const saveBtn = document.getElementById("save-profile");
    saveBtn.disabled = true;
    saveBtn.textContent = "Saving...";
    try {
      const result = await api(`/api/guilds/${guildId}/profile`, {
        method: "POST",
        body: { name: nameInput.value.trim() || null, avatarUrl: avatarInput.value.trim() || null },
      });
      toast(`Profile updated. Refreshed ${result.updated} status card(s)${result.failed ? `, ${result.failed} failed` : ""}.`);
    } catch (err) {
      toast(err.message, "error");
    } finally {
      saveBtn.disabled = false;
      saveBtn.textContent = "Save";
    }
  });

  document.getElementById("reset-profile").addEventListener("click", async () => {
    if (!confirm("Reset this server's bot nickname and status-card avatar back to defaults?")) return;
    try {
      const result = await api(`/api/guilds/${guildId}/profile/reset`, { method: "POST" });
      nameInput.value = "";
      avatarInput.value = "";
      updatePreview();
      toast(`Profile reset. Refreshed ${result.updated} status card(s)${result.failed ? `, ${result.failed} failed` : ""}.`);
    } catch (err) {
      toast(err.message, "error");
    }
  });
}

// ---------------------------------------------------------------------------
// Global link interception (so internal links use pushState, no full reload)
// ---------------------------------------------------------------------------
document.addEventListener("click", (e) => {
  const link = e.target.closest("a[data-nav], a.guild-card");
  if (!link) return;
  const href = link.getAttribute("href");
  if (!href || href.startsWith("/auth/")) return; // let real navigations (login/logout) through
  e.preventDefault();
  navigate(href);
});

render();
