'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const root=path.resolve(__dirname,'..');
const read=p=>fs.readFileSync(path.join(root,p),'utf8');
const app=read('public/app.js'),fn=read('functions/index.js'),rules=read('firestore.rules'),landing=read('public/decouvrir.html'),css=read('public/styles.css');

test('v28.4: group calendar and recurring tabs remain, polls moved into chat',()=>{
  for(const tab of ['calendar','recurring']) {
    assert.match(app,new RegExp(`\\["${tab}",`));
    assert.match(app,new RegExp(`tab: .*"${tab}"`));
  }
  assert.match(app,/p\[2\] === "polls" \? "chat"/);
  const menu=app.split('const GROUP_TABS = ')[1].split(';')[0];
  assert.doesNotMatch(menu,/"polls"/);
  assert.match(menu,/"chat", "Discussion"/);
  assert.match(app,/chat\('messages','messages',80\)/);
  assert.match(app,/chat\('paymentRequests','payments',60\)/);
  assert.match(app,/SOC\.polls=snap\.docs/);
  assert.match(app,/\['plans','calendar'\]\.includes/);
});
test('v28: calendar reads existing plannedExpenses and recurring templates without creating debts',()=>{
  assert.match(app,/function calendarItems\(info,start,end\)/);
  assert.match(app,/info\.st\.plans\.filter\(p=>p\.date/);
  assert.match(app,/recurringTemplates\(info\)/);
  assert.match(app,/function upcomingRecurring\(info,maxDate\)/);
  assert.match(app,/const n=addPeriod\(next,e\.recurring\.freq,e\.recurring\.dayOfMonth\)/);
  assert.match(app,/data-act="calendar-day"/);
  assert.match(app,/openPlanSheet\(S\.route\.gid,null,date\)/);
});
test('v28: calendar handles leap days, month rollover and rejected invalid dates',()=>{
  const source=app.match(/function goodDate\(iso\)\{[^\n]+\}/)[0];
  const context={Date,ISO_DATE:/^\d{4}-\d{2}-\d{2}$/,dateUTC:iso=>new Date(`${iso}T12:00:00Z`)};
  vm.runInNewContext(source+';this.goodDate=goodDate',context);
  assert.equal(context.goodDate('2028-02-29'),true);
  assert.equal(context.goodDate('2027-02-29'),false);
  assert.equal(context.goodDate('2027-13-01'),false);
  assert.equal(context.goodDate('2027-02-30'),false);
  assert.equal(context.goodDate('2027-12-31'),true);
});
test('v28: polls have strict one-person vote update and immutable question/options',()=>{
  assert.match(rules,/match \/groups\/\{gid\}\/polls\/\{pollId\}/);
  assert.match(rules,/request\.resource\.data\.votes\.diff\(resource\.data\.votes\)\.affectedKeys\(\)\.hasOnly\(\[request\.auth\.uid\]\)/);
  assert.match(rules,/request\.resource\.data\.question == resource\.data\.question/);
  assert.match(rules,/request\.resource\.data\.options == resource\.data\.options/);
  assert.match(rules,/request\.time < resource\.data\.closesAt/);
  assert.match(rules,/request\.resource\.data\.votes\.size\(\) == 0/);
  assert.match(rules,/resource\.data\.createdBy == request\.auth\.uid \|\| groupAdmin\(gid\)/);
  assert.match(app,/new FieldPath\('votes',myUid\(\)\)/);
  assert.match(app,/const pollCanManage=/);
});
test('v28: no polls ever touch financial collections or banking',()=>{
  const section=app.split('/* ---------- v28 : calendrier partagé, sondages, récurrences ---------- */')[1].split('/* ---------- Onglet Dépenses ---------- */')[0];
  const poll=section.split('const pollCanManage=')[1].split('function tabRecurring(info)')[0];
  assert.doesNotMatch(poll,/collection\([^\n]*expenses|settlements|moneyRequests|bank|wero/);
  assert.match(poll,/collection\(root,'polls'\)/);
});
test('v28: recurring stop operation keeps historical financial fields intact',()=>{
  const code=fn.split("if(operation==='stopRecurring')")[1].split("if(['save','delete','import']")[0];
  assert.match(code,/db\.runTransaction/);
  assert.match(code,/!group\.data\(\)\.memberIds\.includes\(uid\)/);
  assert.match(code,/!isAdmin\(group\.data\(\),uid\)/);
  assert.match(code,/recurring:null,recurringNext:null/);
  for(const item of ['amountCents:','payers:','split:','approvalStatus:'])assert.ok(!code.includes(item));
  assert.match(app,/call\('approveGroupExpense',\{operation:'stopRecurring'/);
  assert.match(read('DEPLOYER_KORTIZ_V28.ps1'),/'approveGroupExpense'/);
});
test('v28: poll data is anonymized during account deletion',()=>{
  assert.match(fn,/const polls=await g\.ref\.collection\('polls'\)\.get\(\)/);
  assert.match(fn,/delete votes\[uid\]/);
  assert.match(fn,/patch\.createdBy='deleted'/);
});
test('v28: both public and in-app landing show five new features with same copy',()=>{
  const section=landing.match(/<section class="mk-section lp-section lp-reveal" id="nouveautes-v28">[\s\S]*?<\/section>/)?.[0];
  assert.ok(section);
  assert.equal((section.match(/class="lp-v28-card"/g)||[]).length,5);
  assert.ok(app.includes(section));
  assert.match(read('public/landing-v23.css'),/\.lp-v28-grid/);
  assert.match(read('public/landing-v23.css'),/@media\(max-width:580px\)/);
  assert.match(section,/aucune alerte push d'échéance n'est promise/);
});
test('v28: new views have mobile-specific and reduced motion CSS',()=>{
  assert.match(css,/\.v28-calendar-grid/);
  assert.match(css,/\.v28-poll-card/);
  assert.match(css,/\.v28-recurring-row/);
  assert.match(css,/@media\(max-width:680px\)/);
  assert.match(css,/@media\(prefers-reduced-motion:reduce\)/);
});
test('v28: 4 language dictionary contains the full launch description',()=>{
  const txt=read('public/i18n.js');
  for(const item of ['Calendrier partagé','Décider ensemble','Votes et sondages','Rappels des 30 prochains jours','Dépenses régulières','Échéances et prévisions']){
    assert.ok(txt.includes(JSON.stringify(item)),item);
  }
});
