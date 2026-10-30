'use strict';
const test=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const vm=require('node:vm');
const app=fs.readFileSync(require('node:path').join(__dirname,'../public/app.js'),'utf8');
const feature=app.split('/* ---------- v28 : calendrier partagé, sondages, récurrences ---------- */')[1].split('/* ---------- Onglet Dépenses ---------- */')[0];
function runContext(){
 const ACT={},today='2026-10-16',tr=s=>s,money=(n,cur)=>`${n/100} ${cur}`,esc=s=>String(s).replaceAll('<','&lt;').replaceAll('&','&amp;'),z2=n=>String(n).padStart(2,'0');
 const fns={ACT,tr,money,esc,z2,locale:()=> 'fr-FR',daysInMonth:(y,m)=>new Date(Date.UTC(y,m,0)).getUTCDate(),todayISO:(d)=>d?new Date(d).toISOString().slice(0,10):today,fmtDate:s=>s,ico:name=>`<svg>${name}</svg>`,groupInfo:()=>null,groupAdmin:()=>false,myUid:()=> 'u1',scheduleRender:()=>{},openSheet:()=>{},closeSheet:()=>{},setTimeout:()=>{},serverTimestamp:()=>{},S:{ui:{calendarMonth:'2026-10'},route:{gid:'g1'}},Date,Intl};
 const ctx=vm.createContext(fns);const period=app.split('function addPeriod(iso, freq, dom) {')[1].split('/* ---------- RÉPARTITION')[0];vm.runInContext('function addPeriod(iso, freq, dom) {'+period+feature+'\nthis.CalendarAPI={goodDate,dayOffset,recurringTemplates,upcomingRecurring,calendarItems,tabCalendar,tabPolls,tabRecurring,calendarChange,tabPolls};',ctx);
 return {api:ctx.CalendarAPI,ctx};
}
test('calendar in memory: planned expense + two actual recurring dates only',()=>{
 const {api}=runContext(),info={group:{currency:'EUR',archived:false},st:{plansReady:true,plans:[{id:'p1',title:'Hôtel',date:'2026-10-20',status:'planned',amountCents:30000},{id:'p2',title:'Annulé',date:'2026-10-20',status:'cancelled',amountCents:100}],},expenses:[{id:'e1',title:'Loyer',amountCents:80000,date:'2026-10-01',approvalStatus:'approved',recurring:{freq:'monthly',dayOfMonth:1},recurringNext:'2026-11-01'}]};
 const events=api.calendarItems(info,'2026-10-01','2026-12-31');
 assert.deepEqual(Array.from(events,x=>x.date),['2026-10-20','2026-11-01','2026-12-01']);
 const html=api.tabCalendar(info);assert.ok(html.includes('Hôtel'));assert.ok(!html.includes('Annulé'));assert.ok(html.includes('Novembre')===false); // current page October
});
test('calendar treats leap day and month-end recurrence without lost days',()=>{
 const {api}=runContext(),info={group:{currency:'EUR'},st:{plans:[]},expenses:[{id:'e',title:'Abonnement',amountCents:800,date:'2026-01-31',approvalStatus:'approved',recurring:{freq:'monthly',dayOfMonth:31},recurringNext:'2027-01-31'}]};
 const events=api.upcomingRecurring(info,'2027-04-30');
 assert.deepEqual(Array.from(events,x=>x.date),['2027-01-31','2027-02-28','2027-03-31','2027-04-30']);
});
test('poll view escaped text and computed percentages',()=>{
 const {api}=runContext(),info={group:{archived:false,currency:'EUR'},st:{pollsReady:true,polls:[{id:'p',question:'Resto <script>',status:'open',options:['Pizza','Sushi'],votes:{u1:0,u2:0,u3:1},closesAt:{toMillis:()=>Date.now()+86400000}}]}};
 const result=api.tabPolls(info);assert.ok(result.includes('Pizza'));assert.ok(result.includes('67%'));assert.ok(!result.includes('<script>'));assert.ok(result.includes('selected'));
});
test('recurring view gives future due date and no generated duplicates on list',()=>{
 const {api}=runContext(),info={group:{archived:false,currency:'EUR'},expenses:[{id:'e',title:'Internet',amountCents:3000,approvalStatus:'approved',recurringNext:'2026-10-21',recurring:{freq:'monthly',dayOfMonth:21},createdBy:'u1'},{id:'copy',title:'Internet',amountCents:3000,auto:true,recurringFrom:'e',approvalStatus:'approved',recurringNext:null,recurring:null}]};
 const result=api.tabRecurring(info);assert.ok(result.includes('Internet'));assert.ok(result.includes('Arrêter'));assert.ok(result.includes('2026-10-21'));assert.ok(result.includes('Échéance proche'));
});
