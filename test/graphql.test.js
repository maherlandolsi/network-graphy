// Run with: node --test test/
const test = require('node:test');
const assert = require('node:assert/strict');
const G = require('../lib/graphql.js');

test('formats a minified query', () => {
  const q = 'query GetUser($id: ID!, $n: Int = 10) { user(id: $id) { id name posts(first: $n, filter: {a: 1, b: [1, 2]}) { edges { node { ...PostFields title @include(if: true) } } } } } fragment PostFields on Post { id }';
  assert.equal(G.format(q), [
    'query GetUser($id: ID!, $n: Int = 10) {',
    '  user(id: $id) {',
    '    id',
    '    name',
    '    posts(first: $n, filter: {a: 1, b: [1, 2]}) {',
    '      edges {',
    '        node {',
    '          ...PostFields',
    '          title @include(if: true)',
    '        }',
    '      }',
    '    }',
    '  }',
    '}',
    '',
    'fragment PostFields on Post {',
    '  id',
    '}',
  ].join('\n'));
});

test('formats aliases, inline fragments and anonymous queries', () => {
  assert.equal(G.format('{me:viewer{... on User{id} __typename}}'), [
    '{',
    '  me: viewer {',
    '    ... on User {',
    '      id',
    '    }',
    '    __typename',
    '  }',
    '}',
  ].join('\n'));
});

test('keeps strings intact', () => {
  assert.equal(G.format('mutation { add(text: "a, b { c }") { id } }'), [
    'mutation {',
    '  add(text: "a, b { c }") {',
    '    id',
    '  }',
    '}',
  ].join('\n'));
});

test('parses operations and root fields', () => {
  assert.deepEqual(G.parseOperations('mutation Save { a: saveUser(x: 1) { id } logEvent }'), [
    { type: 'mutation', name: 'Save', rootFields: ['saveUser', 'logEvent'] },
  ]);
  assert.deepEqual(G.parseOperations('{ viewer { id } }'), [{ type: 'query', name: null, rootFields: ['viewer'] }]);
  assert.deepEqual(G.parseOperations('fragment F on X { a } query Q { b { ...F } }'), [
    { type: 'query', name: 'Q', rootFields: ['b'] },
  ]);
});

test('extracts from POST, batched, GET and persisted entries', () => {
  const post = G.extractFromEntry({ request: { method: 'POST', url: 'https://x/graphql',
    postData: { mimeType: 'application/json', text: JSON.stringify({ query: 'query A { a }', variables: { x: 1 } }) } } });
  assert.equal(post.operations[0].name, 'A');
  assert.deepEqual(post.operations[0].variables, { x: 1 });

  const batch = G.extractFromEntry({ request: { method: 'POST', url: 'https://x/gql',
    postData: { text: JSON.stringify([{ query: '{ a }' }, { query: 'mutation M { b }', operationName: 'M' }]) } } });
  assert.equal(batch.batched, true);
  assert.deepEqual(batch.operations.map((o) => [o.type, o.name]), [['query', null], ['mutation', 'M']]);

  const get = G.extractFromEntry({ request: { method: 'GET', url: 'https://x/graphql?query=...',
    queryString: [{ name: 'query', value: 'query%20G%20%7B%20g%20%7D' }, { name: 'variables', value: '%7B%22a%22%3A1%7D' }] } });
  assert.equal(get.operations[0].name, 'G');
  assert.deepEqual(get.operations[0].variables, { a: 1 });

  const persisted = G.extractFromEntry({ request: { method: 'POST', url: 'https://x/api',
    postData: { text: JSON.stringify({ operationName: 'P', extensions: { persistedQuery: { sha256Hash: 'abc' } } }) } } });
  assert.equal(persisted.operations[0].persisted, true);

  assert.equal(G.extractFromEntry({ request: { method: 'POST', url: 'https://x/api', postData: { text: '{"a":1}' } } }), null);
});

test('collects response errors', () => {
  assert.equal(G.responseErrors('{"data":null,"errors":[{"message":"x"}]}').length, 1);
  assert.equal(G.responseErrors('[{"errors":[{}]},{"errors":[{},{}]}]').length, 3);
  assert.equal(G.responseErrors('not json').length, 0);
});

test('highlight escapes HTML', () => {
  assert.ok(!G.highlight('{ a(x: "<img>") }').includes('<img>'));
  assert.ok(!G.highlightJson('{"a":"<b>"}').includes('<b>'));
});
