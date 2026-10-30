/* Vérifications statiques, sans installation Firebase requise. */
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.resolve(__dirname,'..');
const src=fs.readFileSync(path.join(root,'functions/index.js'),'utf8');
const deploy=fs.readFileSync(path.join(root,'DEPLOYER_SANS_COMPTE_COMPLET.ps1'),'utf8');
const features=fs.readFileSync(path.join(root,'public/app.js'),'utf8');
const names=[...src.matchAll(/^exports\.([A-Za-z0-9_]+)\s*=/gm)].map(m=>m[1]);
test('les points d’entrée Cloud Functions sont conservés',()=>{
  assert.equal(names.length,25);
  assert.equal(new Set(names).size,names.length);
  for (const name of ['sendFriendRequest','deleteAccount','recurringExpenses','setGroupAdmin','deleteChatMessage','approveGroupExpense','respondGroupSettlement']) {
    assert.ok(names.includes(name),name);
  }
});
test('le profil de faible CPU a une limite stricte pour chaque fonction',()=>{
  for(const [expr,desc] of [
    [/memory:\s*'256MiB'/,'RAM normale'],
    [/cpu:\s*'gcf_gen1'/,'CPU fractionnaire'],
    [/concurrency:\s*1/,'1 requête par instance'],
    [/minInstances:\s*0/,'aucune instance chaude'],
    [/maxInstances:\s*1/,'maximum une instance'],
    [/const HEAVY_RUNTIME = Object\.freeze\(\{ memory: '512MiB', cpu: 'gcf_gen1'/,'fonctions lourdes'],
  ])assert.match(src,expr,desc);
  assert.doesNotMatch(src,/maxInstances:\s*10/);
  for(const n of ['deleteGroup','deleteAccount']) assert.match(src,new RegExp(`exports\\.${n} = onCall\\(\\{ \\.\\.\\.CALLABLE, \\.\\.\\.HEAVY_RUNTIME \\}`));
  assert.match(src,/onDocumentWritten\(\{ document: 'groups\/\{gid\}\/expenses\/\{eid\}', \.\.\.HEAVY_RUNTIME \}/);
  assert.match(src,/onSchedule\(\{\s*schedule:\s*'every day 06:00',\s*timeZone:\s*'Europe\/Brussels',\s*\.\.\.HEAVY_RUNTIME\s*\}/);
});
test('déploiement séquentiel explicite, sans suppression et sans déploiement complet',()=>{
  for(const n of names)assert.match(deploy,new RegExp(`'${n}'`),n);
  assert.match(deploy,/foreach \(\$fn in \$targets\)/);
  assert.match(deploy,/--only "functions:\$fn" --non-interactive/);
  assert.doesNotMatch(deploy,/firebase functions:delete|firebase deploy --only functions\s*$/m);
  assert.match(features,/const FUNCTIONS_REGION = "europe-west1"/);
});
