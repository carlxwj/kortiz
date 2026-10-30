const test = require('node:test');
const assert = require('node:assert/strict');
const {readFileSync} = require('node:fs');
const {join} = require('node:path');
const app = readFileSync(join(__dirname, '..', 'public', 'app.js'), 'utf8');
test('Firestore chat listener errors are saved and displayed, not silently dropped', () => {
  assert.match(app, /SOC\.chatErrors\[sub\]=err\?\.code\|\|'unknown'/);
  assert.match(app, /role=\\?"alert\\?"/);
  assert.match(app, /ACT\['chat-retry'\]/);
});
test('Chat render preserves scroll and composer text while live messages arrive', () => {
  assert.match(app, /const chatScroll = threadBefore/);
  assert.match(app, /chatScroll\?\.stick === false/);
  assert.match(app, /value: \('value' in act \? act\.value : undefined\)/);
  assert.doesNotMatch(app, /if \(scroll\) \{/);
});
