const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const app = fs.readFileSync(path.join(__dirname,'../public/app.js'),'utf8');
const i18n = fs.readFileSync(path.join(__dirname,'../public/i18n.js'),'utf8');

function boot(lang){
  const ctx = {
    document:{documentElement:{lang:'',dataset:{}},addEventListener(){}},
    navigator:{language:lang,languages:[lang]},
    localStorage:{getItem:()=>null,setItem(){}},
    location:{reload(){}},
    MutationObserver:class {observe(){}},
    Node:{TEXT_NODE:3,ELEMENT_NODE:1},
    window:{}
  };
  vm.runInNewContext(i18n,ctx);
  return ctx.window.KortizI18n;
}

test('expense, balance and note placeholder are translated in all supported languages',()=>{
  const examples = {
    'fr-FR':['Ajouter une dépense','Mon solde','Détail, lien, rappel…'],
    'en-US':['Add an expense','My balance','Details, link, reminder…'],
    'pt-BR':['Adicionar despesa','Meu saldo','Detalhes, link, lembrete…'],
    'es-ES':['Añadir un gasto','Mi saldo','Detalles, enlace, recordatorio…'],
  };
  for(const [lang,expected] of Object.entries(examples)) {
    const t=boot(lang);
    assert.deepEqual(['Ajouter une dépense','Mon solde','Détail, lien, rappel…'].map(x=>t.translate(x)),expected,lang);
  }
});

test('new expenses form and sheet translate labels synchronously',()=>{
  assert.match(app,/placeholder="\$\{esc\(tr\("Détail, lien, rappel…"\)\)\}"/);
  assert.match(app,/I18N\.translateDOM\(sh\)/);
  assert.match(app,/I18N\.translateDOM\(view\)/);
  assert.match(app,/esc\(tr\(cta\)\)/);
  assert.match(i18n,/attributeFilter:\['placeholder','aria-label','title','alt'\]/);
});
