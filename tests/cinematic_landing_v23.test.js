const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.resolve(__dirname,'..');
const read=p=>fs.readFileSync(path.join(root,p),'utf8');

const html=read('public/decouvrir.html');
const app=read('public/app.js');
const landingCss=read('public/landing-v23.css');
const landingJs=read('public/landing-v23.js');

test('landing publique conserve ses 7 FAQ, contact et liens légaux, lisibles sans Firebase',()=>{
  assert.equal((html.match(/class="mk-faq-item"/g)||[]).length,7);
  assert.match(html,/href="\/contact\.html"/);
  assert.match(read('public/contact.html'), /carlxwj@gmail\.com/);
  for(const section of ['fonctionnalites','faq','apropos','confiance'])
    assert.match(html,new RegExp(`id="${section}"`));
  for(const legal of ['privacy','terms','notice','cookies'])
    assert.match(html,new RegExp(`/legal\\.html#${legal}`));
  assert.match(html,/meta[^>]*name="robots"/);
});

test('landing garde un seul choix principal Get started conduisant au guide',()=>{
  assert.equal((html.match(/data-landing-go="guide"/g)||[]).length,3); // hero + pied de page + menu mobile
  assert.equal((html.match(/>Commencer(?:\s|<)/g)||[]).length,3);
  assert.doesNotMatch(html,/href="\/\?entry=signup"/);
  assert.doesNotMatch(html,/Voir le guide|Créer un compte/);
  assert.match(html,/href="\/\?entry=login"/);
  assert.match(app,/const content = `<div aria-label="Présentation de Kortiz" class="mk-page lp-page"/);
  assert.match(app,/window\.KortizLanding\?\.init/);
});

test('transitions et navigation accessible pour PC, mobile et préférences réduites',()=>{
  assert.match(html,/aria-expanded="false"/);
  assert.match(html,/aria-controls="lp-nav"/);
  assert.match(landingJs,/scrollIntoView\(\{behavior:/);
  assert.match(landingJs,/classList\.add\('lp-leaving'\)/);
  assert.match(landingJs,/aria-expanded/);
  assert.match(landingCss,/@media\(max-width:700px\)/);
  assert.match(landingCss,/@media\(max-width:380px\)/);
  assert.match(landingCss,/prefers-reduced-motion:reduce/);
  assert.match(landingCss,/\.lp-nav\.lp-open/);
});

test('aucune migration backend ni nouveau runtime requis pour le style',()=>{
  const main=read('public/index.html');
  const sw=read('public/firebase-messaging-sw.js');
  assert.match(main,/landing-v23\.css/);
  assert.match(main,/design-v23\.css/);
  assert.match(main,/landing-v23\.js/);
  assert.match(sw,/kortiz-v28-(?:14-calendar-polls-recurring|2-currency-fix|4-chat-polls-mobile|5-account-security|6-auth-profiles|7-google-popup|8-typographie-landing)/);
  assert.match(sw,/landing-v23\.css/);
  assert.match(html,/google-adsense-account[^>]+ca-pub-4201455737479851/);
  assert.match(main,/google-adsense-account[^>]+ca-pub-4201455737479851/);
});

test('titres majeurs de la nouvelle vitrine sont traduisibles',()=>{
  const i18n=read('public/i18n.js');
  for(const phrase of ['Les dépenses de groupe.','Sans prise de tête.','Gratuit pour commencer','LES SOLDES','UN MÊME ESPACE POUR'])
    assert.ok(i18n.includes(phrase),phrase);
});
