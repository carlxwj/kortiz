'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const code=fs.readFileSync(path.join(__dirname,'../functions/index.js'),'utf8');
const period=code.slice(code.indexOf('function addPeriod('),code.indexOf('async function groupByCode('));
const start=code.indexOf('async function processDueRecurringExpense(');
const end=code.indexOf('exports.recurringExpenses=',start);
assert.ok(start>=0 && end>start);
const logic=code.slice(start,end);

function storeHarness(opts={}){
  const entries=new Map();
  let revisions=0;
  function put(key,value){entries.set(key,{data:structuredClone(value),version:++revisions});}
  const group='groups/g1',source=`${group}/expenses/template`;
  put(group,{archived:!!opts.archived});
  put(`${group}/members/a`,{name:'A'});
  put(`${group}/members/b`,{name:'B'});
  put(source,{title:'Loyer',amountCents:80000,paidBy:'a',payers:{a:80000},split:{a:40000,b:40000},
    splitMode:'equal',splitInput:{},category:'loyer',date:'2026-10-01',note:'',approvalStatus:'approved',
    recurring:{freq:'monthly',dayOfMonth:1},recurringNext:'2026-10-01',createdBy:'u1'});
  const makeRef=(key)=>({path:key,id:key.split('/').at(-1),
    get parent(){const p=key.slice(0,key.lastIndexOf('/'));return {doc:n=>makeRef(`${p}/${n}`),
      get parent(){return makeRef(p.slice(0,p.lastIndexOf('/')));}};},
    collection:n=>({path:`${key}/${n}`,doc:id=>makeRef(`${key}/${n}/${id}`)})});
  const snap=key=>{
    const e=entries.get(key);
    return {exists:!!e,id:key.split('/').at(-1),data:()=>e?structuredClone(e.data):undefined,
      version:e?.version,ref:makeRef(key)};
  };
  let pauseBeforeCommit=null;
  const db={
    runTransaction:async callback=>{
      for(let attempt=0;attempt<5;attempt++){
        const reads=new Map(),writes=[];
        const tx={
          get:async item=>{
            const key=item.path;
            if(key.endsWith('/members')){
              const docs=[...entries.keys()].filter(k=>k.startsWith(`${key}/`)&&k.slice(key.length+1).indexOf('/')===-1).map(snap);
              for(const d of docs)reads.set(d.ref.path,d.version||0);
              return {docs};
            }
            const doc=snap(key);reads.set(key,doc.version||0);return doc;
          },
          update:(ref,delta)=>writes.push(['update',ref.path,delta]),
          create:(ref,value)=>writes.push(['create',ref.path,value]),
          set:(ref,value)=>writes.push(['set',ref.path,value]),
          delete:ref=>writes.push(['delete',ref.path]),
        };
        const output=await callback(tx);
        if(pauseBeforeCommit){const hook=pauseBeforeCommit;pauseBeforeCommit=null;hook();}
        const conflict=[...reads].some(([key,version])=>(entries.get(key)?.version||0)!==version);
        if(conflict)continue;
        for(const [action,key,value] of writes){
          if(action==='create'&&entries.has(key))throw Error('Already exists');
          if(action==='delete')entries.delete(key);
          else put(key,action==='update'?{...(entries.get(key)?.data||{}),...value}:value);
        }
        return output;
      }
      throw Error('Transaction retries exhausted');
    },
  };
  const context=vm.createContext({db,console,Date,Intl,Set,z2:n=>String(n).padStart(2,'0'),daysInMonth:(y,m)=>new Date(Date.UTC(y,m,0)).getUTCDate(),FieldValue:{serverTimestamp:()=> 'SERVER_TIME'}});
  vm.runInContext(`${period}\n${logic}\nthis.process=processDueRecurringExpense;`,context);
  return {entries,source,ref:makeRef(source),run:(day='2026-10-16')=>context.process(makeRef(source),day),
    stopBetweenReadAndCommit:()=>{pauseBeforeCommit=()=>put(source,{...entries.get(source).data,recurring:null,recurringNext:null});},
    put};
}
test('récurrence transactionnelle: produit une seule copie et avance la date',async()=>{
  const h=storeHarness();
  const result=await h.run();
  assert.equal(result.created,1);
  assert.equal(h.entries.get(h.source).data.recurringNext,'2026-11-01');
  const copies=[...h.entries.keys()].filter(k=>k.includes('template_2026-10-01'));
  assert.deepEqual(copies,['groups/g1/expenses/template_2026-10-01']);
  assert.equal(h.entries.get(copies[0]).data.amountCents,80000);
  assert.equal(await h.run(),undefined);
  assert.equal(h.entries.size,6); // groupe + 2 membres + modèle + occurrence + activité
});
test('arrêt concurrent: Firestore relit le modèle après conflit et ne crée aucune dette',async()=>{
  const h=storeHarness();h.stopBetweenReadAndCommit();
  await h.run();
  assert.equal(h.entries.get(h.source).data.recurringNext,null);
  assert.equal([...h.entries.keys()].filter(k=>k.includes('template_')).length,0);
});
test('groupe archivé: pas de génération automatique',async()=>{
  const h=storeHarness({archived:true});
  await h.run();
  assert.equal([...h.entries.keys()].filter(k=>k.includes('template_')).length,0);
});
test('participant sorti: pas de génération et arrêt de la programmation',async()=>{
  const h=storeHarness();h.put('groups/g1/members/b',{name:'B',leftAt:'2026-10-05'});
  await h.run();
  assert.equal(h.entries.get(h.source).data.recurringNext,null);
  assert.equal([...h.entries.keys()].filter(k=>k.includes('template_')).length,0);
});
test('rattrapage limité à 12 échéances et dates déterministes',async()=>{
  const h=storeHarness();
  const result=await h.run('2028-10-16');
  assert.equal(result.created,12);
  assert.equal(h.entries.get(h.source).data.recurringNext,'2027-10-01');
  assert.equal([...h.entries.keys()].filter(k=>k.includes('/template_')).length,12);
});
test('correcteur asynchrone refuse de remplacer une version postérieure',()=>{
  const body=code.split('exports.onExpenseWritten =')[1].split('exports.onSettlementCreated =')[0];
  assert.match(body,/current\.updateTime\?\.isEqual\(rejectedUpdateTime\)/);
  assert.match(body,/const repaired = await db\.runTransaction\(/);
  assert.doesNotMatch(body,/event\.data\.after\.ref\.(?:set|delete)\(/);
});
test('les codes de groupe sont protégés contre les essais en rafale',()=>{
  const lookup=code.slice(code.indexOf('exports.getInvite ='),code.indexOf('exports.joinGroup ='));
  const join=code.slice(code.indexOf('exports.joinGroup ='),code.indexOf('/* ---------- Suppression d\'un groupe'));
  assert.match(lookup,/await throttle\(uid,'inviteLookup',1500\)/);
  assert.match(join,/await throttle\(uid,'joinCode',2500\)/);
  assert.ok(lookup.indexOf('await throttle')<lookup.indexOf('groupByCode'));
});
test('les règles financières interdisent l’écriture directe et préservent la devise',()=>{
  const rules=fs.readFileSync(path.join(__dirname,'../firestore.rules'),'utf8');
  const expenses=rules.slice(rules.indexOf('match /groups/{gid}/expenses/{eid}'),rules.indexOf('// ---------- Remboursements enregistrés'));
  assert.match(expenses,/allow update, delete: if false/);
  assert.match(expenses,/!exists\(groupPath\(gid\)\)/);
  assert.match(rules,/request\.resource\.data\.currency == resource\.data\.currency/);
});
