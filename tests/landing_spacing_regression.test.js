const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const css = fs.readFileSync(require('node:path').join(__dirname,'../public/landing-v23.css'),'utf8');
const html = fs.readFileSync(require('node:path').join(__dirname,'../public/decouvrir.html'),'utf8');
const app = fs.readFileSync(require('node:path').join(__dirname,'../public/app.js'),'utf8');

test('landing: la règle spécifique annule la remise à zéro générale des marges de paragraphes', () => {
  assert.match(css,/\.lp-page h1,\.lp-page h2,\.lp-page h3,\.lp-page p\{margin:0\}/);
  const fix = css.lastIndexOf('/* v25.1');
  assert.ok(fix > 0);
  const overrides = css.slice(fix);
  assert.match(overrides,/\.lp-page \.lp-hero-sub\s*\{\s*margin:clamp\(36px,3\.4vw,52px\) auto 0/);
  assert.match(overrides,/\.lp-page \.lp-hero-micro\s*\{\s*margin:24px auto 0/);
  assert.match(overrides,/@media \(max-width:700px\)/);
  assert.match(overrides,/\.lp-page \.lp-hero-sub\{margin-top:34px/);
  assert.match(overrides,/\.lp-page \.lp-hero-micro\{margin-top:24px/);
});

test('landing intégrée et page publique partagent les mêmes classes de mise en page', () => {
  for(const page of [html,app]) {
    for(const cls of ['lp-hero-sub','lp-hero-micro','lp-button-light']) assert.ok(page.includes(cls),cls);
  }
});
