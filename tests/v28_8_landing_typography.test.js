const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const publicDir = path.join(__dirname, '..', 'public');
const css = fs.readFileSync(path.join(publicDir,'landing-v23.css'),'utf8');
const sw = fs.readFileSync(path.join(publicDir,'firebase-messaging-sw.js'),'utf8');
const decouvrir = fs.readFileSync(path.join(publicDir,'decouvrir.html'),'utf8');
const contact = fs.readFileSync(path.join(publicDir,'contact.html'),'utf8');
const app = fs.readFileSync(path.join(publicDir,'app.js'),'utf8');
test('v28.8: public header has no divider in resting and scrolled states', () => {
  assert.match(css, /\.lp-page \.lp-header,\.lp-page \.lp-header\.lp-scrolled\{border-bottom:0;box-shadow:none\}/);
  assert.match(css, /\.lp-header\{[^}]*border-bottom:0;box-shadow:none;/);
});
test('v28.8: public eyebrow labels are readable and no longer overly tracked', () => {
  assert.match(css, /\.lp-page \.mk-section-head>span,\.lp-page \.mk-eyebrow,\.lp-page \.mk-final-cta>div>span\{[^}]*font-size:13px;[^}]*letter-spacing:\.015em;[^}]*text-transform:none/);
  assert.match(css, /\.lp-preview-label,\.lp-overline\{font-size:12px/);
  assert.match(css, /font-family:system-ui,-apple-system/);
  for (const html of [decouvrir,contact,app]) {
    assert.match(html, /class="lp-header"/);
  }
  assert.match(decouvrir, /Présentation mobile/);
  assert.match(decouvrir, /Aperçu interactif/);
});
test('v28.8: service worker cache is incremented for typography',()=>{
  assert.match(sw, /kortiz-v28-8-typographie-landing/);
  assert.match(sw, /'\/landing-v23\.css'/);
});
