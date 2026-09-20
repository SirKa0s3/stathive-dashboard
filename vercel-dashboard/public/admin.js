// ---------------------------------------------------------------------------
// StatHive admin panel  (/admin, /admin/servers, /admin/users)
// Only reachable for Discord IDs listed in ADMIN_IDS — the server enforces that
// on every /api/admin/* request; this file is just the UI.
// Uses helpers from app.js: app, api, toast, escapeHtml, navigate, fmtNum, timeAgo, glowChart, statsTimer
// ---------------------------------------------------------------------------

const ADM_ICONS = {
  overview: `<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="9" rx="1.5"/><rect x="14" y="3" width="7" height="5" rx="1.5"/><rect x="14" y="12" width="7" height="9" rx="1.5"/><rect x="3" y="16" width="7" height="5" rx="1.5"/></svg>`,
  servers: `<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="7" rx="2"/><rect x="3" y="13" width="18" height="7" rx="2"/><path d="M7 7.5h.01M7 16.5h.01"/></svg>`,
  users: `<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8"/></svg>`,
  back: `<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 12H5M12 19l-7-7 7-7"/></svg>`,
};

function admAvatar(u, size = 64) {
  return u && u.avatar ? `https://cdn.discordapp.com/avatars/${u.id}/${u.avatar}.png?size=${size}` : "https://cdn.discordapp.com/embed/avatars/0.png";
}
function admFmtDate(ms) {
  return ms ? new Date(ms).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" }) : "\u2014";
}
function admAgo(ms) {
  return ms ? timeAgo(new Date(ms).toISOString()) : "\u2014";
}
function admUptime(sec) {
  const d = Math.floor(sec / 86400);
  const h = Math.floor((sec % 86400) / 3600);
  const m = Math.floor((sec % 3600) / 60);
  return d ? `${d}d ${h}h` : h ? `${h}h ${m}m` : `${m}m`;
}
function admIcon(url, name) {
  return url ? `<img class="adm-ico" src="${escapeHtml(url)}" alt="" />` : `<div class="adm-ico fb">${escapeHtml((name || "?")[0])}</div>`;
}

function adminShell(user, section) {
  const nav = (key, href, label) =>
    `<a class="adm-nav ${section === key ? "active" : ""}" href="${href}" data-nav>${ADM_ICONS[key]}<span>${label}</span></a>`;
  return `
    <div class="adm">
      <aside class="adm-side">
        <a class="adm-brand" href="/admin" data-nav>
          <span class="logo-sm"><img src="/logo.png" alt="" /></span>
          <span><b>StatHive</b><small>ADMIN PANEL</small></span>
        </a>
        <nav class="adm-navs">
          ${nav("overview", "/admin", "Overview")}
          ${nav("servers", "/admin/servers", "Servers")}
          ${nav("users", "/admin/users", "Users &amp; bans")}
        </nav>
        <div class="adm-foot">
          <a class="adm-nav" href="/" data-nav>${ADM_ICONS.back}<span>Back to dashboard</span></a>
          <div class="adm-me"><img src="${escapeHtml(admAvatar(user, 64))}" alt="" /><span>${escapeHtml(user.username)}</span><a href="/auth/logout" title="Log out">Log out</a></div>
        </div>
      </aside>
      <main class="adm-main" id="adm-main"><div class="center-screen" style="min-height:60vh"><div class="spinner"></div></div></main>
    </div>`;
}

async function renderAdmin(user, section) {
  app.innerHTML = adminShell(user, section);
  const main = document.getElementById("adm-main");
  const here = location.pathname;
  const ok = () => location.pathname === here && document.getElementById("adm-main") === main;
  try {
    if (section === "servers") await adminServers(main, ok);
    else if (section === "users") await adminUsers(main, ok);
    else await adminOverview(main, ok);
  } catch (err) {
    if (ok()) main.innerHTML = `<div class="banner error">${escapeHtml(err.message)}</div>`;
  }
}

// ----------------------------- Overview -----------------------------------
async function adminOverview(main, ok) {
  const load = () => api("/api/admin/overview");
  const first = await load();
  if (!ok()) return;

  main.innerHTML = `
    <div class="page-header adm-head">
      <div><h1>Overview</h1><p>Everything happening across StatHive, right now.</p></div>
      <span class="live"><i></i>Live</span>
    </div>
    <div class="adm-grid" id="adm-tiles"></div>
    <div class="adm-row">
      <div class="card adm-chart">
        <div class="card-title"><h2>Players online \u00B7 all servers</h2><span class="muted">last 7 days, hourly average</span></div>
        <div id="adm-chart" class="chart-wrap"></div>
      </div>
      <div class="card" id="adm-mix"></div>
    </div>
    <div class="adm-row adm-row-2">
      <div class="card" id="adm-top"></div>
      <div class="card" id="adm-bot"></div>
    </div>`;

  const paint = (d, animate) => {
    if (!document.getElementById("adm-tiles")) return;
    const t = d.totals;
    const b = d.bot;
    const tile = (label, value, sub, cls = "") =>
      `<div class="adm-tile ${cls}"><div class="adm-label">${label}</div><div class="adm-num">${value}</div><div class="adm-sub">${sub}</div></div>`;
    document.getElementById("adm-tiles").innerHTML = [
      tile("Servers", fmtNum(t.guilds), `${fmtNum(t.members)} members in total`),
      tile("Tracked statuses", fmtNum(t.total), `${t.online} online \u00B7 ${t.restarting} restarting \u00B7 ${t.offline} offline`),
      tile("Players online now", fmtNum(t.players), "across every game server", "hot"),
      tile("Peak players \u00B7 7 days", fmtNum(Math.round(d.peak7d)), "all servers combined"),
      tile("Players tracked", fmtNum(t.uniquePlayers), "unique profiles, counted per server"),
      tile("Dashboard users", fmtNum(t.dashboardUsers), "have logged in with Discord"),
      tile("Banned users", fmtNum(t.bannedUsers), t.bannedUsers ? "blocked from the bot" : "nobody banned", t.bannedUsers ? "warn" : ""),
      tile("Bot uptime", admUptime(b.uptimeSec), b.pingMs != null ? `${b.pingMs} ms gateway ping` : "connecting\u2026"),
    ].join("");

    glowChart(document.getElementById("adm-chart"), d.series, "7d", animate, {
      unit: "players",
      colors: ["#f59e0b", "#f43f5e", "#a855f7"],
      empty: "Collecting data \u2014 this fills in as your servers are checked.",
    });

    const parts = [["online", "Online", "#57f287"], ["restarting", "Restarting", "#f5a623"], ["offline", "Offline", "#ed4245"], ["unknown", "Unknown", "#6b7280"]];
    document.getElementById("adm-mix").innerHTML = `
      <div class="card-title"><h2>Status mix</h2></div>
      ${
        t.total === 0
          ? `<p class="muted">No statuses are being tracked yet.</p>`
          : `<div class="mixbar">${parts.map(([k, , c]) => (t[k] ? `<i style="width:${(t[k] / t.total) * 100}%;background:${c}"></i>` : "")).join("")}</div>
             <div class="mixlist">${parts
               .map(([k, label, c]) => `<div><span class="dot" style="background:${c}"></span>${label}<b>${fmtNum(t[k])}</b><small>${Math.round((t[k] / t.total) * 100)}%</small></div>`)
               .join("")}</div>`
      }`;

    document.getElementById("adm-top").innerHTML = `
      <div class="card-title"><h2>Busiest servers right now</h2></div>
      ${
        d.top.length
          ? d.top
              .map(
                (g, i) => `<a class="adm-toprow" href="/g/${g.id}" data-nav><span class="rank">${i + 1}</span>${admIcon(g.icon, g.name)}
                  <span class="nm">${escapeHtml(g.name)}<small>${g.statuses} status${g.statuses === 1 ? "" : "es"}</small></span><b>${fmtNum(g.players)}</b><small>players</small></a>`
              )
              .join("")
          : `<p class="muted">No players online right now.</p>`
      }`;

    const kv = (k, v) => `<div class="kv"><span>${k}</span><b>${v}</b></div>`;
    document.getElementById("adm-bot").innerHTML = `
      <div class="card-title"><h2>Bot health</h2></div>
      <div class="bot-id">${b.avatar ? `<img src="${escapeHtml(b.avatar)}" alt="" />` : ""}<div><b>${escapeHtml(b.username)}</b><small>${escapeHtml(b.id || "")}</small></div></div>
      ${kv("Gateway ping", b.pingMs != null ? `${b.pingMs} ms` : "\u2014")}
      ${kv("Uptime", admUptime(b.uptimeSec))}
      ${kv("Memory", `${b.memoryMb} MB`)}
      ${kv("Check interval", `${b.updateIntervalSec}s`)}
      ${kv("discord.js", escapeHtml(b.discordjs))}
      ${kv("Node.js", escapeHtml(b.node))}
      ${kv("Admins", fmtNum(b.admins))}`;
  };

  paint(first, true);
  statsTimer = setInterval(async () => {
    try {
      const d = await load();
      if (ok()) paint(d, false);
    } catch {}
  }, 15000);
}

// ----------------------------- Servers ------------------------------------
async function adminServers(main, ok) {
  const list = await api("/api/admin/servers");
  if (!ok()) return;
  let q = "";
  let sort = "players";

  main.innerHTML = `
    <div class="page-header adm-head">
      <div><h1>Servers</h1><p id="srv-count"></p></div>
      <div class="adm-tools">
        <input type="text" id="srv-q" placeholder="Search name, server ID or owner ID\u2026" />
        <select id="srv-sort">
          <option value="players">Most players</option><option value="members">Most members</option>
          <option value="statuses">Most statuses</option><option value="name">Name (A\u2013Z)</option><option value="joined">Recently added</option>
        </select>
      </div>
    </div>
    <div class="card adm-tablecard"><div class="table-wrap adm-tall" id="srv-body"></div></div>`;

  const sorters = {
    players: (a, b) => b.statuses.players - a.statuses.players || b.members - a.members,
    members: (a, b) => b.members - a.members,
    statuses: (a, b) => b.statuses.total - a.statuses.total || b.members - a.members,
    name: (a, b) => a.name.localeCompare(b.name),
    joined: (a, b) => (b.joinedAt || 0) - (a.joinedAt || 0),
  };
  const dots = (s) =>
    ["online", "restarting", "offline"]
      .filter((k) => s[k])
      .map((k) => `<span class="cnt"><span class="dot ${k}"></span>${s[k]}</span>`)
      .join("") || `<span class="muted">\u2014</span>`;

  const paint = () => {
    const needle = q.trim().toLowerCase();
    const rows = list
      .filter((g) => !needle || g.name.toLowerCase().includes(needle) || g.id.includes(needle) || String(g.ownerId).includes(needle))
      .sort(sorters[sort]);
    document.getElementById("srv-count").textContent = `${rows.length} of ${list.length} server${list.length === 1 ? "" : "s"} \u2014 click one to see it exactly as its managers do.`;
    document.getElementById("srv-body").innerHTML = rows.length
      ? `<table class="adm-table"><thead><tr><th>Server</th><th>Owner ID</th><th class="r">Members</th><th>Statuses</th><th class="r">Players</th><th>Added</th><th></th></tr></thead><tbody>${rows
          .map(
            (g) => `<tr class="click" data-id="${g.id}">
              <td><div class="who">${admIcon(g.icon, g.name)}<div><b>${escapeHtml(g.name)}</b><small>${g.id}</small></div></div></td>
              <td class="dim">${escapeHtml(g.ownerId || "\u2014")}</td>
              <td class="r">${fmtNum(g.members)}</td>
              <td><div class="cnts"><span class="tot">${g.statuses.total}</span>${dots(g.statuses)}</div></td>
              <td class="r">${g.statuses.players ? `<b>${fmtNum(g.statuses.players)}</b>` : `<span class="muted">0</span>`}</td>
              <td class="dim">${escapeHtml(admFmtDate(g.joinedAt))}</td>
              <td class="go">\u203A</td></tr>`
          )
          .join("")}</tbody></table>`
      : `<p class="muted" style="padding:22px">No servers match your search.</p>`;
    document.querySelectorAll("#srv-body tr.click").forEach((tr) => tr.addEventListener("click", () => navigate(`/g/${tr.dataset.id}`)));
  };

  document.getElementById("srv-q").addEventListener("input", (e) => {
    q = e.target.value;
    paint();
  });
  document.getElementById("srv-sort").addEventListener("change", (e) => {
    sort = e.target.value;
    paint();
  });
  paint();
}

// ----------------------------- Ban evidence (picker + ban dialog) -------------------------------
// Files are checked / shrunk in the browser, then sent as base64 inside the ban request. The server
// (api/server.js) re-checks them and forwards them to the user in their ban DM.
const EVD_MAX_FILES = 5;
const EVD_LIMIT = 3000000; // total bytes (the server allows 3 MiB; this leaves a little margin)
const EVD_IMAGE_TARGET = 900000; // screenshots are shrunk to roughly this size each

function evdInjectStyles() {
  if (document.getElementById("evd-style")) return;
  const style = document.createElement("style");
  style.id = "evd-style";
  style.textContent = `
    .evd { margin-top: 14px; }
    .evd-drop { display: flex; align-items: center; gap: 14px; padding: 14px 16px; border: 1.5px dashed var(--border, rgba(255,255,255,.16)); border-radius: var(--radius-md, 14px); background: var(--surface-2, rgba(255,255,255,.02)); cursor: pointer; outline: none; transition: border-color .15s, background .15s; }
    .evd-drop:hover, .evd-drop:focus-visible { border-color: var(--accent, #5865f2); }
    .evd-drop.drag { border-color: var(--accent, #5865f2); background: var(--accent-soft, rgba(88,101,242,.14)); }
    .evd-icon { flex: none; width: 38px; height: 38px; display: grid; place-items: center; border-radius: 10px; background: var(--accent-soft, rgba(88,101,242,.15)); color: var(--accent, #5865f2); }
    .evd-title { font-size: 14px; font-weight: 700; color: var(--text, #eef0f6); }
    .evd-title span { font-weight: 500; color: var(--text-dim, #9aa1b5); }
    .evd-hint { margin-top: 2px; font-size: 12.5px; line-height: 1.45; color: var(--text-dim, #9aa1b5); }
    .evd-hint b { color: var(--text, #eef0f6); font-weight: 600; }
    .evd-list { display: grid; gap: 8px; margin-top: 10px; }
    .evd-list:empty { display: none; }
    .evd-item { display: flex; align-items: center; gap: 12px; padding: 8px 10px; border: 1px solid var(--border, rgba(255,255,255,.08)); border-radius: 12px; background: var(--surface-2, rgba(255,255,255,.03)); }
    .evd-thumb { flex: none; width: 44px; height: 44px; border-radius: 8px; object-fit: cover; display: grid; place-items: center; background: rgba(255,255,255,.06); font-size: 11px; font-weight: 800; letter-spacing: .04em; color: var(--text-dim, #9aa1b5); }
    .evd-info { min-width: 0; flex: 1; }
    .evd-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 13px; font-weight: 600; color: var(--text, #eef0f6); }
    .evd-sub { margin-top: 1px; font-size: 12px; color: var(--text-faint, #6b7286); }
    .evd-x { flex: none; width: 28px; height: 28px; border: 0; border-radius: 8px; background: transparent; color: var(--text-dim, #9aa1b5); font-size: 14px; cursor: pointer; }
    .evd-x:hover { background: var(--danger-soft, rgba(237,66,69,.15)); color: #ff8183; }
    .evd-busy { color: var(--text-dim, #9aa1b5); font-size: 13px; }
    .evd-spin { flex: none; width: 18px; height: 18px; margin: 0 13px; border: 2px solid rgba(255,255,255,.15); border-top-color: var(--accent, #5865f2); border-radius: 50%; animation: evd-spin .7s linear infinite; }
    @keyframes evd-spin { to { transform: rotate(360deg); } }
    .evd-meta { margin-top: 8px; font-size: 12px; color: var(--text-faint, #6b7286); }
    .evd-meta:empty { display: none; }
    .evd-bar { height: 4px; margin-top: 6px; border-radius: 4px; background: rgba(255,255,255,.07); overflow: hidden; }
    .evd-bar i { display: block; height: 100%; background: var(--accent, #5865f2); }
    .evd-bar i.warn { background: var(--warning, #f5a623); }
    .evd-modal-note { margin: -8px 0 16px; font-size: 13px; color: var(--text-dim, #9aa1b5); }
  `;
  document.head.appendChild(style);
}

const evdFmtSize = (n) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1e3))} KB`);

function evdKind(file) {
  const type = (file.type || "").toLowerCase();
  const name = (file.name || "").toLowerCase();
  if (/^image\/(png|jpe?g|webp)$/.test(type)) return "image";
  if (type === "image/gif") return "gif"; // kept as-is so animations survive
  if (type === "application/pdf" || name.endsWith(".pdf")) return "pdf";
  if (type.startsWith("text/") || /\.(txt|log)$/.test(name)) return "text";
  return null;
}

function evdReadImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error(`Couldn\u2019t read \u201c${file.name}\u201d as an image.`));
    };
    img.src = url;
  });
}

// Small images are kept untouched; big screenshots are scaled down and re-saved as JPEG until they're small enough.
async function evdShrinkImage(file) {
  const img = await evdReadImage(file);
  const longest = Math.max(img.naturalWidth, img.naturalHeight);
  if (file.size <= EVD_IMAGE_TARGET && longest <= 1600) return { blob: file, name: file.name };

  let blob = null;
  for (const [max, quality] of [[1600, 0.85], [1280, 0.72], [1024, 0.6], [800, 0.5]]) {
    const scale = Math.min(1, max / longest);
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#fff"; // JPEG has no transparency
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", quality));
    if (blob && blob.size <= EVD_IMAGE_TARGET) break;
  }
  if (!blob) throw new Error(`Couldn\u2019t shrink \u201c${file.name}\u201d.`);
  if (blob.size >= file.size && file.size <= EVD_LIMIT) return { blob: file, name: file.name }; // already smaller than our attempt
  return { blob, name: file.name.replace(/\.[^.]+$/, "") + ".jpg" };
}

function evdToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",")[1] || "");
    reader.onerror = () => reject(new Error("Couldn\u2019t read one of the evidence files."));
    reader.readAsDataURL(blob);
  });
}

// Drop zone + file list. Works with click-to-browse, drag & drop and pasting screenshots (Ctrl+V).
// scope = the element that listens for paste events (defaults to the picker itself).
function createEvidencePicker(mount, { scope } = {}) {
  evdInjectStyles();
  let items = [];
  let busy = 0;
  let seq = 0;
  let queue = Promise.resolve();

  mount.innerHTML = `
    <div class="evd">
      <div class="evd-drop" tabindex="0" role="button" aria-label="Attach evidence files">
        <div class="evd-icon"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21.4 11.1l-9.2 9.2a6 6 0 0 1-8.5-8.5l9.2-9.2a4 4 0 0 1 5.7 5.7l-9.2 9.2a2 2 0 0 1-2.8-2.8l8.5-8.5"/></svg></div>
        <div>
          <div class="evd-title">Attach evidence <span>(optional)</span></div>
          <div class="evd-hint">Drop files here, <b>paste a screenshot</b> (Ctrl+V) or click to browse. Sent to the user in their ban DM.<br>Up to ${EVD_MAX_FILES} files, ${evdFmtSize(EVD_LIMIT)} in total \u00b7 images, PDF or text.</div>
        </div>
        <input type="file" multiple hidden accept="image/png,image/jpeg,image/webp,image/gif,application/pdf,text/plain,.txt,.log,.pdf" />
      </div>
      <div class="evd-list"></div>
      <div class="evd-meta"></div>
    </div>`;

  const drop = mount.querySelector(".evd-drop");
  const input = mount.querySelector("input[type=file]");
  const list = mount.querySelector(".evd-list");
  const meta = mount.querySelector(".evd-meta");
  const total = () => items.reduce((n, it) => n + it.size, 0);

  function render() {
    list.innerHTML = "";
    for (const it of items) {
      const row = document.createElement("div");
      row.className = "evd-item";
      const thumb = it.url
        ? `<img class="evd-thumb" src="${it.url}" alt="" />`
        : `<div class="evd-thumb">${it.kind === "pdf" ? "PDF" : "TXT"}</div>`;
      row.innerHTML = `${thumb}<div class="evd-info"><div class="evd-name">${escapeHtml(it.name)}</div><div class="evd-sub">${evdFmtSize(it.size)}${it.note ? ` \u00b7 ${escapeHtml(it.note)}` : ""}</div></div><button type="button" class="evd-x" title="Remove" aria-label="Remove ${escapeHtml(it.name)}">\u2715</button>`;
      row.querySelector(".evd-x").addEventListener("click", () => remove(it.id));
      list.appendChild(row);
    }
    if (busy) list.insertAdjacentHTML("beforeend", `<div class="evd-item evd-busy"><div class="evd-spin"></div>Processing\u2026</div>`);

    const used = total();
    const pct = Math.min(100, Math.round((used / EVD_LIMIT) * 100));
    meta.innerHTML =
      items.length || busy
        ? `${items.length} file${items.length === 1 ? "" : "s"} \u00b7 ${evdFmtSize(used)} of ${evdFmtSize(EVD_LIMIT)}<div class="evd-bar"><i class="${pct > 80 ? "warn" : ""}" style="width:${pct}%"></i></div>`
        : "";
  }

  function remove(id) {
    const i = items.findIndex((it) => it.id === id);
    if (i < 0) return;
    if (items[i].url) URL.revokeObjectURL(items[i].url);
    items.splice(i, 1);
    render();
  }

  function clear() {
    items.forEach((it) => it.url && URL.revokeObjectURL(it.url));
    items = [];
    render();
  }

  // Files are processed one after another so the size limit is checked in order.
  function addFiles(fileList) {
    const files = Array.from(fileList || []);
    if (!files.length) return;
    queue = queue.then(async () => {
      for (const file of files) {
        if (items.length >= EVD_MAX_FILES) {
          toast(`You can attach up to ${EVD_MAX_FILES} files.`, "error");
          break;
        }
        const kind = evdKind(file);
        if (!kind) {
          toast(`\u201c${file.name}\u201d isn\u2019t supported. Attach images, PDFs or text files.`, "error");
          continue;
        }
        busy++;
        render();
        try {
          let blob = file;
          let name = file.name || "evidence";
          let note = "";
          if (kind === "image") {
            const shrunk = await evdShrinkImage(file);
            blob = shrunk.blob;
            name = shrunk.name;
            if (blob !== file) note = "resized";
          }
          if (total() + blob.size > EVD_LIMIT) {
            toast(`\u201c${file.name}\u201d doesn\u2019t fit: evidence is limited to ${evdFmtSize(EVD_LIMIT)} in total.`, "error");
            continue;
          }
          items.push({ id: ++seq, name, kind, blob, size: blob.size, note, url: kind === "image" || kind === "gif" ? URL.createObjectURL(blob) : null });
        } catch (err) {
          toast(err.message || `Couldn\u2019t add \u201c${file.name}\u201d.`, "error");
        } finally {
          busy--;
          render();
        }
      }
    });
  }

  drop.addEventListener("click", () => input.click());
  drop.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      input.click();
    }
  });
  input.addEventListener("change", () => {
    addFiles(input.files);
    input.value = "";
  });
  ["dragenter", "dragover"].forEach((type) =>
    drop.addEventListener(type, (e) => {
      e.preventDefault();
      drop.classList.add("drag");
    })
  );
  ["dragleave", "drop"].forEach((type) =>
    drop.addEventListener(type, (e) => {
      e.preventDefault();
      drop.classList.remove("drag");
    })
  );
  drop.addEventListener("drop", (e) => addFiles(e.dataTransfer && e.dataTransfer.files));
  (scope || mount).addEventListener("paste", (e) => {
    const images = Array.from((e.clipboardData && e.clipboardData.files) || []).filter((f) => (f.type || "").startsWith("image/"));
    if (!images.length) return; // plain text pastes behave normally
    e.preventDefault();
    addFiles(images);
  });

  return {
    count: () => items.length,
    clear,
    // waits for anything still being processed, then returns [{ data: "<base64>" }, ...]
    async getPayload() {
      await queue;
      return Promise.all(items.map(async (it) => ({ data: await evdToBase64(it.blob) })));
    },
  };
}

// Ban dialog used by the per-row "Ban" buttons (replaces the old browser prompt).
// onSubmit({ reason, evidence }) must resolve true when the ban went through, false to keep the dialog open.
function evdOpenBanModal({ id, name }, onSubmit) {
  evdInjectStyles();
  const backdrop = document.createElement("div");
  backdrop.className = "modal-backdrop";
  backdrop.innerHTML = `
    <div class="modal">
      <h2>Ban ${escapeHtml(name || id)}</h2>
      <p class="evd-modal-note">They\u2019ll get a DM with the reason and any evidence you attach.</p>
      <div class="field">
        <label>Reason <span class="hint" style="display:inline">(optional)</span></label>
        <input type="text" class="evd-reason" maxlength="200" placeholder="Shown to the user in their ban DM" />
      </div>
      <div class="field">
        <label>Evidence</label>
        <div class="evd-mount"></div>
      </div>
      <div class="modal-actions">
        <button type="button" class="btn btn-ghost evd-cancel">Cancel</button>
        <button type="button" class="btn btn-danger evd-confirm">Ban user</button>
      </div>
    </div>`;
  document.body.appendChild(backdrop);

  const reasonEl = backdrop.querySelector(".evd-reason");
  const confirmBtn = backdrop.querySelector(".evd-confirm");
  const cancelBtn = backdrop.querySelector(".evd-cancel");
  const picker = createEvidencePicker(backdrop.querySelector(".evd-mount"), { scope: backdrop.querySelector(".modal") });
  let submitting = false;

  const onKey = (e) => {
    if (e.key === "Escape" && !submitting) close();
  };
  function close() {
    picker.clear();
    document.removeEventListener("keydown", onKey);
    backdrop.remove();
  }
  document.addEventListener("keydown", onKey);
  cancelBtn.addEventListener("click", () => !submitting && close());
  backdrop.addEventListener("mousedown", (e) => {
    if (e.target === backdrop && !submitting) close();
  });
  reasonEl.addEventListener("keydown", (e) => {
    if (e.key === "Enter") confirmBtn.click();
  });

  confirmBtn.addEventListener("click", async () => {
    if (submitting) return;
    submitting = true;
    confirmBtn.disabled = cancelBtn.disabled = true;
    const label = confirmBtn.textContent;
    confirmBtn.textContent = "Banning\u2026";
    try {
      const evidence = await picker.getPayload();
      if (await onSubmit({ reason: reasonEl.value.trim(), evidence })) return close();
    } catch (err) {
      toast(err.message, "error");
    } finally {
      submitting = false;
      if (backdrop.isConnected) {
        confirmBtn.disabled = cancelBtn.disabled = false;
        confirmBtn.textContent = label;
      }
    }
  });
  reasonEl.focus();
}

// ----------------------------- Users & bans -------------------------------
async function adminUsers(main, ok) {
  let data = await api("/api/admin/users");
  if (!ok()) return;
  let q = "";

  main.innerHTML = `
    <div class="page-header adm-head"><div><h1>Users &amp; bans</h1><p>Banned users can\u2019t log in to the dashboard or use the bot in Discord. They\u2019re sent a DM with the reason and any evidence you attach.</p></div></div>
    <div class="card">
      <div class="card-title"><h2>Ban a user</h2><span class="muted">Right-click a user in Discord \u2192 Copy User ID (needs Developer Mode)</span></div>
      <div class="ban-form">
        <input type="text" id="ban-id" inputmode="numeric" maxlength="20" placeholder="Discord user ID, e.g. 123456789012345678" />
        <input type="text" id="ban-reason" maxlength="200" placeholder="Reason (optional \u2014 shown to the user)" />
        <button class="btn btn-danger" id="ban-go">Ban user</button>
      </div>
      <div id="ban-evd"></div>
    </div>
    <div class="card" id="ban-list"></div>
    <div class="card">
      <div class="card-title"><h2>Dashboard users</h2><span class="count-badge" id="u-count"></span>
        <input type="text" id="u-q" class="adm-mini" placeholder="Search name or ID\u2026" /></div>
      <div class="table-wrap adm-tall" id="u-body"></div>
    </div>`;

  const reload = async () => {
    data = await api("/api/admin/users");
    if (!ok()) return;
    paintBans();
    paintUsers();
  };
  const act = async (fn, okMsg) => {
    try {
      await fn();
      toast(okMsg);
      await reload();
    } catch (err) {
      toast(err.message, "error");
    }
  };
  const evidencePicker = createEvidencePicker(document.getElementById("ban-evd"), {
    scope: document.getElementById("ban-evd").parentElement,
  });

  // Sends the ban (with any evidence) and reports how the DM to the user went. Returns true when the ban went through.
  const submitBan = async (id, label, reason, evidence) => {
    try {
      const res = await api("/api/admin/bans", { method: "POST", body: { userId: id, reason, evidence } });
      toast(`Banned ${label}`);
      const dm = res && res.dm;
      if (dm && dm.sent) toast(`DM sent${dm.files ? ` with ${dm.files} evidence file${dm.files === 1 ? "" : "s"}` : ""}.`);
      else if (dm) toast(`Couldn\u2019t DM ${label}: ${dm.error || "Discord wouldn\u2019t deliver the message."}`, "error");
    } catch (err) {
      toast(err.message, "error");
      return false;
    }
    try {
      await reload();
    } catch {}
    return true;
  };

  const doBan = (id, name) => evdOpenBanModal({ id, name }, ({ reason, evidence }) => submitBan(id, name || id, reason, evidence));
  const doUnban = (id, name) => {
    if (!confirm(`Unban ${name || id}?`)) return;
    act(() => api(`/api/admin/bans/${id}`, { method: "DELETE" }), `Unbanned ${name || id}`);
  };

  const who = (u) =>
    `<div class="who"><img class="adm-ico" src="${escapeHtml(admAvatar(u))}" alt="" /><div><b>${u.username ? escapeHtml(u.username) : "Unknown user"}</b><small>${u.id}</small></div></div>`;

  function paintBans() {
    const box = document.getElementById("ban-list");
    box.innerHTML = `<div class="card-title"><h2>Banned users</h2><span class="count-badge">${data.bans.length}</span></div>${
      data.bans.length
        ? `<div class="table-wrap"><table class="adm-table"><thead><tr><th>User</th><th>Reason</th><th>Banned</th><th></th></tr></thead><tbody>${data.bans
            .map(
              (b) => `<tr><td>${who(b)}</td><td>${b.reason ? escapeHtml(b.reason) : `<span class="muted">No reason given</span>`}</td>
                <td class="dim">${escapeHtml(admFmtDate(b.at))}<small>by ${escapeHtml(b.by?.username || "admin")}</small></td>
                <td class="r"><button class="btn btn-secondary btn-sm" data-unban="${b.id}">Unban</button></td></tr>`
            )
            .join("")}</tbody></table></div>`
        : `<p class="muted">Nobody is banned.</p>`
    }`;
    box.querySelectorAll("[data-unban]").forEach((btn) => {
      const b = data.bans.find((x) => x.id === btn.dataset.unban);
      btn.addEventListener("click", () => doUnban(b.id, b.username));
    });
  }

  function paintUsers() {
    const needle = q.trim().toLowerCase();
    const rows = data.users.filter((u) => !needle || String(u.username).toLowerCase().includes(needle) || u.id.includes(needle));
    document.getElementById("u-count").textContent = data.users.length;
    document.getElementById("u-body").innerHTML = rows.length
      ? `<table class="adm-table"><thead><tr><th>User</th><th>First seen</th><th>Last seen</th><th class="r">Logins</th><th>Status</th><th></th></tr></thead><tbody>${rows
          .map((u) => {
            const status = u.banned ? `<span class="pill offline">Banned</span>` : u.isAdmin ? `<span class="pill adminp">Admin</span>` : `<span class="muted">\u2014</span>`;
            const action = u.isAdmin
              ? ""
              : u.banned
              ? `<button class="btn btn-secondary btn-sm" data-u-unban="${u.id}">Unban</button>`
              : `<button class="btn btn-danger btn-sm" data-u-ban="${u.id}">Ban</button>`;
            return `<tr><td>${who(u)}</td><td class="dim">${escapeHtml(admFmtDate(u.firstSeen))}</td><td class="dim">${escapeHtml(admAgo(u.lastSeen))}</td>
              <td class="r">${fmtNum(u.logins)}</td><td>${status}</td><td class="r">${action}</td></tr>`;
          })
          .join("")}</tbody></table>`
      : `<p class="muted" style="padding:18px">${data.users.length ? "No users match your search." : "Nobody has logged in to the dashboard yet."}</p>`;
    const byId = (id) => data.users.find((u) => u.id === id);
    document.querySelectorAll("[data-u-ban]").forEach((btn) => btn.addEventListener("click", () => doBan(btn.dataset.uBan, byId(btn.dataset.uBan)?.username)));
    document.querySelectorAll("[data-u-unban]").forEach((btn) => btn.addEventListener("click", () => doUnban(btn.dataset.uUnban, byId(btn.dataset.uUnban)?.username)));
  }

  document.getElementById("ban-go").addEventListener("click", async (e) => {
    const btn = e.currentTarget;
    const idEl = document.getElementById("ban-id");
    const reasonEl = document.getElementById("ban-reason");
    const id = idEl.value.trim();
    if (!/^\d{17,20}$/.test(id)) return toast("Enter a valid Discord user ID (17\u201320 digits).", "error");

    const label = btn.textContent;
    btn.disabled = true;
    btn.textContent = evidencePicker.count() ? "Uploading\u2026" : "Banning\u2026";
    try {
      const evidence = await evidencePicker.getPayload();
      if (await submitBan(id, id, reasonEl.value.trim(), evidence)) {
        idEl.value = "";
        reasonEl.value = "";
        evidencePicker.clear();
      }
    } catch (err) {
      toast(err.message, "error");
    } finally {
      btn.disabled = false;
      btn.textContent = label;
    }
  });
  document.getElementById("u-q").addEventListener("input", (e) => {
    q = e.target.value;
    paintUsers();
  });
  paintBans();
  paintUsers();
}
