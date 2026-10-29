'use strict';
/**
 * Dziri System rank card & leaderboard renderer (@napi-rs/canvas — prebuilt, no Chromium).
 *
 * Signature layout: dark-purple glass panel over a gradient / colour / uploaded image,
 * glowing avatar ring, bold username, RANK / LEVEL blocks, gradient progress bar with glow,
 * separate TEXT / VOICE XP chips and the DZIRI SYSTEM wordmark.
 * Every visual property comes from the guild's saved rankCard config.
 */
const path = require('path');
const fs = require('fs');
const { createCanvas, loadImage, GlobalFonts } = require('@napi-rs/canvas');
const { defaultRankCard } = require('../config/defaults');
const store = require('../database/store');
const logger = require('../utils/logger');

const FONT_DIR = path.join(__dirname, '..', 'assets', 'fonts');
let fontsLoaded = false;
function ensureFonts() {
  if (fontsLoaded) return;
  fontsLoaded = true;
  try {
    GlobalFonts.registerFromPath(path.join(FONT_DIR, 'NotoSans-Bold.ttf'), 'Dziri Sans Bold');
    GlobalFonts.registerFromPath(path.join(FONT_DIR, 'NotoSans-Regular.ttf'), 'Dziri Sans');
    GlobalFonts.registerFromPath(path.join(FONT_DIR, 'NotoSansArabic-Bold.ttf'), 'Dziri Arabic');
  } catch (err) { logger.warn('RankCard', 'Font registration failed:', err.message); }
}
const BOLD = (px) => `${px}px "Dziri Sans Bold", "Dziri Arabic", sans-serif`;
const REG = (px) => `${px}px "Dziri Sans", "Dziri Arabic", sans-serif`;

const UPLOAD_DIR = path.join(store.DATA_DIR, 'uploads');

function rr(ctx, x, y, w, h, r) {
  const rad = Math.max(0, Math.min(r, h / 2, w / 2));
  ctx.beginPath();
  ctx.moveTo(x + rad, y);
  ctx.arcTo(x + w, y, x + w, y + h, rad);
  ctx.arcTo(x + w, y + h, x, y + h, rad);
  ctx.arcTo(x, y + h, x, y, rad);
  ctx.arcTo(x, y, x + w, y, rad);
  ctx.closePath();
}

function compact(n) {
  n = Number(n) || 0;
  if (n >= 1e6) return `${(n / 1e6).toFixed(n >= 1e7 ? 0 : 1)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(n >= 1e4 ? 0 : 1)}K`;
  return String(Math.floor(n));
}

function fitText(ctx, text, maxWidth) {
  if (ctx.measureText(text).width <= maxWidth) return text;
  let t = [...text];
  while (t.length > 1 && ctx.measureText(`${t.join('')}…`).width > maxWidth) t.pop();
  return `${t.join('')}…`;
}

async function fetchImage(url) {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(6000) });
    if (!res.ok) return null;
    return await loadImage(Buffer.from(await res.arrayBuffer()));
  } catch { return null; }
}

function drawCover(ctx, img, x, y, w, h) {
  const s = Math.max(w / img.width, h / img.height);
  const iw = img.width * s; const ih = img.height * s;
  ctx.drawImage(img, x + (w - iw) / 2, y + (h - ih) / 2, iw, ih);
}

async function drawBackground(ctx, c, W, H) {
  if (c.backgroundType === 'image' && c.backgroundImage) {
    const file = path.join(UPLOAD_DIR, path.basename(c.backgroundImage));
    if (fs.existsSync(file)) {
      try {
        const img = await loadImage(fs.readFileSync(file));
        drawCover(ctx, img, 0, 0, W, H);
        ctx.fillStyle = `rgba(8,4,18,${Math.min(0.95, Math.max(0, Number(c.overlayOpacity) || 0))})`;
        ctx.fillRect(0, 0, W, H);
        return;
      } catch (err) { logger.warn('RankCard', 'Background image failed:', err.message); }
    }
  }
  if (c.backgroundType === 'color') {
    ctx.fillStyle = c.backgroundColor; ctx.fillRect(0, 0, W, H);
  } else {
    const g = ctx.createLinearGradient(0, 0, W, H);
    g.addColorStop(0, c.gradientFrom); g.addColorStop(1, c.gradientTo);
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  }
}

function glow(ctx, x, y, r, color, alpha) {
  const g = ctx.createRadialGradient(x, y, 0, x, y, r);
  g.addColorStop(0, hexA(color, alpha)); g.addColorStop(1, hexA(color, 0));
  ctx.fillStyle = g; ctx.fillRect(x - r, y - r, r * 2, r * 2);
}

function hexA(hex, a) {
  const h = String(hex || '#a855f7').replace('#', '');
  const full = h.length === 3 ? h.split('').map((x) => x + x).join('') : h.slice(0, 6);
  const n = parseInt(full, 16);
  if (Number.isNaN(n)) return `rgba(168,85,247,${a})`;
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

/**
 * @param {{ username:string, tag:string, avatarUrl:string, rank:number, level:number, current:number, needed:number, textXp:number, voiceXp:number, totalXp:number }} data
 * @param {object} cfg rank card config
 */
async function renderRankCard(data, cfg) {
  ensureFonts();
  const c = { ...defaultRankCard(), ...(cfg || {}) };
  const W = 1000; const H = 300;
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext('2d');

  // outer clip
  rr(ctx, 0, 0, W, H, 30); ctx.save(); ctx.clip();
  await drawBackground(ctx, c, W, H);

  const right = c.layout === 'right';
  const avSize = 176;
  const avX = right ? W - 62 - avSize : 62;
  const avY = (H - avSize) / 2;

  // ambient purple lights
  glow(ctx, avX + avSize / 2, H / 2, 260, c.accentColor, 0.35);
  glow(ctx, right ? 120 : W - 120, 30, 240, c.accentColor2, 0.22);

  // glass panel
  const P = 18;
  rr(ctx, P, P, W - P * 2, H - P * 2, 24);
  ctx.fillStyle = `rgba(18,8,34,${Math.min(0.9, Math.max(0, Number(c.panelOpacity) || 0))})`;
  ctx.fill();
  if (c.blurPanel) {
    const hl = ctx.createLinearGradient(0, P, 0, H / 2);
    hl.addColorStop(0, 'rgba(255,255,255,0.10)'); hl.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = hl; ctx.fill();
  }
  ctx.lineWidth = 1.5; ctx.strokeStyle = 'rgba(255,255,255,0.14)'; ctx.stroke();

  // avatar
  const avatar = data.avatarUrl ? await fetchImage(data.avatarUrl) : null;
  const shapeRadius = c.avatarShape === 'circle' ? avSize / 2 : c.avatarShape === 'rounded' ? 36 : 8;
  if (c.avatarGlow) { ctx.save(); ctx.shadowColor = c.accentColor; ctx.shadowBlur = 40; rr(ctx, avX, avY, avSize, avSize, shapeRadius); ctx.fillStyle = hexA(c.accentColor, 0.5); ctx.fill(); ctx.restore(); }
  ctx.save(); rr(ctx, avX, avY, avSize, avSize, shapeRadius); ctx.clip();
  if (avatar) ctx.drawImage(avatar, avX, avY, avSize, avSize);
  else { ctx.fillStyle = hexA(c.accentColor, 0.6); ctx.fillRect(avX, avY, avSize, avSize); ctx.fillStyle = '#fff'; ctx.font = BOLD(72); ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText((data.username || '?')[0].toUpperCase(), avX + avSize / 2, avY + avSize / 2); ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic'; }
  ctx.restore();
  if (c.avatarRing) {
    const ring = ctx.createLinearGradient(avX, avY, avX + avSize, avY + avSize);
    ring.addColorStop(0, c.accentColor); ring.addColorStop(1, c.accentColor2);
    ctx.lineWidth = 6; ctx.strokeStyle = ring;
    rr(ctx, avX - 5, avY - 5, avSize + 10, avSize + 10, shapeRadius + 5); ctx.stroke();
  }

  // content area
  const cx = right ? 62 : avX + avSize + 44;
  const cw = right ? avX - 44 - cx : W - 62 - cx;

  // brand / title
  if (c.showTitle && c.title) {
    ctx.font = BOLD(15); ctx.fillStyle = c.accentColor;
    ctx.letterSpacing = '4px';
    ctx.textAlign = right ? 'left' : 'right';
    ctx.fillText(String(c.title).toUpperCase().slice(0, 40), right ? cx : cx + cw, 60);
    ctx.letterSpacing = '0px'; ctx.textAlign = 'left';
  }

  // rank & level blocks (top-right of content)
  const blocks = [];
  if (c.showRank) blocks.push(['RANK', `#${data.rank}`]);
  if (c.showLevel) blocks.push(['LEVEL', String(data.level)]);
  let bx = cx + cw; const by = 128;
  for (let i = blocks.length - 1; i >= 0; i--) {
    const [label, value] = blocks[i];
    ctx.font = BOLD(46); const vw = ctx.measureText(value).width;
    ctx.fillStyle = i === blocks.length - 1 ? c.textColor : c.textColor;
    ctx.fillText(value, bx - vw, by);
    ctx.font = BOLD(15); const lw = ctx.measureText(label).width;
    ctx.fillStyle = c.subTextColor; ctx.fillText(label, bx - vw - lw - 10, by);
    bx -= vw + lw + 34;
  }

  // username
  const nameMax = Math.max(140, bx - cx - 10);
  ctx.font = BOLD(40); ctx.fillStyle = c.textColor;
  ctx.fillText(fitText(ctx, data.username || 'Unknown', nameMax), cx, by);
  if (c.showDiscriminatorTag && data.tag) {
    ctx.font = REG(18); ctx.fillStyle = c.subTextColor;
    ctx.fillText(fitText(ctx, `@${data.tag}`, nameMax), cx, by + 30);
  }

  // progress bar
  const barY = 206; const barH = 26;
  const pct = data.needed > 0 ? Math.max(0, Math.min(1, data.current / data.needed)) : 0;
  const rad = c.progressStyle === 'sharp' ? 4 : barH / 2;
  rr(ctx, cx, barY, cw, barH, rad); ctx.fillStyle = c.trackColor; ctx.fill();
  if (pct > 0) {
    const fw = Math.max(barH, cw * pct);
    const pg = ctx.createLinearGradient(cx, 0, cx + fw, 0);
    pg.addColorStop(0, c.accentColor); pg.addColorStop(1, c.accentColor2);
    ctx.save(); ctx.shadowColor = c.accentColor; ctx.shadowBlur = 18;
    rr(ctx, cx, barY, fw, barH, rad); ctx.fillStyle = pg; ctx.fill(); ctx.restore();
    const shine = ctx.createLinearGradient(0, barY, 0, barY + barH);
    shine.addColorStop(0, 'rgba(255,255,255,0.28)'); shine.addColorStop(0.6, 'rgba(255,255,255,0)');
    rr(ctx, cx, barY, fw, barH / 2, rad); ctx.fillStyle = shine; ctx.fill();
  }

  // xp text above bar
  if (c.showXp) {
    ctx.font = BOLD(18); ctx.fillStyle = c.textColor;
    const t1 = compact(data.current); const t2 = ` / ${compact(data.needed)} XP`;
    ctx.font = REG(18); const w2 = ctx.measureText(t2).width;
    ctx.fillStyle = c.subTextColor; ctx.fillText(t2, cx + cw - w2, barY - 12);
    ctx.font = BOLD(18); const w1 = ctx.measureText(t1).width;
    ctx.fillStyle = c.textColor; ctx.fillText(t1, cx + cw - w2 - w1, barY - 12);
  }

  // text / voice chips under the bar
  if (c.showTextVoice) {
    let chipX = cx; const chipY = barY + barH + 12;
    for (const [label, val] of [['TEXT', data.textXp], ['VOICE', data.voiceXp], ['TOTAL', data.totalXp]]) {
      const txt = `${label}  ${compact(val)} XP`;
      ctx.font = BOLD(13); const tw = ctx.measureText(txt).width + 24;
      if (chipX + tw > cx + cw) break;
      rr(ctx, chipX, chipY, tw, 26, 13); ctx.fillStyle = hexA(c.accentColor, 0.18); ctx.fill();
      ctx.lineWidth = 1; ctx.strokeStyle = hexA(c.accentColor, 0.45); ctx.stroke();
      ctx.fillStyle = c.textColor; ctx.fillText(txt, chipX + 12, chipY + 18);
      chipX += tw + 10;
    }
  }

  ctx.restore();
  return canvas.encode('png');
}

/** Leaderboard image (10 rows) in the same visual identity. */
async function renderLeaderboard(rows, { title = 'LEADERBOARD', subtitle = '', page = 1, pages = 1, cfg } = {}) {
  ensureFonts();
  const c = { ...defaultRankCard(), ...(cfg || {}) };
  const W = 1000; const rowH = 74; const top = 110;
  const H = top + Math.max(1, rows.length) * (rowH + 10) + 40;
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext('2d');
  rr(ctx, 0, 0, W, H, 30); ctx.save(); ctx.clip();
  const bg = { ...c, backgroundType: c.backgroundType === 'image' ? 'gradient' : c.backgroundType };
  await drawBackground(ctx, bg, W, H);
  glow(ctx, 120, 40, 300, c.accentColor, 0.3); glow(ctx, W - 100, H - 40, 300, c.accentColor2, 0.2);

  ctx.font = BOLD(15); ctx.letterSpacing = '4px'; ctx.fillStyle = c.accentColor;
  ctx.fillText(String(c.title || 'DZIRI SYSTEM').toUpperCase(), 40, 48); ctx.letterSpacing = '0px';
  ctx.font = BOLD(34); ctx.fillStyle = c.textColor; ctx.fillText(title, 40, 88);
  ctx.font = REG(18); ctx.fillStyle = c.subTextColor;
  const pg = `${subtitle ? `${subtitle} • ` : ''}Page ${page}/${pages}`;
  ctx.fillText(pg, W - 40 - ctx.measureText(pg).width, 88);

  const avatars = await Promise.all(rows.map((r) => (r.avatarUrl ? fetchImage(r.avatarUrl) : null)));
  rows.forEach((r, i) => {
    const y = top + i * (rowH + 10);
    rr(ctx, 30, y, W - 60, rowH, 18);
    ctx.fillStyle = `rgba(18,8,34,${Math.min(0.9, (Number(c.panelOpacity) || 0.3) + 0.1)})`; ctx.fill();
    ctx.lineWidth = 1; ctx.strokeStyle = r.position <= 3 ? hexA(c.accentColor, 0.7) : 'rgba(255,255,255,0.1)'; ctx.stroke();

    ctx.font = BOLD(26); ctx.fillStyle = r.position <= 3 ? c.accentColor : c.subTextColor;
    const pos = `#${r.position}`; ctx.fillText(pos, 52, y + 47);
    const ax = 130; const as = 50; const ay = y + 12;
    ctx.save(); rr(ctx, ax, ay, as, as, as / 2); ctx.clip();
    if (avatars[i]) ctx.drawImage(avatars[i], ax, ay, as, as); else { ctx.fillStyle = hexA(c.accentColor, 0.5); ctx.fillRect(ax, ay, as, as); }
    ctx.restore();

    ctx.font = BOLD(22); ctx.fillStyle = c.textColor;
    ctx.fillText(fitText(ctx, r.username, 300), 200, y + 34);
    ctx.font = REG(15); ctx.fillStyle = c.subTextColor;
    ctx.fillText(`Text ${compact(r.textXp)} • Voice ${compact(r.voiceXp)}`, 200, y + 56);

    // progress
    const px = 540; const pw = 230; const py = y + 31;
    rr(ctx, px, py, pw, 12, 6); ctx.fillStyle = c.trackColor; ctx.fill();
    const pct = r.needed ? Math.min(1, r.current / r.needed) : 0;
    if (pct > 0) { const gr = ctx.createLinearGradient(px, 0, px + pw, 0); gr.addColorStop(0, c.accentColor); gr.addColorStop(1, c.accentColor2); rr(ctx, px, py, Math.max(12, pw * pct), 12, 6); ctx.fillStyle = gr; ctx.fill(); }

    ctx.font = BOLD(20); ctx.fillStyle = c.textColor;
    const lv = `LVL ${r.level}`; ctx.fillText(lv, W - 52 - ctx.measureText(lv).width, y + 34);
    ctx.font = REG(15); ctx.fillStyle = c.subTextColor;
    const xp = `${compact(r.value)} XP`; ctx.fillText(xp, W - 52 - ctx.measureText(xp).width, y + 56);
  });
  if (!rows.length) { ctx.font = REG(20); ctx.fillStyle = c.subTextColor; ctx.fillText('No one has earned XP yet.', 40, top + 40); }
  ctx.restore();
  return canvas.encode('png');
}

module.exports = { renderRankCard, renderLeaderboard, UPLOAD_DIR };
