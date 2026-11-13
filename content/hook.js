/*
 * Runs in the page's own JavaScript world (content script with world: MAIN) at
 * document_start. Wraps WebSocket and EventSource to observe their messages
 * without changing behavior, and posts events for content/relay.js to forward.
 * Nothing leaves the page unless DevTools with Network+ is open on this tab
 * (relay.js decides that).
 */
(() => {
  'use strict';
  if (window.__networkPlusHooked) return;
  try { Object.defineProperty(window, '__networkPlusHooked', { value: true }); } catch (e) { return; }

  const SOURCE = 'network-plus-hook';
  const MAX_DATA = 256 * 1024; // per message
  const KEEP_RECENT = 100; // replayed when DevTools opens after the socket was created
  const live = new Map(); // sid -> socket info
  const bySocket = new WeakMap(); // WebSocket/EventSource -> socket info
  let seq = 0;

  const post = (msg) => {
    try { window.postMessage(Object.assign({ source: SOURCE }, msg), '*'); } catch (e) { /* ignore */ }
  };

  function describe(data) {
    if (typeof data === 'string') {
      return data.length > MAX_DATA ? { data: data.slice(0, MAX_DATA), truncated: data.length } : { data };
    }
    if (data instanceof ArrayBuffer) return { binary: data.byteLength };
    if (ArrayBuffer.isView(data)) return { binary: data.byteLength };
    if (data && typeof data.size === 'number') return { binary: data.size }; // Blob
    return { data: String(data) };
  }

  const meta = (s) => ({ sid: s.sid, kind: s.kind, url: s.url, start: s.start, state: s.state, protocol: s.protocol });

  function frame(s, dir, data, event) {
    const f = Object.assign({ dir, time: Date.now() }, describe(data));
    if (event && event !== 'message') f.event = event;
    s.recent.push(f);
    if (s.recent.length > KEEP_RECENT) s.recent.shift();
    post({ kind: 'frame', sid: s.sid, frame: f });
  }

  function setState(s, state, extra) {
    s.state = state;
    post(Object.assign({ kind: 'state', sid: s.sid, state, protocol: s.protocol }, extra));
    if (state === 'closed') setTimeout(() => live.delete(s.sid), 0);
  }

  function track(kind, obj, url) {
    let abs = String(url);
    try { abs = new URL(url, location.href).href; } catch (e) { /* keep */ }
    const s = { sid: `${Date.now().toString(36)}-${++seq}`, kind, url: abs, start: Date.now(), state: 'connecting', protocol: '', recent: [] };
    live.set(s.sid, s);
    bySocket.set(obj, s);
    post({ kind: 'open', socket: meta(s), recent: [] });
    obj.addEventListener('open', () => { s.protocol = obj.protocol || ''; setState(s, 'open'); });
    obj.addEventListener('error', () => { if (kind === 'sse' && obj.readyState === 2) setState(s, 'closed'); else post({ kind: 'state', sid: s.sid, state: s.state, error: true }); });
    obj.addEventListener('message', (e) => frame(s, 'in', e.data));
    if (kind === 'ws') obj.addEventListener('close', (e) => setState(s, 'closed', { code: e.code, reason: e.reason }));
    return s;
  }

  // ---------- WebSocket ----------
  const NativeWS = window.WebSocket;
  if (typeof NativeWS === 'function') {
    const nativeSend = NativeWS.prototype.send;
    NativeWS.prototype.send = function send(data) {
      const s = bySocket.get(this);
      if (s) { try { frame(s, 'out', data); } catch (e) { /* never break the page */ } }
      return nativeSend.call(this, data);
    };
    window.WebSocket = new Proxy(NativeWS, {
      construct(target, args, newTarget) {
        const ws = Reflect.construct(target, args, newTarget);
        try { track('ws', ws, args[0]); } catch (e) { /* ignore */ }
        return ws;
      },
    });
  }

  // ---------- EventSource ----------
  const NativeES = window.EventSource;
  if (typeof NativeES === 'function') {
    const nativeAdd = NativeES.prototype.addEventListener;
    const watched = new WeakMap(); // EventSource -> Set of named event types already recorded
    NativeES.prototype.addEventListener = function addEventListener(type, ...rest) {
      const s = bySocket.get(this);
      if (s && typeof type === 'string' && !['open', 'error', 'message'].includes(type)) {
        let set = watched.get(this);
        if (!set) { set = new Set(); watched.set(this, set); }
        if (!set.has(type)) {
          set.add(type);
          nativeAdd.call(this, type, (e) => frame(s, 'in', e.data, type));
        }
      }
      return nativeAdd.call(this, type, ...rest);
    };
    window.EventSource = new Proxy(NativeES, {
      construct(target, args, newTarget) {
        const es = Reflect.construct(target, args, newTarget);
        try { track('sse', es, args[0]); } catch (e) { /* ignore */ }
        return es;
      },
    });
  }

  // DevTools opened after sockets were created: re-announce live ones with recent messages.
  window.addEventListener('message', (e) => {
    if (e.source !== window || !e.data || e.data.source !== 'network-plus-relay' || e.data.kind !== 'replay') return;
    for (const s of live.values()) post({ kind: 'open', socket: meta(s), recent: s.recent.slice(), replay: true });
  });
})();
