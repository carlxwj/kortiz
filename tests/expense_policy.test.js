const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const root = join(__dirname, '..');
const backend = readFileSync(join(root, 'functions/index.js'), 'utf8');
const ui = readFileSync(join(root, 'public/app.js'), 'utf8');
const rules = readFileSync(join(root, 'firestore.rules'), 'utf8');

test('every group member can create a validated and immediately counted expense', () => {
  const expenseSave = backend.slice(backend.indexOf('exports.approveGroupExpense = onCall('), backend.indexOf('exports.requestGroupSettlement = onCall('));
  assert.match(expenseSave, /group\.data\(\)\.memberIds\.includes\(uid\)/);
  assert.match(expenseSave, /checkedExpense\(gid,eid,req\.data\?\.expense,ids\)/);
  assert.match(expenseSave, /tx\.create\(ref,\{\.\.\.clean,approvalStatus:'approved'/);
  assert.match(expenseSave, /tx\.create\(refs\[i\],\{\.\.\.clean,approvalStatus:'approved'/);
  assert.doesNotMatch(expenseSave, /approvalStatus:'pending'/);
  assert.match(rules, /allow update, delete: if false/);
});
test('existing pending expenses count, while rejected entries stay excluded', () => {
  assert.match(ui, /st\.expenses\.filter\(e=>e\.approvalStatus!=='rejected'\)/);
  assert.match(ui, /info\.expenses\.filter\(\(e\) => e\.approvalStatus!=='rejected'/);
  const logic = readFileSync(join(root,'functions/exit-debt-logic.js'),'utf8');
  assert.match(logic, /if\(!e \|\| e\.approvalStatus==='rejected'\)continue/);
  assert.doesNotMatch(ui, /data-act="approve-expense"/);
  assert.doesNotMatch(ui, /e\.approvalStatus==='pending'\?`<span class="badge"/);
});
test('creditor or a neutral admin can confirm a group reimbursement; never the debtor', () => {
  const section = backend.slice(backend.indexOf('exports.respondGroupSettlement = onCall('), backend.indexOf('exports.cancelConfirmedSettlement = onCall('));
  assert.match(section, /const debtor = uid === p\.fromUid, creditor = uid === p\.toUid/);
  assert.match(section, /const neutralAdmin = isAdmin\(group,uid\) && !debtor/);
  assert.match(section, /action === 'confirm' && !debtor/);
  assert.match(section, /creditor && \['pending','marked_paid'\]\.includes\(p\.status\)/);
  assert.match(section, /action === 'mark_paid' && debtor/);
  assert.match(section, /tx\.set\(ref\.collection\('settlements'\)\.doc\(\)/);
});
test('recurring expenses are counted immediately and creators can correct their own expenses', () => {
  assert.match(backend, /approvalStatus:'approved', recurring:null/);
  assert.match(backend, /prev\.createdBy!==uid && !isAdmin\(group\.data\(\),uid\)/);
  assert.match(ui, /e\.createdBy===myUid\(\) && e\.approvalStatus!=='rejected'/);
});
