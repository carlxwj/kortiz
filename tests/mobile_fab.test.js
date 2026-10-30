const test = require('node:test');
const assert = require('node:assert/strict');
const {readFileSync} = require('node:fs');
const {join} = require('node:path');
const src = readFileSync(join(__dirname, '../public/app.js'), 'utf8');

test('No expense FAB on mobile home even when groups exist', () => {
  const start = src.indexOf('function renderHome()');
  const end = src.indexOf('ACT["open-group"]', start);
  assert.ok(start >= 0 && end > start);
  const home = src.slice(start, end);
  assert.match(home, /nav:\s*mainNav\("home"\),\s*fab:\s*null/);
});

test('Expense FAB appears only in open, unarchived group expense/balance views', () => {
  const start = src.indexOf('function renderGroup()');
  const end = src.indexOf('ACT.unarchive', start);
  assert.ok(start >= 0 && end > start);
  const group = src.slice(start, end);
  assert.match(group, /tab === "expenses"\s*\|\|\s*tab === "balances"/);
  assert.match(group, /!g\.archived\s*\?\s*"Dépense"\s*:\s*null/);
});
