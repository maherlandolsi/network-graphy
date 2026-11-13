/*
 * Export / import helpers: cURL, fetch(), Postman collection v2.1, HAR 1.2.
 * Pure functions over HAR-shaped request objects. Browser: window.Exporters; Node: module.exports.
 */
(function (root) {
  'use strict';

  const G = typeof module !== 'undefined' && module.exports ? require('./graphql.js') : root.GraphQLUtils;

  // Headers that page scripts (fetch) can't set, or that tools fill in themselves.
  const FORBIDDEN_HEADER = /^(:|sec-|proxy-)|^(accept-charset|accept-encoding|access-control-request-headers|access-control-request-method|connection|content-length|cookie|cookie2|date|dnt|expect|host|keep-alive|origin|referer|te|trailer|transfer-encoding|upgrade|via|user-agent)$/i;
  const CURL_SKIP_HEADER = /^(:|content-length$|host$|connection$)/i;

  const tryJson = (t) => { try { return JSON.parse(t); } catch (e) { return undefined; } };
  const shellQuote = (s) => `'${String(s).replace(/'/g, `'\\''`)}'`;
  const indent = (s, pad = '  ') => s.replace(/\n/g, `\n${pad}`);

  function toCurl(req) {
    const lines = [`curl ${shellQuote(req.url)}`];
    if (req.method && req.method !== 'GET') lines.push(`-X ${req.method}`);
    for (const { name, value } of req.headers || []) {
      if (CURL_SKIP_HEADER.test(name)) continue;
      lines.push(`-H ${shellQuote(`${name}: ${value}`)}`);
    }
    if (req.postData && req.postData.text) lines.push(`--data-raw ${shellQuote(req.postData.text)}`);
    return lines.join(' \\\n  ');
  }

  function toFetch(req) {
    const headers = {};
    for (const { name, value } of req.headers || []) {
      if (!FORBIDDEN_HEADER.test(name)) headers[name] = value;
    }
    const opts = [];
    if (req.method && req.method !== 'GET') opts.push(`  method: ${JSON.stringify(req.method)},`);
    if (Object.keys(headers).length) opts.push(`  headers: ${indent(JSON.stringify(headers, null, 2))},`);
    const text = req.postData && req.postData.text;
    if (text) {
      const json = tryJson(text);
      opts.push(json !== null && typeof json === 'object'
        ? `  body: JSON.stringify(${indent(JSON.stringify(json, null, 2))}),`
        : `  body: ${JSON.stringify(text)},`);
    }
    opts.push('  credentials: "include",');
    return `await fetch(${JSON.stringify(req.url)}, {\n${opts.join('\n')}\n});`;
  }

  // ---------- Postman ----------

  function postmanUrl(raw) {
    try {
      const u = new URL(raw);
      const url = {
        raw,
        protocol: u.protocol.replace(/:$/, ''),
        host: u.hostname.split('.'),
        path: u.pathname.split('/').filter(Boolean),
      };
      if (u.port) url.port = u.port;
      const query = [...u.searchParams].map(([key, value]) => ({ key, value }));
      if (query.length) url.query = query;
      return url;
    } catch (e) {
      return { raw };
    }
  }

  /** item: { name, request (HAR request), gql? (from GraphQLUtils.extractFromEntry) } */
  function postmanItem({ name, request, gql }) {
    const header = (request.headers || [])
      .filter((x) => !FORBIDDEN_HEADER.test(x.name))
      .map((x) => ({ key: x.name, value: x.value }));
    const req = { method: request.method || 'GET', header, url: postmanUrl(request.url) };
    const text = request.postData && request.postData.text;
    const op = gql && !gql.batched ? gql.operations[0] : null;
    // Postman's GraphQL body has no operationName, so only use it for single-operation documents.
    const singleOpDoc = op && op.query && G.parseOperations(op.query).length <= 1;
    if (singleOpDoc && req.method !== 'GET') {
      req.body = {
        mode: 'graphql',
        graphql: {
          query: G.format(op.query),
          variables: op.variables != null ? JSON.stringify(op.variables, null, 2) : '',
        },
      };
    } else if (text) {
      const json = tryJson(text);
      req.body = {
        mode: 'raw',
        raw: json !== undefined ? JSON.stringify(json, null, 2) : text,
        options: { raw: { language: json !== undefined ? 'json' : 'text' } },
      };
    }
    return { name: name || `${req.method} ${request.url}`, request: req, response: [] };
  }

  function toPostmanCollection(name, items) {
    return {
      info: {
        name,
        schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json',
      },
      item: items.map(postmanItem),
    };
  }

  // ---------- HAR ----------

  /** record: { entry, content, encoding, socket? } as used by the panel. */
  function recordToHarEntry(r) {
    const e = JSON.parse(JSON.stringify(r.entry));
    e.response = e.response || {};
    e.response.content = Object.assign({}, e.response.content);
    if (r.content != null) {
      e.response.content.text = r.content;
      if (r.encoding === 'base64') e.response.content.encoding = 'base64';
    }
    if (r.socket) {
      // Same shape Chrome DevTools uses, so the file opens there too.
      e._webSocketMessages = r.socket.messages.map((m) => ({
        type: m.dir === 'out' ? 'send' : 'receive',
        time: m.time / 1000,
        opcode: m.binary != null ? 2 : 1,
        data: m.data != null ? m.data : '',
      }));
      e._networkPlusSocket = { kind: r.socket.kind, protocol: r.socket.protocol || '', state: r.socket.state };
    }
    return e;
  }

  function toHar(records, { version = 'dev' } = {}) {
    return {
      log: {
        version: '1.2',
        creator: { name: 'Network+', version },
        pages: [],
        entries: records.map(recordToHarEntry),
      },
    };
  }

  function fromHar(json) {
    const log = json && json.log;
    if (!log || !Array.isArray(log.entries)) throw new Error('Not a HAR file (missing log.entries)');
    return log.entries.map((raw) => {
      const entry = JSON.parse(JSON.stringify(raw));
      entry.request = Object.assign({ method: 'GET', url: '', headers: [], queryString: [] }, entry.request);
      entry.response = Object.assign({ status: 0, statusText: '', headers: [] }, entry.response);
      entry.response.content = Object.assign({ mimeType: '', size: -1 }, entry.response.content);
      entry.timings = entry.timings || {};
      const content = entry.response.content.text != null ? entry.response.content.text : null;
      const encoding = entry.response.content.encoding || null;
      delete entry.response.content.text;
      delete entry._webSocketMessages;
      const rec = { entry, content, encoding };
      if (Array.isArray(raw._webSocketMessages)) {
        const meta = raw._networkPlusSocket || {};
        rec.socket = {
          kind: meta.kind || 'ws',
          protocol: meta.protocol || '',
          state: 'closed',
          messages: raw._webSocketMessages.map((m) => (m.opcode === 2
            ? { dir: m.type === 'send' ? 'out' : 'in', time: Math.round(m.time * 1000), binary: (m.data || '').length }
            : { dir: m.type === 'send' ? 'out' : 'in', time: Math.round(m.time * 1000), data: m.data != null ? String(m.data) : '' })),
        };
      }
      return rec;
    });
  }

  const api = { FORBIDDEN_HEADER, toCurl, toFetch, postmanItem, toPostmanCollection, toHar, fromHar, recordToHarEntry };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Exporters = api;
})(typeof window !== 'undefined' ? window : globalThis);
