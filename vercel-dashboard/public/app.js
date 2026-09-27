const app = document.getElementById('app');
const state = { csrfToken: null, session: null };
let pageRefreshTimer;

async function api(path, options = {}) {
  const method = options.method || 'GET';
  const headers = options.body ? { 'Content-Type': 'application/json' } : {};
  if (!['GET', 'HEAD'].includes(method) && state.csrfToken) headers['X-CSRF-Token'] = state.csrfToken;
  const res = await fetch(path, { method, headers, body: options.body ? JSON.stringify(options.body) : undefined });
  if (res.status === 204) return null;
  let data = null;
  try { data = await res.json(); } catch {}
  if (!res.ok) throw new Error(data?.error || `Request failed (${res.status})`);
  return data;
}

function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[char]));
}

function toast(message, type = 'success') {
  let stack = document.querySelector('.toast-stack');
  if (!stack) { stack = document.createElement('div'); stack.className = 'toast-stack'; document.body.appendChild(stack); }
  const item = document.createElement('div');
  item.className = `toast ${type}`;
  item.textContent = message;
  stack.appendChild(item);
  setTimeout(() => item.remove(), 4500);
}

function navigate(path) { history.pushState({}, '', path); render(); }
window.addEventListener('popstate', render);

function avatarUrl(user) {
  return user.avatar ? `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png?size=64` : 'https://cdn.discordapp.com/embed/avatars/0.png';
}
function userChip(user) { return `<div class="user-chip"><img src="${esc(avatarUrl(user))}" alt=""><span>${esc(user.username)}</span></div>`; }
function brandLogo(className = 'brand-mark') {
  return `<span class="${className} dragon-logo"><img src="/branding/skaylarz.png" alt="Skaylarz dragon"></span>`;
}
function topbar(user) {
  return `<header class="topbar"><a class="brand" href="/" data-nav>${brandLogo()}<span>Skaylarz</span></a><nav class="nav-links"><a href="/commands" data-nav>Commands</a><a href="/embeds" data-nav>Embeds</a><a href="/dashboard" data-nav>Dashboard</a>${state.session?.canViewStatus ? '<a href="/status" data-nav>Status</a>' : ''}</nav><div class="topbar-right">${user ? `${state.session?.isAdmin ? '<a class="btn btn-secondary btn-sm" href="/admin" data-nav>Admin</a>' : ''}${userChip(user)}<a class="btn btn-ghost btn-sm" href="/auth/logout">Log out</a>` : '<a class="btn btn-primary btn-sm" href="/auth/login">Log in with Discord</a>'}</div></header>`;
}
function footer() {
  return `<footer class="footer wrap"><div class="footer-brand">${brandLogo()}<div><strong>Skaylarz</strong><span>&copy; ${new Date().getFullYear()} · Your community. Your rules.</span></div></div><nav class="footer-links"><a href="/commands" data-nav>Commands</a><a href="/embeds" data-nav>Embed studio</a><a href="/dashboard" data-nav>Dashboard</a></nav></footer>`;
}
function icon(guild, className = 'guild-icon') {
  return guild.icon ? `<img class="${className}" src="${esc(guild.icon)}" alt="${esc(guild.name)} icon">` : `<div class="${className} fallback-icon">${esc((guild.name || '?').slice(0, 2).toUpperCase())}</div>`;
}

async function getSession() {
  try {
    const session = await api('/api/session');
    state.session = session;
    state.csrfToken = session.csrfToken;
    return session;
  } catch { state.session = null; state.csrfToken = null; return { user: null }; }
}

async function render() {
  clearTimeout(pageRefreshTimer);
  app.innerHTML = '<div class="center-screen"><div class="spinner"></div></div>';
  const session = await getSession();
  const path = location.pathname;
  const guildMatch = path.match(/^\/g\/(\d+)(?:\/([a-z-]+))?\/?$/);
  if (guildMatch) return renderGuildPage(guildMatch[1], guildMatch[2] || 'overview', session.user);
  if (path === '/commands') return renderCommands(session.user);
  if (path === '/dashboard') return renderDashboard(session.user);
  if (path === '/embeds') return renderEmbedStudio(session.user);
  if (path === '/admin' || path === '/admin/servers' || path === '/admin/users') return renderAdmin(session.user, path === '/admin/servers' ? 'servers' : path === '/admin/users' ? 'users' : 'overview');
  if (path === '/status') return renderStatus(session.user);
  return renderHome(session.user, new URLSearchParams(location.search).get('error'));
}

function renderHome(user, error) {
  app.innerHTML = `${topbar(user)}${error ? `<div class="wrap page-pad"><div class="banner error">${esc(error)}</div></div>` : ''}
    <main class="brand-home">
      <section class="brand-hero wrap">
        <div class="brand-hero-copy">
          <span class="brand-badge"><span></span> Free public Discord bot</span>
          <p class="brand-overline">Your community. Your rules.</p>
          <h1>Skaylarz<span>.</span></h1>
          <h2>A stronger server.<br>A lighter workload.</h2>
          <p class="brand-intro">Moderation, welcome messages, tickets and staff access — managed from one dashboard. Bans stay in your server.</p>
          <div class="brand-actions"><a href="${user ? '/dashboard' : '/auth/login'}" class="btn brand-primary" ${user ? 'data-nav' : ''}>Open dashboard</a><a href="/commands" class="btn btn-ghost" data-nav>Explore commands</a></div>
          <p class="brand-note">No global bans. No extra tabs. Built for communities of every size.</p>
        </div>
        <div class="brand-poster" aria-label="Skaylarz dragon branding">
          <div class="poster-glow" aria-hidden="true"></div>
          <div class="poster-caption"><span>Skaylarz</span><span>Community first</span></div>
          ${brandLogo('poster-dragon')}
          <div class="poster-bottom"><span>Built to protect.<br>Ready to welcome.</span><span class="poster-symbol" aria-hidden="true">✦</span></div>
        </div>
      </section>
      <div class="brand-strip wrap">
        <div><strong>Free to use</strong><span>For communities of every size</span></div>
        <div><strong>Server-specific</strong><span>Your settings, staff and bans</span></div>
        <div><strong>One dashboard</strong><span>Manage more, switch tabs less</span></div>
      </div>
      <section class="section" id="features"><div class="wrap">
        <div class="brand-section-head"><p class="brand-overline">Everyday essentials</p><h2>Everything your community needs.<br>Nothing standing in the way.</h2></div>
        <div class="grid grid-3">
          <article class="card"><span class="brand-feature-number">01 / Moderation</span><h3>Keep your server yours.</h3><p>Kick, ban and review cases with role-hierarchy checks. Actions never become a global ban across other communities.</p></article>
          <article class="card"><span class="brand-feature-number">02 / Welcome</span><h3>Make the first hello count.</h3><p>Design a welcome embed with a live preview and give new members a safe starter role automatically.</p></article>
          <article class="card"><span class="brand-feature-number">03 / Support</span><h3>Keep the conversation.</h3><p>Handle support through tickets, then revisit private web transcripts from the dashboard.</p></article>
          <article class="card"><span class="brand-feature-number">04 / Creativity</span><h3>Say it your way.</h3><p>Let members post custom embeds — titles, colours and images — while respecting channel permissions.</p></article>
          <article class="card"><span class="brand-feature-number">05 / Staff access</span><h3>The right tools for each role.</h3><p>Server owners choose which roles can use staff commands. Your community stays in control.</p></article>
          <article class="card brand-feature-cta"><span class="brand-feature-number">06 / Get started</span><h3>Your next chapter starts here.</h3><p>Sign in with Discord to manage your servers or add Skaylarz to a new community.</p><a href="/dashboard" data-nav class="brand-text-link">Find your servers →</a></article>
        </div>
      </div></section>
      <section class="section brand-how"><div class="wrap">
        <div class="brand-section-head"><p class="brand-overline">How it works</p><h2>Live in minutes.<br>Stay in control.</h2></div>
        <div class="how-grid">
          <article class="card"><span class="how-step">1</span><h3>Invite the bot</h3><p>Add Skaylarz to a server you manage. Settings stay local to that community.</p></article>
          <article class="card"><span class="how-step">2</span><h3>Open the dashboard</h3><p>Sign in with Discord. Configure welcome, roles, tickets and staff from one place.</p></article>
          <article class="card"><span class="how-step">3</span><h3>Let staff work</h3><p>Grant command access by role. Moderation stays in your server — never global.</p></article>
        </div>
      </div></section>
      <section class="section brand-cta-band"><div class="wrap">
        <div class="cta-panel">
          <div><p class="brand-overline">Ready when you are</p><h2>Give your staff a quieter night.</h2><p>A free public bot for moderation, welcoming and support — with a dashboard that actually feels calm.</p></div>
          <a href="${user ? '/dashboard' : '/auth/login'}" class="btn brand-primary" ${user ? 'data-nav' : ''}>Get started</a>
        </div>
      </div></section>
    </main>${footer()}`;
}

async function renderCommands(user) {
  app.innerHTML = `${topbar(user)}<main class="page"><div class="page-header"><div><p class="kicker">Reference</p><h1>Every command</h1><p>Generated from the same definitions deployed to Discord.</p></div></div><div id="cmd-root"><div class="spinner"></div></div></main>${footer()}`;
  try {
    const categories = await api('/api/commands');
    document.getElementById('cmd-root').innerHTML = categories.map((category) => `<section class="cmd-category"><h2>${esc(category.category)}</h2><div class="cmd-list">${category.commands.map((command) => `<article class="cmd"><code>/${esc(command.name)}</code><div><strong>${esc(command.description)}</strong>${command.subcommands.length ? `<p>${command.subcommands.map((sub) => `<span class="tag">${esc(sub.name)}</span>`).join('')}</p>` : ''}</div></article>`).join('')}</div></section>`).join('');
  } catch (err) { document.getElementById('cmd-root').innerHTML = `<div class="banner error">${esc(err.message)}</div>`; }
}

function serverCard(guild) {
  const background = guild.icon ? `<img class="guild-card-bg" src="${esc(guild.icon)}" alt="">` : '';
  if (guild.inBot && !guild.canManage) return `<article class="guild-card">${background}<span class="guild-card-shade"></span><div class="guild-card-content">${icon(guild)}<div class="guild-card-copy"><strong>${esc(guild.name)}</strong><span>Bot connected · ${guild.accessError ? 'Access check unavailable' : 'No management access'}</span></div></div><p class="guild-access-note">${esc(guild.accessError || 'Ask the server owner for Manage Server or a staff command role to open this dashboard.')}</p></article>`;
  if (guild.inBot) return `<a class="guild-card" href="/g/${guild.id}/overview" data-nav>${background}<span class="guild-card-shade"></span><div class="guild-card-content">${icon(guild)}<div class="guild-card-copy"><strong>${esc(guild.name)}</strong><span>${Number(guild.memberCount || 0).toLocaleString()} members</span></div><span class="card-action">Manage →</span></div></a>`;
  return `<article class="guild-card guild-card-muted">${background}<span class="guild-card-shade"></span><div class="guild-card-content">${icon(guild)}<div class="guild-card-copy"><strong>${esc(guild.name)}</strong><span>Skaylarz is not here yet</span></div><a class="btn btn-primary btn-sm" href="${esc(guild.inviteUrl)}">Add bot</a></div></article>`;
}

async function renderDashboard(user) {
  if (!user) {
    app.innerHTML = `<div class="center-screen"><div class="login-card">${brandLogo('login-logo')}<p class="kicker">Dashboard</p><h1>Your server workspace</h1><p>Log in with Discord to manage servers and add Skaylarz where it is missing.</p><a class="btn btn-primary btn-block" href="/auth/login">Continue with Discord</a></div></div>`;
    return;
  }
  app.innerHTML = `${topbar(user)}<main class="page dashboard-page"><div class="page-header"><div><p class="kicker">Dashboard</p><h1>Your servers</h1><p>Your shared servers, plus servers where you can add Skaylarz.</p></div><button type="button" class="btn btn-secondary" id="refresh-servers">Refresh servers</button></div><div id="guild-root"><div class="spinner"></div></div></main>${footer()}`;
  try {
    document.getElementById('refresh-servers').addEventListener('click', () => renderDashboard(user));
    const guilds = await api('/api/guilds');
    const active = guilds.filter((guild) => guild.inBot);
    const available = guilds.filter((guild) => !guild.inBot);
    document.getElementById('guild-root').innerHTML = `<section class="server-section"><div class="section-title"><h2>Servers with Skaylarz</h2><span>${active.length}</span></div>${active.length ? `<div class="guild-list">${active.map(serverCard).join('')}</div>` : '<div class="empty-state">No shared servers found. If you recently joined a server, log out and sign in again to refresh your Discord memberships.</div>'}</section><section class="server-section"><div class="section-title"><h2>Add to another server</h2><span>${available.length}</span></div>${available.length ? `<div class="guild-list">${available.map(serverCard).join('')}</div>` : '<div class="empty-state compact">No additional servers available to add.</div>'}</section>`;
  } catch (err) { document.getElementById('guild-root').innerHTML = `<div class="banner error">${esc(err.message)}</div><a class="btn btn-secondary" href="/auth/login">Reconnect Discord</a>`; }
}

const NAV_ITEMS = [
  ['overview', 'Overview', '⌂', () => true],
  ['embeds', 'Embed studio', '✎', (access) => access.dashboard],
  ['members', 'Members', '♟', (access) => access.kick || access.ban],
  ['welcome', 'Welcome', '✦', (access) => access.welcome],
  ['autorole', 'Auto role', '◎', (access) => access.autorole],
  ['transcripts', 'Ticket transcripts', '▤', (access) => access.viewTickets],
  ['permissions', 'Staff access', '◇', (access) => access.owner],
  ['settings', 'Settings', '⚙', (access) => access.configure],
];

function guildShell(guild, section, user) {
  const allowed = NAV_ITEMS.filter((item) => item[3](guild.access));
  return `${topbar(user)}<div class="dashboard-shell"><aside class="sidebar"><a class="server-identity" href="/dashboard" data-nav>${icon(guild, 'server-icon')}<span><small>Back to servers</small><strong>${esc(guild.name)}</strong></span></a><nav class="side-nav">${allowed.map(([slug, label, glyph]) => `<a class="${section === slug ? 'active' : ''}" href="/g/${guild.id}/${slug}" data-nav><span>${glyph}</span>${label}</a>`).join('')}</nav><div class="sidebar-foot">${userChip(user)}</div></aside><main class="dashboard-main"><div id="section-root"><div class="spinner"></div></div></main></div>`;
}

async function renderGuildPage(guildId, requestedSection, user) {
  if (!user) return navigate('/dashboard');
  try {
    const guild = await api(`/api/guilds/${guildId}`);
    const allowed = NAV_ITEMS.filter((item) => item[3](guild.access)).map((item) => item[0]);
    const section = allowed.includes(requestedSection) ? requestedSection : 'overview';
    app.innerHTML = guildShell(guild, section, user);
    const renderers = { overview: renderOverview, embeds: renderGuildEmbedStudio, members: renderMembers, welcome: renderWelcome, autorole: renderAutorole, transcripts: renderTranscripts, permissions: renderPermissions, settings: renderSettings };
    await renderers[section](guild);
  } catch (err) {
    app.innerHTML = `${topbar(user)}<div class="center-screen"><div class="card error-state"><h2>We couldn't open that server</h2><p>${esc(err.message)}</p><a class="btn btn-secondary" href="/dashboard" data-nav>Back to servers</a></div></div>`;
  }
}

function sectionHeader(kicker, title, description, action = '') {
  return `<div class="section-header"><div><p class="kicker">${esc(kicker)}</p><h1>${esc(title)}</h1><p>${esc(description)}</p></div>${action}</div>`;
}

async function renderOverview(guild) {
  const root = document.getElementById('section-root');
  const metric = (iconText, value, label, note = '') => `<article class="snapshot-card"><span class="snapshot-icon">${iconText}</span><strong>${value}</strong><b>${label}</b>${note ? `<small>${note}</small>` : ''}</article>`;
  const online = guild.onlineCount == null ? '—' : Number(guild.onlineCount || 0).toLocaleString();
  root.innerHTML = `${sectionHeader('Server overview', guild.name, 'A live snapshot of your Discord server and Skaylarz activity.')}<section class="server-snapshot"><div class="snapshot-heading"><div><h2>Server snapshot</h2><p>Live counts pulled from Discord</p></div><span class="snapshot-live"><i></i>Live</span></div><div class="snapshot-grid">${metric('♙', Number(guild.memberCount || 0).toLocaleString(), 'Members')}${metric('#', Number(guild.channelCount || 0).toLocaleString(), 'Channels')}${metric('♢', Number(guild.roleCount || 0).toLocaleString(), 'Roles')}${metric('◌', online, 'Online', guild.onlineCount == null ? 'Presence tracking is off' : '')}</div><div class="activity-heading"><div><h2>Server activity</h2><p>Insights begin collecting as members use Skaylarz.</p></div><div class="activity-periods"><button type="button" disabled>7d</button><button type="button" class="active" disabled>14d</button><button type="button" disabled>30d</button></div></div><div class="activity-layout"><section class="activity-card"><h3>Activity timeline</h3><p>Messages, commands and joins over the last 14 days</p><div class="activity-graph" role="img" aria-label="No activity recorded yet"><svg viewBox="0 0 800 260" preserveAspectRatio="none" aria-hidden="true"><path class="activity-grid-line" d="M0 45H800M0 110H800M0 175H800M0 240H800"></path><path class="activity-empty-line" d="M0 230 C180 230 270 230 400 230 S640 230 800 230"></path></svg><div class="activity-empty-copy">Activity will appear here as members use the bot.</div></div><div class="activity-legend"><span><i class="message"></i>Messages</span><span><i class="command"></i>Commands</span><span><i class="join"></i>Joins</span></div></section><aside class="top-commands-card"><h3>Top commands</h3><p>Most used in the last 14 days</p><div class="top-commands-empty">Command activity appears here<br>as members use Skaylarz.</div></aside></div></section>`;
}

function memberRow(member, access) {
  const actionable = !member.bot && member.id !== state.session?.user?.id;
  return `<div class="member-row" data-member-id="${member.id}"><img src="${esc(member.avatar)}" alt=""><div class="member-copy"><strong>${esc(member.displayName)}</strong><span>@${esc(member.username)}${member.bot ? ' · Bot' : ''}</span></div><div class="member-actions">${actionable && access.kick ? `<button class="btn btn-secondary btn-sm" data-action="kick" data-id="${member.id}" data-name="${esc(member.displayName)}">Kick</button>` : ''}${actionable && access.ban ? `<button class="btn btn-danger btn-sm" data-action="ban" data-id="${member.id}" data-name="${esc(member.displayName)}">Ban</button>` : ''}</div></div>`;
}

async function renderMembers(guild) {
  const root = document.getElementById('section-root');
  root.innerHTML = `${sectionHeader('Moderation', 'Members', 'Search members and take action without leaving the dashboard.')}<div class="panel"><form id="member-search" class="search-row"><input type="search" name="query" maxlength="100" placeholder="Search by username"><button class="btn btn-secondary" type="submit">Search</button></form><div id="member-list"><div class="spinner"></div></div></div><dialog id="moderation-dialog"><form method="dialog" id="moderation-form"><input type="hidden" name="userId"><input type="hidden" name="moderationAction"><h2 id="moderation-title">Moderate member</h2><p id="moderation-copy"></p><label class="field"><span>Reason</span><textarea name="reason" maxlength="512" required placeholder="Explain why this action is being taken"></textarea></label><div class="dialog-actions"><button class="btn btn-ghost" value="cancel">Cancel</button><button class="btn btn-danger" value="confirm" id="confirm-moderation">Confirm</button></div></form></dialog>`;
  const list = document.getElementById('member-list');
  const load = async (query = '') => {
    list.innerHTML = '<div class="spinner"></div>';
    try { const members = await api(`/api/guilds/${guild.id}/members?query=${encodeURIComponent(query)}`); list.innerHTML = members.length ? `<div class="member-list">${members.map((member) => memberRow(member, guild.access)).join('')}</div>` : '<div class="empty-state compact">No matching members.</div>'; } catch (err) { list.innerHTML = `<div class="banner error">${esc(err.message)}</div>`; }
  };
  await load();
  document.getElementById('member-search').addEventListener('submit', (event) => { event.preventDefault(); load(new FormData(event.target).get('query')); });
  const dialog = document.getElementById('moderation-dialog');
  list.addEventListener('click', (event) => {
    const button = event.target.closest('[data-action]');
    if (!button) return;
    const form = document.getElementById('moderation-form');
    form.elements.userId.value = button.dataset.id; form.elements.moderationAction.value = button.dataset.action; form.elements.reason.value = '';
    document.getElementById('moderation-title').textContent = `${button.dataset.action === 'ban' ? 'Ban' : 'Kick'} ${button.dataset.name}?`;
    document.getElementById('moderation-copy').textContent = button.dataset.action === 'ban' ? 'They will be removed and unable to rejoin until unbanned.' : 'They will be removed but can rejoin with a new invite.';
    dialog.showModal();
  });
  document.getElementById('moderation-form').addEventListener('submit', async (event) => {
    if (event.submitter?.value !== 'confirm') return;
    event.preventDefault();
    const form = event.currentTarget; const button = document.getElementById('confirm-moderation'); button.disabled = true;
    const userId = form.elements.userId.value; const action = form.elements.moderationAction.value;
    try { await api(`/api/guilds/${guild.id}/members/${userId}/${action}`, { method: 'POST', body: { reason: form.elements.reason.value } }); dialog.close(); document.querySelector(`[data-member-id="${userId}"]`)?.remove(); toast(`Member ${action === 'ban' ? 'banned' : 'kicked'} and case logged.`); } catch (err) { toast(err.message, 'error'); } finally { button.disabled = false; }
  });
}

function channelOptions(channels, selected, placeholder = 'Choose a channel') {
  return `<option value="">${esc(placeholder)}</option>${channels.map((channel) => `<option value="${channel.id}" ${channel.id === selected ? 'selected' : ''}>#${esc(channel.name)}</option>`).join('')}`;
}
function roleOptions(roles, selected, placeholder = 'Choose a role', onlyAssignable = false) {
  const list = onlyAssignable ? roles.filter((role) => role.assignable && !role.managed) : roles.filter((role) => !role.managed);
  return `<option value="">${esc(placeholder)}</option>${list.map((role) => `<option value="${role.id}" ${role.id === selected ? 'selected' : ''}>${esc(role.name)}</option>`).join('')}`;
}

async function renderWelcome(guild) {
  const root = document.getElementById('section-root');
  const [config, channels] = await Promise.all([api(`/api/guilds/${guild.id}/config`), api(`/api/guilds/${guild.id}/channels`)]);
  let embed = config.welcomeEmbed || {};
  if (typeof embed === 'string') embed = JSON.parse(embed);
  const embedField = (name, label, max, type = 'text') => `<label class="field"><span>${label}</span><input type="${type}" name="${name}" maxlength="${max}" value="${esc(embed[name] || '')}" ${type === 'url' ? 'placeholder="https://…"' : ''}></label>`;
  root.innerHTML = `${sectionHeader('Onboarding', 'Welcome embed', 'Design the greeting new members see when they join.')}<div class="welcome-grid"><section class="panel form-panel"><form id="welcome-form"><label class="toggle-row"><span><strong>Enable welcome messages</strong><small>Send an embed whenever someone joins.</small></span><input type="checkbox" name="welcomeEnabled" ${config.welcomeEnabled ? 'checked' : ''}></label><label class="field"><span>Welcome channel</span><select name="welcomeChannelId">${channelOptions(channels.text, config.welcomeChannelId)}</select></label>${embedField('title', 'Title', 256)}<label class="field"><span>Message</span><textarea name="welcomeMessage" maxlength="2000" placeholder="Welcome {user} to {server}!">${esc(config.welcomeMessage || 'Welcome {user} to **{server}**! You are member #{memberCount}.')}</textarea><small>Variables in title, message and footer: {user}, {username}, {server}, {memberCount}</small></label><label class="field"><span>Embed colour</span><input type="color" name="color" value="#${esc(embed.color || '5865F2')}"></label>${embedField('footer', 'Footer', 1024)}${embedField('image', 'Large image URL', 1024, 'url')}${embedField('thumbnail', 'Thumbnail URL', 1024, 'url')}<button class="btn btn-primary" type="submit">Save welcome settings</button></form></section><section class="panel welcome-preview-panel"><div class="panel-head"><h2>Live preview</h2></div><p class="preview-caption">Sample member · updates as you type. Discord may render markdown slightly differently.</p><div id="welcome-preview" aria-live="polite"></div><p id="welcome-preview-status" class="preview-caption"></p></section></div>`;
  const form = document.getElementById('welcome-form');
  const sample = (value, limit) => String(value).replace(/\{(user|username|server|memberCount)\}/g, (_, key) => ({ user: '@NewMember', username: 'NewMember', server: guild.name, memberCount: Number(guild.memberCount || 0) + 1 }[key])).slice(0, limit);
  const markdown = (value) => esc(value).replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>').replace(/\n/g, '<br>');
  const safeImage = (value) => { try { const url = new URL(value); return url.protocol === 'https:' && !url.username && !url.password ? esc(url.href) : ''; } catch { return ''; } };
  const preview = () => {
    const title = sample(form.elements.title.value, 256);
    const description = sample(form.welcomeMessage.value || 'Welcome {user} to **{server}**! You are member #{memberCount}.', 2000);
    const footer = sample(form.elements.footer.value, 1024);
    const image = safeImage(form.elements.image.value); const thumbnail = safeImage(form.elements.thumbnail.value);
    document.getElementById('welcome-preview').innerHTML = `<div class="discord-preview" style="border-left-color:${esc(form.color.value)}">${thumbnail ? `<img class="preview-thumbnail" src="${thumbnail}" alt="Thumbnail preview" referrerpolicy="no-referrer">` : ''}${title ? `<h3>${esc(title)}</h3>` : ''}<div class="preview-description">${markdown(description)}</div>${image ? `<img class="preview-image" src="${image}" alt="Welcome image preview" referrerpolicy="no-referrer">` : ''}${footer ? `<small class="preview-footer">${esc(footer)}</small>` : ''}</div>`;
    document.getElementById('welcome-preview-status').textContent = form.welcomeEnabled.checked ? 'Welcome messages are enabled in this draft. Save to apply.' : 'Welcome messages are disabled. You can still edit and save the design.';
  };
  form.addEventListener('input', preview);
  preview();
  document.getElementById('welcome-form').addEventListener('submit', async (event) => {
    event.preventDefault(); const form = event.currentTarget; const button = form.querySelector('button[type="submit"]'); button.disabled = true;
    const welcomeEmbed = Object.fromEntries(['title', 'color', 'footer', 'image', 'thumbnail'].map((key) => [key, form.elements.namedItem(key).value]));
    try { await api(`/api/guilds/${guild.id}/welcome`, { method: 'PATCH', body: { welcomeEnabled: form.welcomeEnabled.checked, welcomeChannelId: form.welcomeChannelId.value, welcomeMessage: form.welcomeMessage.value, welcomeEmbed } }); toast('Welcome embed saved.'); } catch (err) { toast(err.message, 'error'); } finally { button.disabled = false; }
  });
}

async function renderTranscripts(guild) {
  const root = document.getElementById('section-root');
  root.innerHTML = `${sectionHeader('Support', 'Ticket transcripts', 'Private browser-viewable archives. Only Manage Server staff or roles granted /ticket access can view them.')}<section class="panel"><div id="transcript-list"><div class="spinner"></div></div></section>`;
  const list = document.getElementById('transcript-list');
  try {
    const tickets = await api(`/api/guilds/${guild.id}/tickets`);
    list.innerHTML = `<p class="preview-caption">Latest 100 tickets. Transcripts are saved on close and refreshed before deletion. Older deleted tickets cannot be recovered automatically.</p>${tickets.length ? `<div class="transcript-list">${tickets.map((ticket) => `<article class="transcript-row"><div><strong>Ticket #${Number(ticket.ticketNumber)} · ${esc(ticket.subject || ticket.categoryLabel || 'Support')}</strong><small>${esc(ticket.status)} · Opened by ${esc(ticket.openerId)} · ${esc(new Date(ticket.createdAt).toLocaleDateString())}</small></div>${ticket.hasTranscript ? `<a class="btn btn-secondary btn-sm" target="_blank" rel="noopener" href="/api/guilds/${guild.id}/tickets/${encodeURIComponent(ticket.id)}/transcript">View transcript ↗</a>` : '<span class="tag">Not yet archived</span>'}</article>`).join('')}</div>` : '<div class="empty-state compact">No tickets yet.</div>'}`;
  } catch (err) { list.innerHTML = `<div class="banner error">${esc(err.message)}</div>`; }
}

async function renderAutorole(guild) {
  const root = document.getElementById('section-root');
  const [config, roles] = await Promise.all([api(`/api/guilds/${guild.id}/config`), api(`/api/guilds/${guild.id}/roles`)]);
  root.innerHTML = `${sectionHeader('Onboarding', 'Automatic role', 'Give every new member a safe starter role.')}<section class="panel form-panel"><div class="banner info">For safety, roles with administrator or moderation permissions cannot be used. The bot's role must sit above the selected role.</div><form id="autorole-form"><label class="field"><span>Role for new members</span><select name="autoRoleId">${roleOptions(roles, config.autoRoleId, 'Disabled', true)}</select><small>Select Disabled to stop assigning a role.</small></label><button class="btn btn-primary" type="submit">Save automatic role</button></form></section>`;
  document.getElementById('autorole-form').addEventListener('submit', async (event) => { event.preventDefault(); const form = event.currentTarget; try { await api(`/api/guilds/${guild.id}/autorole`, { method: 'PATCH', body: { autoRoleId: form.autoRoleId.value } }); toast('Automatic role saved.'); } catch (err) { toast(err.message, 'error'); } });
}

async function renderPermissions(guild) {
  const root = document.getElementById('section-root');
  const [roles, grants, categories] = await Promise.all([api(`/api/guilds/${guild.id}/roles`), api(`/api/guilds/${guild.id}/command-permissions`), api('/api/commands')]);
  const commands = categories.flatMap((category) => category.commands).filter((command) => command.name !== 'staff-permissions').sort((a, b) => a.name.localeCompare(b.name));
  const draw = (rows) => {
    document.getElementById('grant-list').innerHTML = rows.length ? rows.map((grant) => { const role = roles.find((item) => item.id === grant.roleId); return `<div class="grant-row"><div><span class="role-dot" style="background:${esc(role?.color || '#99a1b3')}"></span><strong>${esc(role?.name || grant.roleId)}</strong><span>can use</span><code>/${esc(grant.commandName)}</code></div><button class="icon-button" data-remove="true" data-role="${grant.roleId}" data-command="${esc(grant.commandName)}" aria-label="Remove permission">×</button></div>`; }).join('') : '<div class="empty-state compact">No custom role grants. Native Discord permissions still apply.</div>';
  };
  root.innerHTML = `${sectionHeader('Owner controls', 'Staff command access', 'Grant one role access to one command at a time.')}<div class="content-grid permissions-grid"><section class="panel form-panel"><h2>Add a role grant</h2><form id="permission-form"><label class="field"><span>Staff role</span><select name="roleId" required>${roleOptions(roles, '', 'Choose a role')}</select></label><label class="field"><span>Command</span><select name="commandName" required><option value="">Choose a command</option>${commands.map((command) => `<option value="${esc(command.name)}">/${esc(command.name)} — ${esc(command.description)}</option>`).join('')}</select></label><button class="btn btn-primary" type="submit">Grant access</button></form></section><section class="panel"><div class="panel-head"><h2>Current grants</h2><span>Owner only</span></div><div id="grant-list"></div></section></div>`;
  let current = grants; draw(current);
  document.getElementById('permission-form').addEventListener('submit', async (event) => { event.preventDefault(); const form = event.currentTarget; try { current = await api(`/api/guilds/${guild.id}/command-permissions`, { method: 'POST', body: { roleId: form.roleId.value, commandName: form.commandName.value, allow: true } }); draw(current); toast('Staff permission granted.'); } catch (err) { toast(err.message, 'error'); } });
  document.getElementById('grant-list').addEventListener('click', async (event) => { const button = event.target.closest('[data-remove]'); if (!button) return; try { current = await api(`/api/guilds/${guild.id}/command-permissions`, { method: 'POST', body: { roleId: button.dataset.role, commandName: button.dataset.command, allow: false } }); draw(current); toast('Staff permission removed.'); } catch (err) { toast(err.message, 'error'); } });
}

async function renderSettings(guild) {
  const root = document.getElementById('section-root');
  const [config, channels] = await Promise.all([api(`/api/guilds/${guild.id}/config`), api(`/api/guilds/${guild.id}/channels`)]);
  root.innerHTML = `${sectionHeader('Configuration', 'Server settings', 'Branding, logs, appeals and ticket destinations.')}<section class="panel form-panel"><form id="settings-form"><div class="form-columns"><label class="field"><span>Accent colour</span><div class="color-row"><input type="color" name="accentColor" value="#${esc(config.accentColor || '5865F2')}"><code>#${esc(config.accentColor || '5865F2')}</code></div></label><label class="field"><span>Banner image URL</span><input type="url" name="bannerUrl" value="${esc(config.bannerUrl || '')}" placeholder="https://..."></label><label class="field"><span>Thumbnail image URL</span><input type="url" name="thumbnailUrl" value="${esc(config.thumbnailUrl || '')}" placeholder="https://..."></label><label class="field"><span>Moderation log</span><select name="modLogChannelId">${channelOptions(channels.text, config.modLogChannelId, 'Not set')}</select></label><label class="field"><span>Appeal channel</span><select name="appealChannelId">${channelOptions(channels.text, config.appealChannelId, 'Not set')}</select></label><label class="field"><span>Transcript channel</span><select name="transcriptChannelId">${channelOptions(channels.text, config.transcriptChannelId, 'Disabled')}</select></label><label class="field"><span>Ticket category</span><select name="ticketCategoryId"><option value="">Not set</option>${channels.categories.map((category) => `<option value="${category.id}" ${category.id === config.ticketCategoryId ? 'selected' : ''}>${esc(category.name)}</option>`).join('')}</select></label></div><button class="btn btn-primary" type="submit">Save server settings</button></form></section>`;
  const form = document.getElementById('settings-form');
  form.accentColor.addEventListener('input', () => { form.accentColor.nextElementSibling.textContent = form.accentColor.value.toUpperCase(); });
  form.addEventListener('submit', async (event) => { event.preventDefault(); const body = Object.fromEntries(new FormData(form)); try { await api(`/api/guilds/${guild.id}/config`, { method: 'PATCH', body }); toast('Server settings saved.'); } catch (err) { toast(err.message, 'error'); } });
}

document.addEventListener('click', (event) => {
  const link = event.target.closest('a[data-nav]');
  if (!link) return;
  const href = link.getAttribute('href');
  if (!href || href.startsWith('http') || href.startsWith('/auth/')) return;
  event.preventDefault(); navigate(href);
});

render();
