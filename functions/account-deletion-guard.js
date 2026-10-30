'use strict';
/** Business-level deletion checks; no Firestore Admin APIs here for deterministic tests.
 * A private request is NOT an enforceable debt until the debtor acknowledges it.
 */
const {computeAvailableTransfers,remainingClaim}=require('./exit-debt-logic');
const docs=rows=>Array.isArray(rows)?rows:(rows?.docs||[]);
const data=doc=>typeof doc?.data==='function'?doc.data():doc;
const UNPAID_DIRECT=new Set(['accepted','marked_paid']);
function groupDebtsFor(uid,members,expenses,settlements,exitDebts){
  const ids=new Set(docs(members).filter(m=>data(m)?.uid===uid).map(m=>m.id));
  const claims=docs(exitDebts).filter(c=>{
    const v=data(c);return remainingClaim(v)>0&&(v.fromUid===uid||(!v.fromUid&&ids.has(v.fromId)));
  }).map(c=>({kind:'exit',amountCents:data(c).amountCents}));
  const transfers=computeAvailableTransfers(expenses,settlements,exitDebts)
    .filter(t=>ids.has(t.fromId)&&Number.isSafeInteger(t.amount)&&t.amount>0)
    .map(t=>({kind:'group',amountCents:t.amount}));
  return [...claims,...transfers];
}
function directDebtsFor(uid,requests){
  return docs(requests).filter(r=>{
    const v=data(r);return v?.debtorUid===uid&&UNPAID_DIRECT.has(v.status)
      && Number.isSafeInteger(v.amountCents)&&v.amountCents>0;
  }).map(r=>({kind:'direct',amountCents:data(r).amountCents}));
}
function externalExitDebtsFor(uid,claims){
  return docs(claims).filter(c=>{
    const v=data(c);return v?.fromUid===uid&&remainingClaim(v)>0;
  }).map(c=>({kind:'exit',amountCents:data(c).amountCents}));
}
module.exports={groupDebtsFor,directDebtsFor,externalExitDebtsFor,UNPAID_DIRECT};
