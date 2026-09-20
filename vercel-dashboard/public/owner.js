"use strict";

/**
 * Owner dashboard backend (used by api/server.js).
 *
 *   OWNER_ID=123456789012345678        in .env (several owners: comma-separated)
 *
 * Owners get everything the admin panel has, plus the owner dashboard at /owner:
 * overview, detailed user pages and the IP log (every dashboard login with the same
 * IP / ISP / VPN / hosting analysis the Discord webhook shows).
 *
 * Data sources:
 *   - lib/admin            the user list and bans (already used by the admin panel)
 *   - lib/loginAlert       the login log (data/login-log.jsonl), one entry per login
 *   - data/user-profiles   the servers each user was in at their last login (written here)
 */

const fs = require("fs");
const path = require("path");
const admin = require("./admin");
const { getLoginLog } = require("./loginAlert");

const DAY = 24 * 60 * 60 * 1000;

/* ------------------------------------------------------------------ */
/* Owner IDs                                                           */
/* ------------------------------------------------------------------ */

function ownerIds() {
  return new Set(
    String(process.env.OWNER_ID || process.env.OWNER_IDS || "")
      .split(/[\s,]+/)
      .map((s) => s.trim())
      .filter((s) => /^\d{17,20}$/.test(s))
  );
}
const isOwnerId = (id) => ownerIds().has(String(id));
const ownerCount = () => ownerIds().size;

/* ------------------------------------------------------------------ */
/* User profile snapshots (which servers a user is in)                 */
/* ------------------------------------------------------------------ */

let profiles = null;
const profilesFile = () => process.env.OWNER_PROFILES_FILE || path.join(process.cwd(), "data", "user-profiles.json");

function loadProfiles() {
  if (profiles) return profiles;
  try {
    profiles = JSON.parse(fs.readFileSync(profilesFile(), "utf8"));
  } catch {
    profiles = {};
  }
  return profiles;
}

function saveProfiles() {
  const file = profilesFile();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(profiles));
  fs.renameSync(tmp, file);
}

/** Called at login. guilds = [{ id, name, owner, manage }, ...] */
function recordProfile(user, guilds) {
  const db = loadProfiles();
  const list = Array.isArray(guilds) ? guilds : [];
  db[user.id] = {
    username: user.username || null,
    globalName: user.global_name || null,
    guildCount: list.length,
    guilds: list.slice(0, 200).map((g) => ({
      id: String(g.id),
      name: String(g.name || "").slice(0, 60),
      owner: !!g.owner,
      manage: !!g.manage,
    })),
    updatedAt: Date.now(),
  };
  saveProfiles();
}

/* ------------------------------------------------------------------ */
/* Small helpers                                                       */
/* ------------------------------------------------------------------ */

const snowflakeMs = (id) => {
  try {
    return Number((BigInt(id) >> 22n) + 1420070400000n);
  } catch {
    return null;
  }
};

function avatarUrl(id, hash, size = 64) {
  if (id && hash) return `https://cdn.discordapp.com/avatars/${id}/${hash}.png?size=${size}`;
  try {
    return `https://cdn.discordapp.com/embed/avatars/${Number((BigInt(id) >> 22n) % 6n)}.png`;
  } catch {
    return "https://cdn.discordapp.com/embed/avatars/0.png";
  }
}

const RANK = { unknown: 0, low: 1, medium: 2, high: 3 };
const isAnon = (e) => !!e.flags && ["vpn", "proxy", "tor"].some((k) => e.flags[k]?.level === "yes");
const isHosting = (e) => e.flags?.hosting?.level === "yes";
const levelOf = (e) => e.verdict?.level || "unknown";

const view = (e) => ({ ...e, avatarUrl: e.userId ? avatarUrl(e.userId, e.avatar) : null });

function tally(list, keyFn) {
  const m = new Map();
  for (const e of list) {
    const k = keyFn(e);
    if (k) m.set(k, (m.get(k) || 0) + 1);
  }
  return [...m.entries()].sort((a, b) => b[1] - a[1]);
}

/** Map<userId, entries oldest->newest> for real logins */
function byUser(log) {
  const m = new Map();
  for (const e of log) {
    if (e.event !== "login" || !e.userId) continue;
    if (!m.has(e.userId)) m.set(e.userId, []);
    m.get(e.userId).push(e);
  }
  return m;
}

/** Map<ip, Set<userId>> for IPs that could plausibly be one person's connection (not VPN / proxy / Tor / hosting) */
function sharedIpIndex(log) {
  const m = new Map();
  for (const e of log) {
    if (!e.userId || !e.ip || isAnon(e) || isHosting(e)) continue;
    if (!m.has(e.ip)) m.set(e.ip, new Set());
    m.get(e.ip).add(e.userId);
  }
  return m;
}

/* ------------------------------------------------------------------ */
/* Overview                                                            */
/* ------------------------------------------------------------------ */

function overview(client) {
  const log = getLoginLog();
  const now = Date.now();
  const users = admin.listUsers();
  const bans = admin.listBans();

  const logins = log.filter((e) => e.event === "login");
  const in24 = logins.filter((e) => now - e.t <= DAY);
  const in7 = logins.filter((e) => now - e.t <= 7 * DAY);

  const todayStart = Math.floor(now / DAY) * DAY;
  const series = [];
  for (let i = 13; i >= 0; i--) {
    const start = todayStart - i * DAY;
    const day = logins.filter((e) => e.t >= start && e.t < start + DAY);
    series.push({
      day: new Date(start).toISOString().slice(0, 10),
      logins: day.length,
      risky: day.filter((e) => RANK[levelOf(e)] >= RANK.medium).length,
    });
  }

  const hostingIsps = new Set(in7.filter(isHosting).map((e) => e.network?.org));

  return {
    totals: {
      users: users.length,
      banned: bans.length,
      admins: users.filter((u) => u.isAdmin || isOwnerId(u.id)).length,
      guilds: client?.guilds?.cache?.size ?? 0,
      logins24h: in24.length,
      logins7d: in7.length,
      uniqueIps7d: new Set(in7.map((e) => e.ip)).size,
      anonymous7d: in7.filter(isAnon).length,
      hosting7d: in7.filter(isHosting).length,
      highRisk7d: in7.filter((e) => levelOf(e) === "high").length,
      newCountry7d: in7.filter((e) => e.history?.newCountry).length,
      denied7d: log.filter((e) => e.event === "denied" && now - e.t <= 7 * DAY).length,
    },
    series,
    topCountries: tally(in7, (e) => e.geo?.country).slice(0, 6).map(([name, count]) => ({ name, count })),
    topIsps: tally(in7, (e) => e.network?.org).slice(0, 6).map(([name, count]) => ({ name, count, hosting: hostingIsps.has(name) })),
    recentRisky: log
      .filter((e) => RANK[levelOf(e)] >= RANK.medium)
      .slice(-8)
      .reverse()
      .map(view),
    log: { entries: log.length, since: log.length ? log[0].t : null },
  };
}

/* ------------------------------------------------------------------ */
/* Users                                                               */
/* ------------------------------------------------------------------ */

function users() {
  const log = getLoginLog();
  const bans = new Map(admin.listBans().map((b) => [b.id, b]));
  const snap = loadProfiles();
  const entriesBy = byUser(log);
  const shared = sharedIpIndex(log);

  return admin
    .listUsers()
    .map((u) => {
      const entries = entriesBy.get(u.id) || [];
      const last = entries[entries.length - 1];
      const ips = new Set(entries.map((e) => e.ip));
      const countries = [...new Set(entries.map((e) => e.geo?.country).filter(Boolean))];

      const linked = new Set();
      for (const ip of ips) for (const other of shared.get(ip) || []) if (other !== u.id) linked.add(other);

      const ban = bans.get(u.id);
      return {
        id: u.id,
        username: u.username || null,
        avatarUrl: avatarUrl(u.id, u.avatar),
        createdAt: snowflakeMs(u.id),
        firstSeen: u.firstSeen || null,
        lastSeen: u.lastSeen || null,
        logins: u.logins || 0,
        banned: !!ban || !!u.banned,
        banReason: ban?.reason || "",
        isAdmin: !!u.isAdmin || isOwnerId(u.id),
        isOwner: isOwnerId(u.id),
        lastIp: last?.ip || null,
        lastCountry: last?.geo?.country || null,
        lastIsp: last?.network?.org || null,
        lastLoginAt: last?.t || null,
        ipCount: ips.size,
        countries: countries.slice(0, 4),
        countryCount: countries.length,
        anonLogins: entries.filter(isAnon).length,
        hostingLogins: entries.filter(isHosting).length,
        worst: entries.reduce((w, e) => (RANK[levelOf(e)] > RANK[w] ? levelOf(e) : w), "unknown"),
        guildCount: snap[u.id]?.guildCount ?? null,
        linkedCount: linked.size,
      };
    })
    .sort((a, b) => (b.lastSeen || 0) - (a.lastSeen || 0));
}

function userDetail(id, client) {
  id = String(id);
  const base = admin.listUsers().find((u) => u.id === id);
  const log = getLoginLog();
  const entries = log.filter((e) => e.userId === id); // oldest -> newest, logins and denied attempts
  if (!base && !entries.length) return null;

  const ban = admin.listBans().find((b) => b.id === id) || null;
  const snap = loadProfiles()[id] || null;
  const real = entries.filter((e) => e.event === "login");
  const newest = entries[entries.length - 1];

  // one row per IP
  const ipMap = new Map();
  for (const e of entries) {
    let r = ipMap.get(e.ip);
    if (!r) ipMap.set(e.ip, (r = { ip: e.ip, count: 0, first: e.t, last: e.t, level: "unknown" }));
    r.count++;
    r.first = Math.min(r.first, e.t);
    r.last = Math.max(r.last, e.t);
    r.geo = e.geo;
    r.network = e.network;
    r.flags = e.flags;
    r.vpnService = e.vpnService;
    r.mobile = e.mobile;
    if (RANK[levelOf(e)] > RANK[r.level]) r.level = levelOf(e);
  }
  const ips = [...ipMap.values()].sort((a, b) => b.last - a.last);

  // other accounts that logged in from the same (non-VPN, non-hosting) IPs
  const mine = new Set(ips.map((r) => r.ip));
  const linkedMap = new Map();
  for (const e of log) {
    if (!e.userId || e.userId === id || !mine.has(e.ip) || isAnon(e) || isHosting(e)) continue;
    if (!linkedMap.has(e.userId)) linkedMap.set(e.userId, { id: e.userId, username: e.username, avatar: e.avatar, ips: new Set() });
    linkedMap.get(e.userId).ips.add(e.ip);
  }
  const banned = new Set(admin.listBans().map((b) => b.id));
  const linked = [...linkedMap.values()].map((l) => ({
    id: l.id,
    username: l.username,
    avatarUrl: avatarUrl(l.id, l.avatar),
    banned: banned.has(l.id),
    sharedIps: [...l.ips],
  }));

  return {
    user: {
      id,
      username: base?.username || newest?.username || null,
      avatarUrl: avatarUrl(id, base?.avatar ?? newest?.avatar),
      createdAt: snowflakeMs(id),
      firstSeen: base?.firstSeen || null,
      lastSeen: base?.lastSeen || null,
      logins: base?.logins ?? real.length,
      isAdmin: !!base?.isAdmin || isOwnerId(id),
      isOwner: isOwnerId(id),
    },
    ban: ban ? { reason: ban.reason || "", at: ban.at || null, by: ban.by?.username || null } : null,
    profile: snap
      ? {
          guildCount: snap.guildCount,
          updatedAt: snap.updatedAt,
          guilds: snap.guilds
            .map((g) => ({ ...g, botInstalled: !!client?.guilds?.cache?.get(g.id) }))
            .sort((a, b) => b.botInstalled - a.botInstalled || b.manage - a.manage || a.name.localeCompare(b.name)),
        }
      : null,
    summary: {
      countries: tally(real, (e) => e.geo?.country).map(([name, count]) => ({ name, count })),
      devices: tally(real, (e) => (e.ua ? [e.ua.browser, e.ua.os].filter(Boolean).join(" · ") : null)).slice(0, 6).map(([name, count]) => ({ name, count })),
      anonymousLogins: real.filter(isAnon).length,
      hostingLogins: real.filter(isHosting).length,
      highRisk: real.filter((e) => levelOf(e) === "high").length,
      denied: entries.filter((e) => e.event === "denied").length,
      impossibleTravel: real.filter((e) => e.history?.travel?.impossible).length,
      automated: real.filter((e) => e.ua?.automated).length,
      logged: entries.length,
    },
    ips,
    linked,
    logins: entries.slice(-50).reverse().map(view),
  };
}

/* ------------------------------------------------------------------ */
/* IP log                                                              */
/* ------------------------------------------------------------------ */

const truthy = (v) => v === "1" || v === "true" || v === true;

function queryLogins(query = {}) {
  const log = getLoginLog();
  const limit = Math.min(200, Math.max(1, parseInt(query.limit, 10) || 50));
  const needle = String(query.q || "").trim().toLowerCase();
  const level = ["high", "medium", "low", "unknown"].includes(query.level) ? query.level : null;
  const event = ["login", "denied"].includes(query.event) ? query.event : null;
  const anon = truthy(query.anon);
  const hosting = truthy(query.hosting);
  const userId = query.userId ? String(query.userId) : null;
  const ip = query.ip ? String(query.ip) : null;

  const match = (e) => {
    if (event && e.event !== event) return false;
    if (level && levelOf(e) !== level) return false;
    if (anon && !isAnon(e)) return false;
    if (hosting && !isHosting(e)) return false;
    if (userId && e.userId !== userId) return false;
    if (ip && e.ip !== ip) return false;
    if (needle) {
      const hay = [e.ip, e.connectionIp, e.username, e.userId, e.geo?.country, e.geo?.city, e.geo?.region, e.network?.org, e.network?.asn, e.network?.hostname, e.vpnService, e.ua?.browser, e.ua?.os]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      if (!hay.includes(needle)) return false;
    }
    return true;
  };

  let total = 0;
  for (const e of log) if (match(e)) total++;

  let start = log.length - 1;
  if (query.before) {
    const i = log.findIndex((e) => e.id === String(query.before));
    start = i >= 0 ? i - 1 : -1;
  }

  const page = [];
  let more = false;
  for (let i = start; i >= 0; i--) {
    if (!match(log[i])) continue;
    if (page.length === limit) {
      more = true;
      break;
    }
    page.push(log[i]);
  }

  return {
    entries: page.map(view),
    total,
    nextBefore: more ? page[page.length - 1].id : null,
  };
}

module.exports = { isOwnerId, ownerCount, recordProfile, overview, users, userDetail, queryLogins };
