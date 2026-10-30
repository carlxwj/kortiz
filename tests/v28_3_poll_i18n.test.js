'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const root=path.join(__dirname,'..');
const app=fs.readFileSync(path.join(root,'public/app.js'),'utf8'),rules=fs.readFileSync(path.join(root,'firestore.rules'),'utf8');
const dict=fs.readFileSync(path.join(root,'public/i18n.js'),'utf8');
const line='Tu peux nous contacter pour un bug visuel, un problème fonctionnel, une question, une suggestion ou une collaboration professionnelle. Nous avons préparé une vraie page de contact avec formulaire et e-mail de destination déjà configuré.';
function localize(lang){
  const mock={documentElement:{dataset:{}},addEventListener:()=>{}};
  const ctx={window:{},document:mock,Node:{TEXT_NODE:3,ELEMENT_NODE:1},MutationObserver:class{observe(){}},navigator:{languages:['fr-FR'],language:'fr-FR'},localStorage:{getItem:()=>lang,setItem:()=>{}},location:{reload:()=>{}}};
  vm.runInNewContext(dict,ctx);
  return ctx.window.KortizI18n;
}
test('v28.3 public landing full contact text is localized consistently',()=>{
  for(const lang of ['fr','en','pt','es']){
    const t=localize(lang).translate;
    assert.ok(t(line).length>60);
    if(lang!=='fr')assert.notEqual(t(line),line,lang);
    assert.equal(t('Ouvrir la page contact')!=='Ouvrir la page contact',lang!=='fr');
    assert.equal(t('Une question, une idée ou un problème ?')!=='Une question, une idée ou un problème ?',lang!=='fr');
  }
});
test('v28.3 screenshots: contact HTML and submit delivery untouched',()=>{
 const contact=fs.readFileSync(path.join(root,'public/contact.html'),'utf8');
 const mail=fs.readFileSync(path.join(root,'public/contact.js'),'utf8');
 assert.match(contact,/id="contact-message"/);
 assert.match(mail,/form\.addEventListener\('submit'/);
 assert.match(mail,/formsubmit\.co\/ajax/);
});
test('v28.3 permission denied polling shows explainable retry, without relaxed access',()=>{
 assert.match(app,/st\.unsubPolls=null;\s*st\.pollsReady=true;st\.pollError=/);
 assert.match(app,/data-act="poll-retry"/);
 assert.match(app,/ACT\['poll-retry'\]=\(\)=>/);
 assert.match(app,/store\.startPolls\(\)/);
 assert.match(rules,/match \/groups\/\{gid\}\/polls\/\{pollId\} \{\s*allow read: if isMember\(gid\)/);
 assert.doesNotMatch(rules,/match \/groups\/\{gid\}\/polls\/\{pollId\} \{\s*allow read: if true/);
});

test('v28.3 textarea placeholder can be localized without translating typed text',()=>{
 assert.match(dict,/if\(n\.matches\('textarea,\[contenteditable\]'\)\)return/);
 assert.doesNotMatch(dict,/if\(n\.matches\('script,style,textarea,\.no-translate'\)\)return/);
});
