#!/usr/bin/env node
/*
 * Dev server for trying Network+ end to end. No dependencies.
 *   node test/server.js         → http://localhost:8000/test/live.html
 * Serves the project files, plus:
 *   ws://localhost:8000/graphql  minimal graphql-transport-ws server (subscriptions tick 5×)
 *   /sse                         Server-Sent Events stream
 *   /graphql (POST)              tiny GraphQL-ish endpoint (echoes operationName)
 */
'use strict';
const http = require('http');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const PORT = Number(process.env.PORT) || 8000;
const ROOT = path.resolve(__dirname, '..');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml' };

function serveStatic(req, res) {
  const urlPath = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  const file = path.resolve(ROOT, `.${urlPath === '/' ? '/test/live.html' : urlPath}`);
  if (!file.startsWith(ROOT + path.sep)) { res.writeHead(403); res.end(); return; }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); res.end('Not found'); return; }
    res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream' });
    res.end(data);
  });
}

function graphqlHttp(req, res) {
  let body = '';
  req.on('data', (c) => { body += c; });
  req.on('end', () => {
    let payload;
    try { payload = JSON.parse(body); } catch (e) { payload = {}; }
    const reply = (p) => ({ data: { echo: { operationName: p.operationName || null, variables: p.variables || null, at: new Date().toISOString() } } });
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify(Array.isArray(payload) ? payload.map(reply) : reply(payload)));
  });
}

function sse(req, res) {
  res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' });
  let n = 0;
  const timer = setInterval(() => {
    n++;
    res.write(n % 2 ? `event: price\ndata: ${JSON.stringify({ sku: 'MS-365-E3', price: 32 + n / 10 })}\n\n` : `data: ${JSON.stringify({ heartbeat: n })}\n\n`);
    if (n >= 6) { clearInterval(timer); res.end(); }
  }, 800);
  req.on('close', () => clearInterval(timer));
}

// ---------- minimal WebSocket framing ----------

function wsSend(socket, text) {
  const data = Buffer.from(text);
  let header;
  if (data.length < 126) header = Buffer.from([0x81, data.length]);
  else if (data.length < 65536) header = Buffer.from([0x81, 126, data.length >> 8, data.length & 255]);
  else { header = Buffer.alloc(10); header[0] = 0x81; header[1] = 127; header.writeBigUInt64BE(BigInt(data.length), 2); }
  socket.write(Buffer.concat([header, data]));
}

function wsFrames(socket, onText) {
  let buf = Buffer.alloc(0);
  socket.on('data', (chunk) => {
    buf = Buffer.concat([buf, chunk]);
    while (buf.length >= 2) {
      const opcode = buf[0] & 0x0f;
      let len = buf[1] & 0x7f;
      let off = 2;
      if (len === 126) { if (buf.length < 4) return; len = buf.readUInt16BE(2); off = 4; }
      else if (len === 127) { if (buf.length < 10) return; len = Number(buf.readBigUInt64BE(2)); off = 10; }
      if (buf.length < off + 4 + len) return;
      const mask = buf.subarray(off, off + 4);
      const payload = Buffer.from(buf.subarray(off + 4, off + 4 + len)).map((b, i) => b ^ mask[i % 4]);
      buf = buf.subarray(off + 4 + len);
      if (opcode === 8) { socket.end(Buffer.from([0x88, 0])); return; }
      if (opcode === 1) onText(Buffer.from(payload).toString());
    }
  });
}

function graphqlWs(req, socket) {
  const accept = crypto.createHash('sha1').update(`${req.headers['sec-websocket-key']}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`).digest('base64');
  const wantsProto = String(req.headers['sec-websocket-protocol'] || '').split(',').map((s) => s.trim());
  const proto = wantsProto.includes('graphql-transport-ws') ? 'graphql-transport-ws' : null;
  socket.write(['HTTP/1.1 101 Switching Protocols', 'Upgrade: websocket', 'Connection: Upgrade', `Sec-WebSocket-Accept: ${accept}`,
    proto ? `Sec-WebSocket-Protocol: ${proto}` : null, '', ''].filter((l) => l !== null).join('\r\n'));
  const timers = new Map();
  socket.on('close', () => timers.forEach(clearInterval));
  socket.on('error', () => timers.forEach(clearInterval));
  wsFrames(socket, (text) => {
    let msg;
    try { msg = JSON.parse(text); } catch (e) { return; }
    if (msg.type === 'connection_init') wsSend(socket, JSON.stringify({ type: 'connection_ack' }));
    else if (msg.type === 'ping') wsSend(socket, JSON.stringify({ type: 'pong' }));
    else if (msg.type === 'subscribe') {
      let n = 0;
      const timer = setInterval(() => {
        n++;
        const fail = msg.payload && /Broken/.test(msg.payload.operationName || '');
        wsSend(socket, JSON.stringify(fail
          ? { id: msg.id, type: 'next', payload: { data: null, errors: [{ message: 'Subscription failed on purpose', path: ['orderUpdated'] }] } }
          : { id: msg.id, type: 'next', payload: { data: { orderUpdated: { id: 7, status: ['NEW', 'PROCESSING', 'PACKED', 'SHIPPED', 'DELIVERED'][n - 1], seq: n } } } }));
        if (n >= 5 || fail) { clearInterval(timer); timers.delete(msg.id); wsSend(socket, JSON.stringify({ id: msg.id, type: 'complete' })); }
      }, 1000);
      timers.set(msg.id, timer);
    } else if (msg.type === 'complete') {
      clearInterval(timers.get(msg.id));
      timers.delete(msg.id);
    }
  });
}

const server = http.createServer((req, res) => {
  const p = new URL(req.url, 'http://x').pathname;
  if (p === '/sse') return sse(req, res);
  if (p === '/slow') { // delays the page load event (used by headless screenshots of test/demo.html)
    const ms = Math.min(5000, Number(new URL(req.url, 'http://x').searchParams.get('ms')) || 500);
    setTimeout(() => { res.writeHead(200, { 'content-type': 'image/gif' }); res.end(Buffer.from('R0lGODlhAQABAAAAACw=', 'base64')); }, ms);
    return undefined;
  }
  if (p === '/graphql' && req.method === 'POST') return graphqlHttp(req, res);
  return serveStatic(req, res);
});
server.on('upgrade', (req, socket) => {
  if (new URL(req.url, 'http://x').pathname === '/graphql') graphqlWs(req, socket);
  else socket.destroy();
});
server.listen(PORT, () => console.log(`Network+ dev server: http://localhost:${PORT}/test/live.html`));
