/* Validation locale sans accès au projet Firebase. Lancer : node --test tests/*.test.js */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.join(__dirname, '..');
const app = fs.readFileSync(path.join(root,'public','app.js'),'utf8');
const i18n = fs.readFileSync(path.join(root,'public','i18n.js'),'utf8');

function boot(lang, stored = 'auto') {
  const handlers = {};
  const doc = { documentElement:{lang:'',dataset:{}}, addEventListener:(type,fn)=>{handlers[type]=fn;} };
  const ctx = {
    document:doc,
    navigator:{language:lang, languages:[lang]},
    localStorage:{getItem:()=>stored,setItem:()=>{}},
    location:{reload:()=>{}},
    MutationObserver:class{observe(){}},
    Node:{TEXT_NODE:3,ELEMENT_NODE:1},
    window:{},
  };
  vm.runInNewContext(i18n,ctx);
  return ctx.window.KortizI18n;
}

test('langue automatique et choix manuel',()=>{
  for (const [device,expected,phrase] of [
    ['fr-FR','fr','Connexion'],['en-GB','en','Log in'],['pt-BR','pt','Entrar'],['es-ES','es','Iniciar sesión'],
  ]){
    const t=boot(device);
    assert.equal(t.language(),expected);
    assert.equal(t.translate('Connexion'),phrase);
  }
  assert.equal(boot('de-DE').language(),'en');
  assert.equal(boot('fr-FR','es').language(),'es');
  assert.equal(boot('pt-PT').locale(),'pt-PT');
  assert.equal(boot('pt-BR').locale(),'pt-BR');
});

test('localisation des messages variables',()=>{
  assert.equal(boot('en-US').translate('Salut Marie 👋'),'Hi Marie 👋');
  assert.equal(boot('pt-BR').translate('Dépenses (9)'),'Despesas (9)');
  assert.equal(boot('es-ES').translate('Aujourd\'hui'),'Hoy');
  assert.equal(boot('en-US').translate('Alex a rejoint le groupe'),'Alex joined the group');
  assert.equal(boot('pt-BR').translate('Ana a créé le groupe « Test »'),'Ana criou o grupo “Test”');
  assert.equal(boot('fr-FR').translate('Solde'),'Solde');
});

test('structure et protections de base',()=>{
  const html=fs.readFileSync(path.join(root,'public','index.html'),'utf8');
  const rules=fs.readFileSync(path.join(root,'firestore.rules'),'utf8');
  const config=JSON.parse(fs.readFileSync(path.join(root,'firebase.json'),'utf8'));
  assert.ok(html.includes('/i18n.js') && html.includes('/app.js') && html.includes('/styles.css'));
  assert.equal(html.includes('data-theme'),false);
  assert.equal(app.includes('theme-set'),false);
  assert.ok(app.includes('language-selector'));
  assert.ok(rules.includes('receiptBelongs(gid, eid'));
  assert.ok(rules.includes('resource.data.uid == request.auth.uid'));
  assert.ok(config.hosting.headers.find(h=>h.source==='**').headers.some(h=>h.key==='Content-Security-Policy'));
});

test('saisie monétaire FR/PT/ES/EN et séparateurs de milliers',()=>{
  const begin=app.indexOf('function parseAmountInput(str)');
  const end=app.indexOf('const centsToInput',begin);
  const fn=app.slice(begin,end);
  const testAmount=(input)=>vm.runInNewContext(fn+'parseAmountInput('+JSON.stringify(input)+')');
  assert.equal(testAmount('12,50'),1250);
  assert.equal(testAmount('12.50'),1250);
  assert.equal(testAmount('1.234,56'),123456);
  assert.equal(testAmount('1,234.56'),123456);
  assert.equal(testAmount('abc'),null);
  assert.equal(testAmount('1,234'),123400);
  assert.equal(testAmount('1.234'),123400);
});


test('import de montants avec codes monétaires internationaux',()=>{
  const begin=app.indexOf('function parseLooseAmount(str)');
  const end=app.indexOf('/** \"03/02/2025',begin);
  // La fonction suivante commence après ce bloc et peut être isolée sans dépendances.
  const fn=app.slice(begin,app.indexOf('function parseBankDate',begin));
  const check=(v)=>vm.runInNewContext(fn+'parseLooseAmount('+JSON.stringify(v)+')');
  assert.equal(check('12,50 EUR'),1250);
  assert.equal(check('BRL 2.345,67'),234567);
  assert.equal(check('R$ 123,40'),12340);
  assert.equal(check('-12.30 USD'),-1230);
});
