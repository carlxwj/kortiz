const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const app = fs.readFileSync(path.join(__dirname,'../public/app.js'),'utf8');
const css = fs.readFileSync(path.join(__dirname,'../public/styles.css'),'utf8');
const i18n = fs.readFileSync(path.join(__dirname,'../public/i18n.js'),'utf8');

const iconKeys = ['home','plane','beer','beach','party','cart','pizza','skier','car','graduation','camping','gamepad','receipt','utensils','calendar','wave','tap','info'];
const symbols = ['🏠','✈️','🍻','🏖️','🎉','🛒','🍕','⛷️','🚗','🎓','🏕️','🎮','🧾','🍽️','📅','👋','👇','ℹ️'];

test('all previously displayed group emoji have outline svg mappings', () => {
  const mapping = app.match(/const GROUP_ICON_TYPES = Object\.freeze\(\{([\s\S]*?)\}\);/);
  assert.ok(mapping);
  for(const emoji of symbols) assert.ok(mapping[1].includes(`'${emoji}'`), `${emoji} is mapped`);
  for(const name of iconKeys) assert.match(app,new RegExp(`^  ${name}: '<(?:path|circle|rect|line|polyline)`, 'm'), `SVG ${name} exists`);
});
test('group symbols use reusable icon across cards, sidebar, header, invitations, picker and print', () => {
  for (const anchor of ['class="sb-emoji">${groupIcon(', 'class="tile group-icon-tile"', 'title: `${groupIcon(', 'data-e="${e}" aria-label="${esc(groupIconLabel(e))}"', 'id="gf-types">${GROUP_TYPES.map', '${groupIcon(g.emoji, "print-group-icon")}']) {
    assert.ok(app.includes(anchor), `missing: ${anchor}`);
  }
  assert.doesNotMatch(app, /\$\{esc\(g\.emoji\)\}/);
  assert.doesNotMatch(app, /\$\{esc\(i\.emoji\)\}/);
  assert.doesNotMatch(app, /\$\{t\.emoji\} \$\{t\.label/);
});
test('picker preserves old saved emoji ids, accessible pressed states, and supports all languages', () => {
  assert.match(app,/data-e="\$\{e\}"/);
  assert.match(app,/aria-pressed="\$\{e === f\.emoji\}"/);
  assert.match(app,/x\.setAttribute\("aria-pressed", String\(yes\)\)/);
  assert.match(i18n,/"Icône du groupe"/);
  assert.match(css,/\.group-icon-picker/);
  assert.match(css,/svg\.i\.group-symbol/);
});
test('styles follow the existing monochrome stroke instead of embedding colored emoji images', () => {
  assert.match(app,/const groupIcon = .*ico\(groupIconKey\(emoji\)/);
  assert.match(css,/svg\.i\{[^}]*stroke:currentColor/);
  assert.doesNotMatch(app,/src="\/icons\/.*\.png"/);
});
