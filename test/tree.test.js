const test = require('node:test');
const assert = require('node:assert/strict');
const T = require('../panel/tree.js');

const data = { data: { customer: { id: 'C-42', name: 'Acme', status: 'ACTIVE',
  licenses: { edges: [{ node: { id: 'L-1', sku: 'MS-365-E3', status: 'ACTIVE' } }, { node: { id: 'L-2', sku: 'AZ-RES', status: 'SUSPENDED' } }] } } } };
const paths = (q) => [...T.filterPlan(data, T.compileQuery(q)).hits.keys()];

test('plain term matches keys or values', () => {
  assert.deepEqual(paths('sku'), ['data.customer.licenses.edges[0].node.sku', 'data.customer.licenses.edges[1].node.sku']);
  assert.deepEqual(paths('az-res'), ['data.customer.licenses.edges[1].node.sku']);
});

test('key=value requires both on the same field', () => {
  assert.deepEqual(paths('status=active'), ['data.customer.status', 'data.customer.licenses.edges[0].node.status']);
  assert.deepEqual(paths('sku=active'), []);
});

test('=value and key= restrict to one side', () => {
  assert.deepEqual(paths('=L-2'), ['data.customer.licenses.edges[1].node.id']);
  assert.deepEqual(paths('name='), ['data.customer.name']);
});

test('dotted key part matches the full path', () => {
  assert.deepEqual(paths('node.id'), ['data.customer.licenses.edges[0].node.id', 'data.customer.licenses.edges[1].node.id']);
});

test('pruning keeps original array indexes and ancestors only', () => {
  const plan = T.filterPlan(data, T.compileQuery('=SUSPENDED'));
  const edges = data.data.customer.licenses.edges;
  assert.deepEqual([...plan.show.get(edges)], [1]);
  assert.deepEqual([...plan.show.get(data.data.customer)], ['licenses']);
  assert.equal(plan.any, true);
  assert.equal(T.filterPlan(data, T.compileQuery('nothing-here')).any, false);
});

test('a matching container shows its whole subtree', () => {
  const plan = T.filterPlan(data, T.compileQuery('licenses='));
  assert.equal(plan.show.has(data.data.customer.licenses), false);
  assert.equal(plan.show.has(data.data.customer.licenses.edges), false);
});

test('empty query compiles to null', () => {
  assert.equal(T.compileQuery('   '), null);
});
