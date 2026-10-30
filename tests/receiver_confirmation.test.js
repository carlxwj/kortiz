'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const base=path.join(__dirname,'..');
const backend=fs.readFileSync(path.join(base,'functions/index.js'),'utf8');
const ui=fs.readFileSync(path.join(base,'public/app.js'),'utf8');
const html=fs.readFileSync(path.join(base,'public/index.html'),'utf8');
const rules=fs.readFileSync(path.join(base,'firestore.rules'),'utf8');
const slice=(start,end)=>backend.slice(backend.indexOf(start),backend.indexOf(end,backend.indexOf(start)));
const callable=(source, name, {actor, group, request, outstanding=5000}={})=>{
  const writes=[];
  const initial={
    'groups/g':group || {memberIds:['admin','payer','receiver'],createdBy:'admin',adminIds:[]},
    [`groups/g/${name==='respondGroupSettlement'?'paymentRequests':'moneyRequests'}/r`]:request,
  };
  const ref=(path)=>({path,collection(c){return {doc(id){return ref(`${path}/${c}/${id||'generated'}`);}}}});
  const groupRef=ref('groups/g');
  const tx={
    get:async doc=>({exists:!!initial[doc.path],data:()=>initial[doc.path]}),
    update:(doc,data)=>writes.push({type:'update',path:doc.path,data}),
    set:(doc,data)=>writes.push({type:'set',path:doc.path,data}),
    create:(doc,data)=>writes.push({type:'create',path:doc.path,data}),
  };
  class HttpsError extends Error {constructor(code,message){super(message);this.code=code;}}
  const c={exports:{},onCall:(_,f)=>f,CALLABLE:{},
    needAuth:()=>actor,requireId:x=>x,
    getGroupFor:async()=>({ref:groupRef,data:initial['groups/g']}),
    getChatFor:async()=>{throw Error('unexpected direct chat');},
    isAdmin:(g,uid)=>g.createdBy===uid||(g.adminIds||[]).includes(uid),
    outstandingLimit:async()=>outstanding,
    FieldValue:{serverTimestamp:()=> 'now'},
    db:{runTransaction:async callback=>callback(tx)},
    HttpsError,
  };
  vm.runInNewContext(source,c,{timeout:1000});
  return {call:(action)=>c.exports[name]({data:{scope:'group',groupId:'g',id:'g',requestId:'r',action}}),writes};
};
const settleSource=slice('exports.respondGroupSettlement = onCall(','exports.cancelConfirmedSettlement = onCall(');
const moneySource=slice('exports.updateMoneyRequest = onCall(','// Derive outstanding transfers');
const group={memberIds:['brenda','carlos','neutral'],createdBy:'brenda',adminIds:[]};
const claim={fromUid:'brenda',toUid:'carlos',fromId:'mBrenda',toId:'mCarlos',amountCents:5000,requestedBy:'brenda',status:'marked_paid'};
const money={debtorUid:'brenda',creditorUid:'carlos',fromId:'mBrenda',toId:'mCarlos',amountCents:5000,status:'marked_paid'};
for(const [title,source,name,request] of [
  ['Soldes',settleSource,'respondGroupSettlement',claim],
  ['Discussion',moneySource,'updateMoneyRequest',money]
]){
  test(`${title}: Carlos créancier non-admin confirme un remboursement de Brenda admin`,async()=>{
    const {call,writes}=callable(source,name,{actor:'carlos',group,request});
    await call('confirm');
    assert.equal(writes.filter(w=>w.path.includes('/settlements/')).length,1);
    assert.ok(writes.some(w=>w.data.status==='confirmed'));
  });
  test(`${title}: Brenda admin débitrice ne peut pas confirmer son propre remboursement`,async()=>{
    const {call,writes}=callable(source,name,{actor:'brenda',group,request});
    await assert.rejects(call('confirm'),err=>err.code==='permission-denied');
    assert.equal(writes.length,0);
  });
  test(`${title}: créancier peut confirmer le paiement même sans déclaration préalable`,async()=>{
    const {call,writes}=callable(source,name,{actor:'carlos',group,request:{...request,status:'pending'}});
    await call('confirm');
    assert.ok(writes.some(w=>w.data.status==='confirmed'));
  });
  test(`${title}: l'administrateur neutre peut confirmer un paiement déclaré`,async()=>{
    const {call}=callable(source,name,{actor:'neutral',group:{...group,adminIds:['neutral']},request});
    await call('confirm');
  });
  test(`${title}: membre neutre sans droits ne peut pas confirmer`,async()=>{
    const {call}=callable(source,name,{actor:'neutral',group,request});
    await assert.rejects(call('confirm'),err=>err.code==='permission-denied');
  });
  test(`${title}: montant supérieur à la dette non réglée refusé`,async()=>{
    const {call,writes}=callable(source,name,{actor:'carlos',group,request,outstanding:2000});
    await assert.rejects(call('confirm'),err=>err.code==='failed-precondition');
    assert.equal(writes.length,0);
  });
}
test('Le formulaire affiche confirmer à un créancier non admin et jamais au débiteur',()=>{
  const body=ui.slice(ui.indexOf('function socialCardForRequest('),ui.indexOf('function groupAdmin('));
  assert.match(body,/neutralAdmin/);
  assert.match(body,/!isDebtor &&/);
  assert.match(body,/isCreditor && \['pending','accepted','marked_paid'\]\.includes\(status\)/);
  assert.match(ui,/if\(creditor && \(status==='pending'\|\|status==='marked_paid'\)\)/);
});
test('Le compte éditeur AdSense reste identifié par balise meta sans charger de publicité',()=>{
  assert.match(html,/google-adsense-account[^>]+ca-pub-4201455737479851/);
  assert.doesNotMatch(html,/adsbygoogle\.js/);
});
test('Les règles bloquent toujours toute écriture client de remboursements',()=>{
  assert.match(rules,/match \/groups\/\{gid\}\/settlements\/\{sid\}/);
  assert.match(rules,/allow create: if false/);
});
