'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {groupDebtsFor,directDebtsFor,externalExitDebtsFor}=require('../functions/account-deletion-guard');
const base=path.join(__dirname,'..');
const server=fs.readFileSync(path.join(base,'functions/index.js'),'utf8');
const app=fs.readFileSync(path.join(base,'public/app.js'),'utf8');
const i18n=fs.readFileSync(path.join(base,'public/i18n.js'),'utf8');
const d=values=>({docs:values.map((data,i)=>({id:data.id||String(i),data:()=>data}))});
const members=d([{id:'member-a',uid:'user-a'},{id:'member-b',uid:'user-b'}]);
const expense=d([{payers:{'member-a':9000},split:{'member-a':3000,'member-b':6000},approvalStatus:'approved'}]);
const empty=d([]);

test('un débiteur de groupe est bloqué; un créancier ne l’est pas',()=>{
  assert.deepEqual(groupDebtsFor('user-b',members,expense,empty,empty),[{kind:'group',amountCents:6000}]);
  assert.deepEqual(groupDebtsFor('user-a',members,expense,empty,empty),[]);
});
test('la comptabilisation confirmée libère une dette de groupe',()=>{
  const paid=d([{fromId:'member-b',toId:'member-a',amountCents:6000}]);
  assert.deepEqual(groupDebtsFor('user-b',members,expense,paid,empty),[]);
});
test('une dette de sortie réservée bloquera le débiteur après départ',()=>{
  const claim=d([{fromUid:'user-b',toUid:'user-a',fromId:'member-b',toId:'member-a',amountCents:6000,status:'pending'}]);
  assert.deepEqual(groupDebtsFor('user-b',members,expense,empty,claim),[{kind:'exit',amountCents:6000}]);
  assert.deepEqual(externalExitDebtsFor('user-b',claim),[{kind:'exit',amountCents:6000}]);
  assert.deepEqual(externalExitDebtsFor('user-a',claim),[]);
});
test('une dette de sortie soldée ne bloque pas',()=>{
  for(const status of ['confirmed','cancelled'])
    assert.deepEqual(externalExitDebtsFor('user-b',d([{fromUid:'user-b',amountCents:6000,status}])),[]);
});
test('une demande privée unilatérale ne permet pas de bloquer le compte cible',()=>{
  const request=d([{debtorUid:'user-b',creditorUid:'user-a',amountCents:1e8,status:'pending'}]);
  assert.deepEqual(directDebtsFor('user-b',request),[]);
});
test('une dette privée reconnue ou paiement non confirmé bloque, pas les demandes terminées',()=>{
  const states=['pending','accepted','marked_paid','confirmed','cancelled','declined'];
  for(const status of states){
    const found=directDebtsFor('user-b',d([{debtorUid:'user-b',amountCents:580,status}]));
    assert.equal(found.length,['accepted','marked_paid'].includes(status)?1:0, status);
  }
});
test('une dette privée ne bloque pas un tiers ni un créancier',()=>{
  assert.deepEqual(directDebtsFor('user-a',d([{debtorUid:'user-b',creditorUid:'user-a',amountCents:580,status:'accepted'}])),[]);
  assert.deepEqual(directDebtsFor('user-c',d([{debtorUid:'user-b',creditorUid:'user-a',amountCents:580,status:'accepted'}])),[]);
});
test('guard deleteAccount exécuté avant le premier traitement irréversible',()=>{
  const section=server.split('exports.deleteAccount = onCall(')[1].split('/* ---------- Validation serveur')[0];
  const guard=section.indexOf('await assertNoOpenDebtForAccount(uid,groups)');
  const messages=section.indexOf('const myMessages=await g.ref.collection');
  assert(guard>0&&messages>guard);
  assert.match(server,/\.where\('members','array-contains',uid\)/);
  assert.match(server,/\.collection\('formerGroups'\)\.get\(\)/);
  assert.match(server,/\.collection\('exitDebts'\)\.get\(\)/);
  assert.match(server,/\.collection\('moneyRequests'\)\.get\(\)/);
});
test('deleteGroup refuse aussi les soldes non réglés',()=>{
  const section=server.split('exports.deleteGroup = onCall(')[1].split('/* ---------- Précondition serveur')[0];
  assert.match(section,/computeAvailableTransfers\(expenses,settlements,openClaims\)\.length/);
});
test('une dette privée ne peut être reconnue que par son débiteur authentifié',()=>{
  const section=server.split('exports.updateMoneyRequest = onCall(')[1].split('// Derive outstanding')[0];
  assert.match(section,/action === 'acknowledge' && isDebtor && r\.status === 'pending'/);
  assert.match(section,/action === 'decline' && isDebtor && r\.status === 'pending'/);
  assert.match(app,/\['acknowledge','Reconnaître la dette'\]/);
});
test('mot de passe oublié valide email, utilise Firebase et localise messages',()=>{
  assert.match(app,/async function resetPassword\(email\)/);
  assert.match(app,/sendPasswordResetEmail\(auth,address\)/);
  assert.match(app,/auth\.languageCode=I18N\.language\(\)/);
  assert.match(app,/auth\/invalid-email/);
  for(const text of ['Reconnaître la dette','Dette reconnue','Envoyer le lien'])
    assert(i18n.includes(JSON.stringify(text)));
});

const vm=require('node:vm');
function moneyCallableHarness(initial='pending'){
  const calls=[];let actor='debtor';let data={creditorUid:'creditor',debtorUid:'debtor',status:initial,amountCents:2400};
  const ref={id:'request',collection:()=>({doc:()=>({id:'request'})})};
  const tx={get:async()=>({exists:true,data:()=>({...data})}),update:(_,patch)=>{calls.push(patch);data={...data,...patch};}};
  const mock={exports:{},CALLABLE:{},onCall:(_,cb)=>cb,HttpsError:class extends Error{constructor(code,msg){super(msg);this.code=code;}},
    needAuth:()=>actor,requireId:val=>val,getChatFor:async()=>({ref,data:{members:['debtor','creditor']}}),
    db:{runTransaction:fn=>fn(tx)},FieldValue:{serverTimestamp:()=>new Date('2026-10-16')},pushRecipient:async()=>{},
  };
  const code=server.slice(server.indexOf('exports.updateMoneyRequest = onCall('),server.indexOf('// Derive outstanding',server.indexOf('exports.updateMoneyRequest = onCall(')));
  vm.runInNewContext(code,mock);
  return {run:(action)=>mock.exports.updateMoneyRequest({data:{scope:'direct',id:'chat1',requestId:'request',action}}),
    setActor:v=>{actor=v}, calls,getData:()=>data};
}
test('Firebase callable: seul le débiteur peut reconnaître une demande privée',async()=>{
  const h=moneyCallableHarness();h.setActor('creditor');
  await assert.rejects(h.run('acknowledge'),{code:'permission-denied'});
  assert.equal(h.calls.length,0);
  h.setActor('debtor');await h.run('acknowledge');
  assert.equal(h.getData().status,'accepted');
});
test('Firebase callable: le débiteur peut refuser une demande non acceptée',async()=>{
  const h=moneyCallableHarness();await h.run('decline');
  assert.equal(h.getData().status,'declined');
  await assert.rejects(h.run('acknowledge'),{code:'permission-denied'});
});
test('Firebase callable: on ne reconnaît pas une dette déjà confirmée',async()=>{
  const h=moneyCallableHarness('confirmed');
  await assert.rejects(h.run('acknowledge'),{code:'permission-denied'});
  assert.equal(h.calls.length,0);
});
