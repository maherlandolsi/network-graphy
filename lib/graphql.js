/*
 * GraphQL helpers: detection in HAR entries, operation parsing,
 * pretty-printing and syntax highlighting. No dependencies.
 * Works in the browser (window.GraphQLUtils) and in Node (module.exports).
 */
(function (root) {
  'use strict';

  const PUNCT = new Set(['!', '$', '&', '(', ')', ':', '=', '@', '[', ']', '{', '|', '}']);
  const NAME_RE = /[_A-Za-z][_0-9A-Za-z]*/y;
  const NUM_RE = /-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/y;

  function tokenize(src) {
    const toks = [];
    const n = src.length;
    let i = 0;
    while (i < n) {
      const c = src[i];
      if (c === ' ' || c === '\t' || c === '\n' || c === '\r' || c === ',' || c === '\ufeff') { i++; continue; }
      if (c === '#') {
        let j = src.indexOf('\n', i);
        if (j < 0) j = n;
        toks.push({ t: 'comment', v: src.slice(i, j).trimEnd() });
        i = j;
        continue;
      }
      if (c === '"') {
        let j;
        if (src.startsWith('"""', i)) {
          j = i + 3;
          while (j < n && !src.startsWith('"""', j)) j += src[j] === '\\' && src.startsWith('"""', j + 1) ? 4 : 1;
          j = Math.min(n, j + 3);
        } else {
          j = i + 1;
          while (j < n && src[j] !== '"' && src[j] !== '\n') j += src[j] === '\\' ? 2 : 1;
          j = Math.min(n, j + 1);
        }
        toks.push({ t: 'string', v: src.slice(i, j) });
        i = j;
        continue;
      }
      if (src.startsWith('...', i)) { toks.push({ t: 'punct', v: '...' }); i += 3; continue; }
      if (PUNCT.has(c)) { toks.push({ t: 'punct', v: c }); i++; continue; }
      NUM_RE.lastIndex = i;
      let m = NUM_RE.exec(src);
      if (m) { toks.push({ t: 'number', v: m[0] }); i += m[0].length; continue; }
      NAME_RE.lastIndex = i;
      m = NAME_RE.exec(src);
      if (m) { toks.push({ t: 'name', v: m[0] }); i += m[0].length; continue; }
      toks.push({ t: 'other', v: c });
      i++;
    }
    return toks;
  }

  const isP = (tok, ...vals) => !!tok && tok.t === 'punct' && vals.includes(tok.v);
  const isValueEnd = (tok) => !!tok && (
    tok.t === 'name' || tok.t === 'number' || tok.t === 'string' || isP(tok, ')', ']', '}', '!')
  );
  const startsValue = (tok) => tok.t === 'name' || tok.t === 'number' || tok.t === 'string' || isP(tok, '$', '[', '{', '...');

  /** Pretty-print a GraphQL document (operations, fragments and SDL). */
  function format(src, indent = '  ') {
    if (typeof src !== 'string' || !src.trim()) return src || '';
    try {
      const toks = tokenize(src);
      let out = '';
      let depth = 0;
      let paren = 0;
      const trimEnd = () => { out = out.replace(/[ \t]+$/, ''); };
      const nl = () => { trimEnd(); out += '\n' + indent.repeat(depth); };
      const endsWs = () => out === '' || /\s$/.test(out);

      for (let i = 0; i < toks.length; i++) {
        const tok = toks[i];
        const prev = toks[i - 1];
        const prev2 = toks[i - 2];
        const v = tok.v;

        if (tok.t === 'comment') {
          if (!endsWs()) out += ' ';
          out += v;
          nl();
          continue;
        }

        // Blank line between top-level definitions.
        if (depth === 0 && paren === 0 && isP(prev, '}')) {
          out = out.replace(/\s+$/, '') + '\n\n';
        }

        if (paren > 0) {
          // Inside arguments / variable definitions: keep inline, re-insert commas.
          if (startsValue(tok) && isValueEnd(prev)) { trimEnd(); out += ', '; }
          if (tok.t === 'punct') {
            switch (v) {
              case '(': paren++; out += '('; continue;
              case ')': paren--; trimEnd(); out += ')'; continue;
              case ':': trimEnd(); out += ': '; continue;
              case '=': trimEnd(); out += ' = '; continue;
              case ']': case '}': trimEnd(); out += v; continue;
              case '@': if (!endsWs() && !isP(prev, '(', '[', '{')) out += ' '; out += '@'; continue;
              default: out += v; continue;
            }
          }
          out += v;
          continue;
        }

        if (tok.t === 'punct') {
          switch (v) {
            case '{':
              trimEnd();
              out += (out && !/\n$/.test(out) ? ' ' : '') + '{';
              depth++;
              nl();
              continue;
            case '}':
              depth = Math.max(0, depth - 1);
              nl();
              out += '}';
              continue;
            case '(': trimEnd(); out += '('; paren++; continue;
            case ')': trimEnd(); out += ')'; continue;
            case ':': trimEnd(); out += ': '; continue;
            case '=': trimEnd(); out += ' = '; continue;
            case '|': trimEnd(); out += ' | '; continue;
            case '&': trimEnd(); out += ' & '; continue;
            case '!': case ']': trimEnd(); out += v; continue;
            default: break; // '$', '@', '[', '...' fall through to generic handling
          }
        }

        // New selection / field begins on its own line.
        const isItemStart = tok.t === 'name' || isP(tok, '...');
        const afterInlineFragOn = prev && prev.v === 'on' && isP(prev2, '...');
        if (depth > 0 && isItemStart && isValueEnd(prev) && !afterInlineFragOn) {
          nl();
        } else if (!endsWs() && !isP(prev, '(', '[', '$', '@') && !(isP(prev, '...') && v !== 'on')) {
          out += ' ';
        }
        out += v;
      }
      return out.trim();
    } catch (err) {
      return src;
    }
  }

  /** Parse operations (type, name, root fields) from a GraphQL document. */
  function parseOperations(src) {
    const ops = [];
    if (typeof src !== 'string') return ops;
    const toks = tokenize(src).filter((t) => t.t !== 'comment');
    let depth = 0;
    let paren = 0;
    let current = null;
    let inFragment = false;
    for (let i = 0; i < toks.length; i++) {
      const tok = toks[i];
      if (tok.t === 'punct') {
        if (tok.v === '(') paren++;
        else if (tok.v === ')') paren--;
        else if (tok.v === '{' && paren === 0) {
          if (depth === 0 && !current && !inFragment) {
            current = { type: 'query', name: null, rootFields: [] };
            ops.push(current);
          }
          depth++;
        } else if (tok.v === '}' && paren === 0) {
          depth--;
          if (depth === 0) { current = null; inFragment = false; }
        }
        continue;
      }
      if (tok.t !== 'name' || paren > 0) continue;
      if (depth === 0) {
        if (['query', 'mutation', 'subscription'].includes(tok.v) && !current) {
          current = { type: tok.v, name: null, rootFields: [] };
          const next = toks[i + 1];
          if (next && next.t === 'name') { current.name = next.v; i++; }
          ops.push(current);
        } else if (tok.v === 'fragment') {
          inFragment = true;
        }
        continue;
      }
      if (depth === 1 && current) {
        const prev = toks[i - 1];
        const next = toks[i + 1];
        if (isP(next, ':')) continue; // alias
        if (isP(prev, '@', '...')) continue; // directive / fragment spread
        if (prev && prev.v === 'on' && isP(toks[i - 2], '...')) continue;
        if (tok.v === 'on' && isP(prev, '...')) continue;
        if (!current.rootFields.includes(tok.v)) current.rootFields.push(tok.v);
      }
    }
    return ops;
  }

  function tryJson(text) {
    if (typeof text !== 'string') return undefined;
    try { return JSON.parse(text); } catch (e) { return undefined; }
  }

  function looksLikeGraphQLPayload(p, url) {
    if (!p || typeof p !== 'object' || Array.isArray(p)) return false;
    if (typeof p.query === 'string' && /[{}]/.test(p.query)) return true;
    if (p.extensions && p.extensions.persistedQuery) return true;
    return typeof p.operationName === 'string' && /graphql/i.test(url || '');
  }

  function payloadsFromMultipart(text) {
    // graphql-multipart-request-spec: the JSON lives in the "operations" part.
    const m = /name="operations"\r?\n(?:[^\r\n]+\r?\n)*\r?\n([\s\S]*?)\r?\n--/.exec(text || '');
    return m ? tryJson(m[1]) : undefined;
  }

  /** Extract GraphQL operations from a HAR entry, or null if it isn't GraphQL. */
  function extractFromEntry(entry) {
    const req = entry && entry.request;
    if (!req) return null;
    const url = req.url || '';
    let payloads = [];
    const text = req.postData && req.postData.text;

    if (text) {
      let parsed = tryJson(text);
      if (parsed === undefined && /multipart/i.test(req.postData.mimeType || '')) parsed = payloadsFromMultipart(text);
      if (parsed === undefined && /application\/graphql/i.test(req.postData.mimeType || '')) parsed = { query: text };
      if (parsed !== undefined) payloads = Array.isArray(parsed) ? parsed : [parsed];
    } else if (req.method === 'GET' && Array.isArray(req.queryString)) {
      const qs = {};
      for (const { name, value } of req.queryString) qs[name] = safeDecode(value);
      if (qs.query || qs.extensions || (qs.operationName && /graphql/i.test(url))) {
        payloads = [{
          query: qs.query,
          operationName: qs.operationName,
          variables: qs.variables !== undefined ? (tryJson(qs.variables) ?? qs.variables) : undefined,
          extensions: qs.extensions !== undefined ? (tryJson(qs.extensions) ?? qs.extensions) : undefined,
        }];
      }
    }

    const gqlPayloads = payloads.filter((p) => looksLikeGraphQLPayload(p, url));
    if (!gqlPayloads.length) return null;

    const operations = gqlPayloads.map((p) => {
      const parsed = parseOperations(p.query);
      const op = (p.operationName && parsed.find((o) => o.name === p.operationName)) || parsed[0] || null;
      return {
        name: p.operationName || (op && op.name) || null,
        type: op ? op.type : 'unknown',
        rootFields: op ? op.rootFields : [],
        query: typeof p.query === 'string' ? p.query : null,
        variables: p.variables,
        extensions: p.extensions,
        persisted: typeof p.query !== 'string',
      };
    });
    return { batched: gqlPayloads.length > 1, operations };
  }

  function safeDecode(v) {
    try { return decodeURIComponent(String(v).replace(/\+/g, ' ')); } catch (e) { return v; }
  }

  /** Collect GraphQL errors from a response body (single or batched). */
  function responseErrors(text) {
    const json = tryJson(text);
    if (json === undefined) return [];
    const list = Array.isArray(json) ? json : [json];
    const errors = [];
    for (const item of list) {
      if (item && Array.isArray(item.errors)) errors.push(...item.errors);
    }
    return errors;
  }

  // ---------- GraphQL over WebSocket (graphql-ws and legacy subscriptions-transport-ws) ----------

  const WS_TYPES = new Set([
    'connection_init', 'connection_ack', 'connection_error', 'connection_terminate', 'ping', 'pong', 'ka',
    'subscribe', 'next', 'error', 'complete', 'start', 'stop', 'data',
  ]);

  /** Parse one socket message; returns null when it isn't a GraphQL transport message. */
  function parseSocketMessage(text) {
    const msg = tryJson(text);
    if (!msg || typeof msg !== 'object' || Array.isArray(msg) || !WS_TYPES.has(msg.type)) return null;
    const out = { type: msg.type, id: msg.id != null ? String(msg.id) : null, op: null, errors: [] };
    const p = msg.payload;
    if ((msg.type === 'subscribe' || msg.type === 'start') && p && (typeof p.query === 'string' || (p.extensions && p.extensions.persistedQuery))) {
      const parsed = parseOperations(p.query);
      const op = (p.operationName && parsed.find((o) => o.name === p.operationName)) || parsed[0] || null;
      out.op = {
        name: p.operationName || (op && op.name) || null,
        type: op ? op.type : 'unknown',
        rootFields: op ? op.rootFields : [],
        query: typeof p.query === 'string' ? p.query : null,
        variables: p.variables,
        extensions: p.extensions,
        persisted: typeof p.query !== 'string',
      };
    }
    if ((msg.type === 'next' || msg.type === 'data') && p && Array.isArray(p.errors)) out.errors = p.errors;
    if (msg.type === 'error') out.errors = Array.isArray(p) ? p : (p ? [p] : []);
    return out;
  }

  // ---------- highlighting (returns HTML) ----------

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  const KEYWORDS = new Set(['query', 'mutation', 'subscription', 'fragment', 'on', 'true', 'false', 'null',
    'type', 'input', 'enum', 'interface', 'union', 'scalar', 'schema', 'extend', 'directive', 'implements']);
  const GQL_HL_RE = /("""[\s\S]*?"""|"(?:\\.|[^"\\\n])*")|(#[^\n]*)|(\$[_A-Za-z]\w*)|(@[_A-Za-z]\w*)|(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)|([_A-Za-z]\w*)/g;

  function highlight(code) {
    let html = '';
    let last = 0;
    GQL_HL_RE.lastIndex = 0;
    let m;
    while ((m = GQL_HL_RE.exec(code))) {
      html += escapeHtml(code.slice(last, m.index));
      const [tok, str, comment, variable, directive, num, name] = m;
      let cls;
      if (str) cls = 'tk-str';
      else if (comment) cls = 'tk-comment';
      else if (variable) cls = 'tk-var';
      else if (directive) cls = 'tk-dir';
      else if (num) cls = 'tk-num';
      else if (name) {
        const rest = code.slice(m.index + tok.length);
        if (KEYWORDS.has(name)) cls = 'tk-kw';
        else if (/^\s*:/.test(rest)) cls = 'tk-attr';
        else if (/^[A-Z]/.test(name)) cls = 'tk-type';
        else cls = 'tk-field';
      }
      html += `<span class="${cls}">${escapeHtml(tok)}</span>`;
      last = m.index + tok.length;
    }
    return html + escapeHtml(code.slice(last));
  }

  const JSON_HL_RE = /("(?:\\.|[^"\\])*")(\s*:)?|\b(true|false)\b|\b(null)\b|(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)/g;

  function highlightJson(code) {
    let html = '';
    let last = 0;
    JSON_HL_RE.lastIndex = 0;
    let m;
    while ((m = JSON_HL_RE.exec(code))) {
      html += escapeHtml(code.slice(last, m.index));
      const [tok, str, colon, bool, nul, num] = m;
      if (str) html += `<span class="${colon ? 'tk-key' : 'tk-str'}">${escapeHtml(str)}</span>${colon ? escapeHtml(colon) : ''}`;
      else if (bool) html += `<span class="tk-kw">${tok}</span>`;
      else if (nul) html += `<span class="tk-null">${tok}</span>`;
      else if (num) html += `<span class="tk-num">${tok}</span>`;
      last = m.index + tok.length;
    }
    return html + escapeHtml(code.slice(last));
  }

  const api = {
    tokenize, format, parseOperations, extractFromEntry, responseErrors, parseSocketMessage,
    highlight, highlightJson, escapeHtml, tryJson,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.GraphQLUtils = api;
})(typeof window !== 'undefined' ? window : globalThis);
