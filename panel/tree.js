/*
 * Collapsible JSON tree. Children render lazily on first expand, and arrays
 * over 100 items are split into groups, so large responses stay fast.
 * Clicking a key reports its path (e.g. data.customer.licenses[0].id).
 */
(function (root) {
  'use strict';

  const IDENT = /^[A-Za-z_$][\w$]*$/;
  const CHUNK = 100;

  function pathString(parts) {
    let s = '';
    for (const p of parts) {
      if (typeof p === 'number') s += `[${p}]`;
      else if (IDENT.test(p)) s += s ? `.${p}` : p;
      else s += `[${JSON.stringify(p)}]`;
    }
    return s;
  }

  function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }

  function valueEl(v) {
    if (v === null) return el('span', 'tk-null', 'null');
    switch (typeof v) {
      case 'string': return el('span', 'tk-str', JSON.stringify(v));
      case 'number': return el('span', 'tk-num', String(v));
      case 'boolean': return el('span', 'tk-kw', String(v));
      default: return el('span', null, String(v));
    }
  }

  function previewText(v) {
    if (Array.isArray(v)) return `Array(${v.length})`;
    const keys = Object.keys(v);
    return `{${keys.slice(0, 4).join(', ')}${keys.length > 4 ? ', …' : ''}}`;
  }

  // ---------- search ----------

  const isPrimitive = (v) => v === null || typeof v !== 'object';
  const primText = (v) => (v === null ? 'null' : String(v));

  /**
   * Query syntax:  term        key or primitive value contains term
   *                key=value   key contains `key` AND value contains `value`
   *                =value      values only;  key=  keys only
   * A key part containing "." or "[" is matched against the full path instead.
   */
  function compileQuery(q) {
    q = String(q || '').trim().toLowerCase();
    if (!q) return null;
    const eq = q.indexOf('=');
    const keyQ = eq < 0 ? q : q.slice(0, eq).trim();
    const valQ = eq < 0 ? q : q.slice(eq + 1).trim();
    const byPath = /[.[]/.test(keyQ);
    const keyMatch = (key, path) => !!keyQ && (byPath ? path.toLowerCase().includes(keyQ) : String(key).toLowerCase().includes(keyQ));
    const valMatch = (v) => !!valQ && isPrimitive(v) && primText(v).toLowerCase().includes(valQ);
    return {
      keyQ: byPath ? '' : keyQ,
      valQ,
      test(key, v, path) {
        if (eq < 0) return { key: keyMatch(key, path), value: valMatch(v) };
        if (keyQ && valQ) { const ok = keyMatch(key, path) && valMatch(v); return { key: ok, value: ok }; }
        return keyQ ? { key: keyMatch(key, path), value: false } : { key: false, value: valMatch(v) };
      },
    };
  }

  const WALK_LIMIT = 300000;

  /** Which children to show per container, and which paths matched. */
  function filterPlan(value, query) {
    const show = new Map(); // container -> Set of child keys to keep (absent = show all)
    const hits = new Map(); // path string -> { key, value, v }
    let visited = 0;
    function walk(v, key, path, full) {
      if (++visited > WALK_LIMIT) return false;
      const ps = pathString(path);
      const r = key === null ? { key: false, value: false } : query.test(key, v, ps);
      const self = r.key || r.value;
      if (self) hits.set(ps, { key: r.key, value: r.value, v });
      if (!isPrimitive(v)) {
        const kept = new Set();
        const keys = Array.isArray(v) ? v.map((_, i) => i) : Object.keys(v);
        for (const k of keys) if (walk(v[k], k, [...path, k], full || self)) kept.add(k);
        // A matching container shows its whole subtree; otherwise keep only matching branches.
        if (full || self) return true;
        if (kept.size) { show.set(v, kept); return true; }
        return false;
      }
      return self || full;
    }
    const any = walk(value, null, [], false);
    return { show, hits, any, truncated: visited > WALK_LIMIT };
  }

  function markText(text, q) {
    const frag = document.createDocumentFragment();
    if (!q) { frag.append(text); return frag; }
    const lower = text.toLowerCase();
    let i = 0;
    let at = lower.indexOf(q);
    while (at >= 0) {
      frag.append(text.slice(i, at), el('mark', 'jt-mark', text.slice(at, at + q.length)));
      i = at + q.length;
      at = lower.indexOf(q, i);
    }
    frag.append(text.slice(i));
    return frag;
  }

  function render(value, { expandDepth = 2, onCopyPath, query: rawQuery } = {}) {
    const rootEl = el('div', 'jt');
    const query = compileQuery(rawQuery);
    const plan = query ? filterPlan(value, query) : null;
    if (plan) {
      rootEl.matches = [...plan.hits.entries()].map(([path, h]) => ({ path, value: h.v }));
      rootEl.truncated = plan.truncated;
      if (!plan.any) {
        rootEl.append(el('div', 'jt-empty', 'No matches'));
        rootEl.expandAll = () => {};
        rootEl.collapseAll = () => {};
        return rootEl;
      }
    }

    function expandable(line, fill, startOpen) {
      const wrap = el('div', 'jt-node');
      const toggle = el('span', 'jt-toggle', '▸');
      const children = el('div', 'jt-children');
      children.hidden = true;
      let filled = false;
      line.prepend(toggle);
      line.classList.add('jt-clickable');
      const setOpen = (open) => {
        if (open && !filled) { filled = true; fill(children); }
        children.hidden = !open;
        toggle.textContent = open ? '▾' : '▸';
      };
      wrap._setOpen = setOpen;
      wrap._children = children;
      line.addEventListener('click', () => setOpen(children.hidden));
      wrap.append(line, children);
      if (startOpen) setOpen(true);
      return wrap;
    }

    function keyEl(key, path) {
      const p = pathString(path);
      const hit = plan && plan.hits.get(p);
      const k = el('span', `jt-key${hit && hit.key ? ' jt-hit' : ''}`);
      k.append(hit && hit.key ? markText(String(key), query.keyQ) : String(key));
      k.title = `Click to copy path: ${p}`;
      k.addEventListener('click', (ev) => {
        ev.stopPropagation();
        if (onCopyPath) onCopyPath(p);
      });
      return k;
    }

    function node(key, v, path, depth) {
      const line = el('div', 'jt-line');
      if (key !== null) line.append(keyEl(key, path), el('span', 'jt-colon', ': '));
      const ps = pathString(path);
      const hit = plan && plan.hits.get(ps);
      if (hit) line.classList.add('jt-hit-line');
      if (v === null || typeof v !== 'object') {
        line.prepend(el('span', 'jt-toggle'));
        const ve = valueEl(v);
        if (hit && hit.value) {
          const shown = ve.textContent;
          ve.textContent = '';
          ve.append(markText(shown, query.valQ));
        }
        line.append(ve);
        return line;
      }
      const isArr = Array.isArray(v);
      const allKeys = isArr ? v.map((_, i) => i) : Object.keys(v);
      const allowed = plan && plan.show.get(v);
      const keys = allowed ? allKeys.filter((k) => allowed.has(k)) : allKeys;
      line.append(el('span', 'jt-preview', previewText(v)));
      if (allowed) line.append(el('span', 'jt-filtered', ` · ${keys.length} of ${allKeys.length} shown`));
      // Filtered view: open every branch that leads to a match, and matching containers.
      const startOpen = plan ? (!!allowed || !!hit || depth < 1) : depth < expandDepth;
      return expandable(line, (children) => {
        if (!keys.length) { children.append(el('div', 'jt-empty', isArr ? 'empty array' : 'empty object')); return; }
        if (keys.length > CHUNK) {
          for (let i = 0; i < keys.length; i += CHUNK) children.append(group(v, keys.slice(i, i + CHUNK), path, depth + 1));
        } else {
          for (const k of keys) children.append(node(k, v[k], [...path, k], depth + 1));
        }
      }, startOpen);
    }

    function group(container, keys, path, depth) {
      const line = el('div', 'jt-line');
      line.append(el('span', 'jt-preview', `[${keys[0]} … ${keys[keys.length - 1]}]`));
      return expandable(line, (children) => {
        for (const k of keys) children.append(node(k, container[k], [...path, k], depth));
      }, !!plan && keys.length <= CHUNK && plan.show.has(container));
    }

    rootEl.append(node(null, value, [], 0));

    rootEl.expandAll = (limit = 5000) => {
      const queue = [rootEl.firstChild];
      let n = 0;
      while (queue.length && n < limit) {
        const nd = queue.shift();
        if (!nd || !nd._setOpen) continue;
        nd._setOpen(true);
        n++;
        queue.push(...nd._children.children);
      }
    };
    rootEl.collapseAll = () => {
      rootEl.querySelectorAll('.jt-node').forEach((nd) => nd._setOpen(false));
      if (rootEl.firstChild && rootEl.firstChild._setOpen) rootEl.firstChild._setOpen(true);
    };
    return rootEl;
  }

  const api = { render, pathString, compileQuery, filterPlan };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.JsonTree = api;
})(typeof window !== 'undefined' ? window : globalThis);
