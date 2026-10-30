'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname,'..');
const app = fs.readFileSync(path.join(root,'public/app.js'),'utf8');
const rules = fs.readFileSync(path.join(root,'firestore.rules'),'utf8');
const backend = fs.readFileSync(path.join(root,'functions/index.js'),'utf8');
const css = fs.readFileSync(path.join(root,'public/styles.css'),'utf8');
const i18n = fs.readFileSync(path.join(root,'public/i18n.js'),'utf8');

test('la création d’un groupe ne permet plus les participants saisis par prénom',()=>{
  const create=app.slice(app.indexOf('async function createGroup('),app.indexOf('function updateGroup(',app.indexOf('async function createGroup(')));
  const form=app.slice(app.indexOf('function openGroupForm('),app.indexOf('ACT["edit-group"]',app.indexOf('function openGroupForm(')));
  assert.doesNotMatch(form,/id="gf-part"|id="gf-add"|id="gf-chips"|Participants \(sans compte\)/);
  assert.doesNotMatch(create,/uid:\s*null|participants\.forEach/);
  assert.match(create,/await batch\.commit\(\)/);
});

test('les écrans de participants ne peuvent plus ajouter un prénom sans compte',()=>{
  const members=app.slice(app.indexOf('ACT.members ='),app.indexOf('ACT["edit-member"]',app.indexOf('ACT.members =')));
  assert.doesNotMatch(members,/id="mb-new"|ACT\["member-add"\]/);
  assert.match(members,/members-open-invite/);
});

test('les règles interdisent les nouvelles fiches anonymes dans un groupe existant',()=>{
  const members=rules.slice(rules.indexOf('match /groups/{gid}/members/{mid}'),rules.indexOf('function validMember(',rules.indexOf('match /groups/{gid}/members/{mid}')));
  assert.match(members,/request\.resource\.data\.uid == request\.auth\.uid/);
  assert.match(members,/request\.resource\.data\.uid == null[\s\S]*!exists\(groupPath\(gid\)\)[\s\S]*demo/);
});

test('les règles Firestore protègent la boîte de réception et les invitations du groupe',()=>{
  assert.match(rules,/match \/users\/\{uid\}\/groupInvites\/\{gid\}/);
  assert.match(rules,/allow read: if signedIn\(\) && request\.auth\.uid == uid;/);
  assert.match(rules,/match \/groups\/\{gid\}\/groupInvites\/\{targetUid\}/);
  assert.match(rules,/allow read, write: if false;/);
});

test('l’envoi ciblé exige l’appartenance au groupe et une amitié existante',()=>{
  const sender=backend.slice(backend.indexOf("if (req.data?.action === 'inviteFriend')"),backend.indexOf("if (req.data?.action === 'respondGroupInvite')"));
  assert.match(sender,/memberIds\.includes\(uid\)/);
  assert.match(sender,/friendships.*directId\(uid,other\)/);
  assert.match(sender,/blockedByMe\.exists\|\|blockedByThem\.exists/);
  assert.match(sender,/groupInvites/);
  assert.match(sender,/expiresAt/);
});

test('l’acceptation valide le destinataire, le profil et la capacité du groupe',()=>{
  const accept=backend.slice(backend.indexOf("if (req.data?.action === 'respondGroupInvite')"),backend.indexOf("if (req.data?.action === 'leaveGroup')"));
  assert.match(accept,/doc\(uid\)\.collection\('groupInvites'\)\.doc\(gid\)/);
  assert.match(accept,/invite\.data\(\)\.status!=='pending'/);
  assert.match(accept,/memberIds\.length>=50/);
  assert.match(accept,/displayName/);
  assert.match(accept,/FieldValue\.arrayUnion\(uid\)/);
  assert.match(accept,/remainingClaim\(d\)>0/);
  assert.match(accept,/status:'accepted'/);
});

test('un refus ne modifie pas l’appartenance au groupe',()=>{
  const accept=backend.slice(backend.indexOf("if (req.data?.action === 'respondGroupInvite')"),backend.indexOf("if (req.data?.action === 'leaveGroup')"));
  assert.match(accept,/if\(!g\.exists\|\|!accept\)[\s\S]*status:'declined'[\s\S]*return \{ok:true,accepted:false\}/);
});

test('l’invitation conserve code, lien, WhatsApp et liste d’amis',()=>{
  const invite=app.slice(app.indexOf('ACT.invite ='),app.indexOf('ACT["copy-code"]'));
  for(const op of ['invite-friend-to-group','copy-code','copy-link','invite-wa','invite-share'])assert.ok(invite.includes(op),op);
});

test('les invitations apparaissent sur accueil et dans Amis et messages',()=>{
  assert.match(app,/function startGroupInvites\(uid\)/);
  assert.match(app,/function groupInvitationsUI\(\)/);
  assert.match(app,/data-act="accept-group-invite"/);
  assert.match(app,/data-act="decline-group-invite"/);
  assert.equal((app.match(/\$\{groupInvitationsUI\(\)\}/g)||[]).length,2);
  assert.match(css,/\.group-invite-card/);
});

test('les comptes supprimés et groupes supprimés nettoient les invitations reçues',()=>{
  const account=backend.slice(backend.indexOf('exports.deleteAccount'),backend.indexOf('/* ---------- Validation serveur',backend.indexOf('exports.deleteAccount')));
  assert.match(account,/collection\('groupInvites'\)\.get\(\)/);
  const group=backend.slice(backend.indexOf('exports.deleteGroup'),backend.indexOf('exports.deleteAccount'));
  assert.match(group,/collection\('groupInvites'\)\.get\(\)/);
});

test('la main reste seulement à droite du prénom sur accueil',()=>{
  assert.match(app,/\$\{tr\('Salut'\)\} <span class="welcome-user-inline">\$\{esc\(first\)\}\$\{userMark\('welcome-name-mark'\)\}/);
  assert.doesNotMatch(app,/nameWithMark\(/);
  assert.match(i18n,/"Salut": \{"en": "Hi", "pt": "Olá", "es": "Hola"\}/);
});

test('toutes les nouvelles instructions ont des traductions FR EN PT ES',()=>{
  for(const key of ['Invitations de groupe','Invitation envoyée.','Inviter depuis mes amis','Rejoindre le groupe','Tu rejoindras ce groupe avec ton profil Kortiz.']){
    const idx=i18n.indexOf(JSON.stringify(key));
    assert.ok(idx>=0,key);
    assert.match(i18n.slice(idx,idx+400),/"en"/);
    assert.match(i18n.slice(idx,idx+400),/"pt"/);
    assert.match(i18n.slice(idx,idx+400),/"es"/);
  }
});
