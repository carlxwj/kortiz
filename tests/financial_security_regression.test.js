const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const root = path.resolve(__dirname,'..');
const server = fs.readFileSync(path.join(root,'functions/index.js'),'utf8');
const client = fs.readFileSync(path.join(root,'public/app.js'),'utf8');
const rules = fs.readFileSync(path.join(root,'firestore.rules'),'utf8');
const html = fs.readFileSync(path.join(root,'public/index.html'),'utf8');
const docs = entries => ({docs:entries.map(data=>({data:()=>data}))});
// Pure accounting helpers extracted without running firebase functions.
const pure = server.slice(server.indexOf('function serverTransfers('), server.indexOf('async function outstandingLimit('));
const {computeAvailableTransfers} = require('../functions/exit-debt-logic');
const ctx = vm.createContext({computeAvailableTransfers});
vm.runInContext(pure+'\nthis.serverTransfers=serverTransfers; this.touchesReimbursedParticipant=touchesReimbursedParticipant;',ctx);
test('50 euros avancés par Carlos pour Brenda créent une dette de Brenda vers Carlos',()=>{
  const ex=docs([{amountCents:5000, payers:{carlos:5000}, split:{brenda:5000}, approvalStatus:'approved'}]);
  assert.deepEqual(JSON.parse(JSON.stringify(ctx.serverTransfers(ex,docs([])))),[{fromId:'brenda',toId:'carlos',amount:5000}]);
  assert.deepEqual(JSON.parse(JSON.stringify(ctx.serverTransfers(ex,docs([{fromId:'brenda',toId:'carlos',amountCents:5000}])))),[]);
  assert.deepEqual(JSON.parse(JSON.stringify(ctx.serverTransfers(ex,docs([{fromId:'brenda',toId:'carlos',amountCents:2000}])))),[{fromId:'brenda',toId:'carlos',amount:3000}]);
});
test('Les anciennes dépenses pending comptent et les dépenses rejected ne comptent pas',()=>{
  const ex=docs([
    {approvalStatus:'pending',payers:{carlos:1000},split:{brenda:1000}},
    {approvalStatus:'rejected',payers:{carlos:1000},split:{brenda:1000}},
  ]);
  assert.equal(ctx.serverTransfers(ex,docs([]))[0].amount,1000);
});
test('Les dépenses liées à des participants ayant remboursé sont protégées',()=>{
  const history=docs([{fromId:'brenda',toId:'carlos',amountCents:2000}]).docs;
  assert.equal(ctx.touchesReimbursedParticipant({split:{brenda:5000},payers:{carlos:5000}},history),true);
  assert.equal(ctx.touchesReimbursedParticipant({split:{alice:5000},payers:{zoe:5000}},history),false);
});
test('Confirmation depuis le chat et depuis Soldes écrit une settlement comptable',()=>{
  const update=server.slice(server.indexOf('exports.updateMoneyRequest ='),server.indexOf('function serverTransfers('));
  assert.match(update,/status === 'confirmed'/);
  assert.match(update,/outstandingLimit\(chat\.ref/);
  assert.match(update,/collection\('settlements'\)\.doc/);
  assert.match(update,/tx\.create\(/);
  assert.match(update,/isAdmin\(group\.data\(\),uid\)/);
  assert.match(server,/exports.respondGroupSettlement[\s\S]*?outstandingLimit\(ref,p\.fromId,p\.toId,tx\)/);
  assert.match(server,/moneyRequestId:rid, paymentRequestId:rid/);
});
test('Les demandes de groupe doivent correspondre à une dette non soldée',()=>{
  const create=server.slice(server.indexOf('exports.createMoneyRequest ='),server.indexOf('exports.updateMoneyRequest ='));
  assert.match(create,/memberByUid\(members, debtorUid\)/);
  assert.match(create,/outstandingLimit\(context\.ref, fromId, toId, tx\)/);
  assert.match(create,/cents > outstanding/);
});
test('La suppression de membres sans compte est validée côté serveur',()=>{
  assert.match(server,/req\.data\?\.action === 'removeMember'/);
  assert.match(server,/tx\.get\(gref\.collection\('expenses'\)\)/);
  assert.match(server,/tx\.get\(gref\.collection\('settlements'\)\)/);
  assert.match(server,/tx\.get\(gref\.collection\('paymentRequests'\)\)/);
  const memberRules=rules.slice(rules.indexOf('match /groups/{gid}/members/'),rules.indexOf('function validMember('));
  assert.match(memberRules,/allow delete: if false/);
  assert.match(client,/call\('joinGroup',\{action:'removeMember'/);
});
test('Les coordonnées Wero et SEPA utilisent une transaction et restent non modifiables côté client',()=>{
  const profile=server.slice(server.indexOf('exports.saveSocialProfile ='),server.indexOf('exports.sendFriendRequest ='));
  assert.match(profile,/action === 'syncPaymentDetails'/);
  assert.match(profile,/db\.runTransaction/);
  assert.match(profile,/collection\('groups'\)\.where\('memberIds','array-contains',uid\)/);
  assert.match(profile,/tx\.update\(userRef/);
  assert.match(profile,/for\(const ref of updates\)tx\.update/);
  assert.match(client,/call\('saveSocialProfile',\{action:'syncPaymentDetails'/);
  assert.match(rules,/affectedKeys\(\)\.hasAny\(\['iban','shareIban','weroContact','shareWero'\]\)/);
});
test('Modifier ou supprimer une dépense remboursée est bloqué, ajouter reste libre',()=>{
  const expense=server.slice(server.indexOf('exports.approveGroupExpense ='),server.indexOf('exports.requestGroupSettlement ='));
  assert.match(expense,/if\(old\.exists\)[\s\S]*?touchesReimbursedParticipant/);
  assert.match(expense,/if\(req\.data\?\.isNew!==true\)/);
  assert.match(expense,/Modification bloquée/);
  assert.match(expense,/Suppression bloquée/);
});
test('Le mode hors-ligne ne promet plus de synchronisation bancaire automatique',()=>{
  assert.match(html,/Pour enregistrer des dépenses, remboursements et messages, reconnecte-toi/);
  assert.doesNotMatch(html,/tes ajouts sont mis en file d'attente/);
});
