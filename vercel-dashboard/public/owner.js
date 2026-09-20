// ---------------------------------------------------------------------------
// StatHive owner dashboard  (/owner, /owner/users, /owner/users/<id>, /owner/logins)
// Only for the Discord ID(s) in OWNER_ID on the VPS. The server enforces that on every
// /api/owner/* request; this file is just the UI. Standalone: it doesn't need app.js.
// ---------------------------------------------------------------------------
(() => {
  "use strict";

  const root = document.getElementById("owner");
  let me = null; // the logged-in owner
  let renderId = 0; // bumped on every navigation so slow requests can't paint over a newer page
  let liveTimer = null;

  /* ------------------------------------------------------------------ */
  /* Helpers                                                             */
  /* ------------------------------------------------------------------ */

  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const num = (n) => Number(n || 0).toLocaleString();
  const fmtDate = (ms) =>
    ms ? new Date(ms).toLocaleString(undefined, { year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "\u2014";
  const fmtDay = (ms) => (ms ? new Date(ms).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" }) : "\u2014");
  function ago(ms) {
    if (!ms) return "\u2014";
    const s = Math.round((Date.now() - ms) / 1000);
    if (s < 45) return "just now";
    const m = Math.round(s / 60);
    if (m < 60) return `${m}m ago`;
    const h = Math.round(m / 60);
    if (h < 24) return `${h}h ago`;
    const d = Math.round(h / 24);
    return d < 30 ? `${d}d ago` : fmtDay(ms);
  }
  const place = (g) => (g ? [g.city, g.region, g.country].filter(Boolean).join(", ") : "");
  const deviceLabel = (ua) => (ua ? [ua.browser, ua.os].filter(Boolean).join(" \u00b7 ") + (ua.automated ? " \u00b7 bot" : "") || "Unknown" : "\u2014");
  const avatarOf = (u) =>
    u.avatar ? `https://cdn.discordapp.com/avatars/${u.id}/${u.avatar}.png?size=64` : "https://cdn.discordapp.com/embed/avatars/0.png";

  const svg = (path) =>
    `<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${path}</svg>`;
  const ICON = {
    overview: svg('<rect x="3" y="3" width="7" height="9" rx="1.5"/><rect x="14" y="3" width="7" height="5" rx="1.5"/><rect x="14" y="12" width="7" height="9" rx="1.5"/><rect x="3" y="16" width="7" height="5" rx="1.5"/>'),
    users: svg('<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8"/>'),
    logins: svg('<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>'),
    admin: svg('<line x1="4" y1="21" x2="4" y2="14"/><line x1="4" y1="10" x2="4" y2="3"/><line x1="12" y1="21" x2="12" y2="12"/><line x1="12" y1="8" x2="12" y2="3"/><line x1="20" y1="21" x2="20" y2="16"/><line x1="20" y1="12" x2="20" y2="3"/><line x1="1" y1="14" x2="7" y2="14"/><line x1="9" y1="8" x2="15" y2="8"/><line x1="17" y1="16" x2="23" y2="16"/>'),
    back: svg('<path d="M19 12H5M12 19l-7-7 7-7"/>'),
    refresh: svg('<polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/>'),
    copy: svg('<rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>'),
    lock: svg('<rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>'),
  };

  function toast(msg, type = "success") {
    let box = document.querySelector(".ow-toasts");
    if (!box) {
      box = document.createElement("div");
      box.className = "ow-toasts";
      document.body.appendChild(box);
    }
    const el = document.createElement("div");
    el.className = `ow-toast ${type}`;
    el.textContent = msg;
    box.appendChild(el);
    setTimeout(() => el.remove(), 4500);
  }

  async function copyText(text) {
    try {
      await navigator.clipboard.writeText(text);
      toast("Copied");
    } catch {
      toast("Couldn\u2019t copy. Select it and press Ctrl+C.", "error");
    }
  }

  async function api(path, { method = "GET", body } = {}) {
    const res = await fetch(path, {
      method,
      headers: body ? { "Content-Type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
      credentials: "same-origin",
    });
    let data = null;
    try {
      data = await res.json();
    } catch {}
    if (!res.ok) {
      const err = new Error((data && data.error) || `Request failed (${res.status})`);
      err.status = res.status;
      throw err;
    }
    return data;
  }

  /* ---------- small UI pieces ---------- */

  const LEVEL_LABEL = { high: "High risk", medium: "Suspicious", low: "Normal", unknown: "Unverified" };
  const riskPill = (level) => `<span class="ow-pill ${LEVEL_LABEL[level] ? level : "unknown"}">${LEVEL_LABEL[level] || LEVEL_LABEL.unknown}</span>`;

  function flagPills(flags) {
    if (!flags) return `<span class="ow-pill out">no data</span>`;
    const names = { vpn: "VPN", proxy: "Proxy", tor: "Tor", hosting: "Hosting", abuser: "Abuser" };
    const out = [];
    for (const k of Object.keys(names)) {
      const f = flags[k];
      if (!f || f.level === "no") continue;
      const cls = f.level === "yes" ? (k === "hosting" ? "medium" : "high") : "maybe";
      out.push(`<span class="ow-pill ${cls}">${names[k]}${f.level === "maybe" ? "?" : ""}</span>`);
    }
    return out.length ? `<div class="ow-pills">${out.join("")}</div>` : `<span class="ow-pill low">clean</span>`;
  }

  const userCell = (u, href) => {
    const inner = `<img src="${esc(u.avatarUrl || avatarOf(u))}" alt="" /><div><b>${u.username ? esc(u.username) : "Unknown user"}</b><small>${esc(u.id || u.userId || "")}</small></div>`;
    return href ? `<a class="ow-user" href="${esc(href)}" data-nav>${inner}</a>` : `<div class="ow-user">${inner}</div>`;
  };

  function openModal(html, { wide = false, onClose } = {}) {
    const bg = document.createElement("div");
    bg.className = "ow-modal-bg";
    bg.innerHTML = `<div class="ow-modal ${wide ? "wide" : ""}">${html}</div>`;
    document.body.appendChild(bg);
    const close = () => {
      document.removeEventListener("keydown", onKey);
      bg.remove();
      if (onClose) onClose();
    };
    const onKey = (e) => e.key === "Escape" && close();
    document.addEventListener("keydown", onKey);
    bg.addEventListener("mousedown", (e) => e.target === bg && close());
    bg.querySelectorAll("[data-close]").forEach((b) => b.addEventListener("click", close));
    return { el: bg, close };
  }

  // resolves true when confirmed, false when cancelled / closed
  function confirmModal({ title, text, confirmText }) {
    return new Promise((resolve) => {
      const m = openModal(
        `<h2>${esc(title)}</h2><p class="sub">${esc(text)}</p>
        <div class="ow-modal-actions"><button class="ow-btn ghost" data-close>Cancel</button><button class="ow-btn" id="ow-yes">${esc(confirmText)}</button></div>`,
        { onClose: () => resolve(false) } // a promise only settles once, so this is ignored after a "yes"
      );
      m.el.querySelector("#ow-yes").addEventListener("click", () => {
        resolve(true);
        m.close();
      });
    });
  }

  /* ------------------------------------------------------------------ */
  /* Login (IP log) table + detail window, shared by several pages       */
  /* ------------------------------------------------------------------ */

  function loginTable(entries) {
    if (!entries.length) return `<div class="ow-empty">Nothing matches.</div>`;
    return `<div class="ow-table-wrap"><table class="ow-table"><thead><tr><th>Time</th><th>User</th><th>IP address</th><th>Location</th><th>Network</th><th>Signals</th><th>Risk</th><th>Device</th></tr></thead><tbody>${entries
      .map((e) => {
        const org = e.network?.org || "";
        return `<tr class="click" data-log="${esc(e.id)}">
          <td>${esc(ago(e.t))}<small>${esc(fmtDate(e.t))}</small></td>
          <td>${e.userId ? userCell({ id: e.userId, username: e.username, avatarUrl: e.avatarUrl }) : `<span class="ow-faint">unknown</span>`}</td>
          <td><span class="ow-mono">${esc(e.ip)}</span>${e.event === "denied" ? `<small>login denied</small>` : ""}</td>
          <td>${esc(place(e.geo) || "\u2014")}</td>
          <td class="ellip" title="${esc(org)}">${esc(org || "\u2014")}<small>${esc(e.network?.type || "")}</small></td>
          <td>${flagPills(e.flags)}</td>
          <td>${riskPill(e.verdict?.level)}</td>
          <td class="ellip">${esc(deviceLabel(e.ua))}</td>
        </tr>`;
      })
      .join("")}</tbody></table></div>`;
  }

  function bindLoginRows(container, entries) {
    const byId = new Map(entries.map((e) => [e.id, e]));
    container.querySelectorAll("tr[data-log]").forEach((tr) =>
      tr.addEventListener("click", (ev) => {
        if (ev.target.closest("a")) return; // the user link navigates on its own
        const e = byId.get(tr.dataset.log);
        if (e) logModal(e);
      })
    );
  }

  const FLAG_NAMES = { vpn: "VPN", proxy: "Proxy", tor: "Tor exit node", hosting: "Hosting / datacenter", abuser: "Known abuser" };

  function logModal(e) {
    const g = e.geo || {};
    const n = e.network || {};
    const h = e.history;
    const hasMap = Number.isFinite(g.lat) && Number.isFinite(g.lon);
    const flagRow = (k) => {
      const f = e.flags?.[k];
      if (!f) return "";
      const status = f.level === "yes" ? `<span class="ow-pill ${k === "hosting" ? "medium" : "high"}">Yes</span>` : f.level === "maybe" ? `<span class="ow-pill maybe">Possible</span>` : `<span class="ow-pill low">No</span>`;
      const extra = k === "vpn" && f.level === "yes" && e.vpnService ? ` \u00b7 ${esc(e.vpnService)}` : k === "hosting" && f.level === "yes" && e.hostingProvider ? ` \u00b7 ${esc(e.hostingProvider)}` : "";
      const src = f.level === "yes" ? f.by : f.level === "maybe" ? f.weak : [];
      return `<div class="ow-flag"><span><b>${FLAG_NAMES[k]}</b>${extra}</span><span>${status}${src.length ? `<div class="src">${esc(src.join(" \u00b7 "))}</div>` : ""}</span></div>`;
    };
    const kv = (k, v) => (v == null || v === "" ? "" : `<dt>${k}</dt><dd>${v}</dd>`);

    const historyBits = [];
    if (h) {
      historyBits.push(h.firstLogin ? "First recorded login" : h.newIp ? "New IP" : "Known IP");
      if (h.newCountry) historyBits.push("New country");
      if (h.travel?.impossible) historyBits.push(`Impossible travel: ~${num(h.travel.km)} km in ${h.travel.hours < 1 ? Math.max(1, Math.round(h.travel.hours * 60)) + " min" : h.travel.hours + " h"}`);
    }

    const m = openModal(
      `<div class="ow-modal-top">
        <div>
          <h2>${e.event === "denied" ? "Login denied" : "Panel login"}</h2>
          <div class="ow-pills">${riskPill(e.verdict?.level)}${(e.verdict?.reasons || []).map((r) => `<span class="ow-pill soft">${esc(r)}</span>`).join("")}</div>
        </div>
        <button class="ow-icon-btn" data-close title="Close" aria-label="Close">\u2715</button>
      </div>
      <div class="ow-hero">${e.userId ? userCell({ id: e.userId, username: e.username, avatarUrl: e.avatarUrl }, `/owner/users/${e.userId}`) : `<span class="ow-faint">Unknown user</span>`}<span class="ow-dim" style="font-size:13px">${esc(fmtDate(e.t))} \u00b7 ${esc(ago(e.t))}</span></div>

      <div class="ow-sec"><h3>Connection</h3><dl class="ow-kv">
        ${kv("IP address", `<span class="ow-mono">${esc(e.ip)}</span> <button class="ow-icon-btn" data-copy="${esc(e.ip)}" title="Copy IP" aria-label="Copy IP">${ICON.copy}</button>`)}
        ${kv("Server saw connection from", e.connectionIp ? `<span class="ow-mono">${esc(e.connectionIp)}</span>` : "")}
        ${kv("Hostname", n.hostname ? `<span class="ow-mono">${esc(n.hostname)}</span>` : "")}
      </dl></div>

      <div class="ow-sec"><h3>Location</h3><dl class="ow-kv">
        ${kv("Approximate place", esc(place(g) || "Unknown") + (hasMap ? ` \u00b7 <a href="https://www.google.com/maps?q=${g.lat},${g.lon}" target="_blank" rel="noopener" style="color:var(--rose)">map</a>` : ""))}
        ${kv("Timezone", esc(g.timezone))}
      </dl></div>

      <div class="ow-sec"><h3>Network</h3><dl class="ow-kv">
        ${kv("ISP / organisation", esc(n.org || "Unknown"))}
        ${kv("ASN", n.asn ? `<span class="ow-mono">${esc(n.asn)}</span>${n.asnName && n.asnName !== n.org ? ` \u00b7 ${esc(n.asnName)}` : ""}` : "")}
        ${kv("Connection type", esc(n.type))}
        ${kv("Range", n.range ? `<span class="ow-mono">${esc(n.range)}</span>` : "")}
      </dl></div>

      <div class="ow-sec"><h3>Anonymity &amp; hosting</h3>
        ${e.flags ? Object.keys(FLAG_NAMES).map(flagRow).join("") : `<div class="ow-faint">No lookup data for this login.</div>`}
        ${e.risk != null || e.checks ? `<div class="ow-faint" style="margin-top:10px;font-size:12px">${e.checks ? "Checks: " + e.checks.map((c) => `${esc(c.name)} ${c.ok ? "\u2705" : "\u274c"}`).join(" \u00b7 ") : ""}${e.risk != null ? ` \u00b7 proxycheck risk ${esc(e.risk)}/100` : ""}</div>` : ""}
      </div>

      ${historyBits.length ? `<div class="ow-sec"><h3>Login history</h3><div class="ow-pills">${historyBits.map((b) => `<span class="ow-pill soft">${esc(b)}</span>`).join("")}</div></div>` : ""}

      <div class="ow-sec"><h3>Device</h3><dl class="ow-kv">
        ${kv("Browser", esc(e.ua?.browser))}${kv("Operating system", esc(e.ua?.os))}${kv("Type", esc(e.ua?.device))}
        ${e.ua?.automated ? kv("Client", "Automated / scripted") : ""}
        ${kv("User agent", e.ua?.raw ? `<span class="ow-mono ow-dim">${esc(e.ua.raw)}</span>` : "")}
      </dl></div>

      <div class="ow-modal-actions">
        <a class="ow-btn ghost" href="/owner/logins?ip=${encodeURIComponent(e.ip)}" data-nav data-close>All logins from this IP</a>
        ${e.userId ? `<a class="ow-btn" href="/owner/users/${esc(e.userId)}" data-nav data-close>View user</a>` : ""}
      </div>`,
      { wide: true }
    );
    m.el.querySelectorAll("[data-copy]").forEach((b) => b.addEventListener("click", () => copyText(b.dataset.copy)));
  }

  /* ------------------------------------------------------------------ */
  /* Pages                                                               */
  /* ------------------------------------------------------------------ */

  async function overviewPage(main, ok) {
    const d = await api("/api/owner/overview");
    if (!ok()) return;
    const t = d.totals;
    const tile = (k, v, s, hot) => `<div class="ow-tile ${hot ? "hot" : ""}"><div class="k">${k}</div><div class="v">${num(v)}</div><div class="s">${s || ""}</div></div>`;
    const maxBar = Math.max(1, ...d.series.map((x) => x.logins));
    const bars = d.series
      .map((x) => {
        const h = Math.max(2, Math.round((x.logins / maxBar) * 100));
        const rh = x.logins ? Math.round((x.risky / x.logins) * 100) : 0;
        return `<div class="ow-bar" title="${x.logins} login${x.logins === 1 ? "" : "s"}, ${x.risky} risky"><span class="n">${x.logins || ""}</span><div class="col" style="height:${h}%"><i style="height:${rh}%"></i></div><span class="d">${esc(x.day.slice(5))}</span></div>`;
      })
      .join("");
    const rank = (list) =>
      list.length
        ? `<div class="ow-rank">${list
            .map((r) => `<div class="r"><span class="name">${esc(r.name)}${r.hosting ? ` <span class="ow-pill medium">hosting</span>` : ""}</span><span class="c">${num(r.count)}</span><div class="track"><i style="width:${Math.round((r.count / list[0].count) * 100)}%"></i></div></div>`)
            .join("")}</div>`
        : `<div class="ow-empty">No logins recorded yet.</div>`;

    main.innerHTML = `
      <div class="ow-head"><div><h1>Overview</h1><p>Everything about who is using StatHive and where they log in from.</p></div>
        <div class="ow-actions"><button class="ow-btn ghost" id="ow-refresh">${ICON.refresh}Refresh</button></div></div>
      <div class="ow-tiles">
        ${tile("Dashboard users", t.users, `${num(t.admins)} admin${t.admins === 1 ? "" : "s"} \u00b7 ${num(t.guilds)} servers`)}
        ${tile("Banned", t.banned, t.denied7d ? `${num(t.denied7d)} blocked attempt${t.denied7d === 1 ? "" : "s"} this week` : "no blocked attempts this week", t.banned > 0)}
        ${tile("Logins \u00b7 24h", t.logins24h, `${num(t.logins7d)} in 7 days`)}
        ${tile("Unique IPs \u00b7 7d", t.uniqueIps7d, "distinct addresses")}
        ${tile("VPN / proxy / Tor", t.anonymous7d, "logins in 7 days", t.anonymous7d > 0)}
        ${tile("Hosting IPs", t.hosting7d, "logins in 7 days")}
        ${tile("High risk", t.highRisk7d, "logins in 7 days", t.highRisk7d > 0)}
        ${tile("New country", t.newCountry7d, "logins in 7 days")}
      </div>
      <div class="ow-grid2 ow-stack">
        <div class="ow-card"><div class="ow-card-title"><h2>Logins \u00b7 last 14 days</h2></div>
          <div class="ow-bars">${bars}</div>
          <div class="ow-legend"><span>All logins</span><span class="r">Suspicious or high risk</span></div></div>
        <div class="ow-stack" style="margin:0">
          <div class="ow-card"><div class="ow-card-title"><h2>Top countries \u00b7 7d</h2></div>${rank(d.topCountries)}</div>
          <div class="ow-card"><div class="ow-card-title"><h2>Top networks \u00b7 7d</h2></div>${rank(d.topIsps)}</div>
        </div>
      </div>
      <div class="ow-card flush"><div class="ow-card-title"><h2>Recent risky logins</h2><span class="grow"></span><a class="ow-btn ghost sm" href="/owner/logins?level=high" data-nav>Open IP logs</a></div>
        <div id="ow-risky" style="margin-top:8px">${d.recentRisky.length ? loginTable(d.recentRisky) : `<div class="ow-empty">Nothing suspicious so far. ${d.log.entries ? `Log covers ${num(d.log.entries)} logins since ${esc(fmtDay(d.log.since))}.` : "No logins have been logged yet."}</div>`}</div></div>`;
    main.querySelector("#ow-refresh").addEventListener("click", route);
    bindLoginRows(main.querySelector("#ow-risky"), d.recentRisky);
  }

  async function usersPage(main, ok) {
    const { users } = await api("/api/owner/users");
    if (!ok()) return;
    let q = "";
    let filter = "all";
    let sort = "seen";

    main.innerHTML = `
      <div class="ow-head"><div><h1>Users</h1><p>Everyone who has logged in to the dashboard. Click a user for their full profile.</p></div>
        <div class="ow-actions"><button class="ow-btn ghost" id="ow-refresh">${ICON.refresh}Refresh</button></div></div>
      <div class="ow-filters">
        <input class="ow-input grow" id="u-q" placeholder="Search name, ID, IP or country\u2026" />
        <select class="ow-select" id="u-sort"><option value="seen">Sort: last seen</option><option value="logins">Sort: most logins</option><option value="ips">Sort: most IPs</option><option value="risk">Sort: highest risk</option><option value="new">Sort: newest to the panel</option></select>
      </div>
      <div class="ow-chips" id="u-chips" style="margin-bottom:16px"></div>
      <div class="ow-card flush"><div class="ow-card-title"><h2>Dashboard users</h2><span class="ow-count" id="u-count"></span></div><div id="u-body" style="margin-top:8px"></div></div>`;

    const filters = [
      ["all", "All", () => true],
      ["banned", "Banned", (u) => u.banned],
      ["staff", "Admins & owners", (u) => u.isAdmin],
      ["anon", "Used VPN / proxy", (u) => u.anonLogins > 0],
      ["hosting", "Hosting IPs", (u) => u.hostingLogins > 0],
      ["linked", "Linked accounts", (u) => u.linkedCount > 0],
    ];
    const RANK = { high: 3, medium: 2, low: 1, unknown: 0 };

    function paint() {
      const needle = q.trim().toLowerCase();
      const f = filters.find((x) => x[0] === filter)[2];
      let rows = users.filter(f).filter((u) => !needle || [u.username, u.id, u.lastIp, u.lastCountry, ...(u.countries || [])].filter(Boolean).join(" ").toLowerCase().includes(needle));
      const sorters = {
        seen: (a, b) => (b.lastSeen || 0) - (a.lastSeen || 0),
        logins: (a, b) => b.logins - a.logins,
        ips: (a, b) => b.ipCount - a.ipCount,
        risk: (a, b) => RANK[b.worst] - RANK[a.worst] || b.anonLogins - a.anonLogins,
        new: (a, b) => (b.firstSeen || 0) - (a.firstSeen || 0),
      };
      rows = rows.sort(sorters[sort]);

      main.querySelector("#u-chips").innerHTML = filters
        .map(([key, label, fn]) => `<button class="ow-chip ${filter === key ? "on" : ""}" data-f="${key}">${esc(label)} <b>${num(users.filter(fn).length)}</b></button>`)
        .join("");
      main.querySelectorAll("[data-f]").forEach((b) => b.addEventListener("click", () => ((filter = b.dataset.f), paint())));
      main.querySelector("#u-count").textContent = rows.length;

      main.querySelector("#u-body").innerHTML = rows.length
        ? `<div class="ow-table-wrap"><table class="ow-table"><thead><tr><th>User</th><th>Last login</th><th class="r">Logins</th><th class="r">IPs</th><th class="r">Servers</th><th>Signals</th><th>Risk</th><th>Status</th></tr></thead><tbody>${rows
            .map((u) => {
              const signals = [
                u.anonLogins ? `<span class="ow-pill high">VPN \u00d7${u.anonLogins}</span>` : "",
                u.hostingLogins ? `<span class="ow-pill medium">Hosting \u00d7${u.hostingLogins}</span>` : "",
                u.linkedCount ? `<span class="ow-pill soft">Linked \u00d7${u.linkedCount}</span>` : "",
                u.countryCount > 1 ? `<span class="ow-pill soft">${u.countryCount} countries</span>` : "",
              ].join("");
              const status = [u.isOwner ? `<span class="ow-pill high">Owner</span>` : u.isAdmin ? `<span class="ow-pill soft">Admin</span>` : "", u.banned ? `<span class="ow-pill high">Banned</span>` : ""].join("");
              return `<tr class="click" data-u="${esc(u.id)}">
                <td>${userCell(u)}</td>
                <td>${esc(ago(u.lastLoginAt || u.lastSeen))}<small>${u.lastIp ? `<span class="ow-mono">${esc(u.lastIp)}</span>${u.lastCountry ? " \u00b7 " + esc(u.lastCountry) : ""}` : "no IP logged"}</small></td>
                <td class="r">${num(u.logins)}</td><td class="r">${num(u.ipCount)}</td><td class="r">${u.guildCount == null ? '<span class="ow-faint">\u2014</span>' : num(u.guildCount)}</td>
                <td>${signals ? `<div class="ow-pills">${signals}</div>` : `<span class="ow-faint">\u2014</span>`}</td>
                <td>${u.worst === "unknown" ? `<span class="ow-faint">\u2014</span>` : riskPill(u.worst)}</td>
                <td>${status ? `<div class="ow-pills">${status}</div>` : `<span class="ow-faint">\u2014</span>`}</td></tr>`;
            })
            .join("")}</tbody></table></div>`
        : `<div class="ow-empty">${users.length ? "No users match." : "Nobody has logged in yet."}</div>`;
      main.querySelectorAll("tr[data-u]").forEach((tr) => tr.addEventListener("click", () => navigate(`/owner/users/${tr.dataset.u}`)));
    }

    main.querySelector("#u-q").addEventListener("input", (e) => ((q = e.target.value), paint()));
    main.querySelector("#u-sort").addEventListener("change", (e) => ((sort = e.target.value), paint()));
    main.querySelector("#ow-refresh").addEventListener("click", route);
    paint();
  }

  async function userPage(main, ok, id) {
    const d = await api(`/api/owner/users/${encodeURIComponent(id)}`);
    if (!ok()) return;
    const u = d.user;
    const s = d.summary;
    const fact = (k, v) => `<div class="ow-fact"><div class="k">${k}</div><div class="v">${v}</div></div>`;

    const status = [u.isOwner ? `<span class="ow-pill high">Owner</span>` : u.isAdmin ? `<span class="ow-pill soft">Admin</span>` : "", d.ban ? `<span class="ow-pill high">Banned</span>` : ""].join("");
    const actions = u.isAdmin
      ? ""
      : d.ban
      ? `<button class="ow-btn ghost" id="ow-unban">Unban</button>`
      : `<button class="ow-btn danger" id="ow-ban">Ban user</button>`;

    const ipRows = d.ips
      .map(
        (r) => `<tr><td><a class="ow-mono" href="/owner/logins?ip=${encodeURIComponent(r.ip)}" data-nav style="color:var(--rose)">${esc(r.ip)}</a></td>
          <td>${esc(place(r.geo) || "\u2014")}</td><td class="ellip" title="${esc(r.network?.org || "")}">${esc(r.network?.org || "\u2014")}<small>${esc(r.network?.type || "")}</small></td>
          <td>${flagPills(r.flags)}</td><td class="r">${num(r.count)}</td><td>${esc(ago(r.last))}<small>first ${esc(fmtDay(r.first))}</small></td></tr>`
      )
      .join("");

    const guilds = d.profile?.guilds || [];
    const shown = guilds.slice(0, 60);

    main.innerHTML = `
      <a class="ow-back" href="/owner/users" data-nav>${ICON.back} All users</a>
      <div class="ow-card">
        <div class="ow-hero">
          <div class="ow-user big"><img src="${esc(u.avatarUrl)}" alt="" /><div><b>${u.username ? esc(u.username) : "Unknown user"}</b>
            <small>${esc(u.id)} <button class="ow-icon-btn" id="ow-copy-id" title="Copy ID" aria-label="Copy ID">${ICON.copy}</button></small>
            ${status ? `<div class="ow-pills" style="margin-top:8px">${status}</div>` : ""}</div></div>
          <div class="ow-actions">${actions}<a class="ow-btn ghost" href="/owner/logins?userId=${esc(u.id)}" data-nav>IP logs</a></div>
        </div>
        ${d.ban ? `<div class="ow-banreason"><b>Banned</b> ${d.ban.at ? esc(fmtDate(d.ban.at)) : ""}${d.ban.by ? ` by ${esc(d.ban.by)}` : ""}<br>${d.ban.reason ? esc(d.ban.reason) : `<span class="ow-dim">No reason given.</span>`}</div>` : ""}
        <div class="ow-facts">
          ${fact("Account created", esc(fmtDay(u.createdAt)))}
          ${fact("First seen", esc(fmtDay(u.firstSeen)))}
          ${fact("Last seen", esc(ago(u.lastSeen)))}
          ${fact("Total logins", num(u.logins))}
          ${fact("Distinct IPs", num(d.ips.length))}
          ${fact("Countries", s.countries.length ? esc(s.countries.map((c) => c.name).slice(0, 3).join(", ") + (s.countries.length > 3 ? ` +${s.countries.length - 3}` : "")) : "\u2014")}
          ${fact("Servers", d.profile ? num(d.profile.guildCount) : "\u2014")}
        </div>
      </div>

      <div class="ow-tiles">
        <div class="ow-tile ${s.anonymousLogins ? "hot" : ""}"><div class="k">VPN / proxy / Tor</div><div class="v">${num(s.anonymousLogins)}</div><div class="s">logins</div></div>
        <div class="ow-tile"><div class="k">Hosting IPs</div><div class="v">${num(s.hostingLogins)}</div><div class="s">logins</div></div>
        <div class="ow-tile ${s.highRisk ? "hot" : ""}"><div class="k">High risk</div><div class="v">${num(s.highRisk)}</div><div class="s">logins</div></div>
        <div class="ow-tile ${s.denied ? "hot" : ""}"><div class="k">Blocked attempts</div><div class="v">${num(s.denied)}</div><div class="s">while banned</div></div>
        <div class="ow-tile"><div class="k">Impossible travel</div><div class="v">${num(s.impossibleTravel)}</div><div class="s">logins</div></div>
      </div>

      <div class="ow-card flush"><div class="ow-card-title"><h2>IP addresses</h2><span class="ow-count">${d.ips.length}</span></div>
        <div style="margin-top:8px">${d.ips.length ? `<div class="ow-table-wrap"><table class="ow-table"><thead><tr><th>IP</th><th>Location</th><th>Network</th><th>Signals</th><th class="r">Logins</th><th>Last used</th></tr></thead><tbody>${ipRows}</tbody></table></div>` : `<div class="ow-empty">No IPs logged for this user yet. Logging started when the owner dashboard was installed.</div>`}</div></div>

      <div class="ow-grid2 ow-stack">
        <div class="ow-card"><div class="ow-card-title"><h2>Linked accounts</h2><span class="ow-count">${d.linked.length}</span></div>
          ${d.linked.length
            ? `<div class="ow-stack" style="gap:12px">${d.linked
                .map((l) => `<div class="ow-hero">${userCell(l, `/owner/users/${l.id}`)}<div class="ow-pills">${l.banned ? `<span class="ow-pill high">Banned</span>` : ""}${l.sharedIps.slice(0, 3).map((ip) => `<span class="ow-pill out ow-mono">${esc(ip)}</span>`).join("")}${l.sharedIps.length > 3 ? `<span class="ow-pill out">+${l.sharedIps.length - 3}</span>` : ""}</div></div>`)
                .join("")}</div><p class="ow-faint" style="margin:14px 0 0;font-size:12px">These accounts logged in from the same IP address. VPN, proxy and hosting IPs are left out, but a shared home, school or mobile network can still link unrelated people.</p>`
            : `<div class="ow-empty">No other account has used this user\u2019s IP addresses.</div>`}
        </div>
        <div class="ow-card"><div class="ow-card-title"><h2>Devices</h2></div>
          ${s.devices.length ? `<div class="ow-rank">${s.devices.map((x) => `<div class="r"><span class="name">${esc(x.name)}</span><span class="c">${num(x.count)}</span><div class="track"><i style="width:${Math.round((x.count / s.devices[0].count) * 100)}%"></i></div></div>`).join("")}</div>` : `<div class="ow-empty">No device data.</div>`}
          ${s.automated ? `<p class="ow-faint" style="margin:14px 0 0;font-size:12px">${num(s.automated)} login${s.automated === 1 ? "" : "s"} came from an automated client.</p>` : ""}
        </div>
      </div>

      <div class="ow-card"><div class="ow-card-title"><h2>Servers</h2>${d.profile ? `<span class="ow-count">${num(d.profile.guildCount)}</span><span class="grow"></span><span class="ow-faint" style="font-size:12px">as of their last login, ${esc(ago(d.profile.updatedAt))}</span>` : ""}</div>
        ${shown.length
          ? `<div class="ow-servers">${shown.map((g) => `<span class="ow-server ${g.botInstalled ? "bot" : ""}">${esc(g.name)}${g.owner ? " <em>owner</em>" : g.manage ? " <em>manage</em>" : ""}${g.botInstalled ? " <em>StatHive</em>" : ""}</span>`).join("")}${guilds.length > shown.length ? `<span class="ow-server">+${guilds.length - shown.length} more</span>` : ""}</div>`
          : `<div class="ow-empty">${d.profile ? "Not in any servers." : "Their server list is saved the next time they log in."}</div>`}
      </div>

      <div class="ow-card flush"><div class="ow-card-title"><h2>Recent logins</h2><span class="ow-count">${d.logins.length}</span><span class="grow"></span><a class="ow-btn ghost sm" href="/owner/logins?userId=${esc(u.id)}" data-nav>See all</a></div>
        <div id="ow-user-logins" style="margin-top:8px">${d.logins.length ? loginTable(d.logins.map((e) => ({ ...e, avatarUrl: e.avatarUrl || u.avatarUrl }))) : `<div class="ow-empty">No logins logged yet.</div>`}</div></div>`;

    main.querySelector("#ow-copy-id").addEventListener("click", () => copyText(u.id));
    bindLoginRows(main.querySelector("#ow-user-logins"), d.logins);

    const ban = main.querySelector("#ow-ban");
    if (ban) ban.addEventListener("click", () => banModal(u));
    const unban = main.querySelector("#ow-unban");
    if (unban) {
      unban.addEventListener("click", async () => {
        if (!(await confirmModal({ title: `Unban ${u.username || u.id}?`, text: "They\u2019ll be able to log in and use the bot again.", confirmText: "Unban" }))) return;
        try {
          await api(`/api/admin/bans/${encodeURIComponent(u.id)}`, { method: "DELETE" });
          toast(`Unbanned ${u.username || u.id}`);
          route();
        } catch (err) {
          toast(err.message, "error");
        }
      });
    }
  }

  function banModal(u) {
    const m = openModal(`<h2>Ban ${esc(u.username || u.id)}</h2>
      <p class="sub">They\u2019ll get a DM with the reason. To attach evidence screenshots, ban from the admin panel instead.</p>
      <input class="ow-input" id="ow-reason" maxlength="200" placeholder="Reason (optional, shown to the user)" style="width:100%" />
      <div class="ow-modal-actions"><button class="ow-btn ghost" data-close>Cancel</button><button class="ow-btn" id="ow-confirm-ban">Ban user</button></div>`);
    const input = m.el.querySelector("#ow-reason");
    const btn = m.el.querySelector("#ow-confirm-ban");
    input.focus();
    input.addEventListener("keydown", (e) => e.key === "Enter" && btn.click());
    btn.addEventListener("click", async () => {
      btn.disabled = true;
      btn.textContent = "Banning\u2026";
      try {
        const res = await api("/api/admin/bans", { method: "POST", body: { userId: u.id, reason: input.value.trim(), evidence: [] } });
        toast(`Banned ${u.username || u.id}`);
        if (res && res.dm) {
          if (res.dm.sent) toast("DM sent.");
          else toast(`Couldn\u2019t DM them: ${res.dm.error || "Discord wouldn\u2019t deliver the message."}`, "error");
        }
        m.close();
        route();
      } catch (err) {
        toast(err.message, "error");
        btn.disabled = false;
        btn.textContent = "Ban user";
      }
    });
  }

  async function loginsPage(main, ok) {
    const params = new URLSearchParams(location.search);
    const f = {
      q: params.get("q") || "",
      level: params.get("level") || "",
      event: params.get("event") || "",
      anon: params.get("anon") === "1",
      hosting: params.get("hosting") === "1",
      ip: params.get("ip") || "",
      userId: params.get("userId") || "",
    };
    let entries = [];
    let nextBefore = null;
    let total = 0;

    main.innerHTML = `
      <div class="ow-head"><div><h1>IP logs</h1><p>Every dashboard login with the same IP, ISP and VPN / hosting analysis the Discord alerts show. Click a row for the full breakdown.</p></div>
        <div class="ow-actions"><label class="ow-check"><input type="checkbox" id="l-live" /> Live</label><button class="ow-btn ghost" id="l-refresh">${ICON.refresh}Refresh</button></div></div>
      <div class="ow-filters">
        <input class="ow-input grow" id="l-q" placeholder="Search IP, user, ISP, city, country\u2026" value="${esc(f.q)}" />
        <select class="ow-select" id="l-level"><option value="">Any risk</option><option value="high">High risk</option><option value="medium">Suspicious</option><option value="low">Normal</option><option value="unknown">Unverified</option></select>
        <select class="ow-select" id="l-event"><option value="">Logins &amp; blocked</option><option value="login">Logins only</option><option value="denied">Blocked (banned users)</option></select>
        <label class="ow-check"><input type="checkbox" id="l-anon" /> VPN / proxy / Tor</label>
        <label class="ow-check"><input type="checkbox" id="l-hosting" /> Hosting IPs</label>
      </div>
      <div class="ow-chips" id="l-scope" style="margin-bottom:14px"></div>
      <div class="ow-card flush"><div class="ow-card-title"><h2>Logins</h2><span class="ow-count" id="l-count"></span></div>
        <div id="l-body" style="margin-top:8px"><div class="ow-loading" style="min-height:160px"><div class="ow-spinner"></div></div></div><div class="ow-more" id="l-more" hidden><button class="ow-btn ghost" id="l-more-btn">Load more</button></div></div>`;

    const $ = (sel) => main.querySelector(sel);
    $("#l-level").value = f.level;
    $("#l-event").value = f.event;
    $("#l-anon").checked = f.anon;
    $("#l-hosting").checked = f.hosting;

    function query(before) {
      const p = new URLSearchParams();
      if (f.q) p.set("q", f.q);
      if (f.level) p.set("level", f.level);
      if (f.event) p.set("event", f.event);
      if (f.anon) p.set("anon", "1");
      if (f.hosting) p.set("hosting", "1");
      if (f.ip) p.set("ip", f.ip);
      if (f.userId) p.set("userId", f.userId);
      if (before) p.set("before", before);
      p.set("limit", "50");
      return p;
    }

    function syncUrl() {
      const p = query();
      p.delete("limit");
      history.replaceState({}, "", location.pathname + (p.toString() ? `?${p}` : ""));
    }

    function paint() {
      $("#l-count").textContent = num(total);
      $("#l-body").innerHTML = loginTable(entries);
      bindLoginRows($("#l-body"), entries);
      $("#l-more").hidden = !nextBefore;
      const scope = [];
      if (f.ip) scope.push(["ip", `IP: ${f.ip}`]);
      if (f.userId) scope.push(["userId", `User: ${f.userId}`]);
      $("#l-scope").innerHTML = scope.map(([k, label]) => `<button class="ow-chip on" data-clear="${k}">${esc(label)} \u2715</button>`).join("");
      main.querySelectorAll("[data-clear]").forEach((b) => b.addEventListener("click", () => ((f[b.dataset.clear] = ""), load())));
    }

    async function load() {
      syncUrl();
      try {
        const d = await api(`/api/owner/logins?${query()}`);
        if (!ok()) return;
        entries = d.entries;
        nextBefore = d.nextBefore;
        total = d.total;
        paint();
      } catch (err) {
        if (ok()) $("#l-body").innerHTML = `<div class="ow-banner" style="margin:16px">${esc(err.message)}</div>`;
      }
    }

    let debounce;
    $("#l-q").addEventListener("input", (e) => {
      f.q = e.target.value.trim();
      clearTimeout(debounce);
      debounce = setTimeout(load, 250);
    });
    $("#l-level").addEventListener("change", (e) => ((f.level = e.target.value), load()));
    $("#l-event").addEventListener("change", (e) => ((f.event = e.target.value), load()));
    $("#l-anon").addEventListener("change", (e) => ((f.anon = e.target.checked), load()));
    $("#l-hosting").addEventListener("change", (e) => ((f.hosting = e.target.checked), load()));
    $("#l-refresh").addEventListener("click", load);
    $("#l-more-btn").addEventListener("click", async (e) => {
      e.target.disabled = true;
      try {
        const d = await api(`/api/owner/logins?${query(nextBefore)}`);
        if (!ok()) return;
        entries = entries.concat(d.entries);
        nextBefore = d.nextBefore;
        total = d.total;
        paint();
      } catch (err) {
        toast(err.message, "error");
      } finally {
        e.target.disabled = false;
      }
    });
    $("#l-live").addEventListener("change", (e) => {
      clearInterval(liveTimer);
      liveTimer = null;
      if (e.target.checked) {
        liveTimer = setInterval(() => (ok() ? load() : clearInterval(liveTimer)), 10000);
        toast("Live: refreshing every 10 seconds");
      }
    });

    await load();
  }

  /* ------------------------------------------------------------------ */
  /* Shell, router, sign-in                                              */
  /* ------------------------------------------------------------------ */

  function gate({ title, text, button }) {
    root.innerHTML = `<div class="ow-center"><div class="ow-gate"><div class="ow-lock">${ICON.lock}</div><h1>${esc(title)}</h1><p>${esc(text)}</p>${button ? `<a class="ow-btn" href="${esc(button.href)}">${esc(button.label)}</a>` : ""}</div></div>`;
  }
  const signIn = () =>
    gate({ title: "Owner access", text: "Sign in with the Discord account set as the owner.", button: { href: `/auth/login?next=${encodeURIComponent("/owner")}`, label: "Sign in with Discord" } });
  // same screen for everyone who isn't the owner, so the page doesn't reveal itself
  const denied = () => gate({ title: "Nothing here", text: "This page doesn\u2019t exist.", button: { href: "/", label: "Back to StatHive" } });

  function shell(section) {
    const nav = (key, href, label) => `<a href="${href}" data-nav class="${section === key ? "active" : ""}">${ICON[key]}<span>${label}</span></a>`;
    return `<div class="ow">
      <aside class="ow-side">
        <a class="ow-brand" href="/owner" data-nav><span class="ow-logo"><img src="/logo.png" alt="" onerror="this.remove()" /></span><span><b>StatHive</b><small>OWNER</small></span></a>
        <nav class="ow-nav">${nav("overview", "/owner", "Overview")}${nav("users", "/owner/users", "Users")}${nav("logins", "/owner/logins", "IP logs")}</nav>
        <div class="ow-foot">
          <a class="ow-link" href="/admin">${ICON.admin}<span>Admin panel</span></a>
          <a class="ow-link" href="/">${ICON.back}<span>Back to dashboard</span></a>
          <div class="ow-me"><img src="${esc(avatarOf(me))}" alt="" /><span>${esc(me.username)}</span><a href="/auth/logout">Log out</a></div>
        </div>
      </aside>
      <main class="ow-main" id="ow-main"><div class="ow-loading" style="min-height:50vh"><div class="ow-spinner"></div></div></main>
    </div>`;
  }

  function parseRoute() {
    const parts = location.pathname.split("/").filter(Boolean); // ["owner", "users", "<id>"]
    const sec = parts[1];
    return { section: sec === "users" ? "users" : sec === "logins" ? "logins" : "overview", arg: parts[2] || null };
  }

  const TITLES = { overview: "Overview", users: "Users", logins: "IP logs" };

  async function route() {
    if (!me) return;
    clearInterval(liveTimer);
    liveTimer = null;
    const { section, arg } = parseRoute();
    const token = ++renderId;
    const ok = () => token === renderId;
    document.title = `${TITLES[section]} \u00b7 StatHive Owner`;
    root.innerHTML = shell(section);
    const main = document.getElementById("ow-main");
    try {
      if (section === "users" && arg) await userPage(main, ok, arg);
      else if (section === "users") await usersPage(main, ok);
      else if (section === "logins") await loginsPage(main, ok);
      else await overviewPage(main, ok);
    } catch (err) {
      if (!ok()) return;
      if (err.status === 401) return signIn();
      if (err.status === 404 && err.message === "Not found.") return denied();
      main.innerHTML = `<div class="ow-banner">${esc(err.message)}</div>`;
    }
    if (ok()) window.scrollTo(0, 0);
  }

  function navigate(href) {
    history.pushState({}, "", href);
    route();
  }

  document.addEventListener("click", (e) => {
    const a = e.target.closest("a[data-nav]");
    if (!a || e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
    e.preventDefault();
    navigate(a.getAttribute("href"));
  });
  window.addEventListener("popstate", route);

  async function init() {
    try {
      const res = await fetch("/api/session", { credentials: "same-origin" });
      let data = {};
      try {
        data = await res.json();
      } catch {}
      if (res.status === 401 || !data.user) return data.banned ? denied() : signIn();
      if (!data.user.isOwner) return denied();
      me = data.user;
      route();
    } catch {
      gate({ title: "Can\u2019t reach the server", text: "Check that the StatHive backend is running, then reload." });
    }
  }

  init();
})();
