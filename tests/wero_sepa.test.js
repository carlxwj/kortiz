const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
const app = fs.readFileSync(path.join(root, 'public/app.js'), 'utf8');
const firestore = fs.readFileSync(path.join(root, 'firestore.rules'), 'utf8');
const functions = fs.readFileSync(path.join(root, 'functions/index.js'), 'utf8');
const i18n = fs.readFileSync(path.join(root, 'public/i18n.js'), 'utf8');

const begin = app.indexOf('function normalizeWeroContact(');
const end = app.indexOf('/* ---------- IBAN & QR SEPA (EPC) ---------- */', begin);
assert.ok(begin > -1 && end > begin);
const normalize = vm.runInNewContext(app.slice(begin, end) + '\n({normalizeWeroContact,isValidWeroContact,weroContactType})');

test('les coordonnées Wero valident un téléphone ou un e-mail sans fabriquer de QR', () => {
  assert.equal(normalize.normalizeWeroContact(' +33 6 12 34 56 78 '), '+33612345678');
  assert.equal(normalize.normalizeWeroContact(' PrEnOm@Example.COM '), 'prenom@example.com');
  assert.equal(normalize.isValidWeroContact('+33612345678'), true);
  assert.equal(normalize.isValidWeroContact('0612345678'), true);
  assert.equal(normalize.isValidWeroContact('user@example.org'), true);
  for (const bad of ['', 'abcdef', '123', 'foo@', 'foo@bar', '+33 0 abc', 'a'.repeat(255)])
    assert.equal(normalize.isValidWeroContact(bad), false, bad);
  assert.equal(normalize.weroContactType('a@example.fr'), 'E-mail');
  assert.equal(normalize.weroContactType('+33611223344'), 'Téléphone');
});

test('Wero et SEPA sont deux modes séparés et aucun paiement n’est réalisé par Kortiz', () => {
  assert.match(app, /data-method="sepa"/);
  assert.match(app, /data-method="wero"/);
  assert.match(app, /qrEncode\(buildEpcPayload/);
  assert.match(app, /Kortiz ne le génère pas/);
  assert.match(app, /await addSettlement\(gid,\{fromId,toId,amountCents:cents\}\)/);
  assert.match(app, /Paiement déclaré : en attente de confirmation du bénéficiaire/);
  assert.doesNotMatch(app, /buildWeroQrPayload|wero:\/\/|wero:\/\//i);
});

test('le contact Wero est privé par défaut et sa diffusion est conditionnée au consentement', () => {
  assert.match(app, /shareWero: false/);
  assert.match(app, /p\.shareWero === true && isValidWeroContact\(p\.weroContact\)/);
  assert.match(app, /if \(shareWero && !weroContact\)/);
  assert.match(app, /Partager mon contact Wero avec mes groupes/);
  assert.match(firestore, /'weroContact', 'shareWero'/);
  assert.match(firestore, /d\.get\('shareWero', false\) is bool/);
  assert.match(firestore, /match \/users\/\{uid\} \{\s*allow read: if signedIn\(\) && request\.auth\.uid == uid;/);
  assert.match(firestore, /'iban', 'weroContact'/);
});

test('contact Wero effacé lors du départ et de la suppression de compte', () => {
  assert.match(app, /action:'leaveGroup'/);
  assert.match(functions, /tx\.update\(mine\.ref,\{leftAt:now,iban:'',weroContact:''/);
  assert.match(functions, /uid: null, iban: '', weroContact: ''/);
});

test('tous les textes du parcours Wero sont présents dans les quatre langues', () => {
  for (const term of ['Contact Wero (facultatif)', 'Partager mon contact Wero avec mes groupes', 'Moyen de remboursement', 'Virement SEPA', 'Destinataire Wero', 'Wero indisponible']) {
    assert.ok(i18n.includes('"' + term + '"'), term);
  }
  for (const lang of ['en','pt','es']) assert.match(i18n,new RegExp('"' + lang + '"'));
});
