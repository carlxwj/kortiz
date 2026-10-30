'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname, '..', 'public');
const app = fs.readFileSync(path.join(root,'app.js'),'utf8');
const html = fs.readFileSync(path.join(root,'index.html'),'utf8');

test('ACT, INP et CHG initialisés avant tout enregistrement de gestionnaire v28', () => {
  const declaration = app.indexOf('const ACT = {}, INP = {}, CHG = {};');
  assert.ok(declaration > -1, 'les gestionnaires doivent être déclarés');
  assert.equal(app.lastIndexOf('const ACT = {}, INP = {}, CHG = {};'), declaration, 'une seule initialisation');
  const firstAction = app.indexOf("ACT['notification-preference']");
  const groupMute = app.indexOf("ACT['group-mute']");
  assert.ok(firstAction > declaration && groupMute > declaration, 'aucune déclaration tardive provoquant une ReferenceError');
});

test('un filet de sécurité non-module est chargé avant les imports Firebase', () => {
  const first = html.indexOf('<script src="/boot-failsafe.js"></script>');
  const module = html.indexOf('<script type="module" src="/app.js"></script>');
  assert.ok(first !== -1 && module > first);
  const fallback = fs.readFileSync(path.join(root,'boot-failsafe.js'),'utf8');
  assert.match(fallback, /setTimeout\(showStartupFailure, 12000\)/);
  assert.match(fallback, /\/decouvrir\.html/);
});
