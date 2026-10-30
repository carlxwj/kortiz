const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root=path.join(__dirname,'..');
const fn=fs.readFileSync(path.join(root,'functions/index.js'),'utf8');
const app=fs.readFileSync(path.join(root,'public/app.js'),'utf8');
const deployment=fs.readFileSync(path.join(root,'CORRIGER_FONCTION_DEPENSES.ps1'),'utf8');

test('expense callable permits every member save, without legacy admin approval',()=>{
  const section=fn.slice(fn.indexOf('exports.approveGroupExpense = onCall('),fn.indexOf('exports.requestGroupSettlement = onCall('));
  assert.match(section,/\['save','delete','import'\]\.includes\(operation\)/);
  assert.match(section,/group\.data\(\)\.memberIds\.includes\(uid\)/);
  assert.match(section,/tx\.create\(ref,\{\.\.\.clean,approvalStatus:'approved'/);
  assert.doesNotMatch(section,/Confirmation réservée au créateur et aux administrateurs/);
  assert.match(app,/operation:'save', groupId:gid, expenseId:id/);
});
test('targeted deployment does not deploy all functions or weaken rules',()=>{
  assert.match(deployment, /firebase deploy --only 'functions:approveGroupExpense'/);
  assert.doesNotMatch(deployment,/--only hosting/);
  assert.doesNotMatch(deployment,/--force/);
});
