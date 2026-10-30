const { test }=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {compute}=require('../public/planning-logic.js');
const root=path.resolve(__dirname,'..');
const app=fs.readFileSync(path.join(root,'public/app.js'),'utf8');
const rules=fs.readFileSync(path.join(root,'firestore.rules'),'utf8');
const fn=fs.readFileSync(path.join(root,'functions/index.js'),'utf8');
const html=fs.readFileSync(path.join(root,'public/index.html'),'utf8');
const sw=fs.readFileSync(path.join(root,'public/firebase-messaging-sw.js'),'utf8');
function fixtures(){return {expenses:[{amountCents:5000,approvalStatus:'approved'}],plans:[{amountCents:3000,status:'planned'},{amountCents:1200,status:'cancelled'},{amountCents:700,status:'done'}]};}
test('prévisions et dépenses réelles sont comptées séparément',()=>{
  const {expenses,plans}=fixtures();
  assert.deepEqual(compute(expenses,plans,10000),{spent:5000,planned:3000,projected:8000,budget:10000,remaining:2000,ratio:.8,exceeded:false,hasBudget:true});
});
test('le plafond est facultatif, et aucun budget ne bloque le calcul',()=>{
  const {expenses,plans}=fixtures();
  assert.deepEqual(compute(expenses,plans,null),{spent:5000,planned:3000,projected:8000,budget:null,remaining:null,ratio:null,exceeded:false,hasBudget:false});
});
test('dépassement de budget visible avec les dépenses réelles et prévues',()=>{
  const {expenses,plans}=fixtures(),v=compute(expenses,plans,7500);
  assert.equal(v.exceeded,true);
  assert.equal(v.remaining,-500);
  assert.ok(v.ratio>1);
});
test('dépenses rejetées exclues et prévisions terminées/annulées exclues',()=>{
  const v=compute([{amountCents:2500,approvalStatus:'rejected'},{amountCents:800,approvalStatus:'approved'}], [{status:'done',amountCents:3000},{status:'cancelled',amountCents:700},{status:'planned',amountCents:200}],10000);
  assert.equal(v.spent,800);assert.equal(v.planned,200);assert.equal(v.projected,1000);
});
test('une prévision convertie en dépense réelle ne compte pas deux fois',()=>{
  const before=compute([], [{amountCents:5000,status:'planned'}],10000);
  const after=compute([{amountCents:5000}], [{amountCents:5000,status:'done'}],10000);
  assert.equal(before.projected,after.projected);
  assert.equal(after.spent,5000);assert.equal(after.planned,0);
});
test('groupe créé avec budget optionnel et paramètre réservé au créateur',()=>{
  assert.match(app,/async function createGroup\(\{ name, emoji, currency, type, budgetCents = null \}\)/);
  assert.match(rules,/request\.auth\.uid == resource\.data\.createdBy\)/);
  assert.match(rules,/request\.resource\.data\.get\('budgetCents',null\) == resource\.data\.get\('budgetCents',null\)/);
  assert.match(rules,/budgetCents.*createdBy/);
});
test('prévisions dédiées avec droits limités et validation des montants',()=>{
  assert.match(rules,/match \/groups\/\{gid\}\/plannedExpenses\/\{pid\}/);
  assert.match(rules,/request\.resource\.data\.createdBy == request\.auth\.uid/);
  assert.match(rules,/resource\.data\.createdBy == request\.auth\.uid \|\| groupAdmin\(gid\)/);
  assert.match(rules,/validPlannedExpense\(d\)/);
  assert.match(rules,/okCents\(d\.amountCents\)/);
});
test('l’onglet prévisions et la conversion utilisent la dépense réelle existante',()=>{
  assert.match(app,/\["plans", "Prévisions", "calendar"\]/);
  assert.match(app,/\['plans','calendar'\]\.includes\(S\.route\.tab\)/);
  assert.match(app,/openExpenseForm\(gid,null,p\)/);
  assert.match(app,/await withBusy\(e\.currentTarget, \(\) => saveExpense/);
  assert.match(app,/status:'done',updatedAt:serverTimestamp\(\)/);
});
test('export et suppression de compte couvrent les prévisions',()=>{
  assert.match(app,/plannedExpenses: await sub\("plannedExpenses"\)/);
  assert.match(fn,/collection\('plannedExpenses'\)\.where\('createdBy','==',uid\)/);
});
test('script de calcul chargé avant le module app et ajouté au cache PWA',()=>{
  assert.ok(html.indexOf('planning-logic.js') < html.indexOf('/app.js'));
  assert.match(sw,/\'\/planning-logic\.js\'/);
});
test('nouveaux libellés présents dans les quatre langues',()=>{
  const vm=require('node:vm');
  const i18n=fs.readFileSync(path.join(root,'public/i18n.js'),'utf8');
  const store={getItem:()=>null,setItem:()=>{}};
  let lang='fr';
  const doc={documentElement:{setAttribute(){},dataset:{},lang:'fr'},addEventListener(){},body:null};
  const ctx={window:{location:{},navigator:{language:'fr'},addEventListener(){}},document:doc,localStorage:store,navigator:{language:'fr'},location:{},MutationObserver:class{observe(){}},Node:{TEXT_NODE:3,ELEMENT_NODE:1}};
  // Même sans navigateur connecté à Firebase, le dictionnaire doit traduire tous les nouveaux libellés.
  vm.runInNewContext(i18n,ctx);
  for(const [fr,en,pt,es] of [
    ['Prévisions','Plans','Previsões','Previsiones'],
    ['Prévisions et budget','Plans and budget','Previsões e orçamento','Previsiones y presupuesto'],
    ['Déjà dépensé','Already spent','Já gasto','Ya gastado'],
    ['Budget restant','Remaining budget','Orçamento restante','Presupuesto restante']
  ]){
    assert.equal(ctx.window.KortizI18n.translate(fr,'fr'),fr);
    assert.equal(ctx.window.KortizI18n.translate(fr,'en'),en);
    assert.equal(ctx.window.KortizI18n.translate(fr,'pt'),pt);
    assert.equal(ctx.window.KortizI18n.translate(fr,'es'),es);
  }
});
