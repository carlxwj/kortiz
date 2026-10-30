'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.resolve(__dirname,'..');
const load=(name)=>fs.readFileSync(path.join(root,name),'utf8');
const FX=require('../public/currency-logic.js');
const base={date:'2026-10-15',rates:{EUR:1,USD:1.2,BRL:6,GBP:0.8,CHF:0.9,ARS:1600}};
test('v28: 23 available currency symbols, unique and three-letter',()=>{
 assert.equal(FX.DISPLAY_CURRENCIES.length,23);
 assert.equal(new Set(FX.DISPLAY_CURRENCIES).size,23);
 assert.ok(FX.DISPLAY_CURRENCIES.every(x=>/^[A-Z]{3}$/.test(x)));
});
test('v28: exchange rate payload refuses invalid rate',()=>{
 assert.ok(FX.validRates(base));
 assert.equal(FX.validRates({...base,rates:{USD:-1}}),false);
 assert.equal(FX.validRates({...base,date:'soon'}),false);
 assert.equal(FX.validRates({}),false);
});
test('v28: same currency stays untouched even if no rates',()=>assert.equal(FX.convert(1500,'EUR','EUR',null),1500));
test('v28: EUR to USD; USD to EUR via EUR base',()=>{
 assert.equal(FX.convert(10000,'EUR','USD',base),12000);
 assert.equal(FX.convert(12000,'USD','EUR',base),10000);
});
test('v28: cross conversion via EUR uses cent integers',()=>{
 assert.equal(FX.convert(10000,'USD','BRL',base),50000);
 assert.equal(FX.convert(50000,'BRL','USD',base),10000);
});
test('v28: currency conversion symmetric for negative values and round safely',()=>{
 assert.equal(FX.convert(-10000,'EUR','GBP',base),-8000);
 assert.equal(FX.convert(101,'EUR','USD',base),121);
 assert.equal(FX.convert(Number.MAX_SAFE_INTEGER,'EUR','ARS',base),null);
 assert.equal(FX.convert(19.7,'EUR','USD',base),null);
});
test('v28: aggregate positive and negative balances independently',()=>{
 const output=FX.summarize([{net:10000,currency:'EUR'},{net:-5000,currency:'USD'},{net:20000,currency:'BRL'}],'EUR',base);
 assert.deepEqual(output,{net:9166,get:13333,owe:4167,unavailable:[],converted:true});
});
test('v28: absent rate does not add unrelated currencies to totals',()=>{
 const output=FX.summarize([{net:10000,currency:'EUR'},{net:20000,currency:'MXN'}],'EUR',base);
 assert.equal(output.net,10000); assert.deepEqual(output.unavailable,['MXN']);
});
test('v28: all dashboard currencies allowed in Firestore profile validation',()=>{
 const rule=load('firestore.rules');
 const supported=rule.match(/d\.get\('displayCurrency','EUR'\) in \[([^\]]+)\]/);
 assert.ok(supported);
 const allow=new Set([...supported[1].matchAll(/'([A-Z]{3})'/g)].map(x=>x[1]));
 assert.deepEqual(new Set(FX.DISPLAY_CURRENCIES),allow);
});
test('v28: group accounting never rewritten by exchange display code',()=>{
 const app=load('public/app.js');
 assert.match(app,/currencyAPI\.summarize\(balancesInGroups,cur,FX\.data\)/);
 assert.match(app,/saveProfile\(\{displayCurrency:value\}\)/);
 assert.ok(!app.includes('updateDoc(doc(db, "groups", gid), {currency:cur}'));
});
test('v28: currency provider has primary + fallback and acknowledgement link',()=>{
 const app=load('public/app.js');
 assert.match(app,/open\.er-api\.com\/v6\/latest\/EUR/);
 assert.match(app,/api\.frankfurter\.dev\/v1\/latest\?base=EUR/);
 assert.match(app,/Rates By Exchange Rate API/);
 assert.match(app,/FX_TTL=24\*60\*60\*1000/);
});
test('v28: six push categories and mute preference applied in backend',()=>{
 const fun=load('functions/index.js');
 const app=load('public/app.js');
 for(const key of ['groupInvites','directMessages','groupMessages','expenses','moneyRequests','paymentConfirmations']){
  assert.ok(fun.includes(`'${key}'`));assert.ok(app.includes(`'${key}'`));
 }
 assert.match(fun,/function allowsPush\(userData,kind,gid\)/);
 assert.match(fun,/userData\?\.mutedGroupIds/);
 assert.match(app,/saveProfile\(\{mutedGroupIds:muted\}\)/);
});
test('v28: profile rules restrict notification categories and mute limits',()=>{
 const rules=load('firestore.rules');
 assert.match(rules,/notificationPrefs.*is map/);
 assert.match(rules,/mutedGroupIds.*is list/);
 assert.match(rules,/mutedGroupIds',\[\]\)\.size\(\) <= 50/);
});
test('v28: optional bug report is never readable through client rules',()=>{
 const rules=load('firestore.rules'),storage=load('storage.rules');
 assert.match(rules,/match \/users\/\{uid\}\/bugReports\/\{reportId\}/);
 assert.match(rules,/allow read, update, delete: if false/);
 assert.match(storage,/match \/supportReports\/\{uid\}\/\{filename\}/);
 assert.match(storage,/request\.auth\.uid == uid/);
 assert.match(storage,/allow read: if false/);
});
test('v28: avatar URL is not busted on each render; changed photo versioned',()=>{
 const app=load('public/app.js');
 assert.match(app,/const resolved=force\?/);
 assert.match(app,/img\.decode\(\)/);
 assert.match(app,/SOC\.photoLoading\.has\(uid\)/);
 assert.ok(!app.includes('url + "?t=" + Date.now()'));
});
test('v28: no Google advertising script auto-runs without CMP',()=>{
 const pages=['public/index.html','public/decouvrir.html','public/contact.html'];
 for(const page of pages)assert.ok(!load(page).includes('src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js'),page);
 assert.match(load('public/index.html'),/google-adsense-account/);
 assert.ok(!load('public/consent-v28.js').includes('adsbygoogle.js'));
});
test('v28: existing contact service remains unchanged',t=>{
 const cur=load('public/contact.js');
 const {createHash}=require('node:crypto');
 // Empreinte exacte du formulaire Contact v28.1 reçu ; indépendante d'une archive absente.
 assert.equal(createHash('sha256').update(cur).digest('hex'),'2e7a8bec24f55dabddb92139798ef2f664de0c41cb850e0c7660d82c648c6e19');
 const baseline='/mnt/data/kortiz-v27-3-footer-contact.zip';
 if(!fs.existsSync(baseline)){t.diagnostic('Archive v27.3 non disponible : comparaison historique non exécutée.');return;}
 const {execFileSync}=require('node:child_process');
 const z=execFileSync('unzip',['-p',baseline,'kortiz/public/contact.js'],{encoding:'utf8'});
 assert.equal(cur,z);
});
test('v28: new scripts are separately linked in public pages',()=>{
 const doc=load('public/index.html');
 for(const name of ['currency-logic.js','consent-v28.js','consent-v28.css'])assert.ok(doc.includes(name));
 const service=load('public/firebase-messaging-sw.js');
 assert.match(service,/kortiz-v28/);
});
const vm=require('node:vm');
test('v28: push filtering rejects disabled category and muted groups at runtime',()=>{
 const index=load('functions/index.js');
 const fragment=index.match(/const PUSH_KEYS=\[[^;]+;\s*function allowsPush\(userData,kind,gid\)\{[\s\S]*?\n\}/)?.[0];
 assert.ok(fragment,'isolated server validation helper');
 const context={}; vm.runInNewContext(fragment+'\nthis.testAllows=allowsPush;',context);
 assert.equal(context.testAllows({},'directMessages'),true);
 assert.equal(context.testAllows({},'fakeCategory'),false);
 assert.equal(context.testAllows({notificationPrefs:{directMessages:false}},'directMessages'),false);
 assert.equal(context.testAllows({mutedGroupIds:['paris']},'expenses','paris'),false);
 assert.equal(context.testAllows({mutedGroupIds:['paris']},'expenses','rome'),true);
 assert.equal(context.testAllows({mutedGroupIds:['paris']},'directMessages'),true);
});
test('v28: mute/unmute toast reflects new preference, not stale state',()=>{
 const app=load('public/app.js');
 assert.match(app,/const willMute=!groupMuted\(gid\)/);
 assert.match(app,/toast\(tr\(willMute\?'Groupe mis en sourdine':'Notifications du groupe réactivées'\)\)/);
});
test('v28: avatar requests are invalidated when a new photo replaces an in-flight request',()=>{
 const app=load('public/app.js');
 assert.match(app,/photoRequests:new Map\(\)/);
 assert.match(app,/const requestId=Symbol\('avatar'\)/);
 assert.match(app,/SOC\.photoRequests\.get\(uid\)!==requestId/);
});
