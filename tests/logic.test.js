// Tests de la logique pure (répartition, soldes, IBAN, EPC, CSV, QR). Lancer : node tests/logic.test.js
// tests/logic.js est une copie de la section « logique pure » de public/index.html.
const fs=require('fs');
const src=fs.readFileSync(__dirname+'/logic.js','utf8');
const api=new Function("require", src+`
return {parseAmountInput,splitAmount,computeBalances,minimalTransfers,isValidIban,formatIban,buildEpcPayload,parseCSV,parseLooseAmount,parseBankDate,detectCsvLayout,qrEncode,qrToSvg,addPeriod,genInviteCode,qrDataCw};`)(require);
const assert=require('assert');
const {splitAmount,computeBalances,minimalTransfers}=api;
let n=0; const ok=(c,m)=>{assert(c,m);n++;};
const sum=o=>Object.values(o).reduce((a,b)=>a+b,0);

// --- Répartition
let r=splitAmount(1000,'equal',[{id:'a'},{id:'b'},{id:'c'}]);
ok(r.ok&&r.split.a===334&&r.split.b===333&&r.split.c===333,'10€/3');
r=splitAmount(1,'equal',[{id:'a'},{id:'b'},{id:'c'}]); ok(sum(r.split)===1,'1 cent/3');
r=splitAmount(10000,'shares',[{id:'a',value:2},{id:'b',value:1}]); ok(r.split.a===6667&&r.split.b===3333,'2 parts/1');
r=splitAmount(9999,'percent',[{id:'a',value:33.33},{id:'b',value:33.33},{id:'c',value:33.34}]); ok(r.ok&&sum(r.split)===9999,'%');
r=splitAmount(1000,'percent',[{id:'a',value:50},{id:'b',value:40}]); ok(!r.ok,'% != 100');
r=splitAmount(1000,'exact',[{id:'a',value:600},{id:'b',value:400}]); ok(r.ok&&r.split.a===600,'exact ok');
r=splitAmount(1000,'exact',[{id:'a',value:600},{id:'b',value:300}]); ok(!r.ok&&r.diff===100,'exact ko');
r=splitAmount(1000,'shares',[{id:'a',value:1.5},{id:'b',value:0.5}]); ok(r.split.a===750&&r.split.b===250,'parts décimales');
for(let t=0;t<3000;t++){const total=1+Math.floor(Math.random()*1e7);const k=1+Math.floor(Math.random()*9);
  const e=[...Array(k)].map((_,i)=>({id:'m'+i,value:1+Math.floor(Math.random()*7)}));
  const rr=splitAmount(total,'shares',e); ok(rr.ok&&sum(rr.split)===total,'somme exacte');}

// --- Saisie des montants
ok(api.parseAmountInput('12,5')===1250&&api.parseAmountInput('12.50')===1250&&api.parseAmountInput('1234')===123400&&api.parseAmountInput('0,07')===7,'saisie');
ok(api.parseAmountInput('abc')===null&&api.parseAmountInput('12,345')===null&&api.parseAmountInput('')===null,'saisie invalide');

// --- Soldes + remboursement minimal
const ex=[{amountCents:3000,payers:{A:3000},split:{A:1000,B:1000,C:1000}},{amountCents:1200,payers:{B:1200},split:{A:400,B:400,C:400}}];
let b=computeBalances(['A','B','C'],ex,[]);
ok(b.A.net===1600&&b.B.net===-200&&b.C.net===-1400,'soldes');
let t=minimalTransfers(b); ok(t.length===2&&sum(t.map(x=>x.amount))===1600,'2 virements');
b=computeBalances(['A','B','C'],ex,[{fromId:'C',toId:'A',amountCents:1400},{fromId:'B',toId:'A',amountCents:200}]);
ok(Object.values(b).every(x=>x.net===0)&&minimalTransfers(b).length===0,'tout remboursé');
// plusieurs payeurs
b=computeBalances(['A','B'],[{amountCents:1000,payers:{A:600,B:400},split:{A:500,B:500}}],[]); ok(b.A.net===100&&b.B.net===-100,'multi payeurs');
// cas aléatoires : somme des soldes = 0 et nombre de virements ≤ n-1
for(let k=0;k<300;k++){const ids=['a','b','c','d','e'].slice(0,2+Math.floor(Math.random()*4));
  const exs=[...Array(6)].map(()=>{const tot=100+Math.floor(Math.random()*5000);const p=ids[Math.floor(Math.random()*ids.length)];
    const s=splitAmount(tot,'equal',ids.map(id=>({id})));return{amountCents:tot,payers:{[p]:tot},split:s.split};});
  const bb=computeBalances(ids,exs,[]);ok(sum(Object.fromEntries(ids.map(i=>[i,bb[i].net])))===0,'Σ=0');
  const tt=minimalTransfers(bb);ok(tt.length<=ids.length-1,'≤ n-1 virements');
  const after=computeBalances(ids,exs,tt.map(x=>({fromId:x.from,toId:x.to,amountCents:x.amount})));ok(ids.every(i=>after[i].net===0),'équilibre');}

// --- IBAN / EPC
ok(api.isValidIban('BE68 5390 0754 7034')&&api.isValidIban('FR76 3000 6000 0112 3456 7890 189')&&!api.isValidIban('BE68 5390 0754 7035')&&!api.isValidIban('BE68539007547'),'IBAN');
const epc=api.buildEpcPayload({name:'Marc Dupont',iban:'BE68 5390 0754 7034',amountCents:1500,remittance:'Kot rue Haute – remboursement Julie'});
ok(epc.split('\n')[0]==='BCD'&&epc.split('\n')[7]==='EUR15.00'&&epc.split('\n')[6]==='BE68539007547034'&&epc.split('\n').length===11,'EPC');

// --- Périodes
ok(api.addPeriod('2025-01-31','monthly',31)==='2025-02-28'&&api.addPeriod('2025-02-28','monthly',31)==='2025-03-31'&&api.addPeriod('2025-12-15','monthly')==='2026-01-15'&&api.addPeriod('2025-03-01','weekly')==='2025-03-08','périodes');

// --- CSV
let csv='Date de comptabilisation;Numéro de compte;Montant;Devise;Nom contrepartie;Communication\n03/02/2025;BE12 3456;-45,20;EUR;DELHAIZE;Courses\n04/02/2025;BE12 3456;"1.234,56";EUR;"Jean ""JJ"" Dupont";Loyer\n';
const p=api.parseCSV(csv); ok(p.delimiter===';'&&p.rows.length===3&&p.rows[2][4]==='Jean "JJ" Dupont','CSV parse');
const lay=api.detectCsvLayout(p.rows); ok(lay.map.date===0&&lay.map.amount===2&&lay.map.desc===4,'CSV colonnes '+JSON.stringify(lay.map));
ok(api.parseLooseAmount('-45,20')===-4520&&api.parseLooseAmount('1.234,56')===123456&&api.parseLooseAmount('12,50 EUR')===1250&&api.parseLooseAmount('(45.20)')===-4520&&api.parseLooseAmount('1.234')===123400&&api.parseLooseAmount('45-')===-4500&&api.parseLooseAmount('abc')===null,'montants CSV');
ok(api.parseBankDate('03/02/2025')==='2025-02-03'&&api.parseBankDate('3-2-25')==='2025-02-03'&&api.parseBankDate('2025-02-03')==='2025-02-03'&&api.parseBankDate('31/02/2025')===null,'dates CSV');
// CSV sans en-tête reconnaissable : détection par contenu
const csv2='x1;x2;x3\n03/02/2025;-12,00;Pizza chez Luigi\n05/02/2025;-8,50;Bus STIB\n';
const l2=api.detectCsvLayout(api.parseCSV(csv2).rows); ok(l2.map.date===0&&l2.map.amount===1&&l2.map.desc===2,'CSV contenu '+JSON.stringify(l2.map));

// --- QR : capacités et matrices pour décodage externe
for(let v=1;v<=13;v++) ok(api.qrDataCw(v)===[0,16,28,44,64,86,108,124,154,182,216,254,290,334][v],'capacité v'+v);
const texts=['Hello','BCD test é€ 123',epc,'x'.repeat(100),'y'.repeat(200),epc+'z'.repeat(331-new TextEncoder().encode(epc).length)];
const out=texts.map(tx=>({text:tx,m:api.qrEncode(tx).map(r=>r.map(c=>c?1:0).join('')).join('\n')}));
console.log('OK —',n,'assertions');
