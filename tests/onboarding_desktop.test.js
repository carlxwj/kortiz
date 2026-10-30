const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const app = fs.readFileSync(path.join(root, 'public/app.js'), 'utf8');
const css = fs.readFileSync(path.join(root, 'public/styles.css'), 'utf8');
const i18n = fs.readFileSync(path.join(root, 'public/i18n.js'), 'utf8');

test('full-width desktop onboarding is not constrained by the narrow auth page', () => {
  assert.match(app, /classList\.toggle\('onboarding-active', onboarding\)/);
  assert.match(css, /body\.bare\.onboarding-active #app/);
  assert.match(css, /body\.onboarding-active #view\{max-width:none!important/);
  assert.match(css, /@media \(min-width:1180px\)/);
  assert.match(css, /grid-template-columns:minmax\(0,1fr\) minmax\(480px,570px\)/);
});

test('first-run onboarding has showcase and accessible step navigation', () => {
  assert.match(app, /class="welcome-showcase"/);
  assert.match(app, /class="welcome-main"/);
  assert.match(app, /class="welcome-stepbar"/);
  assert.match(app, /data-act="onboard-next"/);
  assert.match(app, /id="onboard-profile-form"/);
  assert.match(app, /ACT\['onboard-finish'\]/);
  assert.match(css, /@media \(max-width:759px\)/);
  assert.match(css, /\.welcome-showcase\{display:none\}/);
});

test('desktop showcase copy translated into the priority languages', () => {
  for (const phrase of ['Les comptes entre amis, simplifiés.', 'Partage les dépenses, discute avec tes proches et suis les remboursements sans changer d’application.', 'Guide de bienvenue']) {
    const key = JSON.stringify(phrase).slice(1, -1);
    const line = i18n.split('\n').find(line => line.startsWith('"'+key+'":'));
    assert.ok(line, phrase);
    for (const lang of ['en','pt','es']) assert.match(line, new RegExp('"'+lang+'":"[^"\n]+"'));
  }
});

const rules = fs.readFileSync(path.join(root, 'firestore.rules'), 'utf8');

test('the welcome guide precedes authentication; full names and usernames follow authentication', () => {
  assert.match(app, /if \(!S\.user\) \{[\s\S]*?onboardStep < 3 \? renderOnboarding\(\) : renderAuth\(\)/);
  assert.match(app, /paintWelcomeFrame\(3, content/);
  assert.match(app, /const step = !S\.user \? Math\.max\(1, Math\.min\(S\.ui\.onboardStep \|\| 1,2\)\) : 4;/);
  assert.match(app, /name="givenName"/);
  assert.match(app, /name="familyName"/);
  assert.match(app, /name="handle"/);
  assert.match(app, /ACT\['onboard-finish'\]/);
  assert.match(app, /await call\('saveSocialProfile',\{displayName:name,handle\}\)/);
  assert.match(app, /await saveProfile\(\{displayName:name,givenName:first,familyName:last,onboardingDone:true\}\)/);
  assert.match(app, /if \(!SOC\.self\) \{/);
});

test('Firestore only permits the newly required profile attributes with types and sizes', () => {
  assert.match(rules, /'givenName', 'familyName', 'onboardingDone'/);
  assert.match(rules, /d\.get\('givenName', ''\) is string/);
  assert.match(rules, /d\.get\('familyName', ''\) is string/);
  assert.match(rules, /d\.get\('onboardingDone', false\) is bool/);
  assert.match(rules, /request\.auth\.uid == uid && validUser\(request\.resource\.data\)/);
});

test('four languages translate sign-in and complete-profile step labels', () => {
  for (const phrase of ['Connexion ou inscription','Finalise ton profil','Nom de famille', 'Changer de compte']) {
    const line = i18n.split('\n').find(line => line.startsWith(JSON.stringify(phrase)+':'));
    assert.ok(line, `Missing ${phrase}`);
    for (const lang of ['en','pt','es']) assert.match(line, new RegExp('"'+lang+'":"[^"\n]+"'));
  }
});
