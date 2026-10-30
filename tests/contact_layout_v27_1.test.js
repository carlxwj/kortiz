const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname, '..');
const read = p => fs.readFileSync(path.join(root, p), 'utf8');

test('Contact: padding dedicated to all three issue cards', () => {
  const css = read('public/landing-v23.css');
  const html = read('public/contact.html');
  assert.match(css, /\.lp-page \.lp-contact-reasons > article\s*\{[^}]*padding:19px 21px 20px/s);
  assert.match(css, /\.lp-page \.lp-contact-reasons > article\{padding:18px 18px 19px/);
  for (const label of ['Bug visuel','Bug fonctionnel','Collaboration']) assert.ok(html.includes('<h3>' + label + '</h3>'));
});

test('FormSubmit activation is not described as an email certainly received', () => {
  const js = read('public/contact.js');
  const translations = read('public/i18n.js');
  assert.match(js, /Formulaire en attente d’activation/);
  assert.match(js, /Le message n’est pas encore transmis à Kortiz/);
  assert.doesNotMatch(js, /un e-mail de confirmation a été envoyé à l’adresse Kortiz/);
  assert.match(translations, /FormSubmit demande une confirmation de l’adresse Kortiz/);
});

test('Service worker version bumped to refresh contact CSS', () => {
  assert.match(read('public/firebase-messaging-sw.js'), /kortiz-v28-(?:14-calendar-polls-recurring|2-currency-fix|4-chat-polls-mobile|5-account-security|6-auth-profiles|7-google-popup|8-typographie-landing)/);
});
