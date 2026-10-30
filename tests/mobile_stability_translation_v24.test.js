const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const read = f => fs.readFileSync(path.join(root, f), 'utf8');
const landing = read('public/decouvrir.html');
const app = read('public/app.js');
const i18n = read('public/i18n.js');
const base = read('public/styles.css');
const landingCss = read('public/landing-v23.css');

test('CTA commun aux deux landings : source française et traduction pour toutes les langues', () => {
  for (const html of [landing, app]) {
    assert.equal((html.match(/data-landing-go="guide"/g) || []).length, 3);
    assert.equal((html.match(/>Commencer(?:\s|<)/g) || []).length, 3);
    assert.doesNotMatch(html, />Get started(?:\s|<)/);
  }
  const translations = i18n.match(/"Commencer":\s*\{[^}]+\}/)?.[0] || '';
  for (const [lang, label] of [['en','Get started'],['pt','Começar'],['es','Empezar']]) {
    assert.ok(translations.includes(`"${lang}": "${label}"`), `traduction ${lang}`);
  }
});

test('conteneurs principaux et page marketing neutralisent le glissement horizontal mobile', () => {
  assert.match(base, /@media screen and \(max-width:1023px\)/);
  assert.match(base, /html,body\{width:100%;max-width:100%;overflow-x:hidden;overscroll-behavior-x:none\}/);
  assert.match(base, /#shell,#app,#view\{box-sizing:border-box;width:100%;max-width:100%;min-width:0;overflow-x:hidden\}/);
  assert.match(landingCss, /\.lp-page\{overflow-x:hidden;overscroll-behavior-x:none\}/);
});

test('les zones qui défilent réellement conservent le geste horizontal', () => {
  assert.match(base, /\.chips,\.table-wrap,body\[data-route="group"\] #bottomnav \.bar\{overscroll-behavior-x:contain/);
});

test('navbar de la landing descend sur iPhone, avec prise en compte de la safe area', () => {
  assert.match(landingCss, /\.lp-header\{padding-top:calc\(16px \+ env\(safe-area-inset-top,0px\)\);\}/);
  assert.match(landingCss, /\.lp-hero\{padding-top:64px\}/);
});
