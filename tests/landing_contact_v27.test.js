const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root=path.resolve(__dirname,'..');
const read=f=>fs.readFileSync(path.join(root,f),'utf8');
const landing=read('public/decouvrir.html');
const contact=read('public/contact.html');
const contactJs=read('public/contact.js');
const landingJs=read('public/landing-v23.js');
const landingCss=read('public/landing-v23.css');
const app=read('public/app.js');
const sw=read('public/firebase-messaging-sw.js');

test('la landing comprend les 6 améliorations avec une présentation transparente',()=>{
  for(const id of ['mobile','interactive-preview','cas-usage','retours-usage','guide-iban-wero','confiance'])
    assert.match(landing,new RegExp(`id="${id}"`));
  assert.match(landing,/Ce ne sont pas des avis clients vérifiés/);
  assert.equal((landing.match(/Exemple fictif ·/g)||[]).length,3);
  assert.equal((landing.match(/data-preview-tab="/g)||[]).length,4);
});
test('les deux versions de la landing ont les mêmes composants',()=>{
  for(const str of ['data-preview-tab="budget"','id="retours-usage"','id="lp-faq-search"','id="guide-iban-wero"','id="mobile"']) {
    assert.ok(landing.includes(str),`static ${str}`);
    assert.ok(app.includes(str),`SPA ${str}`);
  }
});
test('header intelligent avec préférence de réduction de mouvement',()=>{
  assert.match(landingJs,/classList\.add\('lp-hidden'\)/);
  assert.match(landingJs,/classList\.remove\('lp-hidden'\)/);
  assert.match(landingCss,/\.lp-header\.lp-hidden/);
  assert.match(landingCss,/prefers-reduced-motion:reduce/);
  assert.match(landingCss,/\.lp-page \.lp-nav\.lp-open\{visibility:visible/);
});
test('recherche FAQ filtre les 7 questions et remet les résultats à zéro',()=>{
  assert.equal((landing.match(/class="mk-faq-item"/g)||[]).length,7);
  assert.match(landingJs,/norm\(item\.textContent\)\.includes\(term\)/);
  assert.match(landingJs,/item\.hidden = !visible/);
  assert.match(landing,/data-faq-clear/);
  assert.match(landing,/id="lp-faq-empty"/);
});
test('mini démo interactive et automatique avec Pause/Lecture',()=>{
  assert.match(landing,/data-preview-play/);
  assert.match(landingJs,/setInterval\(/);
  assert.match(landingJs,/document\.visibilityState/);
  assert.match(landingJs,/ArrowLeft/);
  assert.match(landingJs,/tab\.dataset\.previewTab/);
});
test('le formulaire direct est explicitement configuré vers le destinataire',()=>{
  assert.match(contact,/https:\/\/formsubmit\.co\/ajax\/carlxwj@gmail\.com/);
  assert.match(contact,/https:\/\/formsubmit\.co\/carlxwj@gmail\.com/);
  assert.match(contact,/id="contact-consent"/);
  assert.match(contact,/name="_honey"/);
  assert.match(contactJs,/fetch\(endpoint/);
  assert.match(contactJs,/data\?\.success === true \|\| data\?\.success === 'true'/);
});
test('le formulaire ne promet pas une réception sans réponse confirmée',()=>{
  assert.match(contactJs,/Formulaire en attente d’activation/);
  assert.match(contactJs,/Impossible de confirmer l’envoi/);
  assert.match(contactJs,/fallback\.hidden = false/);
  assert.match(contactJs,/button\.disabled = true/);
});
test('CSP et service worker autorisent le formulaire et sa page sans toucher à l’API bancaire',()=>{
  const firebase=read('firebase.json');
  assert.match(firebase,/https:\/\/formsubmit\.co/);
  assert.match(sw,/kortiz-v28-(?:14-calendar-polls-recurring|2-currency-fix|4-chat-polls-mobile|5-account-security|6-auth-profiles|7-google-popup|8-typographie-landing)/);
  assert.match(sw,/url\.pathname === '\/contact\.html'/);
  assert.match(read('public/sitemap.xml'),/contact\.html/);
  assert.match(read('public/index.html'),/google-adsense-account/);
  assert.doesNotMatch(read('public/index.html'),/adsbygoogle\.js/);
});
test('le formulaire et la landing disposent de traductions supplémentaires',()=>{
  const i18n=read('public/i18n.js');
  for(const phrase of ['Contacte Kortiz.','Envoyer le message','Rechercher une question…','Guide IBAN / Wero','Aperçu interactif']) {
    assert.ok(i18n.includes(JSON.stringify(phrase)),phrase);
  }
});
test('la page Contact est accessible depuis les Réglages',()=>{
  assert.match(app,/Signaler un problème ou proposer une collaboration/);
  assert.match(app,/ACT\[\"open-contact\"\]/);
});
test('aucune Cloud Function nouvelle nécessaire au contact',()=>{
  const fn=read('functions/index.js');
  assert.doesNotMatch(fn,/exports\.sendContactEmail/);
  assert.match(contact,/action="https:\/\/formsubmit\.co\/carlxwj@gmail\.com"/);
});
