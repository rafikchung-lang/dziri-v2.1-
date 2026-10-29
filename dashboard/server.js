'use strict';
/**
 * Dashboard HTTP server (Express). Serves the SPA from /public and the JSON API.
 *
 * Auth: Discord OAuth2 (identify) or optional owner password (DASHBOARD_PASSWORD).
 * Sessions: random id in an HMAC-signed, HttpOnly cookie; session data lives server-side.
 * Guild authorisation is ALWAYS verified server-side through the bot (member must have
 * Manage Server / Administrator in that guild) — guild IDs from the browser are never trusted.
 */
const path = require('path');
const crypto = require('crypto');
const express = require('express');
const logger = require('../utils/logger');

const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const SECRET = process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex');
const SESSION_TTL = 7 * 86_400_000;
const sessions = new Map(); // sid -> { user, mode, exp, state }

setInterval(() => { const now = Date.now(); for (const [k, s] of sessions) if (s.exp < now) sessions.delete(k); }, 3_600_000).unref();

const sign = (v) => `${v}.${crypto.createHmac('sha256', SECRET).update(v).digest('base64url')}`;
function unsign(signed) {
  if (!signed || typeof signed !== 'string') return null;
  const i = signed.lastIndexOf('.');
  if (i < 1) return null;
  const v = signed.slice(0, i);
  const expected = sign(v);
  const a = Buffer.from(expected); const b = Buffer.from(signed);
  return a.length === b.length && crypto.timingSafeEqual(a, b) ? v : null;
}
function parseCookies(req) {
  const out = {};
  for (const part of String(req.headers.cookie || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}
function getSession(req) {
  const sid = unsign(parseCookies(req).dz_sid);
  if (!sid) return null;
  const s = sessions.get(sid);
  if (!s || s.exp < Date.now()) { sessions.delete(sid); return null; }
  return s;
}
function createSession(res, data, req) {
  const sid = crypto.randomBytes(24).toString('hex');
  sessions.set(sid, { ...data, exp: Date.now() + SESSION_TTL });
  const secure = (req.headers['x-forwarded-proto'] || req.protocol) === 'https' ? '; Secure' : '';
  res.setHeader('Set-Cookie', `dz_sid=${encodeURIComponent(sign(sid))}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_TTL / 1000}${secure}`);
}
function destroySession(req, res) {
  const sid = unsign(parseCookies(req).dz_sid);
  if (sid) sessions.delete(sid);
  res.setHeader('Set-Cookie', 'dz_sid=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0');
}

// ---------------------------------------------------------------------------
// Guild authorisation (verified through the bot, cached 60 s)
// ---------------------------------------------------------------------------
const accessCache = new Map();
async function canAccessGuild(client, session, guildId) {
  if (!session || !/^\d{5,25}$/.test(String(guildId))) return false;
  const guild = client.isReady() ? client.guilds.cache.get(guildId) : null;
  if (!guild) return false;
  if (session.mode === 'password') return true;
  const key = `${session.user.id}:${guildId}`;
  const c = accessCache.get(key);
  if (c && c.exp > Date.now()) return c.ok;
  let ok = false;
  try {
    if (guild.ownerId === session.user.id) ok = true;
    else {
      const m = await guild.members.fetch(session.user.id);
      ok = m.permissions.has('ManageGuild') || m.permissions.has('Administrator');
    }
  } catch { ok = false; }
  accessCache.set(key, { ok, exp: Date.now() + 60_000 });
  return ok;
}

function start(client, ticketBot) {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', true);
  // Rank/panel images and member-messaging attachments are validated by their API routes.
  // 15 MB accommodates one 10 MB file after base64 expansion without adding multipart deps.
  app.use(express.json({ limit: '15mb' }));
  app.use((req, res, next) => { res.setHeader('X-Content-Type-Options', 'nosniff'); res.setHeader('Referrer-Policy', 'same-origin'); res.setHeader('X-Frame-Options', 'SAMEORIGIN'); next(); });

  app.get('/api/health', (req, res) => res.json({ ok: true, discord: client.isReady(), uptime: process.uptime() }));

  // ---------------- auth ----------------
  const oauthEnabled = () => Boolean(process.env.CLIENT_ID && process.env.CLIENT_SECRET);
  const redirectUri = (req) => `${(process.env.DASHBOARD_URL || `${req.protocol}://${req.get('host')}`).replace(/\/$/, '')}/auth/callback`;

  app.get('/api/auth/methods', (req, res) => res.json({ oauth: oauthEnabled(), password: Boolean(process.env.DASHBOARD_PASSWORD) }));

  app.get('/auth/discord', (req, res) => {
    if (!oauthEnabled()) return res.redirect('/login?error=oauth_disabled');
    const state = crypto.randomBytes(16).toString('hex');
    res.setHeader('Set-Cookie', `dz_state=${sign(state)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=600`);
    const q = new URLSearchParams({ client_id: process.env.CLIENT_ID, redirect_uri: redirectUri(req), response_type: 'code', scope: 'identify', state, prompt: 'none' });
    res.redirect(`https://discord.com/oauth2/authorize?${q}`);
  });

  app.get('/auth/callback', async (req, res) => {
    try {
      const state = unsign(parseCookies(req).dz_state);
      if (!state || state !== req.query.state) return res.redirect('/login?error=state');
      const tokenRes = await fetch('https://discord.com/api/v10/oauth2/token', {
        method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ client_id: process.env.CLIENT_ID, client_secret: process.env.CLIENT_SECRET, grant_type: 'authorization_code', code: String(req.query.code || ''), redirect_uri: redirectUri(req) }),
      });
      if (!tokenRes.ok) return res.redirect('/login?error=token');
      const token = await tokenRes.json();
      const meRes = await fetch('https://discord.com/api/v10/users/@me', { headers: { Authorization: `Bearer ${token.access_token}` } });
      if (!meRes.ok) return res.redirect('/login?error=user');
      const u = await meRes.json();
      createSession(res, { mode: 'oauth', user: { id: u.id, username: u.global_name || u.username, avatar: u.avatar ? `https://cdn.discordapp.com/avatars/${u.id}/${u.avatar}.png?size=128` : '' } }, req);
      res.redirect('/dashboard');
    } catch (err) {
      logger.error('Dashboard', 'OAuth callback failed:', err.message);
      res.redirect('/login?error=oauth');
    }
  });

  const attempts = new Map();
  app.post('/auth/password', (req, res) => {
    const ip = req.ip || 'x';
    const a = attempts.get(ip) || { n: 0, t: Date.now() };
    if (Date.now() - a.t > 600_000) { a.n = 0; a.t = Date.now(); }
    if (a.n >= 8) return res.status(429).json({ error: 'Too many attempts. Try again in 10 minutes.' });
    const pw = process.env.DASHBOARD_PASSWORD;
    if (!pw) return res.status(400).json({ error: 'Password login is disabled.' });
    const given = Buffer.from(String((req.body && req.body.password) || ''));
    const want = Buffer.from(pw);
    if (given.length !== want.length || !crypto.timingSafeEqual(given, want)) { a.n++; attempts.set(ip, a); return res.status(401).json({ error: 'Wrong password.' }); }
    attempts.delete(ip);
    createSession(res, { mode: 'password', user: { id: 'owner', username: 'Owner', avatar: '' } }, req);
    res.json({ ok: true });
  });

  app.post('/auth/logout', (req, res) => { destroySession(req, res); res.json({ ok: true }); });

  // ---------------- API ----------------
  app.use('/api', (req, res, next) => {
    const s = getSession(req);
    if (!s) return res.status(401).json({ error: 'Not logged in.' });
    req.session = s;
    next();
  });
  app.use('/api', require('./api')(client, { canAccessGuild, ticketBot }));
  app.use('/api', (req, res) => res.status(404).json({ error: 'Not found.' }));

  // ---------------- pages ----------------
  app.use('/assets', express.static(path.join(PUBLIC_DIR, 'assets'), { maxAge: '1h' }));
  app.get('/login', (req, res) => res.sendFile(path.join(PUBLIC_DIR, 'login.html')));
  app.get('/', (req, res) => res.redirect(getSession(req) ? '/dashboard' : '/login'));
  // Every /dashboard/* URL serves the SPA, so reloading /dashboard/settings stays there.
  app.get(['/dashboard', '/dashboard/*'], (req, res) => {
    if (!getSession(req)) return res.redirect(`/login?next=${encodeURIComponent(req.originalUrl)}`);
    res.sendFile(path.join(PUBLIC_DIR, 'index.html'));
  });
  app.use((req, res) => res.status(404).send('Not found'));
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    logger.error('Dashboard', err.message);
    if (err.type === 'entity.too.large') return res.status(413).json({ error: 'Upload request too large. Attachments must be 10 MB or smaller.' });
    res.status(500).json({ error: 'Internal server error.' });
  });

  const port = Number(process.env.PORT || process.env.SERVER_PORT) || 3000;
  const server = app.listen(port, '0.0.0.0', () => logger.info('Dashboard', `Running on port ${port}`));
  server.on('error', (err) => logger.error('Dashboard', `Failed to start on port ${port}: ${err.message}`));
  if (!process.env.SESSION_SECRET) logger.warn('Dashboard', 'SESSION_SECRET not set — using a random one (sessions reset on restart).');
  if (!oauthEnabled() && !process.env.DASHBOARD_PASSWORD) logger.warn('Dashboard', 'No login method configured. Set CLIENT_ID + CLIENT_SECRET (Discord login) or DASHBOARD_PASSWORD in .env.');
  return server;
}

module.exports = { start };
