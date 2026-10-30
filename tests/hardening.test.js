// Static checks + execution of the actual pure expense validator.
// These tests complement — and DO NOT replace — Firebase Emulator permission tests.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.join(__dirname,'..');
const read = p => readFileSync(path.join(root,p),'utf8');
const server = read('functions/index.js');
const firestore = read('firestore.rules');
const storage = read('storage.rules');
const client = read('public/app.js');
const i18n = read('public/i18n.js');
function validateExpense(e) {
  const start = server.indexOf('const expenseFields=new Set(');
  const end = server.indexOf('exports.approveGroupExpense = onCall(',start);
  assert.ok(start >= 0 && end > start);
  class HttpsError extends Error { constructor(code,msg){super(msg);this.code=code;} }
  const context={ HttpsError, sumCents:o => Object.values(o||{}).reduce((sum,v)=>sum+(Number.isInteger(v)&&v>=0?v:NaN),0) };
  const code = server.slice(start,end) + '\ncheckedExpense("g","e",input,new Set(["alice","bob"]));';
  return vm.runInNewContext(code, {...context,input:e});
}
const expense=()=>({title:'Courses',amountCents:1250,paidBy:'alice',payers:{alice:1250},split:{alice:625,bob:625},splitMode:'equal',splitInput:{},category:'courses',date:'2026-10-14',note:'',recurring:null,recurringNext:null,receiptPath:null});
test('server expense validator permits a balanced expense',()=>{
  const r=validateExpense(expense());assert.equal(r.amountCents,1250);assert.equal(r.split.bob,625);
});
test('server rejects unbalanced shares and payers before write',()=>{
  assert.throws(()=>validateExpense({...expense(),split:{alice:624,bob:625}}),/parts|paiements/i);
  assert.throws(()=>validateExpense({...expense(),payers:{alice:1300}}),/parts|paiements|Montant/i);
});
test('server rejects spoofed IDs, creator fields, bad dates and false receipt path',()=>{
  assert.throws(()=>validateExpense({...expense(),split:{alice:625,mallory:625}}),/participant/i);
  assert.throws(()=>validateExpense({...expense(),createdBy:'mallory'}),/Champs de dépense/i);
  assert.throws(()=>validateExpense({...expense(),date:'2026-02-31'}),/Date invalide/i);
  assert.throws(()=>validateExpense({...expense(),receiptPath:'groups/other/receipts/e.jpg'}),/justificatif/i);
});
test('currency cannot change after group creation; only demo can create direct expense',()=>{
  assert.match(firestore,/request\.resource\.data\.currency == resource\.data\.currency/);
  assert.match(firestore,/!exists\(groupPath\(gid\)\)/);
  assert.match(firestore,/allow update, delete: if false/);
  assert.match(client,/operation:'save', groupId:gid/);
  assert.match(client,/operation:'import',groupId:gid/);
});
test('immutable receipts and blocked private history are protected by rules',()=>{
  assert.match(storage,/request\.resource\.metadata\.ownerUid == request\.auth\.uid/);
  assert.match(storage,/allow update, delete: if false/);
  assert.match(firestore,/function directChatAllowed\(cid\)/);
  assert.match(storage,/function inDirectChat\(cid\)/);
});
test('money requests and chat messages are atomic and support idempotency',()=>{
  assert.match(server,/const messageRef = key \?/);
  assert.match(server,/const message = context\.ref\.collection\('messages'\)\.doc\(`request_\$\{ref\.id\}`\)/);
  assert.match(server,/tx\.set\(message, \{ uid, name: 'Kortiz'/);
  assert.match(server,/tx\.set\(ref\.collection\('messages'\)\.doc\(`settlement_\$\{p\.id\}`\)/);
  assert.match(client,/clientRequestId=crypto\.randomUUID\(\)/);
});
test('existing ghost participants require admin review; group claims have read-only rules',()=>{
  assert.match(server,/req\.data\?\.action === 'reviewClaim'/);
  assert.match(server,/pendingApproval:true/);
  assert.match(firestore,/match \/groups\/\{gid\}\/memberClaims\/\{claimantUid\}/);
  assert.match(firestore,/allow write: if false/);
});
test('new chat actions and errors are localized and user is informed',()=>{
  for(const k of ['Charger les messages précédents','Envoi en cours…','Demandes de liaison'])assert.ok(i18n.includes(JSON.stringify(k)));
  assert.match(client,/loadOlderChatMessages\(/);
  assert.match(client,/id="chat-send-status"/);
});
