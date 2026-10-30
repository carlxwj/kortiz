const {test}=require('node:test');
const assert=require('node:assert/strict');
const {readFileSync}=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const root=path.join(__dirname,'..');
const source=readFileSync(path.join(root,'public','app.js'),'utf8');
const localeSource=readFileSync(path.join(root,'public','i18n.js'),'utf8');
const begin=source.indexOf('function computeBalances(');
const end=source.indexOf('/* ---------- IBAN & QR SEPA (EPC) ---------- */',begin);
const preview=vm.runInNewContext(source.slice(begin,end)+'\npreviewExpenseTransfers');
const results=(payers,split)=>JSON.parse(JSON.stringify(preview(['brenda','carlos'],payers,split)));

test('Carlos pays 50 euros, Brenda owes all 50 euros',()=>{
  assert.deepEqual(results({carlos:5000},{brenda:5000}),[{from:'brenda',to:'carlos',amount:5000}]);
});
test('Carlos pays 50 euros, both share it equally',()=>{
  assert.deepEqual(results({carlos:5000},{brenda:2500,carlos:2500}),[{from:'brenda',to:'carlos',amount:2500}]);
});
test('Brenda pays 50 euros for herself and owes nobody',()=>{
  assert.deepEqual(results({brenda:5000},{brenda:5000}),[]);
});
test('Multiple payers and unequal shares calculate correct net transfers',()=>{
  assert.deepEqual(results({brenda:1000,carlos:4000},{brenda:5000}),[{from:'brenda',to:'carlos',amount:4000}]);
});
test('Expense editor includes explicit debtor selection, shortcuts and preview',()=>{
  for (const phrase of [
    'Qui doit payer sa part ?', 'Faire payer les autres', 'Tout le monde partage',
    'expense-preview-transfers', "case \"other-debtors\"", 'f.included = new Set(ids)',
    'aria-pressed', 'Doit sa part', 'Ne doit rien'
  ]) assert.ok(source.includes(phrase),phrase);
});
test('New debt-related UI labels are localized in FR, EN, PT and ES',()=>{
  for(const [device,expected] of [['fr-FR','Qui doit payer sa part ?'],['en-US','Who owes a share?'],['pt-BR','Quem deve pagar sua parte?'],['es-ES','¿Quién debe pagar su parte?']]){
    const fake={document:{documentElement:{lang:'',dataset:{}},addEventListener(){}},navigator:{language:device,languages:[device]},localStorage:{getItem(){return 'auto'},setItem(){}},location:{reload(){}},MutationObserver:class{observe(){}},Node:{TEXT_NODE:3,ELEMENT_NODE:1},window:{}};
    vm.runInNewContext(localeSource,fake);
    assert.equal(fake.window.KortizI18n.translate('Qui doit payer sa part ?'),expected);
    assert.equal(fake.window.KortizI18n.translate('Faire payer les autres'),({ 'fr-FR':'Faire payer les autres', 'en-US':'Others owe the cost', 'pt-BR':'Os outros devem pagar', 'es-ES':'Que paguen los demás' })[device]);
  }
});
