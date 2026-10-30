const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');

test('group and private chat listeners start from Firestore document references', () => {
  const app = readFileSync(join(__dirname, '..', 'public', 'app.js'), 'utf8');
  assert.match(app, /const root = scope === 'group'\s*\? doc\(db,'groups',id\)\s*:\s*doc\(db,'directChats',id\)/);
  assert.match(app, /collection\(root,sub\)/);
  assert.doesNotMatch(app, /collection\(db,'groups',id\)/);
  assert.doesNotMatch(app, /collection\(db,'directChats',id\)/);
});
