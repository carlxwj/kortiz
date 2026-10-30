const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const N = require('../public/notification-logic.js');
const app = fs.readFileSync(path.join(__dirname,'../public/app.js'),'utf8');
const rules = fs.readFileSync(path.join(__dirname,'../firestore.rules'),'utf8');
const styles = fs.readFileSync(path.join(__dirname,'../public/styles.css'),'utf8');
const index = fs.readFileSync(path.join(__dirname,'../public/index.html'),'utf8');
const i18n = fs.readFileSync(path.join(__dirname,'../public/i18n.js'),'utf8');
const sw = fs.readFileSync(path.join(__dirname,'../public/firebase-messaging-sw.js'),'utf8');
const stamp = n => ({toMillis: () => n});

test('les badges indiquent 1, 2, 3, 4 ou 4+ sans annoncer zéro', () => {
  assert.equal(N.label(0),'');
  for(const n of [1,2,3,4])assert.equal(N.label(n),'+'+String(n));
  assert.equal(N.label(5),'4+');
  assert.equal(N.label(200),'4+');
});
test('les nouveautés excluent les messages propres et les anciens messages', () => {
  const msgs = [
    {uid:'a',createdAt:stamp(120)},
    {uid:'me',createdAt:stamp(130)},
    {uid:'b',createdAt:stamp(90)},
    {uid:'b',createdAt:stamp(140),type:'deleted'},
    {uid:'b',createdAt:stamp(150)},
  ];
  assert.equal(N.unread(msgs,stamp(100),'me','uid'),2);
  assert.equal(N.unread(msgs,stamp(135),'me','uid'),1);
  assert.equal(N.unread(msgs,null,'me','uid'),0);
});
test('les badges dépenses ignorent ses propres créations et les dépenses refusées', () => {
  const expenses = [
    {createdBy:'other',createdAt:stamp(210),approvalStatus:'approved'},
    {createdBy:'me',createdAt:stamp(220),approvalStatus:'approved'},
    {createdBy:'other',createdAt:stamp(230),approvalStatus:'rejected'},
  ];
  assert.equal(N.unread(expenses,stamp(200),'me','createdBy'),1);
});
test('les dates de lecture Firebase sont correctement converties',()=>{
  assert.equal(N.ms({seconds:1720000000,nanoseconds:123000000}),1720000000123);
  assert.equal(N.ms(null),0);
});
test('les routes amis, conversations privées, groupes et dépenses affichent les badges', () => {
  for(const x of ['notifFriendsCount()', 'notifDmCount(c.id)', 'notifGroupCount(g.id)', 'notifGroupCount(g.id)', 'markVisibleNotifications()', "notificationReads", 'startNotificationReads(user.uid)'])
    assert.ok(app.includes(x),x);
  assert.match(app,/const notifBadge=.*notif-pill/);
  assert.match(styles,/\.notif-pill\{/);
});
test('les dates sont stockées dans le profil privé pour suppression avec le compte',()=>{
  assert.match(app,/onSnapshot\(doc\(db,'users',uid\)/);
  assert.match(app,/new FieldPath\('notificationReads',key,'chatReadAt'\)/);
  assert.match(app,/new FieldPath\('notificationReads',notifDocId\(kind,id\),field\)/);
  assert.match(rules,/match \/users\/\{uid\}/);
  assert.match(rules,/d\.get\('notificationReads',\{\}\) is map/);
  assert.doesNotMatch(rules,/match \/users\/\{uid\}\/notificationReads\//);
});
test('le tutoriel IBAN et Wero est un popup et son affichage est configurable par compte',()=>{
  for(const x of ['openPaymentGuide(', "paymentGuideSeen:true", 'paymentGuideMode:choice', "ACT['payment-guide-help']", "ACT['payment-details-guide']", 'Seulement cette fois-ci', 'À chaque ouverture des coordonnées'])
    assert.ok(app.includes(x),x);
  assert.match(app,/title:tr\('Comprendre les remboursements SEPA et Wero'\)/);
  assert.match(app,/Les coordonnées partagées sont visibles par les membres/);
  assert.match(rules,/d\.get\('paymentGuideMode','once'\) in \['once','always'\]/);
});
test('les clés de traduction sont disponibles dans 4 langues et les assets chargés par la PWA',()=>{
  for(const term of ['Seulement cette fois-ci','À chaque ouverture des coordonnées','Comprendre les remboursements SEPA et Wero','nouveautés']){
    assert.ok(i18n.includes(term),term);
  }
  assert.match(index,/notification-logic\.js/);
  assert.match(sw,/notification-logic\.js/);
});
