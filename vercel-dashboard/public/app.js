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

let statsTimer = null;
let pickerFocusHandler = null;

async function render() {
  clearInterval(statsTimer);
  statsTimer = null;
  if (pickerFocusHandler) {
    window.removeEventListener("focus", pickerFocusHandler);
    pickerFocusHandler = null;
  }
  const path = location.pathname;
  const statusMatch = path.match(/^\/g\/([0-9]+)\/s\/([0-9]+)/);
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

  if (statusMatch) {
    renderStatusDashboard(statusMatch[1], statusMatch[2], session.user);
  } else if (guildMatch) {
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
        <div><h1>Your servers</h1><p>Pick a server to manage. Greyed-out servers don\u2019t have StatHive yet \u2014 click one to add it.</p></div>
      </div>
      <div id="guild-grid" class="guild-grid"><div class="spinner" style="margin: 40px auto;"></div></div>
    </div>
  `;

  async function loadGrid(initial) {
    const grid = document.getElementById("guild-grid");
    if (!grid) return;
    try {
      const guilds = await api("/api/guilds");
      if (guilds.length === 0) {
        grid.className = "";
        grid.innerHTML = `<div class="empty-state">No servers found where you can add or manage StatHive. You need <strong>Manage Server</strong> or <strong>Administrator</strong> in a server.</div>`;
        return;
      }
      grid.className = "guild-grid";
      grid.innerHTML = guilds.map(guildCardHtml).join("");
    } catch (err) {
      if (initial) {
        grid.className = "";
        grid.innerHTML = `<div class="banner error">${escapeHtml(err.message)}</div>`;
      }
    }
  }
  await loadGrid(true);

  // Back from the invite tab? Re-check which servers now have the bot.
  pickerFocusHandler = () => loadGrid(false);
  window.addEventListener("focus", pickerFocusHandler);
}

function guildCardHtml(g) {
  const icon = g.icon ? `<img src="${escapeHtml(g.icon)}" alt="" />` : `<div class="fallback-icon">${escapeHtml(g.name[0] || "?")}</div>`;
  const name = `<div class="name">${escapeHtml(g.name)}</div>`;
  if (g.canManage) return `<a class="guild-card" href="/g/${g.id}" data-nav>${icon}${name}</a>`;
  if (!g.installed) {
    return `<a class="guild-card disabled" href="${escapeHtml(g.inviteUrl)}" target="_blank" rel="noopener">${icon}${name}<span class="add-label">+ Add StatHive</span></a>`;
  }
  return `<div class="guild-card disabled locked" title="Only members with the Administrator permission can manage StatHive here.">${icon}${name}<span class="add-label">Administrator required</span></div>`;
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
    const openStats = (id) => navigate(`/g/${guildId}/s/${id}`);
    list.querySelectorAll(".status-card[data-msg]").forEach((card) =>
      card.addEventListener("click", (e) => {
        if (!e.target.closest(".actions")) openStats(card.dataset.msg);
      })
    );
    statuses.forEach((s) => {
      document.getElementById(`stats-${s.messageId}`)?.addEventListener("click", () => openStats(s.messageId));
      document.getElementById(`edit-${s.messageId}`)?.addEventListener("click", () => openStatusModal(guildId, s));
      document.getElementById(`del-${s.messageId}`)?.addEventListener("click", () => deleteStatusConfirm(guildId, s));
    });
  } catch (err) {
    document.getElementById("status-list").outerHTML = `<div class="banner error">${escapeHtml(err.message)}</div>`;
  }
}

const STATUS_LABEL = { online: "Online", restarting: "Restarting", offline: "Offline", unknown: "Unknown" };

function statusCardHtml(s) {
  const target = s.serverCode || s.serverAddress || "unknown";
  const lastChecked = s.lastCheckedAt ? timeAgo(s.lastCheckedAt) : "never";
  const st = STATUS_LABEL[s.status] ? s.status : "unknown";
  const players =
    st === "online" && s.lastKnownPlayers != null ? `<span>\u{1F465} ${fmtNum(s.lastKnownPlayers)} / ${escapeHtml(s.lastKnownMaxPlayers ?? "?")} players</span>` : "";
  return `
    <div class="status-card clickable ${st}" data-msg="${s.messageId}" title="Click for live player stats">
      <div class="info">
        <div class="name">${escapeHtml(s.serverName)}<span class="pill ${st}">\u25CF ${STATUS_LABEL[st]}</span></div>
        <div class="meta">
          ${players}
          <span>\u{1F3AF} ${escapeHtml(target)}</span>
          <span>#${escapeHtml(s.channelId)}</span>
          <span>Checked ${escapeHtml(lastChecked)}</span>
        </div>
      </div>
      <div class="actions">
        <button class="btn btn-primary btn-sm" id="stats-${s.messageId}">Stats</button>
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
// Status dashboard — click a status card: live player stats + Discord preview
// ---------------------------------------------------------------------------
let chartRange = "7d";
let lastStats = null;

function fmtNum(n) {
  return n == null || n === "" ? "—" : Number(n).toLocaleString();
}

function ageSeconds(iso) {
  return Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
}

function timeAgo(iso) {
  const sec = ageSeconds(iso);
  if (sec < 10) return "just now";
  if (sec < 60) return `${sec}s ago`;
  const m = Math.floor(sec / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  return h < 24 ? `${h}h ago` : `${Math.floor(h / 24)}d ago`;
}

// Mimics Discord's <t:...:R> relative timestamp used in the card footer
function discordRel(iso) {
  if (!iso) return "now";
  const sec = ageSeconds(iso);
  if (sec < 45) return "a few seconds ago";
  const m = Math.round(sec / 60);
  if (m < 60) return m === 1 ? "a minute ago" : `${m} minutes ago`;
  const h = Math.round(m / 60);
  if (h < 24) return h === 1 ? "an hour ago" : `${h} hours ago`;
  const d = Math.round(h / 24);
  return d === 1 ? "a day ago" : `${d} days ago`;
}

function fmtDuration(ms) {
  const m = Math.floor(ms / 60000);
  if (m < 1) return "just joined";
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  return h < 24 ? `${h}h ${m % 60}m` : `${Math.floor(h / 24)}d ${h % 24}h`;
}

async function renderStatusDashboard(guildId, messageId, user) {
  app.innerHTML = `<div class="center-screen"><div class="spinner"></div></div>`;
  const statsPath = `/api/guilds/${guildId}/statuses/${messageId}/stats`;
  const here = `/s/${messageId}`;

  let guild, data;
  try {
    [guild, data] = await Promise.all([api(`/api/guilds/${guildId}`), api(statsPath)]);
  } catch (err) {
    if (!location.pathname.includes(here)) return;
    app.innerHTML = `<div class="center-screen"><div class="card" style="max-width:420px;text-align:center;">
      <p style="color:var(--text-dim);margin-bottom:16px;">${escapeHtml(err.message)}</p>
      <a class="btn btn-secondary" href="/g/${guildId}" data-nav>Back to statuses</a>
    </div></div>`;
    return;
  }
  if (!location.pathname.includes(here)) return; // user navigated away while loading

  app.innerHTML = `
    <div class="topbar">
      <div class="topbar-left">
        <a class="brand" href="/" data-nav><span class="logo-sm"><img src="/logo.png" alt="" /></span> StatHive</a>
        <span class="crumb-sep">/</span>
        <a class="guild-chip" href="/g/${guildId}" data-nav>${guild.icon ? `<img src="${escapeHtml(guild.icon)}" alt="" />` : ""}${escapeHtml(guild.name)}</a>
        <span class="crumb-sep">/</span>
        <span class="crumb-current">${escapeHtml(data.serverName)}</span>
      </div>
      <div class="topbar-right">${userChip(user)}<a class="btn btn-ghost btn-sm" href="/auth/logout">Log out</a></div>
    </div>
    <div class="page page-wide">
      <div id="sd-head" class="page-header"></div>
      <div class="sd-hero">
        <div class="card chart-card">
          <div class="chart-head">
            <div><h2>Players online</h2><p class="sub">Hourly average</p></div>
            <div class="seg" id="range-seg">
              <button data-range="24h">24h</button><button data-range="7d">7d</button>
            </div>
          </div>
          <div id="chart-wrap" class="chart-wrap"></div>
          <div id="chart-foot" class="chart-foot"></div>
        </div>
        <div class="card stat-panel" id="sd-stats"></div>
      </div>
      <div class="card" id="sd-players"></div>
      <div class="card" id="sd-preview"></div>
    </div>`;

  chartRange = "7d";
  const seg = document.getElementById("range-seg");
  const syncSeg = () => seg.querySelectorAll("button").forEach((b) => b.classList.toggle("active", b.dataset.range === chartRange));
  seg.querySelectorAll("button").forEach((b) =>
    b.addEventListener("click", () => {
      chartRange = b.dataset.range;
      syncSeg();
      drawChart(true);
    })
  );
  syncSeg();

  paintStatusDashboard(data, guildId, true);
  statsTimer = setInterval(async () => {
    try {
      paintStatusDashboard(await api(statsPath), guildId, false);
    } catch {}
  }, 15000);
}

function paintStatusDashboard(d, guildId, animate) {
  if (!document.getElementById("sd-head")) return;
  lastStats = d;
  const st = STATUS_LABEL[d.status] ? d.status : "unknown";

  document.getElementById("sd-head").innerHTML = `
    <div>
      <h1>${escapeHtml(d.serverName)} <span class="pill ${st}">\u25CF ${STATUS_LABEL[st]}</span></h1>
      <p>${d.lastCheckedAt ? `Last checked ${escapeHtml(timeAgo(d.lastCheckedAt))}` : "Waiting for the first check"} \u00B7 <code>${escapeHtml(d.card.connectCode)}</code></p>
    </div>
    <div class="head-actions">
      <span class="live"><i></i>Live</span>
      <a class="btn btn-secondary" href="/g/${guildId}" data-nav>\u2190 All statuses</a>
    </div>`;
  document.getElementById("sd-stats").innerHTML = statPanelHtml(d);
  document.getElementById("sd-players").innerHTML = playersCardHtml(d);
  document.getElementById("sd-preview").innerHTML = discordPreviewHtml(d);
  document.getElementById("chart-foot").textContent = d.trackingSince
    ? `Tracking since ${new Date(d.trackingSince).toLocaleString()} \u2014 history builds up from that point.`
    : "Waiting for the first check \u2014 stats appear within about 30 seconds.";
  drawChart(animate);
}

// ----- right-hand stats panel -------------------------------------------------
function statPanelHtml(d) {
  const online = d.status === "online";
  const count = online ? d.current?.count ?? d.lastKnownPlayers ?? 0 : 0;
  const max = d.current?.max ?? d.lastKnownMaxPlayers ?? "?";
  const pct = online && Number(max) > 0 ? Math.min(100, Math.round((count / Number(max)) * 100)) : 0;
  const row = (label, value, sub) =>
    `<div class="stat-row"><div><div class="stat-label">${label}</div>${sub ? `<div class="stat-sub">${sub}</div>` : ""}</div><div class="stat-val">${value}</div></div>`;
  return `
    <div class="stat-hero">
      <div class="stat-label">Online now</div>
      <div class="stat-big">${fmtNum(count)}<span>/ ${escapeHtml(max)}</span></div>
      <div class="stat-bar"><i style="width:${pct}%"></i></div>
    </div>
    ${row("Players this week", fmtNum(d.uniqueWeek), `${fmtNum(d.uniqueDay)} in the last 24h`)}
    ${row("Unique players", fmtNum(d.uniqueAll), d.trackingSince ? `since ${escapeHtml(new Date(d.trackingSince).toLocaleDateString())}` : "")}
    ${row("Peak \u00B7 24 hours", fmtNum(d.peak24h))}
    ${row("Peak \u00B7 7 days", fmtNum(d.peak7d))}
    ${row("Uptime \u00B7 7 days", d.uptime7d == null ? "\u2014" : `${d.uptime7d}%`)}`;
}

// ----- active players ---------------------------------------------------------
function playersCardHtml(d) {
  const list = (d.current?.players || []).slice().sort((a, b) => Number(a.id) - Number(b.id));
  const head = `<div class="card-title"><h2>Active players</h2><span class="count-badge">${list.length}</span></div>`;
  if (!list.length) {
    let msg = "No one is online right now.";
    if (d.status === "offline" || d.status === "restarting") msg = `The server is ${STATUS_LABEL[d.status].toLowerCase()} \u2014 no players to show.`;
    else if (d.current && d.current.count > 0 && d.current.listed === 0) {
      msg = "This server doesn\u2019t publish its player list, so names and unique players can\u2019t be tracked.";
    }
    return `${head}<p class="muted">${escapeHtml(msg)}</p>`;
  }
  const MAX_ROWS = 300;
  const rows = list
    .slice(0, MAX_ROWS)
    .map(
      (p) => `<tr><td class="num">${escapeHtml(p.id ?? "")}</td><td>${escapeHtml(p.name)}</td>
        <td class="num">${p.ping == null ? "\u2014" : `${escapeHtml(p.ping)} ms`}</td><td class="num">${escapeHtml(fmtDuration(Date.now() - p.joinedAt))}</td></tr>`
    )
    .join("");
  return `${head}<div class="table-wrap"><table class="ptable">
    <thead><tr><th>ID</th><th>Name</th><th>Ping</th><th>Online for</th></tr></thead><tbody>${rows}</tbody></table></div>
    ${list.length > MAX_ROWS ? `<p class="muted">\u2026and ${list.length - MAX_ROWS} more.</p>` : ""}`;
}

// ----- Discord card preview ---------------------------------------------------
function discordPreviewHtml(d) {
  const c = d.card;
  const st = STATUS_LABEL[d.status] && d.status !== "unknown" ? d.status : "restarting";
  const label = { online: "Online", restarting: "Restarting...", offline: "Offline" }[st];
  const color = { online: "#57f287", restarting: "#f5a623", offline: "#ed4245" }[st];
  const max = d.current?.max ?? d.lastKnownMaxPlayers ?? "?";

  let players = "N/A";
  if (st === "online") players = `<b>${fmtNum(d.current ? d.current.count : d.lastKnownPlayers ?? 0)}</b> / <b>${escapeHtml(max)}</b>`;
  else if (st === "restarting" && d.lastKnownPlayers != null) players = `<b>${fmtNum(d.lastKnownPlayers)}</b> / <b>${escapeHtml(max)}</b> <i>(last known)</i>`;

  const emoji = c.emojis?.[st];
  const emojiHtml =
    (emoji
      ? `<img class="dc-emoji" src="${escapeHtml(emoji)}" alt="" onerror="this.style.display='none';this.nextElementSibling.style.display='inline-block'" />`
      : "") + `<span class="dc-dot ${st}" style="${emoji ? "display:none" : ""}"></span>`;

  const buttons = [];
  if (c.connectUrl) buttons.push("Connect");
  buttons.push("Support");
  (c.customButtons || []).forEach((b) => buttons.push(b.label));
  const buttonsHtml = buttons.map((b) => `<span class="dc-btn">${escapeHtml(b)} <span class="dc-ext">\u2197</span></span>`).join("");

  const time = new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  return `
    <div class="card-title"><h2>Discord preview</h2><span class="muted">How your status card looks in Discord \u2014 updates live</span></div>
    <div class="dc">
      <div class="dc-msg">
        <img class="dc-avatar" src="${escapeHtml(d.identity.avatar)}" alt="" />
        <div class="dc-body">
          <div class="dc-line"><span class="dc-name">${escapeHtml(d.identity.name)}</span><span class="dc-tag">APP</span><span class="dc-time">Today at ${escapeHtml(time)}</span></div>
          <div class="dc-card" style="border-left-color:${color}">
            <div class="dc-head">
              <h3>${escapeHtml(c.serverName)}</h3>
              ${c.thumbnail ? `<img class="dc-thumb" src="${escapeHtml(c.thumbnail)}" alt="" referrerpolicy="no-referrer" onerror="this.style.display='none'" />` : ""}
            </div>
            <hr />
            <div class="dc-text">${emojiHtml} <b>Status:</b> ${label}<br />\u{1F465} <b>Players:</b> ${players}</div>
            <div class="dc-text"><b>F8 Connect</b><pre>connect ${escapeHtml(c.connectCode)}</pre></div>
            ${c.banner ? `<img class="dc-banner" src="${escapeHtml(c.banner)}" alt="" referrerpolicy="no-referrer" onerror="this.style.display='none'" />` : ""}
            <hr />
            <div class="dc-buttons">${buttonsHtml}</div>
            <div class="dc-foot">${escapeHtml(c.footerText || "Last updated")} \u2022 ${escapeHtml(discordRel(d.lastCheckedAt))}</div>
          </div>
        </div>
      </div>
    </div>`;
}

// ----- animated, glowing line chart ------------------------------------------
// Monotone cubic interpolation: smooth curve that never dips below/above the data.
function monotonePath(pts) {
  const n = pts.length;
  if (n === 1) return `M${pts[0][0]},${pts[0][1]}`;
  const dx = [];
  const m = [];
  const t = [];
  for (let i = 0; i < n - 1; i++) {
    dx[i] = pts[i + 1][0] - pts[i][0];
    m[i] = (pts[i + 1][1] - pts[i][1]) / dx[i];
  }
  t[0] = m[0];
  t[n - 1] = m[n - 2];
  for (let i = 1; i < n - 1; i++) t[i] = m[i - 1] * m[i] <= 0 ? 0 : (m[i - 1] + m[i]) / 2;
  for (let i = 0; i < n - 1; i++) {
    if (m[i] === 0) {
      t[i] = 0;
      t[i + 1] = 0;
      continue;
    }
    const a = t[i] / m[i];
    const b = t[i + 1] / m[i];
    const s = a * a + b * b;
    if (s > 9) {
      const k = 3 / Math.sqrt(s);
      t[i] = k * a * m[i];
      t[i + 1] = k * b * m[i];
    }
  }
  let d = `M${pts[0][0]},${pts[0][1]}`;
  for (let i = 0; i < n - 1; i++) {
    const x1 = pts[i][0] + dx[i] / 3;
    const y1 = pts[i][1] + (t[i] * dx[i]) / 3;
    const x2 = pts[i + 1][0] - dx[i] / 3;
    const y2 = pts[i + 1][1] - (t[i + 1] * dx[i]) / 3;
    d += ` C${x1},${y1} ${x2},${y2} ${pts[i + 1][0]},${pts[i + 1][1]}`;
  }
  return d;
}

function drawChart(animate) {
  const wrap = document.getElementById("chart-wrap");
  if (!wrap || !lastStats) return;
  const series = chartRange === "24h" ? lastStats.series.slice(-24) : lastStats.series;
  if (!series.some((p) => p.avg != null)) {
    wrap.innerHTML = `<div class="chart-empty">Collecting data \u2014 the graph fills in as StatHive checks your server every 30 seconds.</div>`;
    return;
  }

  const W = Math.max(320, wrap.clientWidth || 720);
  const H = 300;
  const pad = { l: 36, r: 16, t: 18, b: 28 };
  const iw = W - pad.l - pad.r;
  const ih = H - pad.t - pad.b;
  const top = Math.max(1, ...series.map((p) => p.max ?? 0));
  const niceMax = top <= 4 ? 4 : Math.ceil(top / 4) * 4;
  const x = (i) => pad.l + (series.length === 1 ? iw / 2 : (i / (series.length - 1)) * iw);
  const y = (v) => pad.t + ih * (1 - v / niceMax);

  // Split into runs of consecutive hours so gaps (bot offline) aren't joined with a line
  const runs = [];
  let run = [];
  series.forEach((p, i) => {
    if (p.avg == null) {
      if (run.length) runs.push(run);
      run = [];
    } else run.push([x(i), y(p.avg)]);
  });
  if (run.length) runs.push(run);

  let line = "";
  let area = "";
  let dots = "";
  for (const r of runs) {
    if (r.length === 1) {
      dots += `<circle class="pt" cx="${r[0][0]}" cy="${r[0][1]}" r="3.2" />`;
      continue;
    }
    const d = monotonePath(r);
    line += `${d} `;
    area += `${d} L${r[r.length - 1][0]},${y(0)} L${r[0][0]},${y(0)} Z `;
  }

  const pts = series.map((p, i) => (p.avg == null ? null : { x: x(i), y: y(p.avg), p })).filter(Boolean);
  const last = pts[pts.length - 1];

  let grid = "";
  for (let g = 0; g <= 4; g++) {
    const v = (niceMax / 4) * g;
    grid += `<line class="g" x1="${pad.l}" x2="${W - pad.r}" y1="${y(v)}" y2="${y(v)}" /><text class="ax" x="${pad.l - 8}" y="${y(v) + 3.5}" text-anchor="end">${Math.round(v)}</text>`;
  }
  let xl = "";
  series.forEach((p, i) => {
    const dt = new Date(p.t);
    if (chartRange === "7d" ? dt.getHours() === 0 : dt.getHours() % 4 === 0) {
      const lbl = chartRange === "7d" ? dt.toLocaleDateString(undefined, { weekday: "short" }) : dt.toLocaleTimeString([], { hour: "numeric" });
      xl += `<text class="ax" x="${x(i)}" y="${H - 8}" text-anchor="middle">${escapeHtml(lbl)}</text>`;
    }
  });

  // Filters use userSpaceOnUse so a perfectly flat line (zero-height bbox) still renders.
  wrap.innerHTML = `
    <svg class="glow-chart ${animate ? "anim" : ""}" viewBox="0 0 ${W} ${H}" role="img" aria-label="Players online over time">
      <defs>
        <linearGradient id="lg-line" gradientUnits="userSpaceOnUse" x1="${pad.l}" y1="0" x2="${W - pad.r}" y2="0">
          <stop offset="0" stop-color="#5865f2" /><stop offset=".55" stop-color="#a855f7" /><stop offset="1" stop-color="#22d3ee" />
        </linearGradient>
        <linearGradient id="lg-area" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stop-color="#8b5cf6" stop-opacity=".34" /><stop offset="1" stop-color="#5865f2" stop-opacity="0" />
        </linearGradient>
        <filter id="f-blur" filterUnits="userSpaceOnUse" x="0" y="0" width="${W}" height="${H}"><feGaussianBlur stdDeviation="7" /></filter>
        <filter id="f-glow" filterUnits="userSpaceOnUse" x="0" y="0" width="${W}" height="${H}">
          <feGaussianBlur stdDeviation="2.4" result="b" /><feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge>
        </filter>
      </defs>
      ${grid}${xl}
      <path class="area" d="${area}" fill="url(#lg-area)" />
      <path class="halo" d="${line}" pathLength="1" fill="none" stroke="url(#lg-line)" stroke-width="9" stroke-linecap="round" stroke-linejoin="round" filter="url(#f-blur)" />
      <path class="ln" d="${line}" pathLength="1" fill="none" stroke="url(#lg-line)" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" filter="url(#f-glow)" />
      ${dots}
      <g class="last"><circle class="ring" cx="${last.x}" cy="${last.y}" r="5" /><circle class="core" cx="${last.x}" cy="${last.y}" r="4" filter="url(#f-glow)" /></g>
      <g class="hover" style="display:none"><line class="hl" y1="${pad.t}" y2="${pad.t + ih}" /><circle class="hd" r="5" filter="url(#f-glow)" /></g>
    </svg>
    <div class="chart-tip" style="display:none"></div>`;

  const svg = wrap.querySelector("svg");
  const tip = wrap.querySelector(".chart-tip");
  const hov = svg.querySelector(".hover");
  svg.addEventListener("pointermove", (e) => {
    const r = svg.getBoundingClientRect();
    const mx = ((e.clientX - r.left) / r.width) * W;
    let best = pts[0];
    for (const q of pts) if (Math.abs(q.x - mx) < Math.abs(best.x - mx)) best = q;
    hov.style.display = "";
    const hl = hov.querySelector(".hl");
    hl.setAttribute("x1", best.x);
    hl.setAttribute("x2", best.x);
    const hd = hov.querySelector(".hd");
    hd.setAttribute("cx", best.x);
    hd.setAttribute("cy", best.y);
    tip.style.display = "";
    tip.style.left = `${Math.min(92, Math.max(8, (best.x / W) * 100))}%`;
    tip.style.top = `${(best.y / H) * 100}%`;
    tip.innerHTML = `<b>${best.p.avg}</b> avg \u00B7 <b>${best.p.max}</b> peak<span>${escapeHtml(new Date(best.p.t).toLocaleString([], { weekday: "short", hour: "numeric" }))}</span>`;
  });
  svg.addEventListener("pointerleave", () => {
    hov.style.display = "none";
    tip.style.display = "none";
  });
}

// ---------------------------------------------------------------------------
// Global link interception (so internal links use pushState, no full reload)
// ---------------------------------------------------------------------------
document.addEventListener("click", (e) => {
  const link = e.target.closest("a[data-nav], a.guild-card");
  if (!link) return;
  const href = link.getAttribute("href");
  if (!href || href.startsWith("/auth/") || /^https?:\/\//i.test(href) || link.target === "_blank") return; // real navigations (login/logout/invite)
  e.preventDefault();
  navigate(href);
});

render();
