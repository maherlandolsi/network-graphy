'use strict';
(() => {
  const G = window.GraphQLUtils;
  const X = window.Exporters;
  const T = window.JsonTree;
  const $ = (sel) => document.querySelector(sel);
  const VERSION = (() => { try { return browser.runtime.getManifest().version; } catch (e) { return 'dev'; } })();

  // ======================================================================
  // helpers
  // ======================================================================

  function h(tag, props, ...children) {
    const el = document.createElement(tag);
    if (props) {
      for (const [k, v] of Object.entries(props)) {
        if (v == null || v === false) continue;
        if (k === 'class') el.className = v;
        else if (k === 'html') el.innerHTML = v; // only ever used with pre-escaped HTML
        else if (k === 'dataset') Object.assign(el.dataset, v);
        else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
        else el.setAttribute(k, v === true ? '' : v);
      }
    }
    for (const c of children.flat(Infinity)) {
      if (c == null || c === false) continue;
      el.append(c instanceof Node ? c : String(c));
    }
    return el;
  }

  const store = {
    get(k, d) { try { const v = localStorage.getItem(`ni.${k}`); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem(`ni.${k}`, JSON.stringify(v)); } catch (e) { /* ignore */ } },
  };

  function fmtBytes(n) {
    if (n == null || n < 0 || Number.isNaN(n)) return '—';
    if (n < 1024) return `${n} B`;
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(n < 10240 ? 1 : 0)} kB`;
    return `${(n / 1024 / 1024).toFixed(2)} MB`;
  }

  function fmtMs(ms) {
    if (ms == null || ms < 0 || Number.isNaN(ms)) return '—';
    if (ms < 1000) return `${Math.round(ms)} ms`;
    if (ms < 60000) return `${(ms / 1000).toFixed(2)} s`;
    return `${(ms / 60000).toFixed(1)} min`;
  }

  function fmtClock(t) {
    const d = new Date(t);
    const p = (n, w = 2) => String(n).padStart(w, '0');
    return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}.${p(d.getMilliseconds(), 3)}`;
  }

  function pretty(value) {
    if (typeof value === 'string') {
      const parsed = G.tryJson(value);
      return parsed === undefined ? value : JSON.stringify(parsed, null, 2);
    }
    return JSON.stringify(value, null, 2);
  }

  function safeDecode(v) {
    try { return decodeURIComponent(String(v).replace(/\+/g, ' ')); } catch (e) { return v; }
  }

  function normalizeUrl(u) {
    try { return new URL(u).href; } catch (e) { return u; }
  }

  async function copyText(text) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch (e) {
      const ta = h('textarea', { style: 'position:fixed;opacity:0' });
      ta.value = text;
      document.body.append(ta);
      ta.select();
      const ok = document.execCommand('copy');
      ta.remove();
      return ok;
    }
  }

  let toastTimer;
  function toast(msg, kind = '') {
    let el = $('#toast');
    if (!el) { el = h('div', { id: 'toast', role: 'status' }); document.body.append(el); }
    el.textContent = msg;
    el.className = `show ${kind}`;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.className = ''; }, 2200);
  }

  async function copyWithToast(text, what = 'Copied') {
    if (text == null) return;
    if (await copyText(text)) toast(what);
    else toast('Copy failed', 'error');
  }

  function copyBtn(label, getText) {
    const btn = h('button', { class: 'small-btn', title: label }, label);
    btn.addEventListener('click', async (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      const text = typeof getText === 'function' ? getText() : getText;
      if (text == null) return;
      if (await copyText(text)) {
        btn.textContent = 'Copied';
        btn.classList.add('done');
        setTimeout(() => { btn.textContent = label; btn.classList.remove('done'); }, 1200);
      }
    });
    return btn;
  }

  function section(title, content, { open = true, actions = [] } = {}) {
    return h('details', { class: 'section', open },
      h('summary', null, h('span', null, title), h('span', { class: 'spacer' }), actions),
      content);
  }

  function kvTable(rows) {
    return h('table', { class: 'kv' }, h('tbody', null,
      rows.map(([k, v]) => h('tr', null, h('td', null, k), h('td', null, v == null ? '' : String(v))))));
  }

  function codeBlock(html) {
    return h('pre', { class: 'code', html });
  }

  const MAX_HIGHLIGHT = 1_000_000;
  function jsonBlock(text) {
    return codeBlock(text.length > MAX_HIGHLIGHT ? G.escapeHtml(text) : G.highlightJson(text));
  }

  function download(filename, text, mime = 'application/json') {
    const url = URL.createObjectURL(new Blob([text], { type: mime }));
    const a = h('a', { href: url, download: filename, style: 'display:none' });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
  }

  function stamp() {
    const d = new Date();
    const p = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
  }

  // ---------- popup menu ----------

  let openMenu = null;
  function closeMenu() {
    if (openMenu) { openMenu.remove(); openMenu = null; }
  }
  /** items: [{ label, action, disabled, checked, hint } | '-'] */
  function showMenu(x, y, items, owner = null) {
    closeMenu();
    const menu = h('div', { class: 'menu', role: 'menu' }, items.filter(Boolean).map((it) => (it === '-'
      ? h('div', { class: 'menu-sep' })
      : h('button', {
        class: 'menu-item',
        role: it.checked !== undefined ? 'menuitemcheckbox' : 'menuitem',
        'aria-checked': it.checked !== undefined ? String(!!it.checked) : null,
        disabled: it.disabled,
        onclick: (ev) => { ev.stopPropagation(); closeMenu(); if (it.action) it.action(); },
      },
      h('span', { class: 'menu-check' }, it.checked ? '✓' : ''),
      h('span', { class: 'menu-label' }, it.label),
      it.hint ? h('span', { class: 'menu-hint' }, it.hint) : null))));
    document.body.append(menu);
    const r = menu.getBoundingClientRect();
    menu.style.left = `${Math.max(4, Math.min(x, innerWidth - r.width - 4))}px`;
    menu.style.top = `${y + r.height > innerHeight - 4 ? Math.max(4, y - r.height) : y}px`;
    menu._owner = owner;
    openMenu = menu;
    menu.querySelector('.menu-item:not([disabled])')?.focus();
  }
  function menuButton(btn, itemsFn) {
    btn.addEventListener('click', (ev) => {
      ev.stopPropagation();
      if (openMenu && openMenu._owner === btn) { closeMenu(); return; }
      const r = btn.getBoundingClientRect();
      showMenu(r.left, r.bottom + 2, itemsFn(), btn);
    });
  }
  document.addEventListener('mousedown', (ev) => {
    if (!openMenu) return;
    if (openMenu.contains(ev.target) || (openMenu._owner && openMenu._owner.contains(ev.target))) return;
    closeMenu();
  }, true);
  window.addEventListener('blur', closeMenu);

  // ======================================================================
  // state
  // ======================================================================

  const params = new URLSearchParams(location.search);
  const tabId = params.get('tab') ?? browser.devtools?.inspectedWindow?.tabId;
  const channel = new BroadcastChannel(`network-plus-${tabId}`);

  const DUP_WINDOW_MS = 5000;

  const state = {
    records: [],
    byId: new Map(),
    selectedId: null,
    filter: '',
    type: store.get('type', 'all'),
    opFilter: '',
    bookmarkedOnly: false,
    hideOptions: store.get('hideOptions', true),
    preserveLog: store.get('preserveLog', false),
    tab: 'headers',
    view: 'record', // 'record' | 'saved'
    pinnedHeaders: store.get('pinnedHeaders', []).map((n) => String(n).toLowerCase()),
    bookmarks: new Set(store.get('bookmarks', [])),
    saved: store.get('saved', []),
    savedSelected: null,
    savedDrafts: new Map(),
    sort: store.get('sort', null), // { key, dir: 1 | -1 }
    columns: Object.assign({ hidden: {}, widths: {} }, store.get('columns', {})),
    responseView: store.get('responseView', 'tree'),
    treeSearch: '', // kept while you move between requests, so you can compare the same field
    msgFilter: '',
    range: { min: Infinity, max: -Infinity },
    dupIndex: new Map(),
    drafts: new Map(), // record id -> Edit & Resend draft
    pendingResend: null,
    resendSeq: 0,
    resendCallbacks: new Map(),
    importSeq: 0,
  };

  const els = {
    list: $('#list'),
    listHead: $('#listHead'),
    rows: $('#rows'),
    empty: $('#empty'),
    main: $('#main'),
    details: $('#details'),
    splitter: $('#splitter'),
    detailBody: $('#detailBody'),
    detailTitle: $('#detailTitle'),
    statusbar: $('#statusbar'),
    filter: $('#filter'),
    opFilter: $('#opFilter'),
    bookmarkedOnly: $('#bookmarkedOnly'),
    hideOptions: $('#hideOptions'),
    preserveLog: $('#preserveLog'),
    savedBtn: $('#savedBtn'),
  };

  // ======================================================================
  // record preparation
  // ======================================================================

  const TEXT_MIME = /^text\/|json|xml|javascript|ecmascript|graphql|x-www-form-urlencoded|svg|csv/i;

  function decodeBody(rec) {
    if (rec.content == null) return null;
    const mime = (rec.entry.response?.content?.mimeType || '').split(';')[0].trim();
    if (rec.encoding === 'base64') {
      if (!TEXT_MIME.test(mime)) return { mime, base64: rec.content };
      try {
        const bin = atob(rec.content);
        const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
        return { mime, text: new TextDecoder('utf-8').decode(bytes) };
      } catch (e) {
        return { mime, base64: rec.content };
      }
    }
    return { mime, text: rec.content };
  }

  const RESOURCE_TYPES = {
    xhr: 'xhr', fetch: 'xhr', script: 'js', stylesheet: 'css', image: 'img', img: 'img',
    imageset: 'img', font: 'font', document: 'doc', main_frame: 'doc', sub_frame: 'doc',
    media: 'media', websocket: 'ws', eventsource: 'ws',
  };

  function classify(rec) {
    if (rec.socket) return 'ws';
    const e = rec.entry;
    const rt = String(e._resourceType || '').toLowerCase();
    if (RESOURCE_TYPES[rt]) return RESOURCE_TYPES[rt];
    const mime = (e.response?.content?.mimeType || '').toLowerCase();
    const path = rec.path.toLowerCase();
    if (/^image\//.test(mime) || /\.(png|jpe?g|gif|webp|avif|svg|ico)$/.test(path)) return 'img';
    if (/javascript|ecmascript/.test(mime) || /\.m?js$/.test(path)) return 'js';
    if (/css/.test(mime) || /\.css$/.test(path)) return 'css';
    if (/font|woff|ttf|otf/.test(mime) || /\.(woff2?|ttf|otf|eot)$/.test(path)) return 'font';
    if (/html/.test(mime)) return 'doc';
    if (/^(video|audio)\//.test(mime)) return 'media';
    if (e.response?.status === 101) return 'ws';
    if (/json|xml|text\/plain|graphql|event-stream/.test(mime)) return 'xhr';
    return 'other';
  }

  function transferSize(e) {
    const r = e.response || {};
    if (typeof r._transferSize === 'number' && r._transferSize >= 0) return r._transferSize;
    const body = r.bodySize >= 0 ? r.bodySize : r.content?.size;
    if (body == null || body < 0) return null;
    return body + (r.headersSize > 0 ? r.headersSize : 0);
  }

  function opLabel(op) {
    return op.name || (op.rootFields.length ? op.rootFields.join(', ') : '(anonymous)');
  }

  function requestName(r) {
    if (r.gql && r.gql.operations.length) return r.gql.operations.map(opLabel).join(', ');
    return `${displayMethod(r)} ${r.path}`;
  }

  function displayMethod(r) {
    return r.socket ? r.socket.kind.toUpperCase() : r.method;
  }

  function bookmarkKey(r) {
    if (r.gql && r.gql.operations.length) return `gql:${r.gql.operations.map(opLabel).join(',')}`;
    let base = r.url;
    try { const u = new URL(r.url); base = u.origin + u.pathname; } catch (e) { /* keep */ }
    return `${displayMethod(r)} ${base}`;
  }

  function updateSearchText(rec) {
    const gqlTerms = rec.gql ? rec.gql.operations.flatMap((o) => [o.name, o.type, ...o.rootFields]) : [];
    rec.searchText = [rec.url, displayMethod(rec), rec.status, ...gqlTerms].filter(Boolean).join(' ').toLowerCase();
  }

  /** GraphQL-over-WebSocket bookkeeping for one message (operation names, errors). */
  function processSocketMessage(rec, m) {
    if (m.data == null || m._gql !== undefined) return;
    m._gql = G.parseSocketMessage(m.data);
    const p = m._gql;
    if (!p) return;
    if (p.op && p.id != null) {
      rec.socket.opsById[p.id] = p.op;
      const key = `${p.op.type}:${opLabel(p.op)}`;
      if (!rec.socket.opKeys.has(key)) {
        rec.socket.opKeys.add(key);
        rec.gql = rec.gql || { batched: false, socket: true, operations: [] };
        rec.gql.operations.push(p.op);
        updateSearchText(rec);
      }
    }
    if (p.errors.length) rec.gqlErrors.push(...p.errors);
  }

  function prepare(rec) {
    const e = rec.entry;
    rec.method = e.request.method;
    rec.url = e.request.url;
    let u = null;
    try { u = new URL(rec.url); } catch (err) { /* data: or invalid */ }
    rec.host = u ? u.host : '';
    rec.path = u ? u.pathname : rec.url;
    rec.fileName = u ? (u.pathname.split('/').filter(Boolean).pop() || u.host || rec.url) + u.search : rec.url.slice(0, 200);
    rec.status = e.response?.status || 0;
    rec.start = Date.parse(e.startedDateTime) || Date.now();
    rec.duration = typeof e.time === 'number' && e.time >= 0 ? e.time : null;
    rec.gqlErrors = [];
    if (rec.socket) {
      rec.socket.opsById = {};
      rec.socket.opKeys = new Set();
      rec.gql = G.extractFromEntry(e); // EventSource GraphQL via ?query=
      for (const m of rec.socket.messages) processSocketMessage(rec, m);
      const last = rec.socket.messages[rec.socket.messages.length - 1];
      rec.duration = last ? Math.max(0, last.time - rec.start) : 0;
    } else {
      rec.gql = G.extractFromEntry(e);
    }
    rec.end = rec.start + (rec.duration || 0);
    rec.type = classify(rec);
    rec.body = decodeBody(rec);
    if (rec.gql && !rec.socket && rec.body?.text) rec.gqlErrors = G.responseErrors(rec.body.text);
    rec.transfer = rec.socket ? null : transferSize(e);
    updateSearchText(rec);
    detectDuplicate(rec);
  }

  /** Same GraphQL operation + variables sent again within DUP_WINDOW_MS of the previous one. */
  function detectDuplicate(rec) {
    if (!rec.gql || rec.socket || rec.method === 'OPTIONS') return;
    const key = rec.url.split('?')[0] + '|' + rec.gql.operations.map((o) => `${opLabel(o)}:${JSON.stringify(o.variables ?? null)}:${o.query || JSON.stringify(o.extensions ?? null)}`).join(';');
    const prev = state.dupIndex.get(key);
    if (prev && rec.start - prev.last <= DUP_WINDOW_MS && rec.start >= prev.last) {
      prev.count++;
      prev.last = rec.start;
      rec.dup = { count: prev.count };
    } else {
      state.dupIndex.set(key, { last: rec.start, count: 1 });
    }
  }

  // ======================================================================
  // columns, filtering, sorting
  // ======================================================================

  const COLUMNS = [
    { key: 'status', label: 'Status', width: 56, sort: (r) => r.status, render: statusCell },
    { key: 'method', label: 'Method', width: 62, sort: (r) => displayMethod(r), render: (r) => displayMethod(r), cls: (r) => `m-${displayMethod(r).toLowerCase()}` },
    { key: 'name', label: 'Name', flex: true, sort: (r) => requestName(r).toLowerCase(), render: nameCell },
    { key: 'domain', label: 'Domain', width: 150, hidden: true, sort: (r) => r.host, render: (r) => r.host },
    { key: 'type', label: 'Type', width: 70, sort: (r) => typeLabel(r), render: (r) => typeLabel(r) },
    { key: 'size', label: 'Size', width: 72, align: 'right', sort: (r) => (r.socket ? r.socket.messages.length : r.transfer ?? -1), render: sizeCell },
    { key: 'time', label: 'Time', width: 66, align: 'right', sort: (r) => r.duration ?? -1, render: (r) => fmtMs(r.duration) },
    { key: 'waterfall', label: 'Waterfall', width: 200, sort: (r) => r.start, render: waterfallCell },
  ];
  const CORE_COLUMNS = new Set(['status', 'method', 'name']);

  function isColumnVisible(c) {
    if (c.key === 'name') return true;
    const v = state.columns.hidden[c.key];
    return v === undefined ? !c.hidden : !v;
  }
  const visibleColumns = () => COLUMNS.filter(isColumnVisible);

  function gridTemplate(cols) {
    return cols.map((c) => (c.flex ? 'minmax(160px, 1fr)' : `${state.columns.widths[c.key] || c.width}px`)).join(' ');
  }

  function applyGrid() {
    els.list.style.setProperty('--grid', gridTemplate(visibleColumns()));
    els.list.style.setProperty('--grid-compact', gridTemplate(COLUMNS.filter((c) => CORE_COLUMNS.has(c.key))));
  }

  function typeLabel(r) {
    if (r.socket) return r.socket.kind === 'sse' ? 'eventsource' : 'websocket';
    return r.gql ? 'graphql' : r.type;
  }

  function isVisible(r) {
    if (state.hideOptions && r.method === 'OPTIONS') return false;
    if (state.type === 'graphql') { if (!r.gql) return false; }
    else if (state.type === 'xhr') { if (r.type !== 'xhr' && !(r.gql && !r.socket)) return false; }
    else if (state.type !== 'all' && r.type !== state.type) return false;
    if (state.bookmarkedOnly && !state.bookmarks.has(bookmarkKey(r))) return false;
    if (state.opFilter && !(r.gql && r.gql.operations.some((o) => opLabel(o) === state.opFilter))) return false;
    if (state.filter) {
      const terms = state.filter.toLowerCase().split(/\s+/).filter(Boolean);
      for (const t of terms) {
        if (t.startsWith('-')) { if (t.length > 1 && r.searchText.includes(t.slice(1))) return false; }
        else if (!r.searchText.includes(t)) return false;
      }
    }
    return true;
  }

  function orderedVisible() {
    const list = state.records.filter(isVisible);
    const s = state.sort;
    const col = s && COLUMNS.find((c) => c.key === s.key);
    if (!col) return list;
    return list
      .map((r, i) => ({ r, i, v: col.sort(r) }))
      .sort((a, b) => {
        if (a.v === b.v) return a.i - b.i;
        if (a.v == null) return 1;
        if (b.v == null) return -1;
        return (a.v < b.v ? -1 : 1) * s.dir;
      })
      .map((x) => x.r);
  }

  // ======================================================================
  // list rendering
  // ======================================================================

  function statusCell(r) {
    if (r.socket) {
      const s = r.socket.state;
      if (s === 'open') return r.status || '101';
      return s === 'closed' && r.socket.closeCode ? `closed ${r.socket.closeCode}` : s;
    }
    return !r.status ? '(failed)' : r.status;
  }

  function sizeCell(r) {
    if (r.socket) return `${r.socket.messages.length} msg`;
    return fmtBytes(r.transfer);
  }

  function opBadge(op) {
    return h('span', { class: `badge op-${op.type}`, title: op.persisted ? `${op.type} (persisted)` : op.type },
      op.type === 'unknown' ? '?' : op.type[0].toUpperCase());
  }

  function nameCell(r) {
    const bookmarked = state.bookmarks.has(bookmarkKey(r));
    const parts = [
      h('button', {
        class: `row-star${bookmarked ? ' on' : ''}`,
        title: bookmarked ? 'Remove bookmark' : 'Bookmark this request / operation',
        tabindex: '-1',
      }, bookmarked ? '★' : '☆'),
    ];
    if (r.resent) parts.push(h('span', { class: 'badge resent', title: 'Resent from Network+' }, '↻'));
    if (r.imported) parts.push(h('span', { class: 'badge imported', title: 'Imported from a HAR file' }, 'HAR'));
    if (r.socket && r.socket.state === 'open') parts.push(h('span', { class: 'live-dot', title: 'Connection open' }));
    if (!r.gql || !r.gql.operations.length) {
      parts.push(h('span', { class: 'file' }, r.fileName));
      if (r.host) parts.push(h('span', { class: 'url-dim' }, r.host));
      return parts;
    }
    const ops = r.gql.operations;
    if (ops.length > 1) parts.push(h('span', { class: 'badge batch', title: r.socket ? `${ops.length} operations on this connection` : `Batched request (${ops.length} operations)` }, `×${ops.length}`));
    ops.forEach((op, i) => {
      if (i) parts.push(h('span', { class: 'sep' }, ','));
      parts.push(opBadge(op), h('span', { class: 'op-name' }, opLabel(op)));
      if (op.name && op.rootFields.length) parts.push(h('span', { class: 'op-fields' }, op.rootFields.join(', ')));
    });
    if (r.gqlErrors.length) {
      parts.push(h('span', { class: 'badge err', title: r.gqlErrors.map((x) => x?.message).filter(Boolean).join('\n') },
        `${r.gqlErrors.length} error${r.gqlErrors.length > 1 ? 's' : ''}`));
    }
    if (r.dup) {
      parts.push(h('span', { class: 'badge dup', title: `Same operation and variables sent ${r.dup.count} times, each within ${DUP_WINDOW_MS / 1000}s of the previous call` }, `dup ×${r.dup.count}`));
    }
    parts.push(h('span', { class: 'url-dim' }, r.host + r.path));
    return parts;
  }

  function waterfallStyle(r) {
    const { min, max } = state.range;
    const span = Math.max(1, max - min);
    const left = ((r.start - min) / span) * 100;
    const width = Math.max(0.4, (((r.end ?? r.start) - r.start) / span) * 100);
    return `left:${Math.min(99.6, Math.max(0, left))}%;width:${Math.min(100 - Math.max(0, left), width)}%`;
  }

  function waterfallCell(r) {
    return h('div', { class: 'wf-track', title: `Start +${fmtMs(r.start - state.range.min)} · ${fmtMs(r.duration)}` },
      h('div', { class: `wf-bar wf-${r.gql ? 'graphql' : r.type}`, style: waterfallStyle(r) }));
  }

  function buildRow(r) {
    const classes = ['row'];
    if (r.id === state.selectedId && state.view === 'record') classes.push('selected');
    const failed = r.socket ? r.socket.error : !r.status;
    if (failed || r.status >= 400 || r.gqlErrors.length) classes.push('error');
    const row = h('div', { class: classes.join(' '), dataset: { id: r.id }, title: r.url });
    for (const c of visibleColumns()) {
      let cls = `c-${c.key}`;
      if (!CORE_COLUMNS.has(c.key)) cls += ' col-extra';
      if (c.align === 'right') cls += ' right';
      if (c.cls) cls += ` ${c.cls(r)}`;
      row.append(h('div', { class: cls }, c.render(r)));
    }
    return row;
  }

  function renderHead() {
    els.listHead.replaceChildren(...visibleColumns().map((c) => {
      const sorted = state.sort && state.sort.key === c.key;
      const cell = h('div', {
        class: `c-${c.key}${CORE_COLUMNS.has(c.key) ? '' : ' col-extra'}${c.align === 'right' ? ' right' : ''}${sorted ? ' sorted' : ''}`,
        dataset: { key: c.key },
        title: 'Click to sort · right-click for columns',
      },
      h('span', { class: 'head-label' }, c.label),
      sorted ? h('span', { class: 'sort-arrow' }, state.sort.dir > 0 ? '▲' : '▼') : null,
      c.flex ? null : h('span', { class: 'col-resizer', dataset: { key: c.key } }));
      return cell;
    }));
  }

  function renderAll() {
    applyGrid();
    renderHead();
    const frag = document.createDocumentFragment();
    for (const r of orderedVisible()) frag.append(buildRow(r));
    els.rows.replaceChildren(frag);
    updateStatus();
  }

  let renderAllQueued = false;
  function scheduleRenderAll() {
    if (renderAllQueued) return;
    renderAllQueued = true;
    requestAnimationFrame(() => { renderAllQueued = false; renderAll(); });
  }

  const rowUpdates = new Set();
  let rowUpdateQueued = false;
  function scheduleRowUpdate(rec) {
    rowUpdates.add(rec.id);
    if (rowUpdateQueued) return;
    rowUpdateQueued = true;
    requestAnimationFrame(() => {
      rowUpdateQueued = false;
      for (const id of rowUpdates) {
        const rec2 = state.byId.get(id);
        const old = els.rows.querySelector(`.row[data-id="${CSS.escape(String(id))}"]`);
        if (rec2 && old) old.replaceWith(buildRow(rec2));
      }
      rowUpdates.clear();
      updateStatus();
    });
  }

  let waterfallQueued = false;
  function scheduleWaterfall() {
    if (waterfallQueued || !isColumnVisible(COLUMNS.find((c) => c.key === 'waterfall'))) return;
    waterfallQueued = true;
    requestAnimationFrame(() => {
      waterfallQueued = false;
      for (const row of els.rows.children) {
        const r = state.byId.get(Number(row.dataset.id));
        const bar = row.querySelector('.wf-bar');
        if (r && bar) bar.setAttribute('style', waterfallStyle(r));
      }
    });
  }

  function extendRange(rec) {
    let changed = false;
    if (rec.start < state.range.min) { state.range.min = rec.start; changed = true; }
    if ((rec.end ?? rec.start) > state.range.max) { state.range.max = rec.end ?? rec.start; changed = true; }
    return changed;
  }

  function isNearBottom() {
    const l = els.list;
    return l.scrollTop + l.clientHeight >= l.scrollHeight - 40;
  }

  function addRecord(rec, { batch = false } = {}) {
    if (state.byId.has(rec.id)) return false;
    try { prepare(rec); } catch (err) { console.error('Network+: failed to process entry', err); return false; }
    state.byId.set(rec.id, rec);
    const p = state.pendingResend;
    const isResent = !batch && p && Date.now() - p.at < 120000 && rec.method === p.method && normalizeUrl(rec.url) === p.url;
    if (isResent) { rec.resent = true; state.pendingResend = null; }
    const rangeChanged = extendRange(rec);

    const last = state.records[state.records.length - 1];
    const appended = !last || last.id < rec.id;
    if (appended) state.records.push(rec);
    else state.records.splice(state.records.findIndex((r) => r.id > rec.id), 0, rec);

    if (!batch) {
      if (appended && !state.sort) {
        if (isVisible(rec)) {
          const stick = isNearBottom();
          els.rows.append(buildRow(rec));
          if (stick) els.list.scrollTop = els.list.scrollHeight;
        }
        updateStatus();
      } else {
        scheduleRenderAll();
      }
      if (rangeChanged) scheduleWaterfall();
      if (rec.gql) scheduleOpOptions();
    }

    if (isResent) {
      if (p.onMatch) p.onMatch(rec.id);
      if (p.autoSelect) {
        if (!isVisible(rec)) resetFilters();
        state.tab = 'response';
        select(rec.id, { scroll: true });
      }
    }
    return true;
  }

  function removeRecord(id) {
    const rec = state.byId.get(id);
    if (!rec) return;
    state.byId.delete(id);
    state.records = state.records.filter((r) => r !== rec);
    els.rows.querySelector(`.row[data-id="${CSS.escape(String(id))}"]`)?.remove();
    if (state.selectedId === id) closeDetails();
    updateStatus();
  }

  function resetFilters() {
    state.type = 'all';
    state.filter = '';
    state.opFilter = '';
    state.bookmarkedOnly = false;
    els.filter.value = '';
    syncControls();
    renderAll();
  }

  function updateStatus() {
    const total = state.records.length;
    let visible = 0;
    let transferred = 0;
    let options = 0;
    let gql = 0;
    let dups = 0;
    let sockets = 0;
    for (const r of state.records) {
      if (r.method === 'OPTIONS') options++;
      if (r.gql) gql++;
      if (r.dup) dups++;
      if (r.socket) sockets++;
      if (isVisible(r)) { visible++; transferred += r.transfer > 0 ? r.transfer : 0; }
    }
    const parts = [visible === total ? `${total} requests` : `${visible} / ${total} requests`, `${fmtBytes(transferred)} transferred`];
    if (gql) parts.push(`${gql} GraphQL`);
    if (dups) parts.push(`${dups} duplicate call${dups > 1 ? 's' : ''}`);
    if (sockets) parts.push(`${sockets} live connection${sockets > 1 ? 's' : ''}`);
    if (state.hideOptions && options) parts.push(`${options} OPTIONS hidden`);
    els.statusbar.textContent = parts.join('  |  ');
    els.empty.hidden = total > 0;
  }

  // ---------- operation filter dropdown ----------

  let opOptionsTimer = null;
  function scheduleOpOptions() {
    if (opOptionsTimer) return;
    opOptionsTimer = setTimeout(() => { opOptionsTimer = null; renderOpOptions(); }, 250);
  }

  function renderOpOptions() {
    const counts = new Map();
    for (const r of state.records) {
      if (!r.gql) continue;
      for (const op of r.gql.operations) {
        const label = opLabel(op);
        const c = counts.get(label) || { n: 0, type: op.type };
        c.n++;
        counts.set(label, c);
      }
    }
    if (state.opFilter && !counts.has(state.opFilter)) counts.set(state.opFilter, { n: 0, type: 'unknown' });
    const sorted = [...counts.entries()].sort((a, b) => a[0].localeCompare(b[0]));
    const prefix = { query: 'Q', mutation: 'M', subscription: 'S', unknown: '?' };
    els.opFilter.replaceChildren(
      h('option', { value: '' }, counts.size ? `All operations (${counts.size})` : 'All operations'),
      ...sorted.map(([label, c]) => h('option', { value: label }, `${prefix[c.type] || '?'}  ${label}  (${c.n})`)),
    );
    els.opFilter.value = state.opFilter;
    els.opFilter.classList.toggle('active', !!state.opFilter);
  }

  function setOpFilter(label) {
    state.opFilter = label;
    renderOpOptions();
    renderAll();
  }

  // ---------- bookmarks ----------

  function toggleBookmark(r) {
    const key = bookmarkKey(r);
    if (state.bookmarks.has(key)) state.bookmarks.delete(key); else state.bookmarks.add(key);
    store.set('bookmarks', [...state.bookmarks]);
    renderAll();
    if (state.selectedId === r.id && state.view === 'record' && state.tab === 'headers') renderDetails({ keepScroll: true });
  }

  function clearAll({ notify = true } = {}) {
    state.records = [];
    state.byId.clear();
    state.dupIndex.clear();
    state.range = { min: Infinity, max: -Infinity };
    if (state.view === 'record') closeDetails();
    renderAll();
    renderOpOptions();
    if (notify) channel.postMessage({ type: 'clear' });
  }

  // ======================================================================
  // details pane
  // ======================================================================

  function showDetailsPane() {
    els.details.hidden = false;
    els.splitter.hidden = false;
    els.main.classList.add('has-details');
  }

  function select(id, { scroll = false } = {}) {
    state.selectedId = id;
    state.view = 'record';
    for (const row of els.rows.querySelectorAll('.row.selected')) row.classList.remove('selected');
    const row = els.rows.querySelector(`.row[data-id="${CSS.escape(String(id))}"]`);
    if (row) {
      row.classList.add('selected');
      if (scroll) row.scrollIntoView({ block: 'nearest' });
    }
    showDetailsPane();
    renderDetails();
  }

  function closeDetails() {
    state.selectedId = null;
    state.view = 'record';
    for (const row of els.rows.querySelectorAll('.row.selected')) row.classList.remove('selected');
    els.details.hidden = true;
    els.splitter.hidden = true;
    els.main.classList.remove('has-details');
  }

  function hasPayload(r) {
    const req = r.entry.request;
    return !!((r.gql && !r.socket) || req.postData?.text || req.postData?.params?.length || req.queryString?.length);
  }

  function availableTabs(r) {
    if (r.socket) return ['headers', 'messages'];
    const tabs = ['headers'];
    if (hasPayload(r)) tabs.push('payload');
    tabs.push('response', 'timings', 'resend');
    return tabs;
  }

  function renderDetails({ keepScroll = false } = {}) {
    let content;
    const tabButtons = document.querySelectorAll('#tabs button[data-tab]');
    if (state.view === 'saved') {
      tabButtons.forEach((b) => { b.hidden = true; });
      els.detailTitle.hidden = false;
      els.detailTitle.textContent = `Saved requests (${state.saved.length})`;
      try { content = renderSavedPane(); } catch (err) { content = h('div', { class: 'note' }, `Failed to render: ${err.message}`); }
    } else {
      const r = state.byId.get(state.selectedId);
      if (!r) { closeDetails(); return; }
      els.detailTitle.hidden = true;
      const tabs = availableTabs(r);
      if (!tabs.includes(state.tab)) state.tab = r.socket ? 'messages' : 'headers';
      tabButtons.forEach((b) => {
        b.hidden = !tabs.includes(b.dataset.tab);
        b.classList.toggle('active', b.dataset.tab === state.tab);
        if (b.dataset.tab === 'payload') b.textContent = r.gql ? 'GraphQL' : 'Payload';
      });
      const render = {
        headers: renderHeaders, payload: renderPayload, response: renderResponse, timings: renderTimings,
        resend: renderResend, messages: renderMessages,
      }[state.tab];
      try { content = render(r); } catch (err) { console.error(err); content = h('div', { class: 'note' }, `Failed to render: ${err.message}`); }
    }
    const scroll = els.detailBody.scrollTop;
    const openState = keepScroll ? [...els.detailBody.querySelectorAll('details.section')].map((s) => s.open) : null;
    els.detailBody.replaceChildren(content);
    if (openState) els.detailBody.querySelectorAll('details.section').forEach((s, i) => { if (i < openState.length) s.open = openState[i]; });
    els.detailBody.scrollTop = keepScroll ? scroll : 0;
  }

  // ---------- copy / context actions ----------

  function copyItems(r) {
    if (r.socket) {
      return [
        { label: 'Copy URL', action: () => copyWithToast(r.url, 'URL copied') },
        { label: 'Copy all messages (JSON)', action: () => copyWithToast(JSON.stringify(r.socket.messages.map(({ _gql, ...m }) => m), null, 2), 'Messages copied') },
      ];
    }
    const req = r.entry.request;
    return [
      { label: 'Copy URL', action: () => copyWithToast(r.url, 'URL copied') },
      { label: 'Copy as cURL', action: () => copyWithToast(X.toCurl(req), 'cURL copied') },
      { label: 'Copy as fetch', action: () => copyWithToast(X.toFetch(req), 'fetch() copied') },
      {
        label: 'Copy as Postman collection',
        hint: 'paste into Postman → Import',
        action: () => copyWithToast(JSON.stringify(X.toPostmanCollection(requestName(r), [{ name: requestName(r), request: req, gql: r.gql }]), null, 2), 'Postman collection copied'),
      },
      { label: 'Copy response', disabled: r.body?.text == null, action: () => copyWithToast(r.body.text, 'Response copied') },
    ];
  }

  function recordMenu(r) {
    const bookmarked = state.bookmarks.has(bookmarkKey(r));
    const op = r.gql && r.gql.operations[0];
    return [
      ...copyItems(r),
      '-',
      r.socket ? null : { label: 'Edit & Resend', action: () => { state.tab = 'resend'; select(r.id); } },
      r.socket ? null : { label: 'Save request', action: () => saveRecordQuick(r) },
      { label: bookmarked ? 'Remove bookmark' : 'Bookmark', action: () => toggleBookmark(r) },
      op ? { label: `Show only “${opLabel(op)}”`, action: () => setOpFilter(opLabel(op)) } : null,
      '-',
      { label: 'Export this request as HAR', action: () => exportHar([r], requestName(r)) },
    ];
  }

  // ---------- Headers tab ----------

  function togglePinnedHeader(name) {
    const key = name.toLowerCase();
    const list = state.pinnedHeaders;
    const i = list.indexOf(key);
    if (i >= 0) list.splice(i, 1); else list.push(key);
    store.set('pinnedHeaders', list);
    renderDetails({ keepScroll: true });
  }

  /** Header table with pinned (bookmarked) names first, in the order they were pinned. */
  function headerTable(headers) {
    const rank = (name) => {
      const i = state.pinnedHeaders.indexOf(name.toLowerCase());
      return i < 0 ? Infinity : i;
    };
    const sorted = headers
      .map((x, idx) => ({ ...x, idx, rank: rank(x.name) }))
      .sort((a, b) => (a.rank - b.rank) || (a.idx - b.idx));
    return h('table', { class: 'kv headers' }, h('tbody', null, sorted.map((x) => {
      const pinned = x.rank !== Infinity;
      return h('tr', { class: pinned ? 'pinned' : null },
        h('td', null,
          h('button', {
            class: `pin-btn${pinned ? ' on' : ''}`,
            title: pinned ? `Unpin "${x.name}"` : `Pin "${x.name}" to the top of header lists`,
            'aria-pressed': pinned ? 'true' : 'false',
            onclick: () => togglePinnedHeader(x.name),
          }, pinned ? '★' : '☆'),
          x.name),
        h('td', null, x.value == null ? '' : String(x.value)));
    })));
  }

  function actionBar(r) {
    const copyMenuBtn = h('button', { class: 'small-btn' }, 'Copy ▾');
    menuButton(copyMenuBtn, () => copyItems(r));
    const bookmarked = state.bookmarks.has(bookmarkKey(r));
    return h('div', { class: 'toolbar-line' },
      copyMenuBtn,
      r.socket ? null : resendBtn(),
      r.socket ? null : h('button', { class: 'small-btn', onclick: () => saveRecordQuick(r) }, 'Save'),
      h('button', { class: `small-btn${bookmarked ? ' done' : ''}`, onclick: () => toggleBookmark(r) }, bookmarked ? '★ Bookmarked' : '☆ Bookmark'));
  }

  function renderHeaders(r) {
    const e = r.entry;
    const reqHeaders = e.request.headers || [];
    const resHeaders = e.response.headers || [];
    const general = [['Request URL', r.url], ['Request Method', displayMethod(r)]];
    if (r.socket) {
      general.push(['State', statusCell(r)]);
      if (r.socket.protocol) general.push(['Subprotocol', r.socket.protocol]);
      if (r.socket.closeReason) general.push(['Close reason', r.socket.closeReason]);
      general.push(['Messages', String(r.socket.messages.length)]);
    } else {
      general.push(['Status Code', r.status ? `${r.status} ${e.response.statusText || ''}` : '(failed)']);
    }
    if (e.serverIPAddress) general.push(['Remote Address', e.serverIPAddress]);
    if (e.response.httpVersion) general.push(['Version', e.response.httpVersion]);
    if (e.startedDateTime) general.push(['Started', new Date(e.startedDateTime).toLocaleTimeString()]);
    if (r.dup) general.push(['Duplicate', `Same operation & variables, call #${r.dup.count} in a row`]);

    return h('div', null,
      actionBar(r),
      section('General', kvTable(general)),
      r.gql && r.gql.operations.length ? section('GraphQL', kvTable(r.gql.operations.flatMap((op, i) => {
        const p = r.gql.operations.length > 1 ? `#${i + 1} ` : '';
        const rows = [[`${p}Operation`, `${op.type} ${op.name || '(anonymous)'}`]];
        if (op.rootFields.length) rows.push([`${p}Root fields`, op.rootFields.join(', ')]);
        if (op.persisted) rows.push([`${p}Persisted hash`, op.extensions?.persistedQuery?.sha256Hash || '(unknown)']);
        return rows;
      }))) : null,
      resHeaders.length || !r.socket ? section(`Response Headers (${resHeaders.length})`, headerTable(resHeaders)) : null,
      reqHeaders.length || !r.socket ? section(`Request Headers (${reqHeaders.length})`, headerTable(reqHeaders)) : null,
      r.socket && !reqHeaders.length ? h('div', { class: 'note' }, 'Handshake headers are shown in the built-in Network panel; Network+ captures the messages.') : null,
    );
  }

  // ---------- Payload tab ----------

  function renderGraphQLOp(op, i, total, { resend = true } = {}) {
    const formatted = op.query ? G.format(op.query) : null;
    const hasVars = op.variables !== undefined && op.variables !== null;
    const varsText = hasVars ? pretty(op.variables) : null;
    return h('div', { class: 'gql-op' },
      h('div', { class: 'gql-op-header' },
        total > 1 ? h('span', { class: 'muted' }, `#${i + 1}`) : null,
        opBadge(op),
        h('strong', null, op.name || '(anonymous)'),
        op.rootFields.length ? h('span', { class: 'muted' }, `→ ${op.rootFields.join(', ')}`) : null,
        h('span', { class: 'spacer' }),
        formatted ? copyBtn('Copy query', formatted) : null,
        hasVars ? copyBtn('Copy variables', varsText) : null,
        copyBtn('Copy JSON', () => JSON.stringify({ operationName: op.name || undefined, query: op.query || undefined, variables: op.variables, extensions: op.extensions }, null, 2)),
        resend ? resendBtn() : null),
      h('div', { class: 'gql-op-body' },
        formatted
          ? codeBlock(G.highlight(formatted))
          : h('div', { class: 'note' }, 'No query text — persisted query',
            op.extensions?.persistedQuery?.sha256Hash ? ` (sha256: ${op.extensions.persistedQuery.sha256Hash})` : ''),
        hasVars ? section('Variables', jsonBlock(varsText)) : null,
        op.extensions != null ? section('Extensions', jsonBlock(pretty(op.extensions)), { open: false }) : null));
  }

  function renderPayload(r) {
    const req = r.entry.request;
    const wrap = h('div');
    if (r.gql) {
      r.gql.operations.forEach((op, i) => wrap.append(renderGraphQLOp(op, i, r.gql.operations.length)));
      if (req.postData?.text) {
        wrap.append(section('Raw request body', codeBlock(G.escapeHtml(req.postData.text)), {
          open: false, actions: [copyBtn('Copy', req.postData.text)],
        }));
      }
      return wrap;
    }
    if (req.queryString?.length) {
      wrap.append(section('Query String Parameters', kvTable(req.queryString.map((x) => [x.name, safeDecode(x.value)]))));
    }
    if (req.postData?.params?.length) {
      wrap.append(section('Form Data', kvTable(req.postData.params.map((x) => [x.name, x.value ?? x.fileName ?? '']))));
    } else if (req.postData?.text) {
      const text = req.postData.text;
      const json = G.tryJson(text);
      wrap.append(section('Request Payload',
        json !== undefined ? jsonBlock(JSON.stringify(json, null, 2)) : codeBlock(G.escapeHtml(text)),
        { actions: [copyBtn('Copy', text)] }));
    }
    return wrap;
  }

  // ---------- Response tab (tree / raw) ----------

  function jsonView(json, text, { viewKey = 'responseView' } = {}) {
    const view = state[viewKey] || 'tree';
    const wrap = h('div');
    const onCopyPath = (p) => copyWithToast(p, `Path copied: ${p}`);
    let tree = null;

    const searchInput = h('input', {
      class: 'tree-search',
      type: 'search',
      spellcheck: 'false',
      placeholder: 'Search keys & values — sku, status=SHIPPED, =ACTIVE, edges.node.id',
      title: 'term: key or value contains term\nkey=value: both on the same field\n=value: values only · key=: keys only\na.b.c: match against the full path',
    });
    searchInput.value = state.treeSearch;
    const matchInfo = h('span', { class: 'muted match-info' });
    const copyMatches = h('button', { class: 'small-btn', hidden: true, title: 'Copy matches as { path: value } JSON' }, 'Copy matches');
    const box = h('div', { class: 'tree-box' });

    const buildTree = () => {
      tree = T.render(json, { expandDepth: 3, onCopyPath, query: state.treeSearch });
      if (!state.treeSearch && text.length < 20000) tree.expandAll(400); // small payloads: show everything
      box.replaceChildren(tree);
      const n = tree.matches ? tree.matches.length : 0;
      matchInfo.textContent = state.treeSearch
        ? `${n} match${n === 1 ? '' : 'es'}${tree.truncated ? ' (search stopped: very large response)' : ''}`
        : 'Click a key to copy its path';
      matchInfo.classList.toggle('no-match', !!state.treeSearch && !n);
      copyMatches.hidden = !n;
    };

    copyMatches.addEventListener('click', () => {
      if (!tree || !tree.matches) return;
      const out = {};
      for (const m of tree.matches) out[m.path] = m.value;
      copyWithToast(JSON.stringify(out, null, 2), `${tree.matches.length} matches copied`);
    });

    let searchTimer;
    searchInput.addEventListener('input', () => {
      clearTimeout(searchTimer);
      searchTimer = setTimeout(() => {
        state.treeSearch = searchInput.value.trim();
        if (view !== 'tree') { state[viewKey] = 'tree'; store.set(viewKey, 'tree'); renderDetails({ keepScroll: true }); focusTreeSearch(); return; }
        buildTree();
      }, 150);
    });
    searchInput.addEventListener('keydown', (ev) => {
      if (ev.key === 'Escape' && searchInput.value) { ev.stopPropagation(); searchInput.value = ''; searchInput.dispatchEvent(new Event('input')); }
    });

    const seg = (v, label) => h('button', {
      class: `seg${view === v ? ' active' : ''}`,
      onclick: () => { state[viewKey] = v; store.set(viewKey, v); renderDetails({ keepScroll: true }); },
    }, label);
    wrap.append(
      h('div', { class: 'toolbar-line' },
        h('span', { class: 'segmented' }, seg('tree', 'Tree'), seg('raw', 'Raw')),
        searchInput,
        view === 'tree' ? h('button', { class: 'small-btn', onclick: () => tree && tree.expandAll() }, 'Expand all') : null,
        view === 'tree' ? h('button', { class: 'small-btn', onclick: () => tree && tree.collapseAll() }, 'Collapse') : null),
      view === 'tree' ? h('div', { class: 'toolbar-line match-line' }, matchInfo, copyMatches) : null,
    );
    if (view === 'tree') {
      buildTree();
      wrap.append(box);
    } else {
      wrap.append(jsonBlock(JSON.stringify(json, null, 2)));
    }
    return wrap;
  }

  function focusTreeSearch() {
    const input = els.detailBody.querySelector('.tree-search');
    if (input) { input.focus(); input.setSelectionRange(input.value.length, input.value.length); }
  }

  function errorsBox(errors) {
    return h('div', { class: 'errors-box' },
      h('h4', null, `GraphQL errors (${errors.length})`),
      h('ul', null, errors.map((err) => h('li', null,
        err?.message || JSON.stringify(err),
        Array.isArray(err?.path) ? h('span', { class: 'muted' }, `  at ${err.path.join('.')}`) : null,
        err?.extensions?.code ? h('span', { class: 'muted' }, `  [${err.extensions.code}]`) : null))));
  }

  function renderResponse(r) {
    const b = r.body;
    if (!b) return h('div', { class: 'note' }, 'No response body available.');
    if (b.base64 != null) {
      if (/^image\//.test(b.mime)) {
        return h('div', null, h('img', { class: 'preview-img', src: `data:${b.mime};base64,${b.base64}`, alt: '' }),
          h('div', { class: 'muted' }, `${b.mime} · ${fmtBytes(Math.floor(b.base64.length * 0.75))}`));
      }
      return h('div', { class: 'note' }, `Binary content (${b.mime || 'unknown type'}).`);
    }
    const text = b.text;
    if (!text) return h('div', { class: 'note' }, 'Empty response body.');
    const json = G.tryJson(text);
    const wrap = h('div', null, h('div', { class: 'toolbar-line' },
      copyBtn('Copy response', text),
      h('span', { class: 'muted' }, json !== undefined ? 'JSON' : (b.mime || '')),
      h('span', { class: 'muted' }, fmtBytes(text.length))));
    if (r.gqlErrors.length) wrap.append(errorsBox(r.gqlErrors));
    wrap.append(json !== undefined && json !== null && typeof json === 'object' ? jsonView(json, text) : codeBlock(G.escapeHtml(text)));
    return wrap;
  }

  // ---------- Timings tab ----------

  function renderTimings(r) {
    const t = r.entry.timings || {};
    const phases = [
      ['Blocked', t.blocked], ['DNS', t.dns], ['Connecting', t.connect], ['TLS', t.ssl],
      ['Sending', t.send], ['Waiting (TTFB)', t.wait], ['Receiving', t.receive],
    ];
    const total = r.entry.time || phases.reduce((s, [, v]) => s + (v > 0 ? v : 0), 0) || 1;
    let offset = 0;
    const rows = [];
    for (const [label, v] of phases) {
      if (v == null || v < 0) continue;
      const start = label === 'TLS' ? offset - v : offset; // HAR: ssl is included in connect
      rows.push(h('div', { class: 'timing-row' },
        h('span', null, label),
        h('div', { class: 'timing-bar-track' }, h('div', {
          class: 'timing-bar',
          style: `left:${(Math.max(0, start) / total) * 100}%;width:${(v / total) * 100}%`,
        })),
        h('span', { class: 'val' }, fmtMs(v))));
      if (label !== 'TLS') offset += v;
    }
    const totalRow = h('div', { class: 'timing-row' },
      h('strong', null, 'Total'), h('span'), h('strong', { class: 'val' }, fmtMs(r.entry.time)));
    return section('Request Timing', h('div', null, rows, totalRow));
  }

  // ---------- Messages tab (WebSocket / EventSource) ----------

  let liveMessages = null; // { id, list, filter } while the Messages tab is shown

  function messageSummary(r, m) {
    if (m.binary != null) return h('span', { class: 'muted' }, `[binary ${fmtBytes(m.binary)}]`);
    const p = m._gql;
    if (p) {
      const op = p.op || (p.id != null ? r.socket.opsById[p.id] : null);
      return [
        h('span', { class: 'msg-type' }, p.type),
        p.id != null ? h('span', { class: 'muted' }, `#${p.id}`) : null,
        op ? [opBadge(op), h('span', { class: 'op-name' }, opLabel(op))] : null,
        p.errors.length ? h('span', { class: 'badge err' }, `${p.errors.length} error${p.errors.length > 1 ? 's' : ''}`) : null,
      ];
    }
    return [
      m.event ? h('span', { class: 'msg-type' }, m.event) : null,
      h('span', { class: 'msg-preview' }, (m.data || '').slice(0, 300)),
    ];
  }

  function messageDetail(r, m) {
    if (m.binary != null) return h('div', { class: 'note' }, `Binary frame, ${fmtBytes(m.binary)}.`);
    const box = h('div', { class: 'msg-detail' });
    const p = m._gql;
    if (p && p.op) box.append(renderGraphQLOp(p.op, 0, 1, { resend: false }));
    const json = G.tryJson(m.data);
    if (json !== undefined && json !== null && typeof json === 'object') {
      if (p && p.errors.length) box.append(errorsBox(p.errors));
      box.append(jsonView(json, m.data, { viewKey: 'responseView' }));
    } else {
      box.append(codeBlock(G.escapeHtml(m.data || '')));
    }
    if (m.truncated) box.append(h('div', { class: 'note' }, `Truncated: original message was ${fmtBytes(m.truncated)}.`));
    box.append(h('div', { class: 'toolbar-line' }, copyBtn('Copy message', m.data || '')));
    return box;
  }

  function messageMatches(r, m) {
    if (!state.msgFilter) return true;
    const q = state.msgFilter.toLowerCase();
    const p = m._gql;
    const op = p && (p.op || (p.id != null ? r.socket.opsById[p.id] : null));
    return (m.data || '').toLowerCase().includes(q) || (op && opLabel(op).toLowerCase().includes(q)) || (m.event || '').toLowerCase().includes(q);
  }

  function messageRow(r, m) {
    const size = m.binary != null ? m.binary : (m.truncated || (m.data || '').length);
    const row = h('div', { class: `msg-row dir-${m.dir}` },
      h('span', { class: 'msg-dir', title: m.dir === 'out' ? 'Sent' : 'Received' }, m.dir === 'out' ? '↑' : '↓'),
      h('span', { class: 'msg-time' }, fmtClock(m.time)),
      h('span', { class: 'msg-summary' }, messageSummary(r, m)),
      h('span', { class: 'msg-size' }, fmtBytes(size)));
    row.addEventListener('click', () => {
      const next = row.nextElementSibling;
      if (next && next.classList.contains('msg-detail-wrap')) { next.remove(); row.classList.remove('open'); return; }
      row.classList.add('open');
      row.after(h('div', { class: 'msg-detail-wrap' }, messageDetail(r, m)));
    });
    return row;
  }

  function renderMessages(r) {
    const s = r.socket;
    const list = h('div', { class: 'msg-list' });
    const counter = h('span', { class: 'muted' });
    const fill = () => {
      const shown = s.messages.filter((m) => messageMatches(r, m));
      list.replaceChildren(...shown.map((m) => messageRow(r, m)));
      counter.textContent = `${shown.length === s.messages.length ? s.messages.length : `${shown.length} / ${s.messages.length}`} messages`;
      if (!s.messages.length) list.append(h('div', { class: 'note' }, s.state === 'open' || s.state === 'connecting' ? 'Waiting for messages…' : 'No messages.'));
    };
    const filter = h('input', { class: 'msg-filter', type: 'search', placeholder: 'Filter messages', spellcheck: 'false' });
    filter.value = state.msgFilter;
    filter.addEventListener('input', () => { state.msgFilter = filter.value; fill(); });
    fill();
    liveMessages = { id: r.id, list, counter, fill };
    return h('div', null,
      h('div', { class: 'toolbar-line' },
        h('span', { class: `state-pill st-${s.state}` }, s.state),
        s.protocol ? h('span', { class: 'muted' }, s.protocol) : null,
        counter,
        h('span', { class: 'spacer' }),
        filter),
      list);
  }

  function onSocketFrame(id, frame) {
    const rec = state.byId.get(id);
    if (!rec || !rec.socket) return;
    rec.socket.messages.push(frame);
    if (rec.socket.messages.length > 5000) rec.socket.messages.splice(0, rec.socket.messages.length - 5000);
    const hadGql = rec.gql ? rec.gql.operations.length : 0;
    processSocketMessage(rec, frame);
    rec.duration = Math.max(0, frame.time - rec.start);
    rec.end = frame.time;
    if (extendRange(rec)) scheduleWaterfall();
    if ((rec.gql ? rec.gql.operations.length : 0) !== hadGql) { scheduleOpOptions(); if (!isVisible(rec) || state.opFilter) scheduleRenderAll(); }
    scheduleRowUpdate(rec);
    if (liveMessages && liveMessages.id === id && liveMessages.list.isConnected && state.selectedId === id && state.tab === 'messages') {
      if (messageMatches(rec, frame)) {
        const box = els.detailBody;
        const stick = box.scrollTop + box.clientHeight >= box.scrollHeight - 40;
        liveMessages.list.querySelector(':scope > .note')?.remove();
        liveMessages.list.append(messageRow(rec, frame));
        if (stick) box.scrollTop = box.scrollHeight;
      }
      const shown = liveMessages.list.querySelectorAll('.msg-row').length;
      liveMessages.counter.textContent = `${shown === rec.socket.messages.length ? shown : `${shown} / ${rec.socket.messages.length}`} messages`;
    }
  }

  function onSocketState(data) {
    const rec = state.byId.get(data.id);
    if (!rec || !rec.socket) return;
    Object.assign(rec.socket, {
      state: data.state, protocol: data.protocol || rec.socket.protocol,
      closeCode: data.closeCode, closeReason: data.closeReason, error: data.error,
    });
    scheduleRowUpdate(rec);
    if (state.selectedId === rec.id && state.view === 'record' && state.tab !== 'resend') renderDetails({ keepScroll: true });
  }

  // ======================================================================
  // Edit & Resend + saved requests
  // ======================================================================

  const FORBIDDEN_HEADER = X.FORBIDDEN_HEADER;
  const GQL_GET_PARAMS = ['query', 'operationName', 'variables', 'extensions'];
  const DRAFT_FIELDS = ['method', 'url', 'headers', 'mode', 'body', 'operationName', 'query', 'variables', 'extensions'];

  function resendBtn() {
    return h('button', {
      class: 'small-btn primary',
      onclick: (ev) => { ev.stopPropagation(); state.tab = 'resend'; renderDetails(); },
    }, 'Edit & Resend');
  }

  function makeDraft(r) {
    const req = r.entry.request;
    const d = {
      method: req.method,
      url: req.url,
      headers: (req.headers || []).filter((x) => !FORBIDDEN_HEADER.test(x.name)).map((x) => `${x.name}: ${x.value}`).join('\n'),
      mode: 'raw',
      body: '',
      operationName: '',
      query: '',
      variables: '',
      extensions: '',
      status: null,
    };
    const op = r.gql && !r.gql.batched ? r.gql.operations[0] : null;
    if (op) {
      d.mode = 'graphql';
      d.operationName = op.name || '';
      d.query = op.query ? G.format(op.query) : '';
      d.variables = op.variables != null ? pretty(op.variables) : '';
      d.extensions = op.extensions != null ? pretty(op.extensions) : '';
      if (req.method === 'GET') {
        try {
          const u = new URL(req.url);
          GQL_GET_PARAMS.forEach((k) => u.searchParams.delete(k));
          d.url = u.href;
        } catch (e) { /* keep url */ }
      }
    } else if (req.postData?.text) {
      const json = G.tryJson(req.postData.text);
      d.body = json !== undefined ? JSON.stringify(json, null, 2) : req.postData.text;
    }
    return d;
  }

  const cleanDraft = (d) => Object.fromEntries(DRAFT_FIELDS.map((k) => [k, d[k] ?? '']));

  function parseJsonField(text, label) {
    if (!text.trim()) return undefined;
    try { return JSON.parse(text); } catch (e) { throw new Error(`${label} is not valid JSON: ${e.message}`); }
  }

  function graphqlPayload(d) {
    const payload = {};
    if (d.operationName.trim()) payload.operationName = d.operationName.trim();
    if (d.query.trim()) payload.query = d.query;
    const variables = parseJsonField(d.variables, 'Variables');
    const extensions = parseJsonField(d.extensions, 'Extensions');
    if (variables !== undefined) payload.variables = variables;
    if (extensions !== undefined) payload.extensions = extensions;
    return payload;
  }

  function buildRequest(d) {
    const method = d.method.trim().toUpperCase();
    if (!/^[A-Z]+$/.test(method)) throw new Error('Invalid method');
    let url;
    try { url = new URL(d.url.trim()); } catch (e) { throw new Error('Invalid URL'); }

    const headers = [];
    const skipped = [];
    for (const line of d.headers.split('\n')) {
      if (!line.trim() || line.trim().startsWith('#')) continue;
      const i = line.indexOf(':');
      if (i <= 0) throw new Error(`Invalid header line: "${line.trim()}" (expected "Name: value")`);
      const name = line.slice(0, i).trim();
      const value = line.slice(i + 1).trim();
      if (FORBIDDEN_HEADER.test(name)) { skipped.push(name); continue; }
      headers.push([name, value]);
    }

    let body;
    const noBody = method === 'GET' || method === 'HEAD';
    if (d.mode === 'graphql') {
      const payload = graphqlPayload(d);
      if (noBody) {
        for (const [k, v] of Object.entries(payload)) url.searchParams.set(k, typeof v === 'string' ? v : JSON.stringify(v));
      } else {
        body = JSON.stringify(payload);
        if (!headers.some(([n]) => n.toLowerCase() === 'content-type')) headers.push(['content-type', 'application/json']);
      }
    } else if (!noBody && d.body) {
      body = d.body;
    }

    const init = { method, headers, credentials: 'include' };
    if (body !== undefined) init.body = body;
    return { url: url.href, init, skipped };
  }

  /** Draft → HAR-shaped request (for Postman export of saved requests). */
  function draftToHarRequest(d) {
    const built = buildRequest(d);
    return {
      method: built.init.method,
      url: built.url,
      headers: built.init.headers.map(([name, value]) => ({ name, value })),
      postData: built.init.body != null ? { mimeType: 'application/json', text: built.init.body } : undefined,
    };
  }

  function sendDraft(d, statusEl, { autoSelect = true } = {}) {
    const setStatus = (text, kind, extra) => {
      d.status = { text, kind };
      if (statusEl.isConnected) {
        statusEl.className = `resend-status ${kind || ''}`;
        statusEl.replaceChildren(text, extra || '');
      }
    };
    let built;
    try { built = buildRequest(d); } catch (err) { setStatus(err.message, 'error'); return; }
    const reqId = ++state.resendSeq;
    let matchedId = null;
    let lastResult = null;
    const showLink = () => (matchedId != null && !autoSelect
      ? h('button', { class: 'small-btn link-btn', onclick: () => { state.tab = 'response'; select(matchedId, { scroll: true }); } }, 'Show request')
      : null);
    state.pendingResend = {
      method: built.init.method,
      url: normalizeUrl(built.url),
      at: Date.now(),
      autoSelect,
      onMatch: (id) => { matchedId = id; if (lastResult) setStatus(lastResult.text, lastResult.kind, showLink()); },
    };
    state.resendCallbacks.set(reqId, (res) => {
      lastResult = res.error
        ? { text: `Failed: ${res.error}${/networkerror|failed to fetch/i.test(res.error) ? ' (CORS or network error — see the browser console)' : ''} `, kind: 'error' }
        : { text: `Sent: ${res.status} ${res.statusText || ''} · ${fmtMs(res.ms)} `, kind: res.status >= 400 ? 'error' : 'ok' };
      setStatus(lastResult.text, lastResult.kind, showLink());
    });
    setStatus(`Sending…${built.skipped.length ? ` (browser-controlled headers skipped: ${built.skipped.join(', ')})` : ''}`, '');
    channel.postMessage({ type: 'resend', reqId, url: built.url, init: built.init });
  }

  function codeArea(d, key, { rows, placeholder } = {}) {
    const lines = (d[key] || '').split('\n').length;
    const ta = h('textarea', {
      class: 'code-input',
      spellcheck: 'false',
      rows: rows || Math.min(24, Math.max(3, lines + 1)),
      placeholder,
    });
    ta.value = d[key] || '';
    ta.addEventListener('input', () => { d[key] = ta.value; });
    ta.addEventListener('keydown', (ev) => {
      if (ev.key === 'Tab' && !ev.shiftKey) {
        ev.preventDefault();
        ta.setRangeText('  ', ta.selectionStart, ta.selectionEnd, 'end');
        d[key] = ta.value;
      }
    });
    return ta;
  }

  function persistSaved() {
    store.set('saved', state.saved);
    els.savedBtn.textContent = state.saved.length ? `Saved (${state.saved.length})` : 'Saved';
  }

  function saveDraft(d, name, existing) {
    const clean = cleanDraft(d);
    if (existing) {
      Object.assign(existing, { name, draft: clean, savedAt: Date.now() });
    } else {
      existing = { id: `s${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, name, draft: clean, savedAt: Date.now() };
      state.saved.push(existing);
    }
    persistSaved();
    return existing;
  }

  function saveRecordQuick(r) {
    const item = saveDraft(makeDraft(r), requestName(r));
    toast(`Saved “${item.name}” — open Saved to edit or replay it`);
  }

  /**
   * Request editor shared by Edit & Resend and saved requests.
   * ctx: { onReset, defaultName, savedItem, autoSelect }
   */
  function renderEditor(d, ctx) {
    const status = h('div', { class: `resend-status ${d.status?.kind || ''}` }, d.status?.text || '');
    const send = () => sendDraft(d, status, { autoSelect: ctx.autoSelect !== false });

    const method = h('input', { class: 'method-input', list: 'np-methods', spellcheck: 'false', 'aria-label': 'Method' });
    method.value = d.method;
    method.addEventListener('input', () => { d.method = method.value; });
    const url = h('input', { class: 'url-input', spellcheck: 'false', 'aria-label': 'URL' });
    url.value = d.url;
    url.addEventListener('input', () => { d.url = url.value; });

    const nameInput = h('input', { class: 'url-input save-name', spellcheck: 'false', placeholder: 'Name', 'aria-label': 'Saved request name' });
    nameInput.value = ctx.savedItem ? ctx.savedItem.name : ctx.defaultName || '';
    const doSave = (asNew) => {
      const name = nameInput.value.trim() || ctx.defaultName || `${d.method} ${d.url}`;
      const item = saveDraft(d, name, asNew ? null : ctx.savedItem);
      toast(asNew || !ctx.savedItem ? `Saved “${item.name}”` : `Updated “${item.name}”`);
      if (state.view === 'saved') { state.savedSelected = item.id; state.savedDrafts.set(item.id, d); renderDetails({ keepScroll: true }); }
    };

    const form = h('div', { class: 'resend-form' },
      h('datalist', { id: 'np-methods' }, ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'].map((m) => h('option', { value: m }))),
      h('div', { class: 'resend-line' },
        method, url,
        h('button', { class: 'send-btn', title: 'Send (Ctrl/Cmd+Enter)', onclick: send }, 'Send'),
        h('button', { class: 'small-btn', title: 'Discard edits', onclick: ctx.onReset }, 'Reset')),
      status,
      h('div', { class: 'resend-line save-line' },
        nameInput,
        h('button', { class: 'small-btn', onclick: () => doSave(false) }, ctx.savedItem ? 'Update saved' : 'Save'),
        ctx.savedItem ? h('button', { class: 'small-btn', onclick: () => doSave(true) }, 'Save as new') : null,
        h('button', {
          class: 'small-btn',
          title: 'Copy this edited request as cURL',
          onclick: () => { try { copyWithToast(X.toCurl(draftToHarRequest(d)), 'cURL copied'); } catch (e) { toast(e.message, 'error'); } },
        }, 'Copy cURL')),
      section('Headers', h('div', null,
        codeArea(d, 'headers', { placeholder: 'Name: value' }),
        h('div', { class: 'muted hint' }, 'One "Name: value" per line. Cookies, Origin, Host and other browser-controlled headers are added by the browser.'))));

    const rerender = () => renderDetails({ keepScroll: true });
    const switchMode = (to) => {
      try {
        if (to === 'raw') {
          d.body = JSON.stringify(graphqlPayload(d), null, 2);
        } else {
          const j = JSON.parse(d.body);
          if (!j || typeof j !== 'object' || Array.isArray(j)) throw new Error('body must be a single JSON object');
          d.operationName = j.operationName || '';
          d.query = typeof j.query === 'string' ? G.format(j.query) : '';
          d.variables = j.variables != null ? JSON.stringify(j.variables, null, 2) : '';
          d.extensions = j.extensions != null ? JSON.stringify(j.extensions, null, 2) : '';
        }
        d.mode = to;
        d.status = null;
        rerender();
      } catch (err) {
        d.status = { text: `Can't switch: ${err.message}`, kind: 'error' };
        status.textContent = d.status.text;
        status.className = 'resend-status error';
      }
    };

    if (d.mode === 'graphql') {
      const queryArea = codeArea(d, 'query', { placeholder: 'query MyOperation { … }' });
      const opName = h('input', { class: 'url-input', spellcheck: 'false', placeholder: '(none)' });
      opName.value = d.operationName;
      opName.addEventListener('input', () => { d.operationName = opName.value; });
      const persisted = (() => { try { return !!parseJsonField(d.extensions, 'Extensions')?.persistedQuery; } catch (e) { return false; } })();
      form.append(
        section('GraphQL', h('div', null,
          h('label', { class: 'field-label' }, 'Operation name'), opName,
          h('label', { class: 'field-label' }, 'Query'), queryArea,
          persisted ? h('div', { class: 'muted hint' }, 'This uses a persisted query hash (extensions.persistedQuery). If you change the query, remove the extensions or the server may reject the hash.') : null),
        { actions: [
          h('button', { class: 'small-btn', onclick: (ev) => { ev.preventDefault(); d.query = G.format(d.query); queryArea.value = d.query; } }, 'Format'),
          h('button', { class: 'small-btn', onclick: (ev) => { ev.preventDefault(); switchMode('raw'); } }, 'Edit raw body'),
        ] }),
        section('Variables', codeArea(d, 'variables', { placeholder: '{ "id": 1 }' }), {
          actions: [h('button', {
            class: 'small-btn',
            onclick: (ev) => {
              ev.preventDefault();
              try { d.variables = d.variables.trim() ? JSON.stringify(JSON.parse(d.variables), null, 2) : ''; d.status = null; rerender(); } catch (e) { status.textContent = `Variables: ${e.message}`; status.className = 'resend-status error'; }
            },
          }, 'Format')],
        }),
        section('Extensions', codeArea(d, 'extensions', { rows: 3, placeholder: '(optional)' }), { open: !!d.extensions.trim() }));
    } else {
      const canBeGql = (() => { const j = G.tryJson(d.body); return j && typeof j === 'object' && !Array.isArray(j) && typeof j.query === 'string'; })();
      form.append(section('Body', h('div', null,
        codeArea(d, 'body', { placeholder: '(empty)' }),
        /^(GET|HEAD)$/i.test(d.method.trim()) ? h('div', { class: 'muted hint' }, 'GET and HEAD requests are sent without a body.') : null),
      { actions: canBeGql ? [h('button', { class: 'small-btn', onclick: (ev) => { ev.preventDefault(); switchMode('graphql'); } }, 'Edit as GraphQL')] : [] }));
    }

    form.addEventListener('keydown', (ev) => {
      if ((ev.ctrlKey || ev.metaKey) && ev.key === 'Enter') { ev.preventDefault(); send(); }
    });
    return form;
  }

  function renderResend(r) {
    if (!state.drafts.has(r.id)) state.drafts.set(r.id, makeDraft(r));
    return renderEditor(state.drafts.get(r.id), {
      defaultName: requestName(r),
      onReset: () => { state.drafts.delete(r.id); renderDetails(); },
    });
  }

  function openSaved(id = state.savedSelected) {
    state.view = 'saved';
    state.savedSelected = id && state.saved.some((s) => s.id === id) ? id : (state.saved[0]?.id ?? null);
    for (const row of els.rows.querySelectorAll('.row.selected')) row.classList.remove('selected');
    showDetailsPane();
    renderDetails();
  }

  function renderSavedPane() {
    const wrap = h('div', { class: 'saved-pane' });
    if (!state.saved.length) {
      wrap.append(h('div', { class: 'note' }, 'No saved requests yet. Use “Save” in a request’s Headers or Edit & Resend tab, or right-click a request → Save request.'));
      return wrap;
    }
    wrap.append(h('div', { class: 'toolbar-line' },
      h('button', {
        class: 'small-btn',
        onclick: () => {
          try {
            const items = state.saved.map((s) => ({ name: s.name, request: draftToHarRequest(s.draft) }));
            download(`network-plus-saved-${stamp()}.postman_collection.json`, JSON.stringify(X.toPostmanCollection('Network+ saved requests', items), null, 2));
            toast('Postman collection downloaded');
          } catch (e) { toast(`Export failed: ${e.message}`, 'error'); }
        },
      }, 'Export as Postman collection')));
    wrap.append(h('div', { class: 'saved-list' }, state.saved.map((s) => h('div', {
      class: `saved-item${s.id === state.savedSelected ? ' active' : ''}`,
      onclick: () => { state.savedSelected = s.id; renderDetails(); },
    },
    h('span', { class: `saved-method m-${(s.draft.method || '').toLowerCase()}` }, (s.draft.method || '').toUpperCase()),
    h('span', { class: 'saved-name' }, s.name),
    h('span', { class: 'url-dim' }, (() => { try { const u = new URL(s.draft.url); return u.host + u.pathname; } catch (e) { return s.draft.url; } })()),
    h('button', {
      class: 'icon-btn saved-del',
      title: `Delete “${s.name}”`,
      onclick: (ev) => {
        ev.stopPropagation();
        state.saved = state.saved.filter((x) => x !== s);
        state.savedDrafts.delete(s.id);
        if (state.savedSelected === s.id) state.savedSelected = state.saved[0]?.id ?? null;
        persistSaved();
        renderDetails();
      },
    }, '✕')))));
    const item = state.saved.find((s) => s.id === state.savedSelected);
    if (item) {
      if (!state.savedDrafts.has(item.id)) state.savedDrafts.set(item.id, { ...item.draft, status: null });
      wrap.append(h('div', { class: 'saved-editor' }, renderEditor(state.savedDrafts.get(item.id), {
        savedItem: item,
        defaultName: item.name,
        autoSelect: false,
        onReset: () => { state.savedDrafts.delete(item.id); renderDetails(); },
      })));
    }
    return wrap;
  }

  // ======================================================================
  // export / import
  // ======================================================================

  function exportHar(records, label = 'requests') {
    if (!records.length) { toast('Nothing to export', 'error'); return; }
    const har = X.toHar(records, { version: VERSION });
    let host = 'export';
    try { host = new URL(records[0].url).host.replace(/[^\w.-]/g, '_') || host; } catch (e) { /* keep */ }
    download(`network-plus-${host}-${stamp()}.har`, JSON.stringify(har, null, 2));
    toast(`Exported ${records.length} ${records.length === 1 ? 'request' : 'requests'} (${label})`);
  }

  function exportMenu() {
    const visible = orderedVisible();
    const gqlVisible = visible.filter((r) => r.gql && !r.socket);
    return [
      { label: 'Export all as HAR', hint: `${state.records.length}`, disabled: !state.records.length, action: () => exportHar(state.records, 'all') },
      { label: 'Export filtered as HAR', hint: `${visible.length}`, disabled: !visible.length, action: () => exportHar(visible, 'filtered') },
      { label: 'Copy all as HAR', disabled: !state.records.length, action: () => copyWithToast(JSON.stringify(X.toHar(state.records, { version: VERSION }), null, 2), 'HAR copied') },
      '-',
      {
        label: 'Export GraphQL as Postman collection',
        hint: `${gqlVisible.length}`,
        disabled: !gqlVisible.length,
        action: () => {
          const items = gqlVisible.map((r) => ({ name: requestName(r), request: r.entry.request, gql: r.gql }));
          download(`network-plus-graphql-${stamp()}.postman_collection.json`, JSON.stringify(X.toPostmanCollection('Network+ GraphQL requests', items), null, 2));
          toast(`Exported ${items.length} GraphQL requests for Postman`);
        },
      },
    ];
  }

  async function importHarFile(file) {
    try {
      const text = await file.text();
      const recs = X.fromHar(JSON.parse(text));
      clearAll();
      // Negative ids keep imported records before (and separate from) live ones.
      const base = -(recs.length + 1) - (state.importSeq += 100000);
      recs.forEach((rec, i) => { rec.id = base + i + 1; rec.imported = true; addRecord(rec, { batch: true }); });
      renderAll();
      renderOpOptions();
      toast(`Imported ${recs.length} requests from ${file.name}`);
    } catch (err) {
      toast(`Import failed: ${err.message}`, 'error');
    }
  }

  // ======================================================================
  // columns menu & header interactions
  // ======================================================================

  function columnsMenu() {
    return [
      ...COLUMNS.filter((c) => c.key !== 'name').map((c) => ({
        label: c.label,
        checked: isColumnVisible(c),
        action: () => {
          state.columns.hidden[c.key] = isColumnVisible(c);
          if (!isColumnVisible(c) && state.sort && state.sort.key === c.key) { state.sort = null; store.set('sort', null); }
          store.set('columns', state.columns);
          renderAll();
        },
      })),
      '-',
      { label: 'Reset columns', action: () => { state.columns = { hidden: {}, widths: {} }; store.set('columns', state.columns); renderAll(); } },
      { label: 'Reset sort', disabled: !state.sort, action: () => { state.sort = null; store.set('sort', null); renderAll(); } },
    ];
  }

  let resizing = false;
  els.listHead.addEventListener('mousedown', (ev) => {
    const handle = ev.target.closest('.col-resizer');
    if (!handle) return;
    ev.preventDefault();
    ev.stopPropagation();
    resizing = true;
    const key = handle.dataset.key;
    const col = COLUMNS.find((c) => c.key === key);
    const startX = ev.clientX;
    const startW = state.columns.widths[key] || col.width;
    const onMove = (e) => {
      state.columns.widths[key] = Math.max(36, Math.round(startW + e.clientX - startX));
      applyGrid();
    };
    const onUp = () => {
      store.set('columns', state.columns);
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      setTimeout(() => { resizing = false; }, 0);
      scheduleWaterfall();
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  });

  els.listHead.addEventListener('click', (ev) => {
    if (resizing || ev.target.closest('.col-resizer')) return;
    const cell = ev.target.closest('[data-key]');
    if (!cell) return;
    const key = cell.dataset.key;
    const s = state.sort;
    if (!s || s.key !== key) state.sort = { key, dir: 1 };
    else if (s.dir === 1) state.sort = { key, dir: -1 };
    else state.sort = null;
    store.set('sort', state.sort);
    renderAll();
  });

  els.listHead.addEventListener('contextmenu', (ev) => {
    ev.preventDefault();
    showMenu(ev.clientX, ev.clientY, columnsMenu());
  });

  // ======================================================================
  // events
  // ======================================================================

  els.rows.addEventListener('click', (ev) => {
    const row = ev.target.closest('.row');
    if (!row) return;
    const rec = state.byId.get(Number(row.dataset.id));
    if (!rec) return;
    if (ev.target.closest('.row-star')) { ev.stopPropagation(); toggleBookmark(rec); return; }
    select(rec.id);
  });

  els.rows.addEventListener('contextmenu', (ev) => {
    const row = ev.target.closest('.row');
    if (!row) return;
    const rec = state.byId.get(Number(row.dataset.id));
    if (!rec) return;
    ev.preventDefault();
    if (state.selectedId !== rec.id || state.view !== 'record') select(rec.id);
    showMenu(ev.clientX, ev.clientY, recordMenu(rec));
  });

  els.list.addEventListener('keydown', (ev) => {
    if (ev.key !== 'ArrowDown' && ev.key !== 'ArrowUp') return;
    ev.preventDefault();
    const rows = [...els.rows.children];
    if (!rows.length) return;
    const cur = rows.findIndex((r) => Number(r.dataset.id) === state.selectedId);
    const next = cur < 0 ? 0 : Math.min(rows.length - 1, Math.max(0, cur + (ev.key === 'ArrowDown' ? 1 : -1)));
    select(Number(rows[next].dataset.id), { scroll: true });
  });

  document.addEventListener('keydown', (ev) => {
    if (ev.key === 'Escape') {
      if (openMenu) { closeMenu(); return; }
      if (!els.details.hidden) closeDetails();
    }
    if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === 'l') { ev.preventDefault(); clearAll(); }
    if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === 'f') { ev.preventDefault(); els.filter.focus(); els.filter.select(); }
  });

  $('#tabs').addEventListener('click', (ev) => {
    const btn = ev.target.closest('button[data-tab]');
    if (!btn) return;
    state.tab = btn.dataset.tab;
    renderDetails();
  });
  $('#closeDetails').addEventListener('click', closeDetails);
  $('#clear').addEventListener('click', () => clearAll());

  let filterTimer;
  els.filter.addEventListener('input', () => {
    clearTimeout(filterTimer);
    filterTimer = setTimeout(() => { state.filter = els.filter.value.trim(); renderAll(); }, 120);
  });

  els.opFilter.addEventListener('change', () => setOpFilter(els.opFilter.value));

  els.bookmarkedOnly.addEventListener('click', () => {
    state.bookmarkedOnly = !state.bookmarkedOnly;
    syncControls();
    renderAll();
  });

  const typeButtons = document.querySelectorAll('#types button');
  function syncControls() {
    typeButtons.forEach((b) => b.classList.toggle('active', b.dataset.type === state.type));
    els.bookmarkedOnly.classList.toggle('active', state.bookmarkedOnly);
    els.bookmarkedOnly.setAttribute('aria-pressed', String(state.bookmarkedOnly));
    els.opFilter.value = state.opFilter;
    els.opFilter.classList.toggle('active', !!state.opFilter);
  }
  $('#types').addEventListener('click', (ev) => {
    const btn = ev.target.closest('button[data-type]');
    if (!btn) return;
    state.type = btn.dataset.type;
    store.set('type', state.type);
    syncControls();
    renderAll();
  });

  els.hideOptions.checked = state.hideOptions;
  els.hideOptions.addEventListener('change', () => {
    state.hideOptions = els.hideOptions.checked;
    store.set('hideOptions', state.hideOptions);
    renderAll();
  });

  els.preserveLog.checked = state.preserveLog;
  els.preserveLog.addEventListener('change', () => {
    state.preserveLog = els.preserveLog.checked;
    store.set('preserveLog', state.preserveLog);
  });

  els.savedBtn.addEventListener('click', () => {
    if (state.view === 'saved' && !els.details.hidden) closeDetails();
    else openSaved();
  });
  menuButton($('#exportBtn'), exportMenu);
  menuButton($('#columnsBtn'), columnsMenu);
  $('#importBtn').addEventListener('click', () => $('#importFile').click());
  $('#importFile').addEventListener('change', (ev) => {
    const file = ev.target.files && ev.target.files[0];
    ev.target.value = '';
    if (file) importHarFile(file);
  });

  // splitter drag
  els.splitter.addEventListener('mousedown', (ev) => {
    ev.preventDefault();
    els.splitter.classList.add('dragging');
    const rect = els.main.getBoundingClientRect();
    const onMove = (e) => {
      const w = Math.min(rect.width - 200, Math.max(260, rect.right - e.clientX));
      els.details.style.width = `${w}px`;
    };
    const onUp = () => {
      els.splitter.classList.remove('dragging');
      store.set('detailsWidth', els.details.style.width);
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  });
  const savedWidth = store.get('detailsWidth', null);
  if (savedWidth) els.details.style.width = savedWidth;

  // theme
  function applyTheme(name) {
    const dark = name ? name === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches;
    document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  }
  applyTheme(browser.devtools?.panels?.themeName);
  browser.devtools?.panels?.onThemeChanged?.addListener(applyTheme);

  // ======================================================================
  // channel
  // ======================================================================

  channel.onmessage = ({ data }) => {
    if (!data) return;
    switch (data.type) {
      case 'entry':
        addRecord(data.record);
        break;
      case 'snapshot': {
        let added = false;
        for (const rec of data.records) added = addRecord(rec, { batch: true }) || added;
        if (added) { renderAll(); renderOpOptions(); els.list.scrollTop = els.list.scrollHeight; }
        break;
      }
      case 'remove':
        removeRecord(data.id);
        break;
      case 'socketFrame':
        onSocketFrame(data.id, data.frame);
        break;
      case 'socketState':
        onSocketState(data);
        break;
      case 'navigated':
        if (!state.preserveLog) clearAll({ notify: false });
        break;
      case 'resendResult': {
        const cb = state.resendCallbacks.get(data.reqId);
        state.resendCallbacks.delete(data.reqId);
        if (cb) cb(data.result || {});
        break;
      }
      default:
        break;
    }
  };

  syncControls();
  persistSaved();
  renderAll();
  renderOpOptions();
  channel.postMessage({ type: 'hello' });
})();
