'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const project=path.resolve(__dirname,'..');
const app=fs.readFileSync(path.join(project,'public/app.js'),'utf8');
const FX=require('../public/currency-logic.js');
const rules=fs.readFileSync(path.join(project,'firestore.rules'),'utf8');
const sw=fs.readFileSync(path.join(project,'public/firebase-messaging-sw.js'),'utf8');

test('v28.2: currency changes display immediately while Firestore write is pending',()=>{
  assert.match(app,/FX\.pendingCurrency=value;[\s\S]*?scheduleRender\(\);[\s\S]*?refreshExchangeRates\(\)/);
  assert.match(app,/const pref=FX\.pendingCurrency \|\| S\.profile\?\.displayCurrency/);
  assert.match(app,/currencySaving\?`<span class="fx-saving"/);
});
test('v28.2: saves are serialized and stale response cannot override a newer choice',()=>{
  assert.match(app,/currencySaveQueue=currencySaveQueue\.catch\(\(\)=>\{\}\)\.then/);
  assert.match(app,/const selectionVersion=\+\+FX\.currencySelectionVersion/);
  assert.match(app,/FX\.currencySelectionVersion===selectionVersion/);
});
test('v28.2: rejected profile write restores model-driven currency, with user-visible toast',()=>{
  assert.match(app,/FX\.pendingCurrency=null;FX\.currencySaving=false/);
  assert.match(app,/toast\(`\$\{tr\('Devise non enregistrée'\)\}/);
  assert.match(app,/keep\.id!=='home-currency'/);
});
test('v28.2: loading/failing exchange rate requests cannot silently show an incomplete sum',()=>{
  assert.match(app,/FX\.state==='loading'\?`<div class="fx-unavailable"/);
  assert.match(app,/Service de change inaccessible/);
  assert.match(app,/currencyAPI\.summarize\(balancesInGroups,cur,FX\.data\)/);
});
test('v28.2: backend accounting is unchanged, matching group total remains exact',()=>{
  const rates={date:'2026-10-15',rates:{EUR:1,USD:1.2,BRL:6}};
  assert.equal(FX.convert(5000,'EUR','USD',rates),6000);
  assert.equal(FX.summarize([{currency:'EUR',net:5000}],'BRL',rates).net,30000);
  assert.match(rules,/d\.get\('displayCurrency','EUR'\) in/);
});
test('v28.2: service worker invalidates previous JS cache',()=>{
  assert.match(sw,/kortiz-v28-(?:5-account-security|6-auth-profiles|7-google-popup|8-typographie-landing)/);
});
