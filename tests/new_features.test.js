/* Static regression checks; deployment + emulator integration tests remain mandatory. */
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {readFileSync}=require('node:fs');
const {join}=require('node:path');
const root=join(__dirname,'..');
const get=n=>readFileSync(join(root,n),'utf8');
const fsRules=get('firestore.rules'),storage=get('storage.rules'),func=get('functions/index.js'),app=get('public/app.js'),html=get('public/index.html');
test('identity is Kortiz and authentication screen has no language picker',()=>{
  assert.match(html,/<title>Kortiz/);
  assert.ok(!app.includes("localePicker('auth-lang')"));
  assert.match(app,/localePicker\('settings-lang'\)/);
  assert.match(app,/window.KortizI18n/);
});
test('client cannot create a confirmed settlement or write message documents',()=>{
  const settlement=fsRules.match(/match \/groups\/\{gid\}\/settlements\/\{sid\} \{([^}]+)/)?.[1]||'';
  assert.match(settlement,/allow create: if false/);
  assert.match(settlement,/allow delete: if false/);
  assert.match(fsRules,/match \/groups\/\{gid\}\/messages\/\{mid\}/);
  assert.match(fsRules,/match \/directChats\/\{cid\}/);
  assert.match(fsRules,/allow write: if false/);
});
test('expenses can be saved by members; recipient or neutral admin confirms repayments',()=>{
  assert.match(func,/exports\.approveGroupExpense = onCall/);
  assert.match(func,/g\.data\(\)\.memberIds\.includes\(uid\)/);
  assert.match(func,/approvalStatus:'approved',createdBy:uid/);
  assert.match(func,/action === 'confirm' && !debtor/);
  assert.match(func,/exports\.respondGroupSettlement = onCall/);
  assert.match(func,/outstandingLimit\(/);
  assert.match(func,/exports\.updateMoneyRequest = onCall/);
  assert.match(fsRules,/allow update, delete: if false/);
  assert.match(func,/operation==='save'/);
  assert.match(func,/checkedExpense\(/);
});
test('media uploads have authenticated ownership checks and size limits',()=>{
  assert.match(storage,/match \/avatars\/\{uid\}\/profile.jpg/);
  assert.match(storage,/request.auth.uid == uid/);
  assert.match(storage,/25 \* 1024 \* 1024/);
  assert.match(func,/exports\.sendChatMessage = onCall/);
  assert.match(func,/exports\.reportChatMessage = onCall/);
});
test('legal pages are provided in four languages and publisher details exist',()=>{
  const legal=get('public/legal.js');
  for(const l of ['"fr"','"en"','"pt"','"es"'])assert.ok(legal.includes(l));
  assert.match(legal,/Carlos da Costa/);
  assert.match(legal,/carlxwj@gmail.com/);
  assert.match(legal,/68000 Colmar/);
});
