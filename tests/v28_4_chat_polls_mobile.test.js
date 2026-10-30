'use strict';
const {test}=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const vm=require('node:vm');const crypto=require('node:crypto');const path=require('node:path');
const root=path.resolve(__dirname,'..');
const read=n=>fs.readFileSync(path.join(root,n),'utf8');
const app=read('public/app.js'),rules=read('firestore.rules'),css=read('public/styles.css'),fn=read('functions/index.js'),dict=read('public/i18n.js');
test('v28.4: fixed mobile navigation always offers the group discussion and More',()=>{
  assert.match(app,/GROUP_MOBILE_TABS = \["expenses", "plans", "chat", "balances"\]/);
  assert.match(app,/data-act="group-more-tabs"/);
  assert.match(app,/data-act="nav" data-to="\/g\/\$\{esc\(gid\)\}\/\$\{k\}"/);
  assert.match(css,/body\[data-route="group"\] #bottomnav \.bar>\.nav-item\{min-width:0/);
  assert.match(app,/\["friends", "\/friends", "Messages", "mail"\]/);
  assert.doesNotMatch(app.split('const GROUP_TABS = ')[1].split(';')[0],/Sondages/);
});
test('v28.4: group poll route redirects to chat for saved bookmarks',()=>{
  assert.match(app,/p\[2\] === "polls" \? "chat"/);
  assert.match(app,/polls: \[\]/); // group store maintains old collection as legacy, no deletion
});
test('v28.4: polls are streamed for both group and DM roots, without blocking messages',()=>{
  assert.match(app,/const root = scope === 'group' \? doc\(db,'groups',id\) : doc\(db,'directChats',id\)/);
  assert.match(app,/onSnapshot\(query\(collection\(root,'polls'\),orderBy\('createdAt','desc'\),limit\(80\)\)/);
  assert.match(app,/SOC\.pollsLoading=false;SOC\.pollError=err\?\.code/);
  assert.match(app,/SOC\.chatUnsubs\.push\(unsubPolls\)/);
  assert.match(app,/SOC\.polls=\[\]; SOC\.pollsLoading=false; SOC\.pollError=null/);
  assert.match(app,/chatTimeline\(scope,id,readonly\)/);
  assert.match(app,/chatPollMarkup\(x\.item,scope,id,readonly\)/);
  assert.match(app,/data-act="poll-create" data-scope="\$\{scope\}" data-chat="\$\{esc\(id\)\}"/);
});
test('v28.4: HTML poll renders percentages and escapes potentially malicious question',()=>{
  const code=app.split('// Polls appear between chat messages')[1].split('function socialChatUI(',1)[0];
  const context={Date,Intl,Array,Object,Math,groupInfo:()=>({group:{createdBy:'u1'}}),groupAdmin:()=>false,
    tr:x=>x,esc:x=>String(x).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('"','&quot;'),
    ico:()=>'<svg></svg>',locale:()=> 'fr-FR',myUid:()=> 'u1',msOf:t=>t?.toMillis?.()||Date.now(),
    pollIsOpen:p=>p.status==='open'};
  vm.runInNewContext('function chatPollMarkup'+code.split('function chatPollMarkup')[1]+'\nthis.card=chatPollMarkup;',context);
  const html=context.card({id:'p1',question:'Restaurant <script>alert(1)</script>',options:['Sushi','Pizza'],status:'open',createdBy:'u2',votes:{u1:0,u2:0,u3:1},closesAt:{toMillis:()=>Date.now()+86400000}},'direct','cid1');
  assert.match(html,/67%/);assert.match(html,/selected/);assert.match(html,/data-scope="direct" data-chat="cid1"/);assert.doesNotMatch(html,/<script>/);assert.match(html,/Restaurant &lt;script>/);
});
test('v28.4: private poll rules read, write only for DM members and allow only own votes',()=>{
  const section=rules.split('match /directChats/{cid} {')[1].split('match /groups/{gid}/messages/{mid}')[0];
  assert.match(section,/match \/polls\/\{pollId\} \{/);
  assert.match(section,/allow read: if directChatAllowed\(cid\)/);
  assert.match(section,/members\.size\(\) == 2/);
  assert.match(section,/validPoll\(request\.resource\.data\)/);
  assert.match(section,/request\.resource\.data\.votes\.diff\(resource\.data\.votes\)\.affectedKeys\(\)\.hasOnly\(\[request\.auth\.uid\]\)/);
  assert.match(section,/request\.resource\.data\.question == resource\.data\.question/);
  assert.match(section,/resource\.data\.createdBy == request\.auth\.uid/);
  assert.match(section,/allow delete: if false/);
  assert.doesNotMatch(section,/allow read: if true/);
});
test('v28.4: account deletion removes vote UID/author from private polls as well as group polls',()=>{
  assert.match(fn,/const directPolls=await d\.ref\.collection\('polls'\)\.get\(\)/);
  assert.match(fn,/delete votes\[uid\];patch\.votes=votes/);
  assert.match(fn,/if\(poll\.data\(\)\.createdBy===uid\)patch\.createdBy='deleted'/);
});
test('v28.4: Contact still matches v28.3 byte-for-byte',()=>{
  const hashes={
    'public/contact.js':'2e7a8bec24f55dabddb92139798ef2f664de0c41cb850e0c7660d82c648c6e19',
    'public/contact.html':'ad9fa0f3bd90007bb144bd6fd871aa6a236712aa6036e99e9c5f1a6252278742'};
  for(const [file,checksum] of Object.entries(hashes))assert.equal(crypto.createHash('sha256').update(fs.readFileSync(path.join(root,file))).digest('hex'),checksum);
});
test('v28.4: New chat controls translated in four languages',()=>{
  for(const label of ['Sondage','Créer un sondage','Autres rubriques','Plus','Vérifie les autorisations Firestore de cette conversation.']){
    const line=dict.split(JSON.stringify(label)+': ')[1]?.split('\n',1)[0];
    assert.ok(line && line.includes('"en"')&&line.includes('"pt"')&&line.includes('"es"'),label);
  }
});
