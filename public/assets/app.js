/* Dziri System — dashboard SPA (History-API router, every section has its own URL) */
'use strict';

const ICONS = {
  overview: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="7" height="9" rx="2"/><rect x="14" y="3" width="7" height="5" rx="2"/><rect x="14" y="12" width="7" height="9" rx="2"/><rect x="3" y="16" width="7" height="5" rx="2"/></svg>',
  commands: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 17l6-6-6-6"/><path d="M12 19h8"/></svg>',
  automod: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z"/><path d="M9 12l2 2 4-4"/></svg>',
  autorole: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="9" cy="8" r="4"/><path d="M2 21v-2a7 7 0 0114 0v2M19 8v6M16 11h6"/></svg>',
  moderation: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 4l6 6-9 9H5v-6z"/><path d="M3 21h18"/></svg>',
  leveling: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/></svg>',
  logs: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 3H6a2 2 0 00-2 2v14a2 2 0 002 2h12a2 2 0 002-2V9z"/><path d="M14 3v6h6M8 13h8M8 17h5"/></svg>',
  history: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 12a9 9 0 109-9 9 9 0 00-7 3.3"/><path d="M3 4v4h4M12 7v5l3 2"/></svg>',
  settings: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 00.3 1.8l.1.1a2 2 0 11-2.8 2.8l-.1-.1a1.7 1.7 0 00-1.8-.3 1.7 1.7 0 00-1 1.5V21a2 2 0 11-4 0v-.1a1.7 1.7 0 00-1.1-1.5 1.7 1.7 0 00-1.8.3l-.1.1a2 2 0 11-2.8-2.8l.1-.1a1.7 1.7 0 00.3-1.8 1.7 1.7 0 00-1.5-1H3a2 2 0 110-4h.1a1.7 1.7 0 001.5-1.1 1.7 1.7 0 00-.3-1.8l-.1-.1a2 2 0 112.8-2.8l.1.1a1.7 1.7 0 001.8.3H9a1.7 1.7 0 001-1.5V3a2 2 0 114 0v.1a1.7 1.7 0 001 1.5 1.7 1.7 0 001.8-.3l.1-.1a2 2 0 112.8 2.8l-.1.1a1.7 1.7 0 00-.3 1.8V9a1.7 1.7 0 001.5 1H21a2 2 0 110 4h-.1a1.7 1.7 0 00-1.5 1z"/></svg>',
  tickets: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 9V7a2 2 0 012-2h14a2 2 0 012 2v2a3 3 0 000 6v2a2 2 0 01-2 2H5a2 2 0 01-2-2v-2a3 3 0 000-6z"/><path d="M13 5v3M13 11v2M13 16v3"/></svg>',
  temprooms: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 5L6 9H3v6h3l5 4z"/><path d="M16 9a4 4 0 010 6M19 6a8 8 0 010 12"/></svg>',
};

const ROUTES = [
  { path: '/dashboard', key: 'overview', title: 'Overview', sub: 'Live status of your server and Dziri System', render: pageOverview },
  { path: '/dashboard/commands', key: 'commands', title: 'Commands', sub: 'Aliases, reasons, permissions and responses per command', render: pageCommands },
  { path: '/dashboard/automod', key: 'automod', title: 'AutoMod', sub: 'Automatic filters, spam protection and message cleanup', render: pageAutomod, prefix: true },
  { path: '/dashboard/autorole', key: 'autorole', title: 'AutoRole', sub: 'Assign one or more Discord roles when a member joins', render: pageAutoRole },
  { path: '/dashboard/moderation', key: 'moderation', title: 'Moderation', sub: 'Mute behaviour, staff roles and member messaging', render: pageModeration },
  { path: '/dashboard/tickets', key: 'tickets', title: 'Tickets', sub: 'Ticket panel, types, permissions and moderator notifications', render: pageTickets, prefix: true },
  { path: '/dashboard/temp-rooms', key: 'temprooms', title: 'Temporary Rooms', sub: 'Join-to-create voice rooms and their control panel', render: pageTempRooms, prefix: true },
  { path: '/dashboard/leveling', key: 'leveling', title: 'Leveling', sub: 'Text XP, voice XP, rewards and the rank card', render: pageLeveling, prefix: true },
  { path: '/dashboard/logs', key: 'logs', title: 'Logs', sub: 'Choose which events are logged and where', render: pageLogs },
  { path: '/dashboard/history', key: 'history', title: 'Member History', sub: 'Every moderation action, role and nickname change', render: pageHistory },
  { path: '/dashboard/settings', key: 'settings', title: 'Settings', sub: 'Prefix and general configuration', render: pageSettings },
];

const S = { me: null, bot: null, guilds: [], guildId: null, roles: { status: 'idle', items: [] }, channels: { status: 'idle', items: [] }, renderToken: 0, cleanup: [] };
const view = () => document.getElementById('view');
const gid = () => S.guildId;
const G = (path) => `/guilds/${gid()}${path}`;

// ------------------------------------------------------------------ routing
function link(path) { return `${path}${gid() ? `?guild=${gid()}` : ''}`; }
function navigate(path, replace) {
  const url = link(path);
  if (replace) history.replaceState({}, '', url); else history.pushState({}, '', url);
  render();
}
document.addEventListener('click', (e) => {
  const a = e.target.closest('a[data-nav]');
  if (!a || e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
  e.preventDefault();
  document.getElementById('sidebar').classList.remove('open');
  navigate(a.getAttribute('data-nav'));
});
window.addEventListener('popstate', () => { const g = new URLSearchParams(location.search).get('guild'); if (g && g !== S.guildId && S.guilds.some((x) => x.id === g)) selectGuild(g, true); else render(); });

function currentRoute() {
  const p = location.pathname.replace(/\/+$/, '') || '/dashboard';
  return ROUTES.find((r) => r.path === p) || ROUTES.find((r) => r.prefix && p.startsWith(`${r.path}/`)) || null;
}

function renderNav() {
  const r = currentRoute();
  const nav = document.getElementById('nav');
  nav.replaceChildren(...ROUTES.map((x) => {
    const a = h('a', { href: link(x.path), 'data-nav': x.path, class: r && r.key === x.key ? 'active' : '' });
    a.innerHTML = ICONS[x.key];
    a.appendChild(document.createTextNode(x.title));
    return a;
  }));
}

async function render() {
  S.cleanup.forEach((fn) => { try { fn(); } catch { /* ignore */ } }); S.cleanup = [];
  document.querySelectorAll('.dropdown').forEach((d) => d.remove());
  const token = ++S.renderToken;
  const r = currentRoute();
  renderNav();
  const v = view();
  if (!r) {
    document.getElementById('page-title').textContent = 'Not found';
    document.getElementById('page-sub').textContent = '';
    v.replaceChildren(h('div', { class: 'card enter' }, h('h2', null, 'Page not found'), h('p', { class: 'desc' }, 'This dashboard page does not exist.'), h('a', { class: 'btn primary', href: link('/dashboard'), 'data-nav': '/dashboard' }, 'Go to Overview')));
    return;
  }
  document.getElementById('page-title').textContent = r.title;
  document.getElementById('page-sub').textContent = r.sub;
  document.title = `${r.title} — Dziri System`;
  if (!gid()) { v.replaceChildren(noGuildView()); return; }
  const page = h('div', { class: 'page' });
  v.replaceChildren(page);
  try {
    await r.render(page, () => token === S.renderToken);
  } catch (err) {
    if (token !== S.renderToken) return;
    page.replaceChildren(ErrorBanner(`Could not load this page: ${err.message}`));
  }
}

function noGuildView() {
  if (S.bot && !S.bot.ready) return h('div', { class: 'stack' }, ErrorBanner('The bot is not connected to Discord right now. Check DISCORD_TOKEN and the console, then reload.'));
  return h('div', { class: 'card enter' }, h('h2', null, 'No servers available'),
    h('p', { class: 'desc' }, 'Dziri System is not in any server where you have the Manage Server permission.'),
    S.bot && S.bot.inviteUrl ? h('a', { class: 'btn primary', href: S.bot.inviteUrl, target: '_blank', rel: 'noopener' }, 'Invite Dziri System') : null);
}

// ------------------------------------------------------------------ discord data (real roles/channels)
function loadDiscordData() {
  S.roles = { status: 'loading', items: [] };
  S.channels = { status: 'loading', items: [] };
  const g = gid();
  S.roles.promise = api('GET', G('/roles')).then((d) => { if (g !== gid()) return; S.roles.items = d.roles.map((r) => ({ ...r, meta: r.managed ? 'managed' : '' })); S.roles.status = 'ready'; })
    .catch((e) => { S.roles.status = 'error'; S.roles.error = e.message; });
  S.channels.promise = api('GET', G('/channels')).then((d) => { if (g !== gid()) return; S.channels.items = d.channels; S.channels.status = 'ready'; })
    .catch((e) => { S.channels.status = 'error'; S.channels.error = e.message; });
}
const ensureData = () => Promise.all([S.roles.promise, S.channels.promise]);

const roleSelect = (values, opts = {}) => Select({ source: S.roles, values, kind: 'role', emptyText: 'No roles available.', loadingText: 'Loading roles...', filter: opts.includeEveryone ? (opts.filter || null) : ((r) => !r.everyone && (!opts.filter || opts.filter(r))), multiple: opts.multiple !== false, placeholder: opts.placeholder, onChange: opts.onChange });
const TEXTISH = ['text', 'announcement', 'forum', 'media'];
const channelSelect = (values, opts = {}) => Select({
  source: S.channels, values, kind: 'channel', emptyText: 'No channels available.', loadingText: 'Loading channels...', multiple: opts.multiple !== false, placeholder: opts.placeholder, onChange: opts.onChange,
  filter: opts.types ? (c) => opts.types.includes(c.type) : (c) => c.type !== 'category' || opts.categories,
});

async function selectGuild(id, fromPop) {
  S.guildId = id;
  localStorage.setItem('dz_guild', id);
  const u = new URL(location.href); u.searchParams.set('guild', id);
  if (!fromPop) history.replaceState({}, '', u.pathname + u.search);
  loadDiscordData();
  renderGuildPicker();
  render();
}

function renderGuildPicker() {
  const box = document.getElementById('guild-picker');
  if (!S.guilds.length) { box.replaceChildren(); return; }
  const sel = h('select', { class: 'input guild-select', onchange: () => selectGuild(sel.value) }, S.guilds.map((g) => h('option', { value: g.id, selected: g.id === gid() }, g.name)));
  box.replaceChildren(Field('Server', sel));
}

// ------------------------------------------------------------------ boot
(async function boot() {
  document.getElementById('menu-btn').onclick = () => document.getElementById('sidebar').classList.toggle('open');
  renderNav();
  view().replaceChildren(Loading(['Loading configuration...']));
  try {
    [S.me, S.bot] = await Promise.all([api('GET', '/me'), api('GET', '/bot')]);
  } catch (e) { view().replaceChildren(ErrorBanner(e.message)); return; }
  renderFoot(); renderBotStatus();
  setInterval(async () => { try { S.bot = await api('GET', '/bot'); renderBotStatus(); } catch { /* ignore */ } }, 30000);
  try { S.guilds = (await api('GET', '/guilds')).guilds; } catch (e) { S.guilds = []; toast(e.message, 'err'); }
  const wanted = new URLSearchParams(location.search).get('guild') || localStorage.getItem('dz_guild');
  const pick = S.guilds.find((g) => g.id === wanted) || S.guilds[0];
  if (pick) await selectGuild(pick.id);
  else render();
})();

function renderBotStatus() {
  const el = document.getElementById('bot-status');
  const b = S.bot || {};
  el.className = `pill ${b.ready ? 'on' : 'off'}`;
  el.replaceChildren(h('span', { class: `dot ${b.ready ? 'on' : ''}` }), b.ready ? ` ${b.tag} • ${b.ping}ms` : ' Bot offline');
}
function renderFoot() {
  const u = S.me.user;
  document.getElementById('side-foot').replaceChildren(
    u.avatar ? h('img', { class: 'avatar', src: u.avatar, alt: '' }) : h('div', { class: 'avatar' }, (u.username || '?')[0]),
    h('div', { style: { flex: 1, minWidth: 0 } }, h('div', { style: { fontWeight: 650, overflow: 'hidden', textOverflow: 'ellipsis' } }, u.username), h('div', { class: 'hint' }, S.me.mode === 'password' ? 'Owner login' : 'Discord login')),
    h('button', { class: 'btn sm ghost', title: 'Log out', onclick: async () => { await fetch('/auth/logout', { method: 'POST' }); location.href = '/login'; } }, '⏻'));
}

// ================================================================== PAGES
const LABELS = { textmute: 'Text Mute', textunmute: 'Text Unmute', voicemute: 'Voice Mute', voiceunmute: 'Voice Unmute', ban: 'Ban', unban: 'Unban', kick: 'Kick', purge: 'Purge', lock: 'Lock', unlock: 'Unlock', roleadd: 'Role Added', roleremove: 'Role Removed', nickname: 'Nickname', automod: 'AutoMod', broadcast: 'Messaging', warn: 'Warning' };
const TYPE_ICON = { textmute: '🔇', textunmute: '🔊', voicemute: '🎙️', voiceunmute: '🎙️', ban: '🔨', unban: '♻️', kick: '👢', purge: '🧹', lock: '🔒', unlock: '🔓', roleadd: '➕', roleremove: '➖', nickname: '🏷️', automod: '🛡️', broadcast: '📨' };

// ---------------------------------------------------------------- Overview
async function pageOverview(page, alive) {
  page.replaceChildren(Loading(['Loading server overview...']));
  const d = await api('GET', G('/overview'));
  if (!alive()) return;
  const sum = (o) => Object.values(o || {}).reduce((a, b) => a + b, 0);
  const stat = (k, v, s, i) => h('div', { class: 'card stat enter', style: { animationDelay: `${i * 50}ms` } }, h('div', { class: 'k' }, k), h('div', { class: 'v' }, v), s ? h('div', { class: 's' }, s) : null);
  const m7 = d.moderation.last7d;
  page.replaceChildren(h('div', { class: 'stack' },
    h('div', { class: 'grid g4' },
      stat('Bot status', d.bot.ready ? 'Online' : 'Offline', `${d.bot.ping}ms ping • up ${fmtUptime(d.bot.uptime || 0)} • ${d.bot.memory} MB`, 0),
      stat('Members', fmtNum(d.guild.memberCount), `${d.guild.voiceActive} in voice now`, 1),
      stat('Channels / Roles', `${d.guild.channels} / ${d.guild.roles}`, d.guild.name, 2),
      stat('Commands', `${d.commands.enabled}/${d.commands.total}`, `Prefix: ${d.prefix === '' ? '(empty)' : d.prefix}`, 3)),
    h('div', { class: 'grid g4' },
      stat('Actions (24h)', fmtNum(sum(d.moderation.last24h)), 'moderation + automod', 4),
      stat('Actions (7d)', fmtNum(sum(m7)), Object.entries(m7).map(([k, v]) => `${LABELS[k] || k}: ${v}`).slice(0, 3).join(' • ') || 'No actions', 5),
      stat('Active mutes', `${d.moderation.active.textMutes + d.moderation.active.voiceMutes}`, `${d.moderation.active.textMutes} text (role) • ${d.moderation.active.voiceMutes} voice`, 6),
      stat('Leveling', fmtNum(d.leveling.trackedMembers), `${fmtNum(d.leveling.totalTextXp)} text XP • ${fmtNum(d.leveling.totalVoiceXp)} voice XP`, 7)),
    h('div', { class: 'card enter' }, h('div', { class: 'row' }, h('h2', null, 'Recent actions'), h('div', { class: 'spacer' }), h('a', { class: 'btn sm', href: link('/dashboard/history'), 'data-nav': '/dashboard/history' }, 'View all')),
      d.recent.length ? historyTable(d.recent) : h('div', { class: 'empty', style: { marginTop: '12px' } }, h('b', null, 'No actions yet.'), 'Moderation actions will appear here.'))));
}

function historyTable(items) {
  return h('table', { class: 'table', style: { marginTop: '10px' } },
    h('thead', null, h('tr', null, ['Action', 'Member', 'Moderator', 'Reason', 'Duration', 'Date'].map((x) => h('th', null, x)))),
    h('tbody', null, items.map((e) => h('tr', null,
      h('td', null, h('span', { class: 'pill accent' }, `${TYPE_ICON[e.type] || '•'} ${LABELS[e.type] || e.type}`)),
      h('td', null, h('div', null, e.targetTag || '—'), e.targetId ? h('div', { class: 'tiny' }, e.targetId) : null),
      h('td', null, h('div', null, e.moderatorTag || '—'), e.moderatorId ? h('div', { class: 'tiny' }, e.moderatorId) : null),
      h('td', { dir: 'auto' }, e.reason || '—', e.details ? h('div', { class: 'tiny' }, e.details) : null),
      h('td', null, e.duration ? (/^perm/.test(e.duration) ? 'Permanent' : e.duration) : '—'),
      h('td', null, h('div', null, new Date(e.at).toLocaleString()), h('div', { class: 'tiny' }, relTime(e.at)))))));
}

// ---------------------------------------------------------------- Commands
const CMD_ICON = { textmute: '🔇', textunmute: '🔊', voicemute: '🎙️', voiceunmute: '🎧', ban: '🔨', unban: '♻️', kick: '👢', purge: '🧹', lock: '🔒', unlock: '🔓', role: '🎭', move: '➡️', moveme: '🚶', crimeshistory: '📕', currentcrime: '⚠️', rank: '🏅', leaderboard: '🏆', history: '📜', help: '❓' };
async function pageCommands(page, alive) {
  page.replaceChildren(Loading(['Loading roles...', 'Loading channels...', 'Loading configuration...']));
  const [data, rn] = await Promise.all([api('GET', G('/commands')), api('GET', G('/rolenames')).catch(() => ({ entries: [] })), ensureData()]);
  if (!alive()) return;
  const prefix = data.prefix;
  const search = h('input', { class: 'input', placeholder: 'Search commands or aliases…', dir: 'auto', style: { maxWidth: '320px' } });
  const list = h('div', { class: 'stack', style: { gap: '12px' } });
  const cards = data.commands.map((c, i) => commandCard(c, prefix, i, rn.entries || []));
  list.append(...cards.map((c) => c.el));
  search.addEventListener('input', () => {
    const q = search.value.trim().toLocaleLowerCase();
    cards.forEach((c) => { c.el.style.display = !q || c.matches(q) ? '' : 'none'; });
  });
  page.replaceChildren(h('div', { class: 'stack' },
    h('div', { class: 'card enter' }, h('div', { class: 'row' },
      h('div', { style: { flex: 1 } }, h('h2', null, 'Command system'),
        h('div', { class: 'desc', style: { margin: 0 } }, 'Slash commands, prefix commands and aliases all run the same handler with the same permission checks. Current prefix: ',
          prefix === '' ? h('code', { class: 'k' }, '(empty)') : h('code', { class: 'k' }, prefix), ' — ',
          h('a', { href: link('/dashboard/settings'), 'data-nav': '/dashboard/settings' }, 'change'))),
      search)),
    list));
}

/**
 * Custom names for individual Discord ROLES (a separate system from command aliases).
 * Each row = a real Discord role selector + chip input with that role's extra names.
 */
function RoleNamesEditor(entries) {
  let rows = (entries || []).map((e) => ({ roleId: e.roleId, names: [...(e.names || [])], missing: Boolean(e.missing), roleName: e.roleName }));
  const list = h('div', { class: 'stack', style: { gap: '10px' } });
  const err = h('div', { class: 'err-text' });
  const render = () => {
    list.replaceChildren(...(rows.length ? rows.map((row, i) => {
      const sel = roleSelect(row.roleId ? [row.roleId] : [], { multiple: false, placeholder: 'Select a Discord role…', onChange: (v) => { row.roleId = v; err.textContent = ''; } });
      const tags = TagInput({ values: row.names, placeholder: 'Type a custom name and press Enter…', onChange: (v) => { row.names = v; err.textContent = ''; } });
      row._tags = tags;
      return h('div', { class: 'card', style: { padding: '14px', background: 'rgba(0,0,0,.18)' } },
        row.missing && row.roleId ? h('div', { class: 'banner', style: { marginBottom: '10px', padding: '8px 12px', fontSize: '12.5px' } }, `⚠ The Discord role for this row (ID ${row.roleId}) no longer exists. Pick a new role or delete the row.`) : null,
        h('div', { class: 'grid g2' },
          Field('Discord Role', sel, 'The real Discord role. It is never renamed — the ID is stored.'),
          Field('Custom Role Names', tags, 'Type → Enter. English, Arabic and Unicode are supported.')),
        h('div', { class: 'row', style: { justifyContent: 'flex-end', marginTop: '6px' } },
          h('button', { type: 'button', class: 'btn sm danger', onclick: () => { rows.splice(i, 1); render(); } }, 'Delete row')));
    }) : [h('div', { class: 'empty' }, h('b', null, 'No custom role names yet.'), 'Add a role below to give it short names like “ods” or “أوديسي”.')]),
    h('div', null, h('button', { type: 'button', class: 'btn sm', onclick: () => { rows.push({ roleId: '', names: [] }); render(); } }, '+ Add role')),
    err);
  };
  render();
  const wrap = h('div', null, list);
  wrap.getValue = () => rows.filter((r) => r.roleId).map((r) => ({ roleId: r.roleId, names: r._tags ? r._tags.getValue() : r.names }));
  wrap.setEntries = (e) => { rows = e.map((x) => ({ roleId: x.roleId, names: [...(x.names || [])], missing: Boolean(x.missing) })); render(); };
  wrap.setError = (m) => { err.textContent = m || ''; };
  return wrap;
}

function commandCard(c, prefix, idx, roleNameEntries) {
  let cfg = c.config;
  const isMod = c.category === 'moderation' || c.userPermissions.length > 0;
  const aliasPill = h('span', { class: 'pill accent' });
  const statePill = h('span', { class: 'pill' });
  const refreshPills = () => {
    aliasPill.textContent = `${cfg.aliases.length} alias${cfg.aliases.length === 1 ? '' : 'es'}`;
    statePill.className = `pill ${cfg.enabled ? 'on' : 'off'}`; statePill.textContent = cfg.enabled ? 'Enabled' : 'Disabled';
  };
  refreshPills();
  const el = h('div', { class: 'card cmd enter', style: { animationDelay: `${Math.min(idx, 10) * 35}ms` } });
  const head = h('div', { class: 'cmd-head', onclick: () => { el.classList.toggle('open'); if (el.classList.contains('open') && !built) build(); } },
    h('div', { class: 'cmd-icon' }, CMD_ICON[c.name] || '⚙️'),
    h('div', { style: { flex: 1, minWidth: 0 } }, h('div', { class: 'cmd-title' }, c.label, h('code', null, `/${c.name}`)), h('div', { class: 'cmd-sub' }, c.description)),
    aliasPill, statePill, h('span', { class: 'cmd-chev' }, '▾'));
  const inner = h('div', { class: 'cmd-inner' });
  el.append(head, h('div', { class: 'cmd-body' }, h('div', null, inner)));
  let built = false;

  function build() {
    built = true;
    const enabled = Toggle(cfg.enabled);
    const triggers = h('div', { class: 'row', style: { gap: '6px' } });
    const showTriggers = (aliases) => triggers.replaceChildren(h('span', { class: 'hint' }, 'Triggers:'), h('code', { class: 'k' }, `/${c.name}`), h('code', { class: 'k' }, `${prefix}${c.name}`), ...aliases.map((a) => h('code', { class: 'k', dir: 'auto' }, `${prefix}${a}`)));
    const aliases = TagInput({ values: cfg.aliases, placeholder: 'Type an alias and press Enter...', onChange: (v) => { showTriggers(v); aliases.setError(''); } });
    showTriggers(cfg.aliases);

    const sections = [
      ToggleRow('Enabled', 'When disabled, the slash command, prefix command and all aliases stop working on this server.', enabled),
      h('div', { class: 'field' }, h('label', null, 'Aliases'), aliases, h('div', { class: 'hint' }, `Arabic and any Unicode text are supported. The command name "${c.name}" always works — aliases are extra triggers.`), triggers),
    ];

    let reasons = null; let defDur = null; let useMenu = null;
    if (c.supportsReasons) {
      reasons = ReasonEditor({ reasons: cfg.reasons, durations: c.reasonDurations });
      useMenu = Toggle(cfg.useReasonMenu !== false);
      sections.push(h('div', { class: 'field' }, h('label', null, `${c.label} Reasons`), h('div', { class: 'hint', style: { marginBottom: '6px' } }, 'Shown in a Discord select menu when no reason is typed. These reasons belong to this command only.'), reasons));
      sections.push(ToggleRow('Show reason menu', 'If off, the command runs immediately with "No reason provided" when no reason is typed.', useMenu));
    }
    if (c.supportsDuration) {
      defDur = h('input', { class: 'input', value: cfg.defaultDuration || '', placeholder: 'e.g. 10m, 1h, permanent' });
      sections.push(Field('Default duration', defDur, 'Used when the chosen reason has no duration and none is typed.'));
    }
    // /role only: custom names for individual Discord roles (NOT command aliases).
    let roleNamesEditor = null;
    if (c.name === 'role') {
      roleNamesEditor = RoleNamesEditor(roleNameEntries);
      sections.push(h('div', { class: 'field' },
        h('label', null, 'Custom Role Names'),
        h('div', { class: 'hint', style: { marginBottom: '8px' } },
          'Give a Discord role extra names that only exist inside Dziri System — the Discord role is never renamed. ',
          h('code', { class: 'k' }, `${prefix}role @user ods`), ' then resolves “ods” to the real role.'),
        roleNamesEditor));
    }
    const roles = roleSelect(cfg.allowedRoles, { placeholder: 'Search roles…' });
    const chans = channelSelect(cfg.allowedChannels, { categories: true, placeholder: 'All channels — search to restrict…' });
    sections.push(h('div', { class: 'grid g2' },
      Field('Allowed Roles', roles, c.userPermissions.length ? `Members need the Discord permission ${c.userPermissions.join(', ')} OR one of these roles. Administrators always pass.` : 'Leave empty to allow everyone; otherwise only these roles can use it.'),
      Field('Allowed Channels', chans, 'Leave empty to allow the command in every channel.')));

    const log = Toggle(cfg.log); const dm = Toggle(cfg.dmTarget); const eph = Toggle(cfg.ephemeral); const del = Toggle(cfg.deleteTrigger);
    const toggles = h('div', { class: 'grid g2' },
      h('div', null, h('div', { class: 'label' }, 'Logging'), ToggleRow('Log usage', 'Send a log embed to the moderation log channel.', log), isMod ? ToggleRow('DM the target', 'Notify the member by DM (if enabled in Moderation).', dm) : null),
      h('div', null, h('div', { class: 'label' }, 'Response'), ToggleRow('Ephemeral slash replies', 'Only the executor sees the slash response.', eph), ToggleRow('Delete prefix trigger', 'Delete the triggering message after a prefix command.', del)));
    sections.push(toggles);
    if (c.botPermissions.length) sections.push(h('div', { class: 'hint' }, `Bot needs: ${c.botPermissions.join(', ')}`));

    sections.push(SaveButton(async () => {
      const body = {
        enabled: enabled.getValue(), aliases: aliases.getValue(), allowedRoles: roles.getValue(), allowedChannels: chans.getValue(),
        log: log.getValue(), dmTarget: dm.getValue(), ephemeral: eph.getValue(), deleteTrigger: del.getValue(),
      };
      if (reasons) { body.reasons = reasons.getValue(); body.useReasonMenu = useMenu.getValue(); }
      if (defDur) body.defaultDuration = defDur.value.trim();
      if (roleNamesEditor) {
        // Saved first so a custom-name error does not silently drop the rest of the form.
        try {
          const rnRes = await api('PUT', G('/rolenames'), { entries: roleNamesEditor.getValue() });
          roleNamesEditor.setError('');
          roleNameEntries = rnRes.entries;
        } catch (err) { roleNamesEditor.setError(err.message); throw err; }
      }
      try {
        const res = await api('PUT', G(`/commands/${c.name}`), body);
        cfg = res.config; c.config = cfg; refreshPills(); aliases.setValue(cfg.aliases); showTriggers(cfg.aliases);
      } catch (err) {
        if (/alias/i.test(err.message)) aliases.setError(err.message, err.data && err.data.alias);
        throw err;
      }
    }));
    inner.replaceChildren(...sections);
  }
  return { el, matches: (q) => c.name.includes(q) || c.label.toLocaleLowerCase().includes(q) || cfg.aliases.some((a) => a.toLocaleLowerCase().includes(q)) };
}

// ---------------------------------------------------------------- AutoRole
async function pageAutoRole(page, alive) {
  page.replaceChildren(Loading(['Loading Discord roles...', 'Loading AutoRole configuration...']));
  const [data] = await Promise.all([api('GET', G('/autorole')), ensureData()]);
  if (!alive()) return;

  const cfg = data.autoRole;
  const status = data.status || { roles: [], botMissingPermission: false };
  const enabled = Toggle(cfg.enabled);
  const roles = roleSelect(cfg.roleIds, {
    placeholder: 'Search real Discord roles…',
    filter: (r) => r.assignable === true,
  });

  const warnings = [];
  if (status.botMissingPermission) warnings.push('Dziri System is missing the Manage Roles permission. Grant it before enabling AutoRole.');
  for (const role of status.roles || []) if (role.warning) warnings.push(`${role.name || role.id}: ${role.warning}`);

  page.replaceChildren(h('div', { class: 'stack' },
    warnings.length ? warnBanner(warnings) : null,
    h('div', { class: 'card enter' },
      ToggleRow('Enable AutoRole', 'Assign every selected role to new non-bot members when they join.', enabled),
      h('div', { class: 'field', style: { marginTop: '14px' } },
        h('label', null, 'Roles to assign'),
        roles,
        h('div', { class: 'hint' }, 'Uses actual Discord role IDs. Select multiple roles; each selection becomes a removable chip. Only roles below the bot’s highest role are shown.'))),
    h('div', { class: 'grid g3' },
      h('div', { class: 'card stat enter' }, h('div', { class: 'k' }, 'Status'), h('div', { class: 'v' }, cfg.enabled ? 'Enabled' : 'Disabled'), h('div', { class: 's' }, cfg.enabled ? 'New members receive the selected roles.' : 'No roles are assigned automatically.')),
      h('div', { class: 'card stat enter' }, h('div', { class: 'k' }, 'Selected roles'), h('div', { class: 'v' }, String(cfg.roleIds.length)), h('div', { class: 's' }, 'Stored by Discord role ID.')),
      h('div', { class: 'card stat enter' }, h('div', { class: 'k' }, 'Bot permission'), h('div', { class: 'v' }, status.botMissingPermission ? 'Missing' : 'Ready'), h('div', { class: 's' }, 'Manage Roles + correct hierarchy required.'))),
    h('div', { class: 'card' }, SaveButton(async () => {
      const selected = roles.getValue();
      if (enabled.getValue() && !selected.length) throw new Error('Select at least one role before enabling AutoRole.');
      const saved = await api('PUT', G('/autorole'), { enabled: enabled.getValue(), roleIds: selected });
      enabled.setValue(saved.autoRole.enabled);
      roles.setValue(saved.autoRole.roleIds);
    }))));
}

// ---------------------------------------------------------------- AutoMod
const RULES = [
  ['antiSpam', 'Anti-Spam', 'Too many messages in a short time.', [['threshold', 'Messages'], ['interval', 'Within (seconds)']]],
  ['antiLink', 'Anti-Link', 'Blocks links except allowed domains.', []],
  ['antiInvite', 'Anti-Invite', 'Blocks Discord server invites.', []],
  ['badWords', 'Bad Words', 'Blocks messages containing listed words (any language).', []],
  ['mentionSpam', 'Mention Spam', 'Too many mentions in a single message.', [['threshold', 'Mentions']]],
  ['caps', 'Excessive Caps', 'Messages that are mostly capital letters.', [['threshold', 'Caps %'], ['minLength', 'Min letters']]],
  ['duplicates', 'Duplicate Messages', 'Same message repeated.', [['threshold', 'Repeats'], ['interval', 'Within (seconds)']]],
];
const ACTION_OPTS = [['delete', 'Delete message'], ['warn', 'Delete + warn'], ['timeout', 'Delete + timeout'], ['kick', 'Delete + kick'], ['ban', 'Delete + ban']];

async function pageAutomod(page, alive) {
  const sub = location.pathname.replace(/\/+$/, '').split('/')[3] || '';
  const tabs = h('div', { class: 'tabs' }, [
    ['', 'AutoMod Rules'], ['message-cleanup', 'Message Cleanup'],
  ].map(([p, label]) => h('a', { href: link(`/dashboard/automod${p ? `/${p}` : ''}`), 'data-nav': `/dashboard/automod${p ? `/${p}` : ''}`, class: sub === p ? 'active' : '' }, label)));
  const body = h('div');
  page.replaceChildren(tabs, body);
  if (sub === 'message-cleanup') return pageMessageCleanup(body, alive);
  if (sub) { body.replaceChildren(ErrorBanner('Unknown AutoMod page.')); return; }

  body.replaceChildren(Loading(['Loading roles...', 'Loading channels...', 'Loading configuration...']));
  const [{ config }] = await Promise.all([api('GET', G('/config')), ensureData()]);
  if (!alive()) return;
  const a = config.automod;
  const master = Toggle(a.enabled);
  const exRoles = roleSelect(a.exemptRoles);
  const exChans = channelSelect(a.exemptChannels, { categories: true });
  const logCh = channelSelect(a.logChannelId ? [a.logChannelId] : [], { multiple: false, types: TEXTISH, placeholder: 'Use the Logs page channel' });
  const ruleCtl = {};
  const ruleCards = RULES.map(([key, title, desc, nums], i) => {
    const r = a.rules[key];
    const ctl = { enabled: Toggle(r.enabled), action: h('select', { class: 'input' }, ACTION_OPTS.map(([v, l]) => h('option', { value: v, selected: r.action === v }, l))), duration: h('input', { class: 'input', value: r.duration || '', placeholder: '5m' }), nums: {} };
    const durField = Field('Timeout duration', ctl.duration);
    const syncDur = () => { durField.style.display = ctl.action.value === 'timeout' ? '' : 'none'; };
    ctl.action.addEventListener('change', syncDur); syncDur();
    const fields = [Field('Action', ctl.action), durField];
    for (const [nk, nl] of nums) { ctl.nums[nk] = h('input', { class: 'input', type: 'number', min: 1, value: r[nk] }); fields.push(Field(nl, ctl.nums[nk])); }
    if (key === 'badWords') { ctl.words = TagInput({ values: r.words, placeholder: 'Type a word and press Enter...', allowSpaces: true }); fields.push(h('div', { style: { gridColumn: '1 / -1' } }, Field('Blocked words', ctl.words, 'Matching is case-insensitive and works with Arabic.'))); }
    if (key === 'antiLink') { ctl.domains = TagInput({ values: r.allowedDomains, placeholder: 'Allowed domain, e.g. youtube.com — Enter' }); fields.push(h('div', { style: { gridColumn: '1 / -1' } }, Field('Allowed domains', ctl.domains))); }
    ruleCtl[key] = ctl;
    return h('div', { class: 'card enter', style: { animationDelay: `${i * 40}ms` } },
      h('div', { class: 'row' }, h('div', { style: { flex: 1 } }, h('h3', null, title), h('div', { class: 'hint' }, desc)), ctl.enabled),
      h('div', { class: 'grid g2', style: { marginTop: '14px' } }, fields));
  });
  body.replaceChildren(h('div', { class: 'stack' },
    h('div', { class: 'card enter' }, ToggleRow('AutoMod enabled', 'Master switch. Members with Manage Messages or Administrator are always exempt.', master),
      h('div', { class: 'grid g3', style: { marginTop: '10px' } }, Field('Exempt roles', exRoles), Field('Exempt channels', exChans), Field('AutoMod log channel', logCh, 'Optional — overrides the Logs page AutoMod channel.'))),
    h('div', { class: 'grid g2' }, ruleCards),
    h('div', { class: 'card' }, SaveButton(async () => {
      const rules = {};
      for (const [key] of RULES) {
        const c = ruleCtl[key];
        rules[key] = { enabled: c.enabled.getValue(), action: c.action.value, duration: c.duration.value.trim() || '5m' };
        for (const [nk, inp] of Object.entries(c.nums)) rules[key][nk] = Number(inp.value);
        if (c.words) rules[key].words = c.words.getValue();
        if (c.domains) rules[key].allowedDomains = c.domains.getValue();
      }
      await api('PUT', G('/automod'), { enabled: master.getValue(), exemptRoles: exRoles.getValue(), exemptChannels: exChans.getValue(), logChannelId: logCh.getValue(), rules });
    }))));
}

function cleanupTime(ts) { return ts ? `${new Date(ts).toLocaleString()} (${relTime(ts)})` : 'Not run yet'; }

async function pageMessageCleanup(body, alive) {
  body.replaceChildren(Loading(['Loading voice channels...', 'Loading cleanup schedule...']));
  const [data] = await Promise.all([api('GET', G('/automod/message-cleanup')), ensureData()]);
  if (!alive()) return;
  let status = data.status;
  const controls = {};

  function scopeCard(scope, title, description, needsChannels) {
    const cfg = data.config[scope];
    const enabled = Toggle(cfg.enabled);
    const value = h('input', { class: 'input', type: 'number', min: 1, max: 720, value: cfg.intervalValue });
    const unit = h('select', { class: 'input' }, h('option', { value: 'hours', selected: cfg.intervalUnit !== 'days' }, 'Hours'), h('option', { value: 'days', selected: cfg.intervalUnit === 'days' }, 'Days'));
    const channels = needsChannels ? channelSelect(cfg.channelIds || [], { types: ['voice'], placeholder: 'Select public voice channels…' }) : null;
    const stat = h('div');
    const renderStatus = () => {
      const s = status[scope];
      stat.replaceChildren(
        h('div', { class: 'grid g3', style: { marginTop: '12px' } },
          h('div', { class: 'stat' }, h('div', { class: 'k' }, 'Last cleanup'), h('div', { class: 's' }, cleanupTime(s.lastRun))),
          h('div', { class: 'stat' }, h('div', { class: 'k' }, 'Next scheduled'), h('div', { class: 's' }, s.enabled ? cleanupTime(s.nextRun) : 'Disabled')),
          h('div', { class: 'stat' }, h('div', { class: 'k' }, 'Last result'), h('div', { class: 's' }, `${s.lastDeleted} deleted • ${s.lastFailed} failed • ${s.lastChannels} channel(s)`))),
        s.lastError ? h('div', { class: 'banner', style: { marginTop: '10px' } }, s.lastError) : null);
    };
    renderStatus();
    const clear = h('button', { class: 'btn danger', onclick: async () => {
      const yes = await Modal({ title: `Clear ${title} now?`, body: `This will delete messages from ${needsChannels ? 'the selected public voice-channel chats' : 'currently tracked temporary-room chats'}. Unrelated channels are never touched.`, confirmText: 'Clear Now', danger: true });
      if (!yes) return;
      clear.disabled = true; clear.textContent = 'Clearing…';
      try {
        const result = await api('POST', G(`/automod/message-cleanup/${scope}/clear`), { confirm: true });
        status = result.status; renderStatus();
        toast(`Deleted ${result.result.deleted} message(s); ${result.result.failed} failed.`, 'ok', 6000);
      } catch (e) { toast(e.message, 'err', 7000); }
      finally { clear.disabled = false; clear.textContent = 'Clear Now'; }
    } }, 'Clear Now');
    controls[scope] = { enabled, value, unit, channels, renderStatus };
    return h('div', { class: 'card enter' }, h('h2', null, title), h('p', { class: 'desc' }, description),
      ToggleRow('Enabled', 'Runs automatically using the persisted schedule below.', enabled),
      needsChannels ? Field('Included public voice channels', channels, 'Only these Discord voice channels and their built-in chats are cleaned. Normal text channels are never included.') : null,
      h('div', { class: 'grid g2', style: { marginTop: '12px' } }, Field('Cleanup interval', value), Field('Time unit', unit)),
      stat, h('div', { class: 'row', style: { justifyContent: 'flex-end', marginTop: '12px' } }, clear));
  }

  body.replaceChildren(h('div', { class: 'stack' },
    h('div', { class: 'banner info' }, 'The scheduler checks every minute, persists its last run, survives restarts, retries failures after 15 minutes, and prevents concurrent cleanup of the same channel.'),
    h('div', { class: 'grid g2' },
      scopeCard('temporaryRooms', 'Temporary Voice Room Chats', 'Automatically clears the built-in chats of currently tracked temporary voice rooms.', false),
      scopeCard('publicVoice', 'Public Voice Channel Chats', 'Clears only the public voice channels selected below. Default interval: 24 hours.', true)),
    h('div', { class: 'card' }, SaveButton(async () => {
      const payload = {};
      for (const scope of ['temporaryRooms', 'publicVoice']) {
        const c = controls[scope];
        payload[scope] = { enabled: c.enabled.getValue(), intervalValue: Number(c.value.value), intervalUnit: c.unit.value, ...(c.channels ? { channelIds: c.channels.getValue() } : {}) };
      }
      const saved = await api('PUT', G('/automod/message-cleanup'), payload);
      status = saved.status;
      controls.temporaryRooms.renderStatus();
      controls.publicVoice.renderStatus();
    }))));
}

// ---------------------------------------------------------------- Moderation (+ member messaging)
async function pageModeration(page, alive) {
  page.replaceChildren(Loading(['Loading roles...', 'Loading channels...', 'Loading configuration...']));
  const [{ config }] = await Promise.all([api('GET', G('/config')), ensureData()]);
  if (!alive()) return;
  const m = config.moderation;
  const mode = h('select', { class: 'input' }, h('option', { value: 'timeout', selected: m.muteMode === 'timeout' }, 'Discord timeout (recommended)'), h('option', { value: 'role', selected: m.muteMode === 'role' }, 'Mute role'));
  const muteRole = roleSelect(m.muteRoleId ? [m.muteRoleId] : [], { multiple: false, placeholder: 'Select mute role…' });
  const muteRoleField = Field('Mute role', muteRole, 'Used only in "Mute role" mode. The bot must be above this role.');
  const sync = () => { muteRoleField.style.display = mode.value === 'role' ? '' : 'none'; };
  mode.addEventListener('change', sync); sync();
  const dTxt = h('input', { class: 'input', value: m.defaultMuteDuration }); const dVc = h('input', { class: 'input', value: m.defaultVoiceMuteDuration });
  const dmT = Toggle(m.dmOnAction);
  const modRoles = roleSelect(m.modRoles); const lockRoles = roleSelect(m.lockRoles, { includeEveryone: true }); const prot = roleSelect(m.protectedRoles);

  page.replaceChildren(h('div', { class: 'stack' },
    h('div', { class: 'grid g2' },
      h('div', { class: 'card enter' }, h('h2', null, 'Text & voice mutes'), h('p', { class: 'desc' }, 'How /textmute works. /voicemute always uses Discord server-mute.'),
        h('div', { class: 'stack', style: { gap: '14px' } }, Field('Text mute mode', mode), muteRoleField,
          h('div', { class: 'grid g2' }, Field('Default text mute duration', dTxt), Field('Default voice mute duration', dVc)),
          ToggleRow('DM members on action', 'Send the reason and duration to the member by DM.', dmT))),
      h('div', { class: 'card enter', style: { animationDelay: '60ms' } }, h('h2', null, 'Staff roles'), h('p', { class: 'desc' }, 'Applied to every moderation command, on top of per-command allowed roles.'),
        h('div', { class: 'stack', style: { gap: '14px' } },
          Field('Moderator roles', modRoles, 'Can use all moderation commands even without the Discord permission.'),
          Field('Default lock roles', lockRoles, '/lock without a role locks the channel for these roles (empty = @everyone).'),
          Field('Protected roles', prot, 'Members with these roles can only be moderated by administrators.')))),
    h('div', { class: 'card' }, SaveButton(async () => {
      await api('PUT', G('/moderation'), { muteMode: mode.value, muteRoleId: muteRole.getValue(), defaultMuteDuration: dTxt.value.trim(), defaultVoiceMuteDuration: dVc.value.trim(), dmOnAction: dmT.getValue(), modRoles: modRoles.getValue(), lockRoles: lockRoles.getValue(), protectedRoles: prot.getValue() });
    })),
    await messagingCard(alive, config.messaging)));
}

async function messagingCard(alive, savedFormat) {
  const draftKey = `dz-broadcast-draft-${gid()}`;
  let draft = {};
  try { draft = JSON.parse(localStorage.getItem(draftKey) || '{}'); } catch { draft = {}; }
  const botData = await api('GET', G('/broadcast/bots')).catch(() => ({ bots: {}, placeholders: [] }));
  let attachments = Array.isArray(draft.attachments) ? draft.attachments : [];
  // Message format (normal/embed, footer, colour) is persisted on the server (guild config), not in the browser draft.
  const DEFAULT_FOOTER = 'Sent from {server} via {bot}';
  const fmt = Object.assign({ messageType: 'normal', embedColor: '#a855f7', footerEnabled: true, footerText: DEFAULT_FOOTER }, savedFormat || botData.messaging || {});
  if (!['normal', 'embed'].includes(fmt.messageType)) fmt.messageType = 'normal';
  if (typeof fmt.footerText !== 'string') fmt.footerText = DEFAULT_FOOTER;

  const target = h('select', { class: 'input' }, h('option', { value: 'all', selected: draft.target !== 'roles' }, 'All members'), h('option', { value: 'roles', selected: draft.target === 'roles' }, 'Members with selected roles'));
  const roles = roleSelect(draft.roles || [], { onChange: saveDraft });
  const exclude = roleSelect(draft.excludeRoles || [], { onChange: saveDraft });
  const rolesField = Field('Roles', roles, 'Members with ANY of these roles.');
  const within = h('input', { class: 'input', type: 'number', min: 0, value: draft.joinedWithinDays || 0 });
  const before = h('input', { class: 'input', type: 'number', min: 0, value: draft.joinedBeforeDays || 0 });
  const delay = h('input', { class: 'input', type: 'number', min: 1, step: 0.5, value: draft.delay || 1.5 });
  // Older drafts kept a separate "embed description"; the message text is now the embed description itself.
  const msg = h('textarea', { class: 'input', dir: 'auto', maxLength: 4000, placeholder: 'Hello {user}, welcome to {server}!' }, draft.message || draft.embedDescription || '');
  const embedTitle = h('input', { class: 'input', value: draft.embedTitle || '', maxLength: 256, dir: 'auto', placeholder: 'Optional embed title' });
  const embedColor = h('input', { class: 'input', type: 'color', value: /^#[0-9a-f]{6}$/i.test(fmt.embedColor) ? fmt.embedColor : '#a855f7' });
  const contentAbove = h('input', { class: 'input', value: draft.contentAbove || '', maxLength: 1800, dir: 'auto', placeholder: 'Optional, e.g. {user}' });
  const delivery = h('select', { class: 'input' }, h('option', { value: 'normal', selected: draft.delivery !== 'webhook' }, 'Normal Bot Message (DM)'), h('option', { value: 'webhook', selected: draft.delivery === 'webhook' }, 'Webhook (selected server channel)'));
  const botSelect = h('select', { class: 'input' }, ['main', 'ticket'].map((key) => {
    const b = botData.bots[key] || {}; const label = key === 'main' ? 'Dziri System' : 'Ticket Bot';
    return h('option', { value: key, selected: (draft.selectedBot || 'main') === key, disabled: !b.ready || !b.inGuild }, `${label}${b.tag ? ` — ${b.tag}` : ''}${!b.ready ? ' — offline' : !b.inGuild ? ' — not in server' : ''}`);
  }));
  const webhookChannel = channelSelect(draft.channelId ? [draft.channelId] : [], { multiple: false, types: TEXTISH, placeholder: 'Webhook delivery channel…', onChange: saveDraft });
  const webhookField = Field('Webhook delivery channel', webhookChannel, 'Webhook mode posts one personalised, rate-limited message per recipient here.');
  const info = h('div', { class: 'hint' });
  const statusBox = h('div');
  const attachmentBox = h('div', { class: 'stack', style: { gap: '8px' } });
  const fileInput = h('input', { type: 'file', multiple: true, accept: 'image/png,image/jpeg,image/gif,image/webp,.pdf,.txt,.csv,.zip,.mp3,.ogg,.wav,.mp4,.webm', style: { display: 'none' } });
  const uploadBtn = h('button', { class: 'btn', onclick: () => fileInput.click() }, '＋ Add attachments');
  const sample = h('div', { class: 'card', style: { padding: '14px', background: 'rgba(0,0,0,.22)' } });

  // ---- message type selector (format) — separate from the delivery method (identity/channel) ----
  let messageType = fmt.messageType;
  const typeBtn = (value, icon, label, desc) => h('a', {
    class: messageType === value ? 'active' : '', role: 'button', tabindex: 0, 'data-type': value,
    style: { cursor: 'pointer', display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: '2px', flex: '1', minWidth: '0' },
    onclick: () => setType(value), onkeydown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setType(value); } },
  }, h('span', null, `${icon} ${label}`), h('span', { class: 'tiny', style: { fontWeight: 500, opacity: .8 } }, desc));
  const typeSwitch = h('div', { class: 'tabs', style: { display: 'flex', width: '100%', margin: 0 } },
    typeBtn('normal', '💬', 'Normal Message', 'Plain text, attachments below'),
    typeBtn('embed', '🟪', 'Embed Message', 'Text inside an embed, image below'));
  const typeHint = h('div', { class: 'hint' });
  function setType(value) {
    messageType = value === 'embed' ? 'embed' : 'normal';
    for (const a of typeSwitch.children) a.className = a.dataset.type === messageType ? 'active' : '';
    syncType(); updatePreview(); saveDraft(); saveFormat();
  }

  // ---- footer controls ----
  const footerToggle = Toggle(fmt.footerEnabled !== false, () => { syncFooter(); updatePreview(); saveFormat(); });
  const footerText = h('input', { class: 'input', value: fmt.footerText, maxLength: 2048, dir: 'auto', placeholder: 'No footer (leave empty to send without one)' });
  const footerClear = h('button', { type: 'button', class: 'btn sm', title: 'Remove the footer text completely', onclick: () => { footerText.value = ''; footerText.focus(); syncFooter(); updatePreview(); saveFormat(); } }, 'Clear');
  const footerReset = h('button', { type: 'button', class: 'btn sm ghost', title: 'Restore the default footer text', onclick: () => { footerText.value = DEFAULT_FOOTER; syncFooter(); updatePreview(); saveFormat(); } }, 'Default');
  const footerRow = h('div', { class: 'row', style: { gap: '8px' } }, footerText, footerClear, footerReset);
  const footerHint = h('div', { class: 'hint' });
  const formatStatus = h('span', { class: 'tiny', style: { color: 'var(--faint)' } });
  function footerValue() { return footerToggle.getValue() ? footerText.value.trim() : ''; }
  function syncFooter() {
    const on = footerToggle.getValue();
    footerText.disabled = !on; footerClear.disabled = !on; footerReset.disabled = !on;
    footerRow.style.opacity = on ? '' : '.5';
    footerHint.textContent = !on ? 'Footer disabled — nothing is appended to your message.'
      : !footerText.value.trim() ? 'Footer enabled but empty — no footer will be sent.'
        : messageType === 'embed' ? 'Shown in the embed footer field. Placeholders are expanded per recipient.'
          : 'Shown under the text as small Discord sub-text (-#). Placeholders are expanded per recipient.';
  }

  const embedTitleField = Field('Embed title', embedTitle, 'Optional. Placeholders work here too.');
  const embedColorField = Field('Embed colour', embedColor);
  const contentAboveField = Field('Plain text above the embed', contentAbove, 'Optional. Sent as normal message content above the embed — put {user} here if you want the member pinged in webhook mode (mentions inside embeds do not notify).');
  const embedFields = h('div', { class: 'stack', style: { gap: '14px' } }, h('div', { class: 'grid g2' }, embedTitleField, embedColorField), contentAboveField);
  const msgField = Field('Message', msg);
  function syncType() {
    const embed = messageType === 'embed';
    embedFields.style.display = embed ? '' : 'none';
    msgField.querySelector('label').textContent = embed ? 'Message (embed description)' : 'Message';
    msg.maxLength = embed ? 4000 : 1800;
    typeHint.textContent = embed
      ? 'Embed: your text is the embed description; the first attached image is shown inside the embed, below the text. Extra images are stacked below it; other files are uploaded as normal attachments.'
      : 'Normal: a regular Discord message. Text comes first, attachments are displayed underneath. No embed is used.';
    syncFooter();
  }

  // Persist the format on the server (debounced) so it survives reloads, navigation and bot restarts.
  let fmtTimer = null;
  function saveFormat() {
    clearTimeout(fmtTimer); formatStatus.textContent = 'Saving format…';
    fmtTimer = setTimeout(async () => {
      try {
        await api('PUT', G('/messaging'), { messageType, embedColor: embedColor.value, footerEnabled: footerToggle.getValue(), footerText: footerText.value });
        if (alive()) formatStatus.textContent = 'Format settings saved ✓';
      } catch (e) { if (alive()) { formatStatus.textContent = 'Format not saved'; toast(e.message, 'err'); } }
    }, 450);
  }
  S.cleanup.push(() => clearTimeout(fmtTimer));

  const placeholders = [
    ['{user}', 'Recipient mention'], ['{username}', 'Username'], ['{displayname}', 'Server display name'], ['{userid}', 'User ID'],
    ['{server}', 'Server name'], ['{serverid}', 'Server ID'], ['{membercount}', 'Member count'], ['{bot}', 'Selected bot name'],
  ];
  const toolbar = h('div', { class: 'row', style: { gap: '6px' } }, placeholders.map(([token, title]) => h('button', {
    type: 'button', class: 'btn sm', title, onclick: () => {
      const start = msg.selectionStart || 0; const end = msg.selectionEnd || start;
      msg.value = msg.value.slice(0, start) + token + msg.value.slice(end);
      msg.focus(); msg.setSelectionRange(start + token.length, start + token.length); updatePreview(); saveDraft();
    },
  }, token)));

  function filters() { return { target: target.value, roles: roles.getValue(), excludeRoles: exclude.getValue(), joinedWithinDays: Number(within.value) || 0, joinedBeforeDays: Number(before.value) || 0 }; }
  function formatPayload() { return { messageType, embedColor: embedColor.value, footerEnabled: footerToggle.getValue(), footerText: footerText.value }; }
  function saveDraft() {
    try {
      localStorage.setItem(draftKey, JSON.stringify({
        target: target.value, roles: roles.getValue(), excludeRoles: exclude.getValue(), joinedWithinDays: Number(within.value) || 0,
        joinedBeforeDays: Number(before.value) || 0, delay: Number(delay.value) || 1.5, message: msg.value,
        embedTitle: embedTitle.value, contentAbove: contentAbove.value,
        delivery: delivery.value, selectedBot: botSelect.value, channelId: webhookChannel.getValue(), attachments,
      }));
    } catch { /* browser storage unavailable */ }
  }
  function sampleExpand(text) {
    const bot = (botData.bots[botSelect.value] || {}).tag || (botSelect.value === 'ticket' ? 'Ticket Bot' : 'Dziri System');
    return String(text || '').replace(/\{user\}/gi, '@Example Member').replace(/\{username\}/gi, 'example_user').replace(/\{displayname\}/gi, 'Example Member')
      .replace(/\{userid\}/gi, '123456789012345678').replace(/\{server\}/gi, 'Example Server').replace(/\{serverid\}/gi, '987654321098765432')
      .replace(/\{membercount\}/gi, '1,234').replace(/\{bot\}/gi, bot);
  }
  // Mirrors services/broadcastService.js payloadFor(): same order, same footer rules, same image placement.
  function updatePreview() {
    const images = attachments.filter((a) => a.type && a.type.startsWith('image/'));
    const files = attachments.filter((a) => !(a.type && a.type.startsWith('image/')));
    const footer = sampleExpand(footerValue());
    const imgEl = (a, extra) => h('img', { src: `/api${G(`/broadcast/attachments/${a.id}`)}`, alt: a.name, style: Object.assign({ display: 'block', maxWidth: '100%', maxHeight: '220px', borderRadius: '8px' }, extra || {}) });
    const fileChips = files.length ? h('div', { class: 'row', style: { gap: '6px', flexWrap: 'wrap', marginTop: '8px' } }, files.map((a) => h('span', { class: 'pill' }, `📎 ${a.name}`))) : null;
    const header = h('div', { class: 'row', style: { justifyContent: 'space-between', gap: '8px' } },
      h('div', { class: 'label' }, 'Example preview — sample values, not a real recipient'),
      h('span', { class: `pill ${messageType === 'embed' ? 'accent' : ''}` }, `${messageType === 'embed' ? 'Embed' : 'Normal'} · ${delivery.value === 'webhook' ? 'Webhook' : 'Bot DM'}`));
    const body = [];
    if (messageType === 'embed') {
      const above = sampleExpand(contentAbove.value.trim());
      if (above) body.push(h('div', { style: { whiteSpace: 'pre-wrap', marginTop: '8px' }, dir: 'auto' }, above));
      if (fileChips) body.push(fileChips, h('div', { class: 'tiny', style: { color: 'var(--faint)', marginTop: '4px' } }, 'Discord limitation: non-image files are always shown above embeds.'));
      const embedBox = h('div', { style: { borderLeft: `4px solid ${embedColor.value}`, padding: '10px 12px', marginTop: '10px', background: 'rgba(255,255,255,.04)', borderRadius: '8px', maxWidth: '520px' } },
        embedTitle.value.trim() ? h('div', { dir: 'auto', style: { fontWeight: 700, marginBottom: '4px' } }, sampleExpand(embedTitle.value)) : null,
        msg.value.trim() ? h('div', { dir: 'auto', style: { whiteSpace: 'pre-wrap' } }, sampleExpand(msg.value)) : (!embedTitle.value.trim() && !images.length ? h('span', { class: 'hint' }, 'No message text.') : null),
        images[0] ? imgEl(images[0], { marginTop: '10px' }) : null,
        footer ? h('div', { class: 'tiny', dir: 'auto', style: { marginTop: '8px', color: 'var(--faint)' } }, footer) : null);
      body.push(embedBox);
      for (const a of images.slice(1, 10)) body.push(h('div', { style: { borderLeft: `4px solid ${embedColor.value}`, padding: '10px 12px', marginTop: '6px', background: 'rgba(255,255,255,.04)', borderRadius: '8px', maxWidth: '520px' } }, imgEl(a)));
    } else {
      body.push(h('div', { style: { whiteSpace: 'pre-wrap', marginTop: '8px' }, dir: 'auto' }, sampleExpand(msg.value) || (attachments.length ? '' : h('span', { class: 'hint' }, 'No message text.'))));
      if (footer) body.push(h('div', { class: 'tiny', dir: 'auto', style: { whiteSpace: 'pre-wrap', marginTop: '10px', color: 'var(--faint)' } }, footer));
      if (images.length) body.push(h('div', { class: 'stack', style: { gap: '6px', marginTop: '10px' } }, images.map((a) => imgEl(a, { maxWidth: '400px' }))));
      if (fileChips) body.push(fileChips);
    }
    sample.replaceChildren(header, ...body, attachments.length ? h('div', { class: 'hint', style: { marginTop: '8px' } }, `${attachments.length} attachment(s) selected`) : null);
  }
  function renderAttachments() {
    const rows = attachments.length ? attachments.map((a) => h('div', { class: 'reason' },
      a.type && a.type.startsWith('image/')
        ? h('img', { src: `/api${G(`/broadcast/attachments/${a.id}`)}`, alt: '', style: { width: '56px', height: '42px', objectFit: 'cover', borderRadius: '8px' } })
        : h('span', { class: 'cmd-icon' }, '📎'),
      h('span', { class: 'rl' }, a.name),
      h('span', { class: 'hint' }, `${(a.size / 1024).toFixed(1)} KB`),
      h('button', { class: 'btn sm danger', onclick: async () => {
        await api('DELETE', G(`/broadcast/attachments/${a.id}`)).catch(() => {});
        attachments = attachments.filter((x) => x.id !== a.id);
        renderAttachments(); updatePreview(); saveDraft();
      } }, 'Remove')))
      : [h('div', { class: 'hint' }, 'No attachments selected.')];
    attachmentBox.replaceChildren(...rows);
  }
  async function uploadFiles(files) {
    for (const file of [...files].slice(0, Math.max(0, 10 - attachments.length))) {
      if (file.size > 10 * 1024 * 1024) { toast(`${file.name} is larger than 10 MB.`, 'err'); continue; }
      try {
        const dataUrl = await new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = reject; reader.readAsDataURL(file); });
        const result = await api('POST', G('/broadcast/attachments'), { name: file.name, type: file.type, dataUrl });
        attachments.push(result.attachment);
      } catch (e) { toast(`${file.name}: ${e.message}`, 'err', 6000); }
    }
    fileInput.value = ''; renderAttachments(); updatePreview(); saveDraft();
  }
  fileInput.addEventListener('change', () => uploadFiles(fileInput.files));

  const syncDelivery = () => { webhookField.style.display = delivery.value === 'webhook' ? '' : 'none'; updatePreview(); saveDraft(); };
  const syncTarget = () => { rolesField.style.display = target.value === 'roles' ? '' : 'none'; saveDraft(); };
  target.addEventListener('change', syncTarget); delivery.addEventListener('change', syncDelivery);
  for (const input of [within, before, delay, msg, embedTitle, contentAbove, botSelect]) input.addEventListener('input', () => { updatePreview(); saveDraft(); });
  botSelect.addEventListener('change', () => { updatePreview(); saveDraft(); });
  embedColor.addEventListener('input', () => { updatePreview(); saveFormat(); });
  footerText.addEventListener('input', () => { syncFooter(); updatePreview(); saveFormat(); });
  syncTarget(); syncDelivery(); syncType(); renderAttachments(); updatePreview();

  const previewBtn = h('button', { class: 'btn', onclick: async () => {
    previewBtn.disabled = true; info.textContent = 'Counting members…';
    try { const p = await api('POST', G('/broadcast/preview'), { filters: filters() }); info.textContent = `${p.count} member(s) match. ${p.skipped} skipped (bots / excluded). Delivery: ${delivery.value === 'webhook' ? 'Webhook' : 'Normal Bot Message'} · Format: ${messageType === 'embed' ? 'Embed' : 'Normal'} · Footer: ${footerValue() ? 'yes' : 'none'}.`; }
    catch (e) { info.textContent = e.message; } finally { previewBtn.disabled = false; }
  } }, 'Preview recipients');
  const sendBtn = h('button', { class: 'btn primary', onclick: async () => {
    const hasTitle = messageType === 'embed' && embedTitle.value.trim();
    if (!msg.value.trim() && !hasTitle && !attachments.length) { toast(messageType === 'embed' ? 'Add message text, an embed title, or an attachment.' : 'Add message text or an attachment.', 'err'); return; }
    let count;
    try { count = (await api('POST', G('/broadcast/preview'), { filters: filters() })).count; } catch (e) { toast(e.message, 'err'); return; }
    const modeText = delivery.value === 'webhook' ? `post ${count} personalised webhook message(s) in the selected channel` : `DM ${count} member(s) from the selected bot`;
    const yes = await Modal({ title: 'Queue member messaging campaign?', body: `This will ${modeText}, one every ${delay.value}s, as ${messageType === 'embed' ? 'an embed message' : 'a normal message'}${footerValue() ? ' with a footer' : ' without a footer'}. Attachments: ${attachments.length}.`, confirmText: 'Queue messages' });
    if (!yes) return;
    try {
      await api('POST', G('/broadcast'), {
        message: msg.value, format: formatPayload(),
        embed: { title: embedTitle.value, color: embedColor.value, contentAbove: contentAbove.value },
        attachmentIds: attachments.map((a) => a.id), selectedBot: botSelect.value, delivery: delivery.value,
        channelId: webhookChannel.getValue(), filters: filters(), delayMs: Number(delay.value) * 1000, confirm: true,
      });
      attachments = []; renderAttachments(); updatePreview(); saveDraft(); toast('Messages queued', 'ok'); poll();
    } catch (e) { toast(e.message, 'err', 7000); }
  } }, 'Send');

  let timer = null;
  async function poll() {
    clearTimeout(timer); if (!alive()) return;
    try {
      const state = await api('GET', G('/broadcast')); if (!alive()) return;
      const rows = state.jobs.map((job) => h('tr', null,
        h('td', null, new Date(job.createdAt).toLocaleString()), h('td', null, h('span', { class: `pill ${job.status === 'completed' ? 'on' : job.status === 'running' ? 'accent' : 'off'}` }, job.status)),
        h('td', null, `${job.delivery || 'normal'}${job.messageType ? ` · ${job.messageType}` : ''}`), h('td', null, String(job.counts.queued)), h('td', null, String(job.counts.sent)),
        h('td', null, String(job.counts.failed)), h('td', null, String(job.counts.skipped)), h('td', { class: 'tiny' }, job.lastError || '—')));
      statusBox.replaceChildren(state.active ? h('div', { class: 'row', style: { marginBottom: '10px' } }, h('div', { class: 'spinner' }), 'Sending…', h('button', { class: 'btn sm danger', onclick: async () => { await api('POST', G('/broadcast/cancel')); poll(); } }, 'Cancel')) : null,
        rows.length ? h('table', { class: 'table' }, h('thead', null, h('tr', null, ['Started', 'Status', 'Mode', 'Queued', 'Sent', 'Failed', 'Skipped', 'Last error'].map((x) => h('th', null, x)))), h('tbody', null, rows)) : h('div', { class: 'hint' }, 'No messaging jobs yet.'));
      if (state.active) timer = setTimeout(poll, 3000);
    } catch { /* dashboard polling must not crash the page */ }
  }
  S.cleanup.push(() => clearTimeout(timer)); poll();

  return h('div', { class: 'card enter' }, h('h2', null, 'Member Messaging'),
    h('p', { class: 'desc' }, 'Queued, rate-limited messaging with per-recipient placeholders. Normal mode sends private DMs; webhook mode posts personalised messages in one selected server channel.'),
    h('div', { class: 'grid g2' },
      h('div', { class: 'stack', style: { gap: '14px' } }, Field('Recipients', target), rolesField, Field('Exclude roles', exclude, 'Use an opt-out role here.'),
        h('div', { class: 'grid g3' }, Field('Joined within (days)', within, '0 = any'), Field('Member for at least (days)', before, '0 = any'), Field('Delay (seconds)', delay, 'Minimum 1 second')),
        h('div', { class: 'grid g2' }, Field('Delivery method', delivery, 'How it is sent: bot DM or webhook identity.'), Field('Sending bot', botSelect)), webhookField,
        h('div', { class: 'field' }, h('label', null, 'Message type'), typeSwitch, typeHint),
        h('div', { class: 'field' }, h('label', null, 'Footer'),
          ToggleRow('Footer enabled', 'Turn off to send without any footer or attribution text.', footerToggle),
          footerRow, footerHint),
        h('div', { class: 'field' }, h('label', null, 'Attachments'), h('div', { class: 'row' }, uploadBtn, h('span', { class: 'hint' }, 'Up to 10 files, 10 MB each, 20 MB total.')), fileInput, attachmentBox)),
      h('div', { class: 'stack', style: { gap: '14px' } },
        h('div', { class: 'field' }, h('label', null, 'Placeholder toolbar'), toolbar, h('div', { class: 'hint' }, 'Click to insert at the current cursor position. Only {user} is allowed to ping, and only the intended recipient.')),
        msgField, embedFields,
        sample, h('div', { class: 'row', style: { justifyContent: 'space-between', gap: '8px' } }, info, formatStatus),
        h('div', { class: 'row', style: { justifyContent: 'flex-end' } }, previewBtn, sendBtn))),
    h('h3', { style: { marginTop: '20px' } }, 'Queue status'), statusBox);
}

// ---------------------------------------------------------------- Leveling
async function pageLeveling(page, alive) {
  const sub = location.pathname.replace(/\/+$/, '').split('/')[3] || '';
  const tabs = h('div', { class: 'tabs' }, [['', 'Settings'], ['rank-card', 'Rank Card'], ['leaderboard', 'Leaderboard']].map(([p, l]) => h('a', { href: link(`/dashboard/leveling${p ? `/${p}` : ''}`), 'data-nav': `/dashboard/leveling${p ? `/${p}` : ''}`, class: sub === p ? 'active' : '' }, l)));
  const body = h('div');
  page.replaceChildren(tabs, body);
  if (sub === 'rank-card') return rankCardEditor(body, alive);
  if (sub === 'leaderboard') return leaderboardView(body, alive);
  if (sub) { body.replaceChildren(ErrorBanner('Unknown leveling page.')); return; }
  body.replaceChildren(Loading(['Loading roles...', 'Loading channels...', 'Loading configuration...']));
  const [{ config }] = await Promise.all([api('GET', G('/config')), ensureData()]);
  if (!alive()) return;
  const l = config.leveling;
  const num = (v, min = 0) => h('input', { class: 'input', type: 'number', min, value: v });
  const en = Toggle(l.enabled); const tMin = num(l.textXpMin); const tMax = num(l.textXpMax); const tCd = num(l.textCooldown);
  const vPm = num(l.voiceXpPerMinute); const vOthers = Toggle(l.voiceRequireOthers);
  const igC = channelSelect(l.ignoredChannels, { categories: true }); const igR = roleSelect(l.ignoredRoles);
  const lu = Toggle(l.levelUpMessages);
  const luCh = channelSelect(l.levelUpChannelId ? [l.levelUpChannelId] : [], { multiple: false, types: TEXTISH, placeholder: 'Same channel as the message' });
  const luT = h('input', { class: 'input', value: l.levelUpTemplate, dir: 'auto' });
  const luBox = h('div', { class: 'grid g2', style: { marginTop: '10px' } }, Field('Announcement channel', luCh), Field('Message template', luT, '{user} {username} {level} {server}'));
  const syncLu = () => { luBox.style.display = lu.getValue() ? '' : 'none'; };
  lu.addEventListener('change', syncLu); syncLu();
  const stack = h('label', null); const stackT = Toggle(l.stackRewards);
  let rewards = l.rewards.map((r) => ({ ...r }));
  const rewardsBox = h('div', { class: 'stack', style: { gap: '8px' } });
  const renderRewards = () => {
    rewardsBox.replaceChildren(...(rewards.length ? rewards.map((r, i) => {
      const lv = h('input', { class: 'input', type: 'number', min: 1, value: r.level, style: { width: '110px' }, oninput: () => { r.level = Number(lv.value); } });
      const rs = roleSelect(r.roleId ? [r.roleId] : [], { multiple: false, filter: (x) => !x.managed, placeholder: 'Select reward role…', onChange: (v) => { r.roleId = v; } });
      rs.style.flex = '1';
      return h('div', { class: 'row', style: { flexWrap: 'nowrap' } }, h('span', { class: 'hint' }, 'Level'), lv, rs, h('button', { class: 'btn sm danger', onclick: () => { rewards.splice(i, 1); renderRewards(); } }, 'Delete'));
    }) : [h('div', { class: 'empty' }, h('b', null, 'No level rewards.'), 'Add a role reward below.')]),
    h('div', null, h('button', { class: 'btn sm', onclick: () => { rewards.push({ level: (rewards[rewards.length - 1] || { level: 0 }).level + 5, roleId: '' }); renderRewards(); } }, '+ Add reward')));
  };
  renderRewards();
  void stack;
  body.replaceChildren(h('div', { class: 'stack' },
    h('div', { class: 'card enter' }, ToggleRow('Leveling enabled', 'Members earn Text XP from messages and Voice XP from time in voice. Level = total XP.', en)),
    h('div', { class: 'grid g2' },
      h('div', { class: 'card enter' }, h('h2', null, '💬 Text XP'), h('p', { class: 'desc' }, 'Random XP per message, once per cooldown.'), h('div', { class: 'grid g3' }, Field('Min XP', tMin), Field('Max XP', tMax), Field('Cooldown (s)', tCd))),
      h('div', { class: 'card enter', style: { animationDelay: '60ms' } }, h('h2', null, '🎙️ Voice XP'), h('p', { class: 'desc' }, 'XP per minute in voice (not deafened, not AFK).'), h('div', { class: 'grid g2' }, Field('XP per minute', vPm), h('div', null, ToggleRow('Require others', 'Only earn when at least 2 humans are in the channel.', vOthers))))),
    h('div', { class: 'card enter' }, h('h2', null, 'Ignored'), h('div', { class: 'grid g2', style: { marginTop: '10px' } }, Field('Ignored channels', igC, 'No text or voice XP in these channels / categories.'), Field('Ignored roles', igR))),
    h('div', { class: 'card enter' }, h('h2', null, 'Level rewards'), h('p', { class: 'desc' }, 'Roles given automatically when a member reaches a level.'), rewardsBox, ToggleRow('Keep previous rewards', 'If off, only the highest earned reward role is kept.', stackT)),
    h('div', { class: 'card enter' }, ToggleRow('Send Level-Up Messages', 'Off by default — when off, the bot never posts level-up announcements.', lu), luBox),
    h('div', { class: 'card' }, SaveButton(async () => {
      if (rewards.some((r) => !r.roleId)) throw new Error('Every level reward needs a role.');
      await api('PUT', G('/leveling'), { enabled: en.getValue(), textXpMin: Number(tMin.value), textXpMax: Number(tMax.value), textCooldown: Number(tCd.value), voiceXpPerMinute: Number(vPm.value), voiceRequireOthers: vOthers.getValue(), ignoredChannels: igC.getValue(), ignoredRoles: igR.getValue(), rewards, stackRewards: stackT.getValue(), levelUpMessages: lu.getValue(), levelUpChannelId: luCh.getValue(), levelUpTemplate: luT.value });
    }))));
}

async function rankCardEditor(body, alive) {
  body.replaceChildren(Loading(['Loading rank card configuration...']));
  const { config } = await api('GET', G('/config'));
  if (!alive()) return;
  let rc = { ...config.rankCard };
  const preview = h('img', { class: 'rc-preview', alt: 'Rank card preview' });
  let pvTimer = null; let lastUrl = null; let pvSeq = 0;
  const refresh = () => {
    clearTimeout(pvTimer);
    pvTimer = setTimeout(async () => {
      const seq = ++pvSeq; preview.classList.add('loading');
      try {
        const res = await fetch(`/api${G('/rankcard/preview')}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(rc) });
        if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Preview failed');
        const blob = await res.blob();
        if (seq !== pvSeq) return;
        if (lastUrl) URL.revokeObjectURL(lastUrl);
        lastUrl = URL.createObjectURL(blob); preview.src = lastUrl;
      } catch (e) { toast(e.message, 'err'); } finally { if (seq === pvSeq) preview.classList.remove('loading'); }
    }, 350);
  };
  S.cleanup.push(() => { clearTimeout(pvTimer); if (lastUrl) URL.revokeObjectURL(lastUrl); });
  const set = (k, v) => { rc[k] = v; refresh(); };
  const color = (k, label) => Field(label, h('input', { class: 'input', type: 'color', value: (rc[k] || '#000000').slice(0, 7), oninput: (e) => set(k, e.target.value) }));
  const select = (k, label, opts) => Field(label, h('select', { class: 'input', onchange: (e) => { set(k, e.target.value); syncBg(); } }, opts.map(([v, l]) => h('option', { value: v, selected: rc[k] === v }, l))));
  const range = (k, label, min, max, step) => { const out = h('span', { class: 'hint' }, String(rc[k])); return Field(h('span', null, label, ' ', out), h('input', { type: 'range', min, max, step, value: rc[k], oninput: (e) => { out.textContent = e.target.value; set(k, Number(e.target.value)); } })); };
  const tog = (k, title, desc) => ToggleRow(title, desc, (() => { const t = Toggle(rc[k], (v) => set(k, v)); return t; })());

  // background image upload (persisted on the server immediately)
  const thumb = h('img', { class: 'bg-thumb', alt: 'Background' });
  const thumbBox = h('div', { class: 'stack', style: { gap: '8px' } });
  const fileIn = h('input', { type: 'file', accept: 'image/png,image/jpeg,image/webp,image/gif', style: { display: 'none' } });
  const drop = h('div', { class: 'dropzone', onclick: () => fileIn.click() }, '⬆ Click or drop an image (PNG / JPG / WEBP, max 5 MB) — recommended 1000×300');
  const renderThumb = () => {
    if (rc.backgroundImage) {
      thumb.src = `/api${G('/rankcard/background')}?v=${encodeURIComponent(rc.backgroundImage)}`;
      thumbBox.replaceChildren(thumb, h('div', { class: 'row' }, h('span', { class: 'hint' }, 'Saved on the server'), h('button', { class: 'btn sm danger', onclick: async () => {
        try { const r = await api('DELETE', G('/rankcard/background')); rc.backgroundImage = r.rankCard.backgroundImage; rc.backgroundType = r.rankCard.backgroundType; bgType.querySelector('select').value = rc.backgroundType; renderThumb(); syncBg(); refresh(); toast('Background removed', 'ok'); } catch (e) { toast(e.message, 'err'); }
      } }, 'Remove image')));
    } else thumbBox.replaceChildren(h('div', { class: 'hint' }, 'No image uploaded.'));
  };
  const upload = async (file) => {
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) { toast('Image must be at most 5 MB.', 'err'); return; }
    drop.textContent = 'Uploading…';
    const dataUrl = await new Promise((res, rej) => { const fr = new FileReader(); fr.onload = () => res(fr.result); fr.onerror = rej; fr.readAsDataURL(file); });
    try {
      const r = await api('POST', G('/rankcard/background'), { dataUrl });
      rc.backgroundImage = r.rankCard.backgroundImage; rc.backgroundType = 'image';
      bgType.querySelector('select').value = 'image'; renderThumb(); syncBg(); refresh();
      toast('Background uploaded and saved', 'ok');
    } catch (e) { toast(`Upload failed: ${e.message}`, 'err'); }
    drop.textContent = '⬆ Click or drop an image (PNG / JPG / WEBP, max 5 MB) — recommended 1000×300';
  };
  fileIn.addEventListener('change', () => upload(fileIn.files[0]));
  drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('drag'); });
  drop.addEventListener('dragleave', () => drop.classList.remove('drag'));
  drop.addEventListener('drop', (e) => { e.preventDefault(); drop.classList.remove('drag'); upload(e.dataTransfer.files[0]); });

  const bgType = select('backgroundType', 'Background type', [['gradient', 'Gradient'], ['color', 'Solid colour'], ['image', 'Uploaded image']]);
  const gradBox = h('div', { class: 'grid g2' }, color('gradientFrom', 'Gradient start'), color('gradientTo', 'Gradient end'));
  const colorBox = h('div', null, color('backgroundColor', 'Background colour'));
  const imgBox = h('div', { class: 'stack', style: { gap: '10px' } }, drop, fileIn, thumbBox, range('overlayOpacity', 'Dark overlay', 0, 0.95, 0.05));
  function syncBg() { gradBox.style.display = rc.backgroundType === 'gradient' ? '' : 'none'; colorBox.style.display = rc.backgroundType === 'color' ? '' : 'none'; imgBox.style.display = rc.backgroundType === 'image' ? '' : 'none'; }
  renderThumb(); syncBg();
  const title = h('input', { class: 'input', value: rc.title, maxLength: 40, dir: 'auto', oninput: (e) => set('title', e.target.value) });

  body.replaceChildren(h('div', { class: 'stack' },
    h('div', { class: 'card enter' }, h('div', { class: 'row', style: { marginBottom: '12px' } }, h('h2', null, 'Live preview'), h('div', { class: 'spacer' }), h('span', { class: 'hint' }, 'Rendered by the bot — exactly what /rank sends')), preview),
    h('div', { class: 'grid g2' },
      h('div', { class: 'card enter' }, h('h2', null, 'Background'), h('div', { class: 'stack', style: { gap: '14px', marginTop: '12px' } }, bgType, gradBox, colorBox, imgBox,
        range('panelOpacity', 'Glass panel opacity', 0, 0.9, 0.02), tog('blurPanel', 'Glass highlight', 'Soft reflective highlight on the panel.'))),
      h('div', { class: 'card enter', style: { animationDelay: '60ms' } }, h('h2', null, 'Colours & text'), h('div', { class: 'stack', style: { gap: '14px', marginTop: '12px' } },
        h('div', { class: 'grid g2' }, color('accentColor', 'Accent'), color('accentColor2', 'Accent 2 (gradient)'), color('textColor', 'Text'), color('subTextColor', 'Secondary text'), color('trackColor', 'Progress track')),
        Field('Brand title', title), tog('showTitle', 'Show title', 'The wordmark in the top corner.')))),
    h('div', { class: 'grid g2' },
      h('div', { class: 'card enter' }, h('h2', null, 'Avatar & layout'), h('div', { class: 'stack', style: { gap: '14px', marginTop: '12px' } },
        h('div', { class: 'grid g3' }, select('avatarShape', 'Avatar shape', [['circle', 'Circle'], ['rounded', 'Rounded'], ['square', 'Square']]), select('layout', 'Avatar side', [['left', 'Left'], ['right', 'Right']]), select('progressStyle', 'Progress bar', [['rounded', 'Rounded'], ['sharp', 'Sharp']])),
        tog('avatarRing', 'Gradient ring', 'Accent ring around the avatar.'), tog('avatarGlow', 'Avatar glow', 'Purple glow behind the avatar.'))),
      h('div', { class: 'card enter', style: { animationDelay: '60ms' } }, h('h2', null, 'Display options'),
        tog('showRank', 'Show rank', '#position on the server.'), tog('showLevel', 'Show level', ''), tog('showXp', 'Show XP numbers', 'current / needed above the bar.'),
        tog('showTextVoice', 'Show Text / Voice XP', 'Separate chips under the bar.'), tog('showDiscriminatorTag', 'Show @username', 'Below the display name.'))),
    h('div', { class: 'card' }, SaveButton(async () => { const r = await api('PUT', G('/rankcard'), rc); rc = { ...r.rankCard }; }))));
  refresh();
}

async function leaderboardView(body, alive) {
  let type = 'total'; let page = 1;
  const table = h('div');
  const tabs = h('div', { class: 'tabs' });
  const renderTabs = () => tabs.replaceChildren(...[['total', 'Total XP'], ['text', 'Text XP'], ['voice', 'Voice XP']].map(([v, l]) => h('a', { href: '#', class: type === v ? 'active' : '', onclick: (e) => { e.preventDefault(); type = v; page = 1; renderTabs(); load(); } }, l)));
  async function load() {
    table.replaceChildren(Loading('Loading leaderboard...'));
    try {
      const d = await api('GET', G(`/leaderboard?type=${type}&page=${page}`));
      if (!alive()) return;
      if (!d.items.length) { table.replaceChildren(h('div', { class: 'empty' }, h('b', null, 'No XP yet.'), 'Members earn XP by chatting and talking in voice.')); return; }
      table.replaceChildren(h('table', { class: 'table' },
        h('thead', null, h('tr', null, ['Rank', 'Member', 'Level', 'Text XP', 'Voice XP', 'Total XP', 'Progress', ''].map((x) => h('th', null, x)))),
        h('tbody', null, d.items.map((it) => h('tr', null,
          h('td', null, h('b', { style: { color: it.position <= 3 ? '#d8b4fe' : '' } }, `#${it.position}`)),
          h('td', null, h('div', { class: 'who' }, it.avatar ? h('img', { class: 'avatar', src: it.avatar, alt: '' }) : h('div', { class: 'avatar' }, '?'), h('div', null, h('div', { dir: 'auto' }, it.username), h('div', { class: 'tiny' }, `${fmtNum(it.messages)} msgs • ${fmtNum(it.voiceMinutes)} voice min`)))),
          h('td', null, String(it.level)), h('td', null, fmtNum(it.textXp)), h('td', null, fmtNum(it.voiceXp)), h('td', null, fmtNum(it.totalXp)),
          h('td', null, h('div', { class: 'bar' }, h('i', { style: { width: `${Math.round((it.current / it.needed) * 100)}%` } })), h('div', { class: 'tiny' }, `${fmtNum(it.current)} / ${fmtNum(it.needed)}`)),
          h('td', null, h('button', { class: 'btn sm danger', title: 'Reset XP', onclick: async () => { if (await Modal({ title: 'Reset XP?', body: `Reset all XP for ${it.username}? This cannot be undone.`, confirmText: 'Reset', danger: true })) { try { await api('DELETE', G(`/leveling/users/${it.userId}`)); toast('XP reset', 'ok'); load(); } catch (e) { toast(e.message, 'err'); } } } }, 'Reset')))))),
      h('div', { class: 'pager' }, h('span', { class: 'hint' }, `Page ${d.page} of ${d.pages} • ${d.total} members`),
        h('button', { class: 'btn sm', disabled: d.page <= 1, onclick: () => { page = d.page - 1; load(); } }, '◀ Prev'),
        h('button', { class: 'btn sm', disabled: d.page >= d.pages, onclick: () => { page = d.page + 1; load(); } }, 'Next ▶')));
    } catch (e) { table.replaceChildren(ErrorBanner(e.message)); }
  }
  renderTabs();
  body.replaceChildren(h('div', { class: 'card enter' }, tabs, table));
  load();
}

// ---------------------------------------------------------------- Logs
const LOG_EVENTS = [
  ['moderation', 'Moderation actions', 'Text/voice mutes, role command, purge, lock…'], ['ban', 'Bans', ''], ['unban', 'Unbans', ''], ['kick', 'Kicks', ''],
  ['messageDelete', 'Deleted messages', ''], ['messageEdit', 'Edited messages', ''], ['memberJoin', 'Member joins', ''], ['memberLeave', 'Member leaves', ''],
  ['nicknameChange', 'Nickname changes', ''], ['roleChange', 'Role changes', ''], ['voiceJoinLeave', 'Voice join / leave / disconnect', ''],
  ['voiceMove', 'Voice moves', ''], ['voiceState', 'Mute / deafen changes', ''], ['automod', 'AutoMod', ''],
];
async function pageLogs(page, alive) {
  page.replaceChildren(Loading(['Loading channels...', 'Loading configuration...']));
  const [{ config }, storage] = await Promise.all([api('GET', G('/config')), api('GET', G('/logging/storage')), ensureData()]);
  if (!alive()) return;
  const lg = config.logging;
  const en = Toggle(lg.enabled);
  const retention = h('select', { class: 'input' }, [
    [0, 'Disabled'], [1, '1 Day'], [3, '3 Days'], [7, '7 Days'], [14, '14 Days'], [30, '30 Days'], [90, '90 Days'],
  ].map(([v, label]) => h('option', { value: String(v), selected: Number(lg.retentionDays || 0) === v }, label)));
  const localStorageText = h('span', { class: 'hint' }, `${storage.local.files} local log file(s) • ${(storage.local.bytes / 1024).toFixed(1)} KB`);
  const clearLogs = h('button', { class: 'btn danger', onclick: async () => {
    const yes = await Modal({ title: 'Delete stored logs?', body: 'Are you sure you want to delete the stored Dziri logs? This removes bot-generated log messages from configured Discord log channels and local process log files. It does not delete moderation history, configuration, tickets, leveling, or user data.', confirmText: 'Delete Logs', danger: true });
    if (!yes) return;
    clearLogs.disabled = true; clearLogs.textContent = 'Deleting logs…';
    try {
      const result = await api('POST', G('/logging/clear'), { confirm: true });
      localStorageText.textContent = '0 local log files • 0.0 KB';
      toast(`Deleted ${result.discord.deleted} Discord log message(s) and freed ${(result.local.bytes / 1024).toFixed(1)} KB locally.`, 'ok', 6000);
    } catch (e) { toast(e.message, 'err', 7000); }
    finally { clearLogs.disabled = false; clearLogs.textContent = 'Clear Logs'; }
  } }, 'Clear Logs');
  const def = channelSelect(lg.defaultChannelId ? [lg.defaultChannelId] : [], { multiple: false, types: TEXTISH, placeholder: 'Select default log channel…' });
  const ign = channelSelect(lg.ignoredChannels, { categories: true });
  const ctl = {};
  const rows = LOG_EVENTS.map(([k, label, desc]) => {
    const ev = lg.events[k] || { enabled: true, channelId: '' };
    ctl[k] = { t: Toggle(ev.enabled), c: channelSelect(ev.channelId ? [ev.channelId] : [], { multiple: false, types: TEXTISH, placeholder: 'Default channel' }) };
    return h('tr', null, h('td', null, h('div', { style: { fontWeight: 600 } }, label), desc ? h('div', { class: 'tiny' }, desc) : null), h('td', null, ctl[k].t), h('td', { style: { minWidth: '260px' } }, ctl[k].c));
  });
  page.replaceChildren(h('div', { class: 'stack' },
    h('div', { class: 'card enter' }, ToggleRow('Logging enabled', 'Master switch for all Discord log embeds.', en),
      h('div', { class: 'grid g2', style: { marginTop: '10px' } }, Field('Default log channel', def, 'Used by every event without its own channel.'), Field('Ignored channels', ign, 'Message logs are not sent for these channels.'))),
    h('div', { class: 'card enter' }, h('h2', null, 'Events'), h('table', { class: 'table' }, h('thead', null, h('tr', null, h('th', null, 'Event'), h('th', null, 'Enabled'), h('th', null, 'Channel'))), h('tbody', null, rows))),
    h('div', { class: 'card enter' }, h('h2', null, 'Storage / Cleanup'),
      h('p', { class: 'desc' }, 'Retention deletes only Dziri-generated Discord log embeds and local process log files. Member history, configuration, tickets, temporary rooms, leveling and user data are never touched.'),
      h('div', { class: 'grid g2' }, Field('Automatic Log Retention', retention, 'Runs on startup and every 6 hours.'),
        h('div', { class: 'field' }, h('label', null, 'Manual Clear Logs'), localStorageText, h('div', { class: 'row', style: { marginTop: '7px' } }, clearLogs)))),
    h('div', { class: 'card' }, SaveButton(async () => {
      const events = {};
      for (const [k] of LOG_EVENTS) events[k] = { enabled: ctl[k].t.getValue(), channelId: ctl[k].c.getValue() };
      await api('PUT', G('/logging'), { enabled: en.getValue(), defaultChannelId: def.getValue(), ignoredChannels: ign.getValue(), retentionDays: Number(retention.value), events });
    }))));
}

// ---------------------------------------------------------------- Member history
async function pageHistory(page, alive) {
  const params = new URLSearchParams(location.search);
  const st = { page: Number(params.get('page')) || 1, type: params.get('type') || '', search: params.get('search') || '', userId: params.get('user') || '' };
  const type = h('select', { class: 'input', style: { maxWidth: '200px' } }, h('option', { value: '' }, 'All actions'), Object.entries(LABELS).map(([v, l]) => h('option', { value: v, selected: st.type === v }, l)));
  const search = h('input', { class: 'input', placeholder: 'Search member, moderator or reason…', value: st.search, dir: 'auto', style: { maxWidth: '300px' } });
  const user = h('input', { class: 'input', placeholder: 'User ID', value: st.userId, style: { maxWidth: '200px' } });
  const out = h('div');
  const syncUrl = () => { const u = new URL(location.href); for (const [k, v] of [['page', st.page > 1 ? st.page : ''], ['type', st.type], ['search', st.search], ['user', st.userId]]) { if (v) u.searchParams.set(k, v); else u.searchParams.delete(k); } history.replaceState({}, '', u.pathname + u.search); };
  async function load() {
    out.replaceChildren(Loading('Loading history...'));
    syncUrl();
    try {
      const q = new URLSearchParams({ page: st.page, pageSize: 20, type: st.type, search: st.search, userId: st.userId });
      const d = await api('GET', G(`/history?${q}`));
      if (!alive()) return;
      st.page = d.page;
      out.replaceChildren(d.items.length ? historyTable(d.items) : h('div', { class: 'empty' }, h('b', null, 'No entries found.'), 'Moderation actions, role and nickname changes appear here.'),
        h('div', { class: 'pager' }, h('span', { class: 'hint' }, `Page ${d.page} of ${d.pages} • ${d.total} entries`),
          h('button', { class: 'btn sm', disabled: d.page <= 1, onclick: () => { st.page = d.page - 1; load(); } }, '◀ Prev'),
          h('button', { class: 'btn sm', disabled: d.page >= d.pages, onclick: () => { st.page = d.page + 1; load(); } }, 'Next ▶')));
    } catch (e) { out.replaceChildren(ErrorBanner(e.message)); }
  }
  let t;
  const debounced = () => { clearTimeout(t); t = setTimeout(() => { st.page = 1; st.search = search.value.trim(); st.userId = user.value.trim(); load(); }, 350); };
  type.addEventListener('change', () => { st.type = type.value; st.page = 1; load(); });
  search.addEventListener('input', debounced); user.addEventListener('input', debounced);
  S.cleanup.push(() => clearTimeout(t));
  page.replaceChildren(h('div', { class: 'card enter' }, h('div', { class: 'row', style: { marginBottom: '6px' } }, type, search, user), out));
  load();
}

// ---------------------------------------------------------------- Settings
async function pageSettings(page, alive) {
  page.replaceChildren(Loading(['Loading configuration...']));
  const [{ config }, cmds] = await Promise.all([api('GET', G('/config')), api('GET', G('/commands'))]);
  if (!alive()) return;
  // prefix may be "" — show it exactly as stored
  const prefix = h('input', { class: 'input', value: config.prefix, maxLength: 10, placeholder: '', dir: 'auto', style: { maxWidth: '240px', fontSize: '16px' } });
  const examples = h('div', { class: 'row', style: { gap: '6px' } });
  const tm = cmds.commands.find((c) => c.name === 'textmute');
  const showEx = () => {
    const p = prefix.value;
    const al = tm ? tm.config.aliases.slice(0, 3) : [];
    examples.replaceChildren(h('span', { class: 'hint' }, 'Examples:'), h('code', { class: 'k' }, `${p}textmute @User`), ...al.map((a) => h('code', { class: 'k', dir: 'auto' }, `${p}${a} @User`)));
  };
  prefix.addEventListener('input', showEx); showEx();
  const accent = h('input', { class: 'input', type: 'color', value: config.dashboard.accent.slice(0, 7), style: { maxWidth: '120px' } });
  const b = S.bot || {};
  page.replaceChildren(h('div', { class: 'stack' },
    h('div', { class: 'card enter' }, h('h2', null, 'Command Prefix'), h('p', { class: 'desc' }, 'Leave empty to use aliases directly. With an empty prefix, a message only runs a command when its first word is exactly a command name or alias — normal chat like "hello everyone" is ignored.'),
      h('div', { class: 'row' }, prefix, h('button', { class: 'btn', onclick: () => { prefix.value = ''; showEx(); prefix.focus(); } }, 'Clear prefix'), h('button', { class: 'btn', onclick: () => { prefix.value = '!'; showEx(); } }, 'Use "!"')),
      h('div', { style: { marginTop: '12px' } }, examples),
      SaveButton(async () => {
        const r = await api('PUT', G('/settings'), { prefix: prefix.value });
        prefix.value = r.prefix; showEx();
        if (r.prefix === '') toast('Prefix is now empty — aliases work directly.', 'info');
      })),
    h('div', { class: 'card enter' }, h('h2', null, 'Dashboard'), h('div', { class: 'row', style: { marginTop: '10px' } }, Field('Accent colour', accent)),
      SaveButton(async () => { const r = await api('PUT', G('/settings'), { dashboard: { accent: accent.value } }); applyAccent(r.dashboard.accent); })),
    h('div', { class: 'grid g2' },
      h('div', { class: 'card enter' }, h('h2', null, 'Other settings'), h('div', { class: 'stack', style: { gap: '8px', marginTop: '10px' } },
        [['/dashboard/logs', 'Logging settings', 'Log channels and events'], ['/dashboard/moderation', 'Moderation settings', 'Mute mode, staff roles, messaging'], ['/dashboard/leveling', 'Leveling settings', 'XP rates, rewards, level-up messages'], ['/dashboard/commands', 'Commands', 'Aliases, reasons and permissions']]
          .map(([p, t, d]) => h('a', { class: 'reason', href: link(p), 'data-nav': p, style: { color: 'inherit' } }, h('span', { class: 'rl' }, t), h('span', { class: 'hint' }, d), '→')))),
      h('div', { class: 'card enter' }, h('h2', null, 'Bot'), h('div', { class: 'stack', style: { gap: '6px', marginTop: '10px' } },
        h('div', null, 'Status: ', h('b', null, b.ready ? 'Online' : 'Offline')), h('div', null, 'Account: ', h('b', null, b.tag || '—')),
        h('div', null, 'Servers: ', h('b', null, String(b.guilds || 0))), h('div', null, 'Memory: ', h('b', null, `${b.memory || 0} MB`)),
        b.inviteUrl ? h('a', { class: 'btn sm', href: b.inviteUrl, target: '_blank', rel: 'noopener', style: { alignSelf: 'flex-start', marginTop: '8px' } }, 'Invite to another server') : null)))));
}

function applyAccent(c) { if (c) document.documentElement.style.setProperty('--accent', c); }


/** Sender-bot + delivery-mode picker shared by the ticket and temp-room panels. */
function PanelTransport({ senderBot, delivery, bots, system }) {
  const opt = (key) => {
    const b = (bots && bots[key]) || {};
    const label = key === 'main' ? 'Dziri System' : 'Ticket Bot';
    const state = !b.configured ? ' — not configured' : !b.ready ? ' — offline' : !b.inGuild ? ' — not in this server' : b.tag ? ` — ${b.tag}` : '';
    return h('option', { value: key, selected: senderBot === key }, `${label}${state}`);
  };
  const sender = h('select', { class: 'input' }, opt('main'), opt('ticket'));
  const mode = h('select', { class: 'input' },
    h('option', { value: 'message', selected: delivery !== 'webhook' }, 'Discord Message (normal bot message)'),
    h('option', { value: 'webhook', selected: delivery === 'webhook' }, 'Webhook (application-owned)'));
  const note = h('div', { class: 'hint' });
  const warn = h('div', { class: 'err-text' });
  const sync = () => {
    const key = sender.value;
    const b = (bots && bots[key]) || {};
    note.textContent = mode.value === 'webhook'
      ? 'A webhook owned by the selected bot is created in the channel. Its buttons still route back to that bot.'
      : 'Sent as a normal message — the author in Discord is the selected bot. No webhook is created. Images still work.';
    warn.textContent = !b.configured
      ? (key === 'ticket' ? 'TICKET_DISCORD_TOKEN is not set in .env, so the Ticket Bot cannot send this panel.' : 'The main bot token is not configured.')
      : !b.ready ? 'That bot is currently offline.' : !b.inGuild ? 'That bot is not in this server — invite it first.' : '';
  };
  sender.addEventListener('change', sync); mode.addEventListener('change', sync); sync();
  const wrap = h('div', { class: 'grid g2' },
    Field('Panel Sender Bot', sender, 'This bot sends the panel AND handles every button/menu on it.'),
    Field('Panel Delivery', mode, note));
  const box = h('div', null, wrap, warn);
  box.getValue = () => ({ senderBot: sender.value, delivery: mode.value });
  void system;
  return box;
}

function publishedInfo(panel) {
  if (!panel || !panel.published) return h('div', { class: 'hint' }, 'This panel has not been published yet.');
  return h('div', { class: 'hint' },
    `Published ${panel.at ? relTime(panel.at) : ''} by ${panel.botLabel || 'bot'} as a ${panel.mode === 'webhook' ? 'webhook message' : 'normal Discord message'} — `,
    panel.url ? h('a', { href: panel.url, target: '_blank', rel: 'noopener' }, 'open message') : 'unknown message');
}

// ---------------------------------------------------------------- Tickets
function PanelImageEditor(scope, initial, onChange) {
  let image = initial || '';
  const thumb = h('img', { class: 'bg-thumb', alt: 'Panel image' });
  const box = h('div', { class: 'stack', style: { gap: '8px' } });
  const fileIn = h('input', { type: 'file', accept: 'image/png,image/jpeg,image/webp,image/gif', style: { display: 'none' } });
  const drop = h('div', { class: 'dropzone', onclick: () => fileIn.click() }, '⬆ Click or drop a banner image (PNG / JPG / WEBP / GIF, max 5 MB)');
  const render = () => {
    if (image) {
      thumb.src = `/api${G(`/${scope}/panel-image`)}?v=${encodeURIComponent(image)}`;
      box.replaceChildren(thumb, h('div', { class: 'row' }, h('span', { class: 'hint' }, 'Saved on the server — survives restarts'),
        h('button', { type: 'button', class: 'btn sm danger', onclick: async () => {
          try { await api('DELETE', G(`/${scope}/panel-image`)); image = ''; render(); onChange && onChange(''); toast('Image removed', 'ok'); }
          catch (e) { toast(e.message, 'err'); }
        } }, 'Remove image')));
    } else box.replaceChildren(h('div', { class: 'hint' }, 'No image uploaded.'));
  };
  const upload = async (file) => {
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) { toast('Image must be at most 5 MB.', 'err'); return; }
    drop.textContent = 'Uploading…';
    try {
      const dataUrl = await new Promise((res, rej) => { const fr = new FileReader(); fr.onload = () => res(fr.result); fr.onerror = rej; fr.readAsDataURL(file); });
      const r = await api('POST', G(`/${scope}/panel-image`), { dataUrl });
      image = r.image; render(); onChange && onChange(image);
      toast('Image uploaded and saved', 'ok');
    } catch (e) { toast(`Upload failed: ${e.message}`, 'err'); }
    drop.textContent = '⬆ Click or drop a banner image (PNG / JPG / WEBP / GIF, max 5 MB)';
  };
  fileIn.addEventListener('change', () => upload(fileIn.files[0]));
  drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('drag'); });
  drop.addEventListener('dragleave', () => drop.classList.remove('drag'));
  drop.addEventListener('drop', (e) => { e.preventDefault(); drop.classList.remove('drag'); upload(e.dataTransfer.files[0]); });
  render();
  const wrap = h('div', { class: 'stack', style: { gap: '10px' } }, drop, fileIn, box);
  wrap.getValue = () => image;
  return wrap;
}

function warnBanner(list) {
  if (!list || !list.length) return null;
  return h('div', { class: 'banner enter' }, h('b', null, '⚠ Configuration warnings'), h('ul', { style: { margin: '6px 0 0', paddingLeft: '18px' } }, list.map((w) => h('li', null, w))));
}

async function pageTickets(page, alive) {
  const sub = location.pathname.replace(/\/+$/, '').split('/')[3] || '';
  const tabs = h('div', { class: 'tabs' }, [['', 'Overview'], ['panel', 'Panel'], ['types', 'Ticket Types'], ['notifications', 'Notifications']]
    .map(([p, l]) => h('a', { href: link(`/dashboard/tickets${p ? `/${p}` : ''}`), 'data-nav': `/dashboard/tickets${p ? `/${p}` : ''}`, class: sub === p ? 'active' : '' }, l)));
  const body = h('div');
  page.replaceChildren(tabs, body);
  if (!['', 'panel', 'types', 'notifications'].includes(sub)) { body.replaceChildren(ErrorBanner('Unknown tickets page.')); return; }
  body.replaceChildren(Loading(['Loading roles...', 'Loading channels...', 'Loading ticket configuration...']));
  const [data] = await Promise.all([api('GET', G('/tickets')), ensureData()]);
  if (!alive()) return;
  const t = data.tickets; const st = data.status;

  const botCard = h('div', { class: 'card enter' },
    h('div', { class: 'row' },
      h('div', { style: { flex: 1 } }, h('h2', null, 'Ticket Bot'),
        h('div', { class: 'hint' }, st.configured
          ? (st.connected ? `Connected as ${st.tag}. ${st.inGuild ? 'Present in this server.' : 'NOT in this server — invite it to create tickets.'}` : 'TICKET_DISCORD_TOKEN is set but the bot is not connected. Check the token and the console.')
          : 'TICKET_DISCORD_TOKEN is not set in .env — the ticket bot is disabled. The main bot keeps working.')),
      h('span', { class: `pill ${st.connected && st.inGuild ? 'on' : 'off'}` }, h('span', { class: `dot ${st.connected && st.inGuild ? 'on' : ''}` }), st.connected ? (st.inGuild ? ' Ready' : ' Not in server') : ' Offline'),
      st.inviteUrl && (!st.connected || !st.inGuild) ? h('a', { class: 'btn sm', href: st.inviteUrl, target: '_blank', rel: 'noopener' }, 'Invite Ticket Bot') : null));

  if (sub === '') return ticketsOverview(body, t, st, botCard);
  if (sub === 'panel') return ticketsPanel(body, t, st, botCard);
  if (sub === 'types') return ticketsTypes(body, t, botCard, st);
  return ticketsNotifications(body, t, botCard);
}

function ticketsOverview(body, t, st, botCard) {
  const en = Toggle(t.enabled);
  const support = roleSelect(t.supportRoles);
  const cat = channelSelect(t.categoryId ? [t.categoryId] : [], { multiple: false, types: ['category'], categories: true, placeholder: 'Default category for new tickets…' });
  const logCh = channelSelect(t.logChannelId ? [t.logChannelId] : [], { multiple: false, types: TEXTISH, placeholder: 'Ticket log channel…' });
  const naming = h('input', { class: 'input', value: t.namingFormat, placeholder: 'ticket-{username}' });
  const maxOpen = h('input', { class: 'input', type: 'number', min: 1, max: 10, value: t.maxOpenPerUser });
  const confirm = Toggle(t.closeConfirm); const transcripts = Toggle(t.transcripts);
  const stat = (k, v) => h('div', { class: 'card stat enter' }, h('div', { class: 'k' }, k), h('div', { class: 'v' }, v));
  body.replaceChildren(h('div', { class: 'stack' },
    warnBanner(st.warnings), botCard,
    h('div', { class: 'grid g4' }, stat('Open tickets', String(st.open)), stat('Closed', String(st.closed)), stat('Total created', String(st.total)), stat('Panel', st.published ? 'Published' : 'Not published')),
    h('div', { class: 'card enter' }, ToggleRow('Ticket system enabled', 'Members can open tickets from the panel.', en),
      h('div', { class: 'grid g2', style: { marginTop: '10px' } },
        Field('Default support roles', support, 'These roles can see and manage every ticket. Ticket types can add more.'),
        Field('Default ticket category', cat, 'Used when a ticket type has no category of its own.'),
        Field('Ticket log channel', logCh, 'Created / claimed / closed / reopened / deleted events and transcripts.'),
        Field('Channel naming', naming, 'Placeholders: {username} {number} {type}')),
      h('div', { class: 'grid g2', style: { marginTop: '10px' } },
        Field('Max open tickets per member', maxOpen),
        h('div', null, ToggleRow('Confirm before closing', 'Ask the staff member to confirm.', confirm), ToggleRow('Save transcripts', 'Attach a .txt transcript to the log channel on close.', transcripts)))),
    h('div', { class: 'card' }, SaveButton(async () => {
      await api('PUT', G('/tickets'), { enabled: en.getValue(), supportRoles: support.getValue(), categoryId: cat.getValue(), logChannelId: logCh.getValue(), namingFormat: naming.value.trim(), maxOpenPerUser: Number(maxOpen.value), closeConfirm: confirm.getValue(), transcripts: transcripts.getValue() });
    })),
    st.recent && st.recent.length ? h('div', { class: 'card enter' }, h('h2', null, 'Recent tickets'),
      h('table', { class: 'table' }, h('thead', null, h('tr', null, ['#', 'Type', 'Opened by', 'Channel', 'Status', 'Created'].map((x) => h('th', null, x)))),
        h('tbody', null, st.recent.map((x) => h('tr', null, h('td', null, String(x.number)), h('td', null, x.typeName), h('td', null, x.userTag || x.userId),
          h('td', null, `#${x.channelId}`), h('td', null, h('span', { class: `pill ${x.status === 'open' ? 'on' : 'off'}` }, x.status)), h('td', null, relTime(x.createdAt))))))) : null));
}

function ticketsPanel(body, t, st, botCard) {
  const p = t.panel;
  const transport = PanelTransport({ senderBot: p.senderBot, delivery: p.delivery, bots: st.bots, system: 'tickets' });
  const ch = channelSelect(p.channelId ? [p.channelId] : [], { multiple: false, types: TEXTISH, placeholder: 'Channel where the panel is posted…' });
  const title = h('input', { class: 'input', value: p.title, maxLength: 256, dir: 'auto' });
  const desc = h('textarea', { class: 'input', dir: 'auto', maxLength: 4000 }, p.description);
  const footer = h('input', { class: 'input', value: p.footer, maxLength: 200, dir: 'auto' });
  const placeholder = h('input', { class: 'input', value: p.selectPlaceholder, maxLength: 150, dir: 'auto' });
  const color = h('input', { class: 'input', type: 'color', value: (p.color || '#a855f7').slice(0, 7) });
  const imgUrl = h('input', { class: 'input', value: p.imageUrl || '', placeholder: 'https://… (used when no file is uploaded)' });
  const thumb = h('input', { class: 'input', value: p.thumbnailUrl || '', placeholder: 'https://… thumbnail' });
  const img = PanelImageEditor('tickets', p.image);
  const status = publishedInfo(st.panel);
  const typeCount = h('div', { class: 'hint' }, `${(t.types || []).length} ticket type(s) configured — the menu shows exactly these, nothing is added automatically.`);
  const publish = h('button', { class: 'btn primary', onclick: async () => {
    publish.disabled = true; publish.textContent = 'Publishing…';
    try {
      const r = await api('POST', G('/tickets/publish'));
      toast(`Panel sent by ${r.botTag} as a ${r.mode === 'webhook' ? 'webhook message' : 'normal message'}`, 'ok', 5000);
      status.replaceWith(status = publishedInfo({ published: true, at: Date.now(), botLabel: r.botTag, mode: r.mode, url: r.url }));
    } catch (e) { toast(e.message, 'err', 7000); }
    finally { publish.disabled = false; publish.textContent = 'Publish / update panel'; }
  } }, 'Publish / update panel');
  body.replaceChildren(h('div', { class: 'stack' }, botCard,
    h('div', { class: 'card enter' }, h('h2', null, 'Delivery'), h('p', { class: 'desc' }, 'Choose which bot sends this panel and how. The sending bot also handles every interaction on it.'), transport),
    h('div', { class: 'card enter' }, h('h2', null, 'Ticket panel'), h('p', { class: 'desc' }, 'The message members use to open a ticket. The select menu is built only from your ticket types.'),
      h('div', { class: 'grid g2' },
        h('div', { class: 'stack', style: { gap: '14px' } }, Field('Ticket Panel Channel', ch, 'Real Discord text channel — separate from the notification channel and the ticket category.'),
          Field('Title', title), Field('Description', desc), h('div', { class: 'grid g2' }, Field('Footer', footer), Field('Colour', color)), Field('Select menu placeholder', placeholder), typeCount),
        h('div', { class: 'stack', style: { gap: '14px' } }, Field('Panel image / banner', img, 'Uploaded images work in BOTH delivery modes.'),
          Field('…or image URL', imgUrl), Field('Thumbnail URL', thumb), status, h('div', { class: 'row' }, publish)))),
    h('div', { class: 'card' }, SaveButton(async () => {
      const tr = transport.getValue();
      await api('PUT', G('/tickets'), { panel: { channelId: ch.getValue(), title: title.value, description: desc.value, footer: footer.value, selectPlaceholder: placeholder.value, color: color.value, imageUrl: imgUrl.value.trim(), thumbnailUrl: thumb.value.trim(), ...tr } });
    }))));
}

function ticketsTypes(body, t, botCard, st) {
  let types = (t.types || []).map((x) => ({ ...x, supportRoles: [...(x.supportRoles || [])] }));
  const list = h('div', { class: 'stack', style: { gap: '12px' } });
  const render = () => {
    list.replaceChildren(...(types.length ? types.map((ty, i) => {
      const name = h('input', { class: 'input', value: ty.name, maxLength: 100, dir: 'auto', oninput: () => { ty.name = name.value; } });
      const emoji = h('input', { class: 'input', value: ty.emoji, maxLength: 8, placeholder: '🛟', oninput: () => { ty.emoji = emoji.value; } });
      const desc = h('input', { class: 'input', value: ty.description, maxLength: 100, dir: 'auto', oninput: () => { ty.description = desc.value; } });
      const cat = channelSelect(ty.categoryId ? [ty.categoryId] : [], { multiple: false, types: ['category'], categories: true, placeholder: 'Use the default category…', onChange: (v) => { ty.categoryId = v; } });
      const roles = roleSelect(ty.supportRoles, { onChange: (v) => { ty.supportRoles = v; } });
      const naming = h('input', { class: 'input', value: ty.namingFormat, placeholder: 'Use the default naming…', oninput: () => { ty.namingFormat = naming.value; } });
      const welcome = h('textarea', { class: 'input', dir: 'auto', maxLength: 1500, oninput: () => { ty.welcome = welcome.value; } }, ty.welcome);
      const move = (d) => { const j = i + d; if (j < 0 || j >= types.length) return; [types[i], types[j]] = [types[j], types[i]]; render(); };
      return h('div', { class: 'card enter', style: { background: 'rgba(0,0,0,.18)' } },
        h('div', { class: 'row', style: { marginBottom: '10px' } }, h('span', { class: 'cmd-icon' }, ty.emoji || '🎟️'), h('b', { style: { flex: 1 } }, ty.name || 'New type'),
          h('button', { class: 'btn sm', disabled: i === 0, onclick: () => move(-1) }, '↑'),
          h('button', { class: 'btn sm', disabled: i === types.length - 1, onclick: () => move(1) }, '↓'),
          h('button', { class: 'btn sm danger', onclick: () => { types.splice(i, 1); render(); } }, 'Delete')),
        h('div', { class: 'grid g3' }, Field('Name', name), Field('Emoji', emoji), Field('Short description', desc, 'Shown in the select menu.')),
        h('div', { class: 'grid g2', style: { marginTop: '10px' } }, Field('Discord category', cat, 'Ticket channels of this type are created here.'), Field('Extra support roles', roles, 'Added on top of the default support roles.')),
        h('div', { class: 'grid g2', style: { marginTop: '10px' } }, Field('Channel naming override', naming, '{username} {number} {type}'), Field('Welcome message', welcome)));
    }) : [h('div', { class: 'empty' }, h('b', null, 'No ticket types configured.'), 'Add your first type — it appears in the panel select menu.')]),
    h('div', null, h('button', { class: 'btn sm', onclick: () => { types.push({ id: '', name: `Type ${types.length + 1}`, description: '', emoji: '🎟️', categoryId: '', supportRoles: [], namingFormat: '', welcome: '' }); render(); } }, '+ Add ticket type')));
  };
  render();
  body.replaceChildren(h('div', { class: 'stack' }, botCard,
    h('div', { class: 'card enter' }, h('h2', null, 'Ticket types'),
      h('p', { class: 'desc' }, 'The Discord select menu contains exactly these entries — same name, description and emoji. Nothing is added automatically.'),
      (st && st.panel && st.panel.published) ? h('div', { class: 'banner info', style: { marginBottom: '12px' } }, 'After changing types, press “Publish / update panel” on the Panel tab so Discord shows the new menu.') : null,
      list),
    h('div', { class: 'card' }, SaveButton(async () => {
      if (types.some((x) => !x.name.trim())) throw new Error('Every ticket type needs a name.');
      const r = await api('PUT', G('/tickets'), { types });
      types = r.tickets.types.map((x) => ({ ...x, supportRoles: [...(x.supportRoles || [])] }));
      render();
      toast('Saved. Publish the panel again to update the select menu in Discord.', 'info', 6000);
    }))));
}

function ticketsNotifications(body, t, botCard) {
  const n = t.notifications;
  const en = Toggle(n.enabled);
  const ch = channelSelect(n.channelId ? [n.channelId] : [], { multiple: false, types: TEXTISH, placeholder: 'Moderator notification channel…' });
  const roles = roleSelect(n.mentionRoles);
  const sync = Toggle(n.syncPermissions);
  const syncBtn = h('button', { class: 'btn', onclick: async () => {
    syncBtn.disabled = true;
    try { const r = await api('POST', G('/tickets/sync-permissions')); toast(r.ok ? 'Channel permissions updated' : (r.error || 'Nothing to sync'), r.ok ? 'ok' : 'err'); }
    catch (e) { toast(e.message, 'err'); } finally { syncBtn.disabled = false; }
  } }, 'Apply channel permissions now');
  body.replaceChildren(h('div', { class: 'stack' }, botCard,
    h('div', { class: 'card enter' }, h('h2', null, 'Moderator notifications'),
      h('p', { class: 'desc' }, 'A separate channel where staff see untaken tickets. Each notification includes the member, exact type and an Accept Ticket button. Accepting claims the ticket and removes that notification automatically.'),
      ToggleRow('Enable Ticket Notifications', 'Send one embed per new ticket.', en),
      h('div', { class: 'grid g2', style: { marginTop: '10px' } },
        Field('Ticket Notification Channel', ch, 'Real Discord text channel.'),
        Field('Roles to mention', roles, 'Optional ping when a ticket is opened.')),
      ToggleRow('Restrict channel to support roles', 'Hides the channel from @everyone and grants access to support roles. Only those overwrites are touched.', sync),
      h('div', { class: 'row', style: { marginTop: '10px' } }, syncBtn)),
    h('div', { class: 'card' }, SaveButton(async () => {
      await api('PUT', G('/tickets'), { notifications: { enabled: en.getValue(), channelId: ch.getValue(), mentionRoles: roles.getValue(), syncPermissions: sync.getValue() } });
    }))));
}

// ---------------------------------------------------------------- Temporary rooms
async function pageTempRooms(page, alive) {
  const sub = location.pathname.replace(/\/+$/, '').split('/')[3] || '';
  const tabs = h('div', { class: 'tabs' }, [['', 'Settings'], ['panel', 'Control Panel']]
    .map(([p, l]) => h('a', { href: link(`/dashboard/temp-rooms${p ? `/${p}` : ''}`), 'data-nav': `/dashboard/temp-rooms${p ? `/${p}` : ''}`, class: sub === p ? 'active' : '' }, l)));
  const body = h('div');
  page.replaceChildren(tabs, body);
  if (!['', 'panel'].includes(sub)) { body.replaceChildren(ErrorBanner('Unknown temporary rooms page.')); return; }
  body.replaceChildren(Loading(['Loading channels...', 'Loading configuration...']));
  const [data] = await Promise.all([api('GET', G('/temprooms')), ensureData()]);
  if (!alive()) return;
  const t = data.tempRooms; const st = data.status;
  if (sub === 'panel') return tempRoomsPanel(body, t, st, data);

  const en = Toggle(t.enabled);
  const join = channelSelect(t.joinChannelId ? [t.joinChannelId] : [], { multiple: false, types: ['voice'], placeholder: 'Join to Create voice channel…' });
  const cat = channelSelect(t.categoryId ? [t.categoryId] : [], { multiple: false, types: ['category'], categories: true, placeholder: 'Category for new rooms…' });
  const fmt = h('input', { class: 'input', value: t.nameFormat, dir: 'auto', placeholder: "{username}'s Room" });
  const limit = h('input', { class: 'input', type: 'number', min: 0, max: 99, value: t.defaultUserLimit });
  const locked = Toggle(t.defaultLocked);
  const staff = roleSelect(t.staffRoles);
  const del = Toggle(t.deleteWhenEmpty);
  const grace = h('input', { class: 'input', type: 'number', min: 0, max: 300, value: t.emptyGraceSeconds });
  const maxRooms = h('input', { class: 'input', type: 'number', min: 1, max: 5, value: t.maxRoomsPerUser });
  const rename = Toggle(t.allowRename);
  const logCh = channelSelect(t.logChannelId ? [t.logChannelId] : [], { multiple: false, types: TEXTISH, placeholder: 'Optional log channel…' });
  body.replaceChildren(h('div', { class: 'stack' },
    warnBanner(st.warnings),
    h('div', { class: 'card enter' }, ToggleRow('Temporary rooms enabled', 'Members who join the Join-to-Create channel get their own voice room.', en),
      h('div', { class: 'grid g2', style: { marginTop: '10px' } },
        Field('Join to Create channel', join, 'Real Discord voice channel.'),
        Field('Temporary room category', cat, 'New rooms are created here (defaults to the join channel’s category).'),
        Field('Room name format', fmt, 'Placeholders: {username} {displayname} {number}'),
        Field('Default user limit', limit, '0 = unlimited'))),
    h('div', { class: 'grid g2' },
      h('div', { class: 'card enter' }, h('h2', null, 'Ownership & access'),
        h('div', { class: 'stack', style: { gap: '14px', marginTop: '10px' } },
          Field('Staff roles', staff, 'Can control any room, not just their own.'),
          Field('Max rooms per member', maxRooms),
          ToggleRow('Create rooms locked', 'New rooms start locked for @everyone.', locked),
          ToggleRow('Allow renaming', 'Owners may rename their room.', rename))),
      h('div', { class: 'card enter' }, h('h2', null, 'Cleanup & logs'),
        h('div', { class: 'stack', style: { gap: '14px', marginTop: '10px' } },
          h('div', null, ToggleRow('Delete when empty', 'Remove the room once everybody leaves.', del)),
          Field('Grace period (seconds)', grace, 'Wait before deleting an empty room.'),
          h('div', { class: 'hint' }, 'Voice-room chat cleanup is configured under AutoMod → Message Cleanup.'),
          Field('Log channel', logCh, 'Optional: room created / deleted events.')))),
    h('div', { class: 'card' }, SaveButton(async () => {
      await api('PUT', G('/temprooms'), { enabled: en.getValue(), joinChannelId: join.getValue(), categoryId: cat.getValue(), nameFormat: fmt.value, defaultUserLimit: Number(limit.value), defaultLocked: locked.getValue(), staffRoles: staff.getValue(), deleteWhenEmpty: del.getValue(), emptyGraceSeconds: Number(grace.value), maxRoomsPerUser: Number(maxRooms.value), allowRename: rename.getValue(), logChannelId: logCh.getValue() });
    })),
    h('div', { class: 'card enter' }, h('h2', null, `Active rooms (${st.active})`),
      st.rooms.length ? h('table', { class: 'table' }, h('thead', null, h('tr', null, ['Room', 'Owner', 'Members', 'Limit', 'State', 'Created'].map((x) => h('th', null, x)))),
        h('tbody', null, st.rooms.map((rm) => h('tr', null, h('td', { dir: 'auto' }, rm.name), h('td', null, h('span', { class: 'tiny' }, rm.ownerId)), h('td', null, String(rm.members)),
          h('td', null, rm.userLimit ? String(rm.userLimit) : '∞'),
          h('td', null, h('span', { class: `pill ${rm.locked ? 'off' : 'on'}` }, rm.locked ? 'Locked' : 'Open'), rm.hidden ? h('span', { class: 'pill' }, 'Hidden') : null),
          h('td', null, relTime(rm.createdAt))))))
        : h('div', { class: 'empty' }, h('b', null, 'No active temporary rooms.'), 'Rooms appear here while members are using them.'))));
}

/** Full control-panel editor: content, image, delivery, and add/edit/delete/reorder buttons. */
function tempRoomsPanel(body, t, st, data) {
  const p = t.panel;
  const ACTIONS = data.actions || [];
  const STYLES = data.styles || ['primary', 'secondary', 'success', 'danger'];
  const actionMeta = (a) => ACTIONS.find((x) => x.action === a) || { label: a, emoji: '', style: 'secondary' };

  const transport = PanelTransport({ senderBot: p.senderBot, delivery: p.delivery, bots: st.bots, system: 'temprooms' });
  const ch = channelSelect(p.channelId ? [p.channelId] : [], { multiple: false, types: TEXTISH, placeholder: 'Channel for the control panel…' });
  const title = h('input', { class: 'input', value: p.title, maxLength: 256, dir: 'auto' });
  const desc = h('textarea', { class: 'input', dir: 'auto', maxLength: 4000 }, p.description);
  const footer = h('input', { class: 'input', value: p.footer, maxLength: 200, dir: 'auto' });
  const color = h('input', { class: 'input', type: 'color', value: (p.color || '#a855f7').slice(0, 7) });
  const imgUrl = h('input', { class: 'input', value: p.imageUrl || '', placeholder: 'https://… (used when no file is uploaded)' });
  const thumbUrl = h('input', { class: 'input', value: p.thumbnailUrl || '', placeholder: 'https://… thumbnail' });
  const img = PanelImageEditor('temprooms', p.image);
  let status = publishedInfo(st.panel);

  // ---- button manager -------------------------------------------------
  let buttons = (p.buttons || []).map((b) => ({ ...b }));
  const list = h('div', { class: 'stack', style: { gap: '10px' } });
  const preview = h('div', { class: 'stack', style: { gap: '8px' } });
  const STYLE_BG = { primary: 'linear-gradient(135deg,#5865f2,#4752c4)', secondary: 'rgba(255,255,255,.09)', success: 'linear-gradient(135deg,#059669,#10b981)', danger: 'linear-gradient(135deg,#dc2626,#ef4444)' };
  const renderPreview = () => {
    const live = buttons.filter((b) => b.enabled !== false);
    const rows = [];
    for (let i = 0; i < live.length && rows.length < 5; i += 5) rows.push(live.slice(i, i + 5));
    preview.replaceChildren(
      h('div', { class: 'label' }, `Discord preview — ${live.length} button(s) in ${rows.length} row(s)`),
      ...(rows.length ? rows.map((row) => h('div', { class: 'row', style: { gap: '6px' } }, row.map((b) => h('span', {
        style: { padding: '7px 13px', borderRadius: '8px', background: STYLE_BG[b.style] || STYLE_BG.secondary, border: '1px solid rgba(255,255,255,.12)', fontSize: '13px', fontWeight: 600, whiteSpace: 'nowrap' }, dir: 'auto',
      }, `${b.emoji ? `${b.emoji} ` : ''}${b.label || actionMeta(b.action).label}`))))
        : [h('div', { class: 'hint' }, 'No enabled buttons — the panel cannot be published.')]),
      live.length > 25 ? h('div', { class: 'err-text' }, 'Discord allows at most 25 buttons; extras are dropped.') : null);
  };
  const render = () => {
    list.replaceChildren(...(buttons.length ? buttons.map((b, i) => {
      const meta = actionMeta(b.action);
      const action = h('select', { class: 'input', onchange: () => { b.action = action.value; const m = actionMeta(b.action); if (!b.label) b.label = m.label; render(); } },
        ACTIONS.map((a) => h('option', { value: a.action, selected: b.action === a.action }, a.label)));
      const label = h('input', { class: 'input', value: b.label || meta.label, maxLength: 80, dir: 'auto', oninput: () => { b.label = label.value; renderPreview(); } });
      const emoji = h('input', { class: 'input', value: b.emoji === undefined ? meta.emoji : b.emoji, maxLength: 16, placeholder: 'optional', oninput: () => { b.emoji = emoji.value; renderPreview(); } });
      const style = h('select', { class: 'input', onchange: () => { b.style = style.value; renderPreview(); } },
        STYLES.map((x) => h('option', { value: x, selected: (b.style || 'secondary') === x }, x[0].toUpperCase() + x.slice(1))));
      const on = Toggle(b.enabled !== false, (v) => { b.enabled = v; renderPreview(); });
      const move = (d) => { const j = i + d; if (j < 0 || j >= buttons.length) return; [buttons[i], buttons[j]] = [buttons[j], buttons[i]]; render(); };
      return h('div', { class: 'card', style: { padding: '12px', background: 'rgba(0,0,0,.18)' } },
        h('div', { class: 'row', style: { marginBottom: '8px' } },
          h('span', { class: 'pill accent' }, `#${i + 1}`),
          h('b', { style: { flex: 1 }, dir: 'auto' }, `${b.emoji || meta.emoji || ''} ${b.label || meta.label}`),
          on,
          h('button', { class: 'btn sm', disabled: i === 0, title: 'Move up', onclick: () => move(-1) }, '↑'),
          h('button', { class: 'btn sm', disabled: i === buttons.length - 1, title: 'Move down', onclick: () => move(1) }, '↓'),
          h('button', { class: 'btn sm danger', onclick: () => { buttons.splice(i, 1); render(); } }, 'Delete')),
        h('div', { class: 'grid g4' }, Field('Action', action, 'Only implemented actions'), Field('Label', label), Field('Emoji', emoji), Field('Style', style)));
    }) : [h('div', { class: 'empty' }, h('b', null, 'No buttons configured.'), 'Add the controls you want members to have.')]),
    h('div', { class: 'row' },
      h('button', { class: 'btn sm', onclick: () => { const used = new Set(buttons.map((x) => x.action)); const next = ACTIONS.find((a) => !used.has(a.action)) || ACTIONS[0]; if (!next) return; buttons.push({ id: `b-${next.action}-${buttons.length}`, action: next.action, label: next.label, emoji: next.emoji, style: next.style, enabled: true }); render(); } }, '+ Add button'),
      h('button', { class: 'btn sm', onclick: async () => { if (await Modal({ title: 'Reset buttons?', body: 'Restore the default control panel buttons? Your custom labels will be lost.', confirmText: 'Reset' })) { buttons = ACTIONS.map((a, i) => ({ id: `b-${a.action}-${i}`, action: a.action, label: a.label, emoji: a.emoji, style: a.style, enabled: true })); render(); } } }, 'Reset to defaults')));
    renderPreview();
  };
  render();

  const publish = h('button', { class: 'btn primary', onclick: async () => {
    publish.disabled = true; publish.textContent = 'Publishing…';
    try {
      const r = await api('POST', G('/temprooms/publish'));
      toast(`Panel sent by ${r.botTag} as a ${r.mode === 'webhook' ? 'webhook message' : 'normal message'}`, 'ok', 5000);
      const next = publishedInfo({ published: true, at: Date.now(), botLabel: r.botTag, mode: r.mode, url: r.url });
      status.replaceWith(next); status = next;
    } catch (e) { toast(e.message, 'err', 7000); }
    finally { publish.disabled = false; publish.textContent = 'Publish / update panel'; }
  } }, 'Publish / update panel');

  body.replaceChildren(h('div', { class: 'stack' },
    warnBanner(st.warnings),
    h('div', { class: 'card enter' }, h('h2', null, 'Delivery'), h('p', { class: 'desc' }, 'Choose which bot sends the control panel and how. The sending bot also handles every button on it.'), transport),
    h('div', { class: 'card enter' }, h('h2', null, 'Panel content'),
      h('div', { class: 'grid g2' },
        h('div', { class: 'stack', style: { gap: '14px' } }, Field('Control panel channel', ch), Field('Title', title), Field('Description', desc), h('div', { class: 'grid g2' }, Field('Footer', footer), Field('Colour', color))),
        h('div', { class: 'stack', style: { gap: '14px' } }, Field('Panel image / background', img, 'Works in both delivery modes.'), Field('…or image URL', imgUrl), Field('Thumbnail URL', thumbUrl), status, h('div', { class: 'row' }, publish)))),
    h('div', { class: 'card enter' }, h('h2', null, 'Control panel buttons'),
      h('p', { class: 'desc' }, 'Add, edit, reorder, disable or delete buttons. Only actions the bot can really perform are available. Order here is the order in Discord; rows of 5 are filled automatically.'),
      h('div', { class: 'card', style: { padding: '14px', marginBottom: '14px', background: 'rgba(0,0,0,.22)' } }, preview),
      list),
    h('div', { class: 'card' }, SaveButton(async () => {
      if (!buttons.filter((b) => b.enabled !== false).length) throw new Error('Enable at least one button.');
      const tr = transport.getValue();
      const r = await api('PUT', G('/temprooms'), { panel: { channelId: ch.getValue(), title: title.value, description: desc.value, footer: footer.value, color: color.value, imageUrl: imgUrl.value.trim(), thumbnailUrl: thumbUrl.value.trim(), buttons, ...tr } });
      buttons = (r.tempRooms.panel.buttons || []).map((b) => ({ ...b }));
      render();
      toast('Press “Publish / update panel” to apply the buttons in Discord.', 'info', 6000);
    }))));
}
