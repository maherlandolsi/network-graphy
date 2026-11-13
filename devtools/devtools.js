/*
 * DevTools page: lives as long as the DevTools window is open, so it captures
 * requests even before the panel is first shown. Records are buffered here and
 * streamed to the panel over a BroadcastChannel scoped to the inspected tab.
 */
'use strict';

const MAX_RECORDS = 3000;
const tabId = browser.devtools.inspectedWindow.tabId;
const channel = new BroadcastChannel(`network-plus-${tabId}`);

let buffer = [];
let seq = 0;

browser.devtools.panels.create('Network+', '/icons/icon.svg', `/panel/panel.html?tab=${tabId}`);

function preserveLog() {
  try { return JSON.parse(localStorage.getItem('ni.preserveLog')) === true; } catch (e) { return false; }
}

function getContent(entry) {
  return new Promise((resolve) => {
    let done = false;
    const finish = (content, second) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      // Firefox resolves [content, mimeType]; Chrome calls back (content, encoding).
      const encoding = second === 'base64' ? 'base64' : (entry.response?.content?.encoding || null);
      resolve({ content: typeof content === 'string' ? content : null, encoding });
    };
    const timer = setTimeout(() => finish(null), 10000);
    try {
      const p = entry.getContent((c, e) => finish(c, e));
      if (p && typeof p.then === 'function') {
        p.then((res) => (Array.isArray(res) ? finish(res[0], res[1]) : finish(res)), () => finish(null));
      }
    } catch (err) {
      finish(null);
    }
  });
}

function pushRecord(record) {
  buffer.push(record);
  if (buffer.length > MAX_RECORDS) buffer = buffer.slice(-MAX_RECORDS);
  channel.postMessage({ type: 'entry', record });
}

browser.devtools.network.onRequestFinished.addListener(async (entry) => {
  const id = ++seq;
  const { content, encoding } = await getContent(entry);
  // JSON round-trip drops getContent() and anything else not cloneable.
  const record = { id, entry: JSON.parse(JSON.stringify(entry)), content, encoding };
  // A WebSocket handshake (101) that the socket hook already reports as its own row.
  if (record.entry.response && record.entry.response.status === 101 && recentSocketUrls.has(record.entry.request.url)) return;
  pushRecord(record);
});

browser.devtools.network.onNavigated.addListener((url) => {
  if (!preserveLog()) {
    buffer = [];
    sockets.clear();
  }
  channel.postMessage({ type: 'navigated', url });
});

// ---------- WebSocket / EventSource capture (via content/hook.js → relay.js → background.js) ----------

const MAX_SOCKET_MESSAGES = 5000;
const sockets = new Map(); // `${frameId}:${sid}` -> record
const recentSocketUrls = new Map(); // url -> timestamp, to drop duplicate 101 HAR entries

function rememberSocketUrl(url) {
  recentSocketUrls.set(url, Date.now());
  for (const [u, t] of recentSocketUrls) if (Date.now() - t > 30000) recentSocketUrls.delete(u);
}

function socketEntry(s) {
  let queryString = [];
  try { queryString = [...new URL(s.url).searchParams].map(([name, value]) => ({ name, value })); } catch (e) { /* ignore */ }
  return {
    startedDateTime: new Date(s.start).toISOString(),
    time: 0,
    request: { method: 'GET', url: s.url, httpVersion: '', headers: [], queryString },
    response: {
      status: s.kind === 'ws' ? 101 : 200,
      statusText: s.kind === 'ws' ? 'Switching Protocols' : 'OK',
      httpVersion: '',
      headers: [],
      content: { mimeType: s.kind === 'sse' ? 'text/event-stream' : '', size: 0 },
      bodySize: -1,
      headersSize: -1,
    },
    timings: {},
    _resourceType: s.kind === 'ws' ? 'websocket' : 'eventsource',
  };
}

function onSocketEvent(msg) {
  const key = `${msg.frameId || 0}:${msg.sid || (msg.socket && msg.socket.sid)}`;
  if (msg.kind === 'open') {
    if (sockets.has(key)) return; // replay of a socket we already know
    const s = msg.socket;
    rememberSocketUrl(s.url);
    // Drop a 101 handshake row that arrived before the hook's event.
    const dup = buffer.findIndex((r) => !r.socket && r.entry.response.status === 101 && r.entry.request.url === s.url);
    if (dup >= 0) {
      channel.postMessage({ type: 'remove', id: buffer[dup].id });
      buffer.splice(dup, 1);
    }
    const record = {
      id: ++seq,
      entry: socketEntry(s),
      content: null,
      encoding: null,
      socket: { kind: s.kind, sid: s.sid, protocol: s.protocol || '', state: s.state, messages: (msg.recent || []).slice() },
    };
    sockets.set(key, record);
    pushRecord(record);
    return;
  }
  const record = sockets.get(key);
  if (!record) return;
  if (msg.kind === 'frame') {
    const list = record.socket.messages;
    list.push(msg.frame);
    if (list.length > MAX_SOCKET_MESSAGES) list.splice(0, list.length - MAX_SOCKET_MESSAGES);
    channel.postMessage({ type: 'socketFrame', id: record.id, frame: msg.frame });
  } else if (msg.kind === 'state') {
    Object.assign(record.socket, { state: msg.state, protocol: msg.protocol || record.socket.protocol });
    if (msg.code != null) record.socket.closeCode = msg.code;
    if (msg.reason) record.socket.closeReason = msg.reason;
    if (msg.error) record.socket.error = true;
    channel.postMessage({
      type: 'socketState', id: record.id, state: record.socket.state, protocol: record.socket.protocol,
      closeCode: record.socket.closeCode, closeReason: record.socket.closeReason, error: record.socket.error,
    });
  }
}

let bgPort = null;
function connectBackground() {
  try {
    bgPort = browser.runtime.connect({ name: `np-devtools-${tabId}` });
    bgPort.onMessage.addListener(onSocketEvent);
    // The background event page may be suspended; reconnect so capture keeps working.
    bgPort.onDisconnect.addListener(() => { bgPort = null; setTimeout(connectBackground, 500); });
  } catch (e) {
    setTimeout(connectBackground, 2000);
  }
}
connectBackground();

// ---------- Edit & Resend ----------
// The request is replayed with fetch() inside the inspected page, so it uses the
// page's cookies, origin and CORS rules, and shows up in onRequestFinished.

async function evalInPage(code) {
  try {
    const res = await browser.devtools.inspectedWindow.eval(code);
    const [value, exc] = Array.isArray(res) ? res : [res, null];
    if (exc && (exc.isException || exc.isError)) {
      return { error: exc.isException ? String(exc.value) : (exc.description || exc.code || 'eval failed') };
    }
    return { value };
  } catch (err) {
    return { error: String(err && err.message || err) };
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function resend({ reqId, url, init }) {
  const key = `${Date.now()}-${reqId}`;
  const start = await evalInPage(`(() => {
    const store = (window.__networkPlusResend = window.__networkPlusResend || {});
    const key = ${JSON.stringify(key)};
    const t0 = performance.now();
    store[key] = { pending: true };
    fetch(${JSON.stringify(url)}, ${JSON.stringify(init)})
      .then((r) => { store[key] = { status: r.status, statusText: r.statusText, ms: Math.round(performance.now() - t0) }; })
      .catch((e) => { store[key] = { error: String((e && e.message) || e) }; });
    return true;
  })()`);
  if (start.error) {
    channel.postMessage({ type: 'resendResult', reqId, result: { error: start.error } });
    return;
  }
  const deadline = Date.now() + 120000;
  while (Date.now() < deadline) {
    await sleep(250);
    const poll = await evalInPage(`(() => {
      const store = window.__networkPlusResend || {};
      const s = store[${JSON.stringify(key)}];
      if (s && !s.pending) delete store[${JSON.stringify(key)}];
      return s || null;
    })()`);
    if (poll.error) {
      channel.postMessage({ type: 'resendResult', reqId, result: { error: poll.error } });
      return;
    }
    if (poll.value && !poll.value.pending) {
      channel.postMessage({ type: 'resendResult', reqId, result: poll.value });
      return;
    }
    if (poll.value === null) break; // page navigated away
  }
  channel.postMessage({ type: 'resendResult', reqId, result: { error: 'No result (timed out or page navigated)' } });
}

channel.onmessage = ({ data }) => {
  if (!data) return;
  if (data.type === 'hello') channel.postMessage({ type: 'snapshot', records: buffer });
  else if (data.type === 'clear') { buffer = []; sockets.clear(); }
  else if (data.type === 'resend') resend(data);
};
