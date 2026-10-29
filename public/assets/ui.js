/* Dziri System — UI primitives (vanilla JS, no build step) */
'use strict';

function h(tag, props, ...children) {
  const el = document.createElement(tag);
  if (props) {
    for (const [k, v] of Object.entries(props)) {
      if (v === null || v === undefined || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
      else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
      else if (k === 'html') el.innerHTML = v;
      else if (k in el && typeof v !== 'string') el[k] = v;
      else el.setAttribute(k, v === true ? '' : String(v));
    }
  }
  appendKids(el, children);
  return el;
}
function appendKids(el, kids) {
  for (const c of kids) {
    if (c === null || c === undefined || c === false) continue;
    if (Array.isArray(c)) appendKids(el, c);
    else el.appendChild(c instanceof Node ? c : document.createTextNode(String(c)));
  }
}

async function api(method, url, body) {
  const opts = { method, credentials: 'same-origin', headers: {} };
  if (body !== undefined) { opts.headers['Content-Type'] = 'application/json'; opts.body = JSON.stringify(body); }
  let res;
  try { res = await fetch(`/api${url}`, opts); } catch { throw new Error('Network error — is the bot running?'); }
  if (res.status === 401) { location.href = `/login?next=${encodeURIComponent(location.pathname + location.search)}`; throw new Error('Not logged in'); }
  const ct = res.headers.get('content-type') || '';
  const data = ct.includes('application/json') ? await res.json().catch(() => null) : null;
  if (!res.ok) { const e = new Error((data && data.error) || `Request failed (${res.status})`); e.data = data; e.status = res.status; throw e; }
  return data;
}

function toast(message, type = 'info', ms = 3800) {
  const box = document.getElementById('toasts');
  const icon = type === 'ok' ? '✓' : type === 'err' ? '⛔' : 'ℹ';
  const t = h('div', { class: `toast ${type}` }, h('b', null, icon), h('div', null, message));
  box.appendChild(t);
  setTimeout(() => { t.classList.add('out'); setTimeout(() => t.remove(), 300); }, ms);
}

function Toggle(checked, onChange) {
  const input = h('input', { type: 'checkbox', checked: Boolean(checked), onchange: () => onChange && onChange(input.checked) });
  const el = h('label', { class: 'toggle' }, input, h('span', { class: 'track' }), h('span', { class: 'knob' }));
  el.getValue = () => input.checked;
  el.setValue = (v) => { input.checked = Boolean(v); };
  return el;
}
function ToggleRow(title, desc, toggle) {
  return h('div', { class: 'toggle-row' }, h('div', null, h('div', { class: 't' }, title), desc ? h('div', { class: 'd' }, desc) : null), toggle);
}
function Field(label, control, hint) {
  return h('div', { class: 'field' }, label ? h('label', null, label) : null, control, hint ? h('div', { class: 'hint' }, hint) : null);
}
function Loading(lines) {
  return h('div', { class: 'card enter' }, (Array.isArray(lines) ? lines : [lines]).map((l) => h('div', { class: 'loading-block', style: { padding: '10px', justifyContent: 'flex-start' } }, h('div', { class: 'spinner' }), l)));
}
function ErrorBanner(msg) { return h('div', { class: 'banner enter' }, msg); }

/* ---------------------------------------------------------------
 * TagInput — type → Enter → chip.  Unicode / Arabic safe.  No commas needed.
 * ------------------------------------------------------------- */
function TagInput({ values = [], placeholder = 'Type and press Enter…', onChange, allowSpaces = false, maxLength = 32 }) {
  let list = [...values];
  const err = h('div', { class: 'err-text' });
  const input = h('input', { placeholder, dir: 'auto', autocomplete: 'off', spellcheck: 'false', maxLength: allowSpaces ? 200 : maxLength });
  const box = h('div', { class: 'chipbox', onclick: (e) => { if (e.target === box) input.focus(); } });
  const keyOf = (s) => s.normalize('NFC').toLocaleLowerCase();
  const emit = () => onChange && onChange([...list]);
  function render() {
    box.replaceChildren(...list.map((v, i) => h('span', { class: 'chip', dir: 'auto', 'data-v': keyOf(v) },
      h('span', { class: 'lbl' }, v),
      h('button', { type: 'button', class: 'x', title: `Remove ${v}`, onclick: (e) => { e.stopPropagation(); list.splice(i, 1); render(); emit(); } }, '×'))), input);
  }
  function add(raw) {
    const parts = allowSpaces ? [raw] : String(raw).split(/\s+/u);
    let changed = false;
    for (let p of parts) {
      p = p.normalize('NFC').replace(/[\u200B-\u200F\u202A-\u202E\u2066-\u2069\uFEFF]/g, '').trim();
      if (!p) continue;
      if (list.some((x) => keyOf(x) === keyOf(p))) { flash(p); continue; }
      list.push(p); changed = true;
    }
    if (changed) { render(); emit(); setError(''); }
  }
  function flash(v) { const c = box.querySelector(`[data-v="${CSS.escape(keyOf(v))}"]`); if (c) { c.style.animation = 'none'; void c.offsetWidth; c.style.animation = ''; } }
  function setError(msg, alias) {
    err.textContent = msg || '';
    box.style.borderColor = msg ? 'rgba(248,113,113,.6)' : '';
    if (alias) { const c = box.querySelector(`[data-v="${CSS.escape(keyOf(alias))}"]`); if (c) { c.style.background = 'rgba(248,113,113,.25)'; c.style.borderColor = 'rgba(248,113,113,.6)'; } }
  }
  input.addEventListener('keydown', (e) => {
    if (e.isComposing || e.keyCode === 229) return;
    if (e.key === 'Enter' || (!allowSpaces && e.key === ' ') || (e.key === 'Tab' && input.value.trim())) {
      e.preventDefault(); add(input.value); input.value = '';
    } else if (e.key === 'Backspace' && !input.value && list.length) {
      list.pop(); render(); emit();
    }
  });
  input.addEventListener('paste', (e) => {
    const text = (e.clipboardData || window.clipboardData).getData('text');
    if (/[\n\r]/.test(text) || (!allowSpaces && /\s/.test(text.trim()))) { e.preventDefault(); text.split(/[\n\r]+/).forEach((l) => add(l)); }
  });
  input.addEventListener('focus', () => box.classList.add('focus'));
  input.addEventListener('blur', () => { box.classList.remove('focus'); if (input.value.trim()) { add(input.value); input.value = ''; } });
  render();
  const wrap = h('div', { class: 'field' }, box, err);
  wrap.getValue = () => { if (input.value.trim()) { add(input.value); input.value = ''; } return [...list]; };
  wrap.setValue = (v) => { list = [...v]; render(); };
  wrap.setError = setError;
  return wrap;
}

/* ---------------------------------------------------------------
 * Select (single / multi) for REAL Discord roles & channels.
 * The dropdown is appended to <body> with position:fixed and z-index 10000, so no card,
 * backdrop-filter stacking context or overlay can clip it or swallow its clicks.
 * Mouse (mousedown keeps focus, click selects), keyboard (↑ ↓ Enter Esc Backspace) and search.
 * ------------------------------------------------------------- */
function Select({ source, values = [], multiple = true, placeholder, emptyText = 'Nothing available.', loadingText = 'Loading…', filter, onChange, kind = 'role' }) {
  let vals = (Array.isArray(values) ? values : [values]).filter(Boolean).map(String);
  let dd = null; let hl = 0; let shown = [];
  const input = h('input', { placeholder: placeholder || (kind === 'role' ? 'Search roles…' : 'Search channels…'), dir: 'auto', autocomplete: 'off', spellcheck: 'false', role: 'combobox', 'aria-expanded': 'false' });
  const caret = h('span', { class: 'caret' }, '▾');
  const box = h('div', { class: 'chipbox', style: { cursor: 'pointer' } });
  const emit = () => onChange && onChange(multiple ? [...vals] : (vals[0] || ''));

  const all = () => (source.status === 'ready' ? source.items.filter(filter || (() => true)) : []);
  const byId = (id) => (source.items || []).find((i) => i.id === id);

  function label(item) {
    if (kind === 'role') return [h('span', { class: 'sw', style: { background: item.color || '#99aab5' } }), h('span', { class: 'lbl' }, item.name)];
    const icon = { voice: '🔊', stage: '🎙️', category: '📁', forum: '💬', announcement: '📢' }[item.type] || '#';
    return [h('span', { style: { opacity: 0.7 } }, icon), h('span', { class: 'lbl' }, item.name)];
  }
  function renderChips() {
    const chips = vals.map((id) => {
      const it = byId(id);
      return h('span', { class: 'chip' },
        it ? label(it) : h('span', { class: 'lbl' }, source.status === 'loading' ? 'Loading…' : `Unknown (${id})`),
        h('button', { type: 'button', class: 'x', title: 'Remove', onmousedown: (e) => { e.preventDefault(); e.stopPropagation(); }, onclick: (e) => { e.stopPropagation(); vals = vals.filter((v) => v !== id); renderChips(); if (dd) renderDD(); emit(); } }, '×'));
    });
    input.placeholder = !multiple && vals.length ? '' : (placeholder || (kind === 'role' ? 'Search roles…' : 'Search channels…'));
    box.replaceChildren(...chips, input, caret);
  }
  function position() {
    if (!dd) return;
    const r = box.getBoundingClientRect();
    const below = window.innerHeight - r.bottom;
    dd.style.left = `${Math.max(8, r.left)}px`;
    dd.style.width = `${Math.max(220, r.width)}px`;
    if (below < 240 && r.top > below) { dd.style.top = 'auto'; dd.style.bottom = `${window.innerHeight - r.top + 6}px`; dd.style.maxHeight = `${Math.min(300, r.top - 16)}px`; }
    else { dd.style.bottom = 'auto'; dd.style.top = `${r.bottom + 6}px`; dd.style.maxHeight = `${Math.min(300, below - 16)}px`; }
  }
  function outside(e) { if (box.contains(e.target) || (dd && dd.contains(e.target))) return; close(); }
  function open() {
    if (dd) return;
    dd = h('div', { class: 'dropdown', role: 'listbox', onmousedown: (e) => e.preventDefault() });
    document.body.appendChild(dd);
    box.classList.add('focus'); input.setAttribute('aria-expanded', 'true');
    hl = 0; renderDD(); position();
    window.addEventListener('scroll', position, true);
    window.addEventListener('resize', position);
    document.addEventListener('mousedown', outside, true);
  }
  function close() {
    if (!dd) return;
    dd.remove(); dd = null;
    box.classList.remove('focus'); input.setAttribute('aria-expanded', 'false');
    input.value = '';
    window.removeEventListener('scroll', position, true);
    window.removeEventListener('resize', position);
    document.removeEventListener('mousedown', outside, true);
  }
  function renderDD() {
    if (!dd) return;
    if (source.status === 'loading') { dd.replaceChildren(h('div', { class: 'dd-empty' }, h('div', { class: 'row', style: { justifyContent: 'center' } }, h('div', { class: 'spinner' }), loadingText))); return; }
    if (source.status === 'error') { dd.replaceChildren(h('div', { class: 'dd-empty', style: { color: '#fca5a5' } }, source.error || 'Could not load data from Discord.')); return; }
    const items = all();
    if (!items.length) { dd.replaceChildren(h('div', { class: 'dd-empty' }, emptyText)); return; }
    const q = input.value.trim().toLocaleLowerCase();
    shown = q ? items.filter((i) => i.name.toLocaleLowerCase().includes(q) || i.id === q) : items;
    if (!shown.length) { dd.replaceChildren(h('div', { class: 'dd-empty' }, 'No matches.')); return; }
    hl = Math.min(hl, shown.length - 1);
    const kids = []; let group;
    shown.forEach((it, i) => {
      if (kind === 'channel' && it.type !== 'category' && (it.parentName || '') !== group) { group = it.parentName || ''; kids.push(h('div', { class: 'dd-group' }, group || 'No category')); }
      const sel = vals.includes(it.id);
      kids.push(h('div', {
        class: `dd-item${sel ? ' sel' : ''}${i === hl ? ' hl' : ''}`, role: 'option', 'aria-selected': String(sel), 'data-i': String(i),
        onmousedown: (e) => e.preventDefault(),
        onclick: (e) => { e.stopPropagation(); choose(it.id); },
        onmousemove: () => { if (hl !== i) { hl = i; markHL(); } },
      }, label(it), sel ? h('span', { class: 'check' }, '✓') : (it.meta ? h('span', { class: 'meta' }, it.meta) : null)));
    });
    dd.replaceChildren(...kids);
  }
  function markHL() {
    if (!dd) return;
    dd.querySelectorAll('.dd-item').forEach((el) => el.classList.toggle('hl', Number(el.dataset.i) === hl));
    const cur = dd.querySelector('.dd-item.hl'); if (cur) cur.scrollIntoView({ block: 'nearest' });
  }
  function choose(id) {
    if (multiple) {
      vals = vals.includes(id) ? vals.filter((v) => v !== id) : [...vals, id];
      input.value = ''; renderChips(); renderDD(); position(); input.focus();
    } else {
      vals = vals[0] === id ? [] : [id];
      renderChips(); close(); input.blur();
    }
    emit();
  }
  box.addEventListener('mousedown', (e) => { if (e.target !== input) e.preventDefault(); input.focus(); open(); });
  input.addEventListener('focus', open);
  input.addEventListener('input', () => { hl = 0; open(); renderDD(); });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); if (!dd) open(); else { hl = Math.min(shown.length - 1, hl + 1); markHL(); } }
    else if (e.key === 'ArrowUp') { e.preventDefault(); hl = Math.max(0, hl - 1); markHL(); }
    else if (e.key === 'Enter') { e.preventDefault(); if (dd && shown[hl]) choose(shown[hl].id); else open(); }
    else if (e.key === 'Escape') { close(); }
    else if (e.key === 'Tab') { close(); }
    else if (e.key === 'Backspace' && !input.value && vals.length) { vals.pop(); renderChips(); renderDD(); emit(); }
  });
  input.addEventListener('blur', () => setTimeout(() => { if (dd && document.activeElement !== input) close(); }, 150));
  renderChips();
  if (source.status === 'loading' && source.promise) source.promise.then(() => { renderChips(); renderDD(); }).catch(() => {});
  const wrap = h('div', { class: 'field' }, box);
  wrap.getValue = () => (multiple ? [...vals] : (vals[0] || ''));
  wrap.setValue = (v) => { vals = (Array.isArray(v) ? v : [v]).filter(Boolean).map(String); renderChips(); };
  return wrap;
}

/* ---------------------------------------------------------------
 * ReasonEditor — list editor with Add / Edit / Delete, per command.
 * ------------------------------------------------------------- */
const DURATION_RE = /^(?:(?:\d+[smhdw])+|permanent|perm|forever|)$/i;
function fmtDur(d) { if (!d) return 'Default'; if (/^perm/i.test(d)) return 'Permanent'; return d; }
function ReasonEditor({ reasons = [], durations = true, onChange }) {
  let list = reasons.map((r) => ({ ...r }));
  let editing = -1;
  const root = h('div', { class: 'stack', style: { gap: '10px' } });
  const listEl = h('div', { class: 'reasons' });
  const err = h('div', { class: 'err-text' });
  const emit = () => onChange && onChange(list.map((r) => ({ ...r })));
  const validDur = (d) => DURATION_RE.test(String(d || '').replace(/\s+/g, ''));

  function rowForm(init, onSave, onCancel, saveLabel) {
    const l = h('input', { class: 'input', placeholder: 'Reason (e.g. Spamming)', value: init.label || '', dir: 'auto', maxLength: 100 });
    const d = durations ? h('input', { class: 'input', placeholder: 'Duration: 10m / 1h / 7d / permanent', value: init.duration || '' }) : null;
    const submit = () => {
      const label = l.value.trim(); const dur = d ? d.value.trim().toLowerCase().replace(/\s+/g, '') : '';
      if (!label) { err.textContent = 'Reason label cannot be empty.'; l.focus(); return; }
      if (d && !validDur(dur)) { err.textContent = 'Invalid duration. Use e.g. 10m, 1h, 2d, 1w or permanent.'; d.focus(); return; }
      err.textContent = ''; onSave({ label, duration: dur });
    };
    const key = (e) => { if (e.key === 'Enter') { e.preventDefault(); submit(); } if (e.key === 'Escape' && onCancel) onCancel(); };
    l.addEventListener('keydown', key); if (d) d.addEventListener('keydown', key);
    const form = h('div', { class: 'reason-form', style: durations ? null : { gridTemplateColumns: '1fr auto auto' } }, l, d, h('button', { type: 'button', class: 'btn primary sm', onclick: submit }, saveLabel), onCancel ? h('button', { type: 'button', class: 'btn sm', onclick: onCancel }, 'Cancel') : h('span'));
    form.focusFirst = () => l.focus();
    return form;
  }
  function render() {
    if (!list.length) listEl.replaceChildren(h('div', { class: 'empty' }, h('b', null, 'No reasons configured.'), 'Add your first reason.'));
    else listEl.replaceChildren(...list.map((r, i) => {
      if (i === editing) return rowForm(r, (v) => { list[i] = v; editing = -1; render(); emit(); }, () => { editing = -1; render(); }, 'Save');
      return h('div', { class: 'reason' },
        h('span', { style: { color: 'var(--faint)', fontSize: '12px', width: '18px' } }, String(i + 1)),
        h('span', { class: 'rl', dir: 'auto' }, r.label),
        durations ? h('span', { class: 'rd' }, fmtDur(r.duration)) : null,
        h('button', { type: 'button', class: 'btn sm', disabled: i === 0, title: 'Move up', onclick: () => { [list[i - 1], list[i]] = [list[i], list[i - 1]]; render(); emit(); } }, '↑'),
        h('button', { type: 'button', class: 'btn sm', onclick: () => { editing = i; render(); } }, 'Edit'),
        h('button', { type: 'button', class: 'btn sm danger', onclick: () => { list.splice(i, 1); if (editing === i) editing = -1; render(); emit(); } }, 'Delete'));
    }));
  }
  let addForm;
  const mkAdd = () => rowForm({}, (v) => {
    if (list.length >= 25) { err.textContent = 'Discord menus allow at most 25 reasons.'; return; }
    list.push(v); render(); emit(); const nf = mkAdd(); addForm.replaceWith(nf); addForm = nf; nf.focusFirst();
  }, null, 'Add Reason');
  addForm = mkAdd();
  render();
  root.append(listEl, addForm, err);
  root.getValue = () => list.map((r) => ({ ...r }));
  return root;
}

/* ---------------------------------------------------------------
 * SaveButton — "Saving..." → "✓ Changes saved" only after the server confirms.
 * ------------------------------------------------------------- */
function SaveButton(onSave, text = 'Save Changes') {
  const status = h('span', { class: 'save-status' });
  const btn = h('button', { type: 'button', class: 'btn primary' }, text);
  let t;
  btn.addEventListener('click', async () => {
    clearTimeout(t);
    btn.disabled = true; btn.textContent = 'Saving...'; status.className = 'save-status'; status.textContent = '';
    try {
      await onSave();
      status.className = 'save-status ok'; status.textContent = '✓ Changes saved';
      toast('Changes saved', 'ok', 2500);
      t = setTimeout(() => { status.textContent = ''; }, 4000);
    } catch (err) {
      status.className = 'save-status err'; status.textContent = 'Failed to save changes';
      toast(`Failed to save changes: ${err.message}`, 'err', 6000);
    } finally { btn.disabled = false; btn.textContent = text; }
  });
  return h('div', { class: 'save-row' }, status, btn);
}

function Modal({ title, body, confirmText = 'Confirm', danger = false, onConfirm }) {
  return new Promise((resolve) => {
    const close = (v) => { back.remove(); resolve(v); };
    const back = h('div', { class: 'modal-back', onmousedown: (e) => { if (e.target === back) close(false); } },
      h('div', { class: 'card modal' }, h('h2', null, title), h('div', { class: 'desc', style: { marginTop: '8px' } }, body),
        h('div', { class: 'row', style: { justifyContent: 'flex-end' } },
          h('button', { class: 'btn', onclick: () => close(false) }, 'Cancel'),
          h('button', { class: `btn ${danger ? 'danger' : 'primary'}`, onclick: async () => { if (onConfirm) await onConfirm(); close(true); } }, confirmText))));
    document.body.appendChild(back);
  });
}

function relTime(ts) {
  const s = Math.round((Date.now() - ts) / 1000);
  if (s < 60) return `${s}s ago`; if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`; return `${Math.floor(s / 86400)}d ago`;
}
function fmtNum(n) { return new Intl.NumberFormat('en-US').format(Number(n) || 0); }
function fmtUptime(ms) { const s = Math.floor(ms / 1000); const d = Math.floor(s / 86400); const hh = Math.floor((s % 86400) / 3600); const m = Math.floor((s % 3600) / 60); return d ? `${d}d ${hh}h` : hh ? `${hh}h ${m}m` : `${m}m`; }
