const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const functions = fs.readFileSync(path.resolve(__dirname,'../functions/index.js'),'utf8');
const src = functions.slice(functions.indexOf('exports.updateMoneyRequest ='),functions.indexOf('// Derive outstanding transfers'));
function harness({action='confirm',user='admin',remaining=5000,existing=false,requestStatus='marked_paid',accountedAt=null}={}) {
  const writes=[];
  const values = {
    'groups/g': {memberIds:['admin','debtor','creditor'],createdBy:'admin'},
    'groups/g/moneyRequests/r': {fromId:'debtorMember',toId:'creditorMember',debtorUid:'debtor',creditorUid:'creditor',amountCents:5000,status:requestStatus,...(accountedAt?{accountedAt}: {})},
    'groups/g/settlements/money_r': existing ? {moneyRequestId:'r'} : null,
  };
  const ref=(name)=>({name,collection(n){return {doc(id){return ref(`${name}/${n}/${id}`)}}}});
  const group = ref('groups/g');
  const tx={
    get:async r => ({exists:!!values[r.name],data:()=>values[r.name]}),
    create:(r,data)=>writes.push({op:'create',name:r.name,data}),
    update:(r,data)=>writes.push({op:'update',name:r.name,data}),
  };
  class TestError extends Error { constructor(code,message){super(message);this.code=code;} }
  const ctx={exports:{},CALLABLE:{},onCall:(_,handler)=>handler,
    needAuth:(req)=>req.auth.uid, requireId:x=>x,
    getGroupFor:async()=>({ref:group,data:values['groups/g']}),
    getChatFor:()=>{throw Error('unexpected direct')},
    isAdmin:(g,uid)=>g.createdBy===uid,
    memberByUid:()=>null,
    outstandingLimit:async()=>remaining,
    FieldValue:{serverTimestamp:()=> 'SERVER_TIMESTAMP'},
    db:{runTransaction:async fn=>fn(tx)},
    HttpsError:TestError,
  };
  vm.runInNewContext(src,ctx,{timeout:1000});
  return {call:()=>ctx.exports.updateMoneyRequest({auth:{uid:user},data:{scope:'group',id:'g',requestId:'r',action}}),writes};
}
test('Confirmation depuis la discussion crée le règlement comptable avant le statut',async()=>{
  const {call,writes}=harness();
  await call();
  const settlement = writes.find(w=>w.op==='create'&&w.name==='groups/g/settlements/money_r');
  assert.ok(settlement,'A settlement must be created');
  assert.equal(settlement.data.amountCents,5000);
  assert.equal(settlement.data.fromId,'debtorMember');
  assert.equal(settlement.data.toId,'creditorMember');
  assert.equal(settlement.data.paymentRequestId,'r');
  const req = writes.find(w=>w.op==='update'&&w.name==='groups/g/moneyRequests/r');
  assert.equal(req.data.status,'confirmed');
  assert.ok(req.data.accountedAt);
});
test('Le débiteur ne peut pas confirmer à la place de l’admin',async()=>{
  const {call,writes}=harness({user:'debtor'});
  await assert.rejects(call(),e=>e.code==='permission-denied');
  assert.equal(writes.length,0);
});
test('Impossible de confirmer plus que la dette restante',async()=>{
  const {call,writes}=harness({remaining:2000});
  await assert.rejects(call(),e=>e.code==='failed-precondition');
  assert.equal(writes.length,0);
});
test('Une demande déjà confirmée dans une ancienne version peut être régularisée par l’admin',async()=>{
  const {call,writes}=harness({action:'reconcile',requestStatus:'confirmed'});
  await call();
  assert.ok(writes.some(w=>w.op==='create'&&w.name==='groups/g/settlements/money_r'));
  const request=writes.find(w=>w.op==='update'&&w.name==='groups/g/moneyRequests/r');
  assert.equal(request.data.status,'confirmed');
  assert.ok(request.data.accountedAt);
  assert.equal(request.data.confirmedAt,undefined,'Do not overwrite original confirmation timestamp');
});
test('Une régularisation déjà comptabilisée ne crée pas un deuxième remboursement',async()=>{
  const {call,writes}=harness({action:'reconcile',requestStatus:'confirmed',existing:true});
  await call();
  assert.equal(writes.filter(w=>w.op==='create').length,0);
  assert.equal(writes.filter(w=>w.op==='update').length,1);
});
