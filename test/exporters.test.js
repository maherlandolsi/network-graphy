const test = require('node:test');
const assert = require('node:assert/strict');
const X = require('../lib/exporters.js');
const G = require('../lib/graphql.js');

const gqlBody = JSON.stringify({ operationName: 'GetUser', query: 'query GetUser($id: ID!) { user(id: $id) { id } }', variables: { id: 1 } });
const req = {
  method: 'POST',
  url: 'https://api.example.com/graphql?x=1',
  headers: [
    { name: ':authority', value: 'api.example.com' },
    { name: 'content-type', value: 'application/json' },
    { name: 'Cookie', value: 'secret=1' },
    { name: 'authorization', value: "Bearer it's" },
  ],
  postData: { mimeType: 'application/json', text: gqlBody },
};

test('cURL quotes values and skips pseudo headers', () => {
  const curl = X.toCurl(req);
  assert.match(curl, /^curl 'https:\/\/api\.example\.com\/graphql\?x=1'/);
  assert.ok(!curl.includes(':authority'));
  assert.ok(curl.includes(`-H 'authorization: Bearer it'\\''s'`));
  assert.ok(curl.includes('--data-raw'));
});

test('fetch snippet drops forbidden headers and pretty-prints JSON bodies', () => {
  const f = X.toFetch(req);
  assert.ok(f.startsWith('await fetch("https://api.example.com/graphql?x=1", {'));
  assert.ok(f.includes('"method": ') === false && f.includes('method: "POST"'));
  assert.ok(!/cookie/i.test(f));
  assert.ok(f.includes('body: JSON.stringify({'));
  assert.ok(f.includes('credentials: "include"'));
});

test('Postman collection uses GraphQL body mode for single operations', () => {
  const gql = G.extractFromEntry({ request: req });
  const col = X.toPostmanCollection('Test', [{ name: 'GetUser', request: req, gql }]);
  assert.equal(col.info.schema, 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json');
  const item = col.item[0];
  assert.equal(item.request.body.mode, 'graphql');
  assert.match(item.request.body.graphql.query, /query GetUser\(\$id: ID!\) \{\n/);
  assert.deepEqual(JSON.parse(item.request.body.graphql.variables), { id: 1 });
  assert.deepEqual(item.request.url.host, ['api', 'example', 'com']);
  assert.deepEqual(item.request.url.query, [{ key: 'x', value: '1' }]);
  assert.ok(!item.request.header.some((x) => /cookie|:authority/i.test(x.key)));
});

test('Postman falls back to raw JSON for non-GraphQL bodies', () => {
  const item = X.postmanItem({ request: { method: 'PUT', url: 'https://x.dev/a', headers: [], postData: { text: '{"a":1}' } } });
  assert.equal(item.request.body.mode, 'raw');
  assert.equal(item.request.body.options.raw.language, 'json');
});

test('HAR round trip keeps bodies and socket messages', () => {
  const records = [
    { entry: { startedDateTime: '2026-01-01T00:00:00.000Z', time: 12, request: req, response: { status: 200, headers: [], content: { mimeType: 'application/json', size: 2 } }, timings: {} }, content: '{}', encoding: null },
    { entry: { startedDateTime: '2026-01-01T00:00:01.000Z', time: 0, request: { method: 'GET', url: 'wss://x/graphql', headers: [] }, response: { status: 101, headers: [], content: {} }, _resourceType: 'websocket' },
      content: null, encoding: null,
      socket: { kind: 'ws', protocol: 'graphql-transport-ws', state: 'open', messages: [{ dir: 'out', time: 1767225601500, data: '{"type":"connection_init"}' }, { dir: 'in', time: 1767225601600, binary: 4 }] } },
  ];
  const har = X.toHar(records, { version: '1.0' });
  assert.equal(har.log.creator.name, 'Network+');
  assert.equal(har.log.entries[0].response.content.text, '{}');
  assert.equal(har.log.entries[1]._webSocketMessages[0].type, 'send');

  const back = X.fromHar(JSON.parse(JSON.stringify(har)));
  assert.equal(back.length, 2);
  assert.equal(back[0].content, '{}');
  assert.equal(back[0].entry.response.content.text, undefined);
  assert.equal(back[1].socket.protocol, 'graphql-transport-ws');
  assert.deepEqual(back[1].socket.messages[0], { dir: 'out', time: 1767225601500, data: '{"type":"connection_init"}' });
  assert.equal(back[1].socket.messages[1].dir, 'in');
});

test('fromHar rejects non-HAR input', () => {
  assert.throws(() => X.fromHar({ foo: 1 }), /Not a HAR file/);
});

test('parseSocketMessage understands graphql-ws and legacy protocol', () => {
  const sub = G.parseSocketMessage(JSON.stringify({ id: '1', type: 'subscribe', payload: { query: 'subscription OnMsg { messageAdded { id } }' } }));
  assert.deepEqual([sub.type, sub.id, sub.op.name, sub.op.type, sub.op.rootFields], ['subscribe', '1', 'OnMsg', 'subscription', ['messageAdded']]);
  const legacy = G.parseSocketMessage(JSON.stringify({ id: 2, type: 'start', payload: { operationName: 'X', query: 'subscription X { a }' } }));
  assert.equal(legacy.op.name, 'X');
  assert.equal(G.parseSocketMessage(JSON.stringify({ id: '1', type: 'next', payload: { errors: [{ message: 'boom' }] } })).errors.length, 1);
  assert.equal(G.parseSocketMessage('{"type":"chat","text":"hi"}'), null);
  assert.equal(G.parseSocketMessage('hello'), null);
});
