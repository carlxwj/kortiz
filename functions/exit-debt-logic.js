'use strict';
/** Pure financial ledger: exit claims reserve already-calculated transfers.
 * Expense and settlement documents can be Firestore snapshots or plain objects.
 * All numbers are integer cents; claims never count as payments until confirmed.
 */
const asData = item => (item && typeof item.data === 'function' ? item.data() : item);
const asDocs = entries => Array.isArray(entries) ? entries : (entries?.docs || []);
const OPEN = new Set(['pending','marked_paid','disputed']);
function remainingClaim(claim) {
  const d = asData(claim) || {};
  return OPEN.has(d.status) && Number.isSafeInteger(d.amountCents) && d.amountCents > 0 ? d.amountCents : 0;
}
function computeAvailableTransfers(expenses, settlements, exitClaims = []) {
  const balances = new Map();
  const add = (id,amount) => { if(id && Number.isSafeInteger(amount)) balances.set(id,(balances.get(id)||0)+amount); };
  for(const entry of asDocs(expenses)) {
    const e = asData(entry);
    if(!e || e.approvalStatus==='rejected')continue;
    for(const [id,n] of Object.entries(e.payers||{})) add(id,n);
    for(const [id,n] of Object.entries(e.split||{})) add(id,-n);
  }
  for(const entry of asDocs(settlements)) {
    const s=asData(entry);
    if(!s)continue;
    add(s.fromId,s.amountCents);add(s.toId,-s.amountCents);
  }
  // A pending claim reserves the debtor's negative balance and the creditor's
  // positive balance, preventing it from being declared twice inside the group.
  for(const entry of asDocs(exitClaims)) {
    const c=asData(entry), amount=remainingClaim(c);
    if(!amount || !c.fromId || !c.toId)continue;
    add(c.fromId,amount);add(c.toId,-amount);
  }
  const creditors=[...balances].filter(([,v])=>v>0).map(([id,amount])=>({id,amount}));
  const debtors=[...balances].filter(([,v])=>v<0).map(([id,amount])=>({id,amount:-amount}));
  const sort=(a,b)=>b.amount-a.amount||a.id.localeCompare(b.id);
  const transfers=[];
  while(creditors.length && debtors.length) {
    creditors.sort(sort);debtors.sort(sort);
    const c=creditors[0],d=debtors[0],amount=Math.min(c.amount,d.amount);
    transfers.push({fromId:d.id,toId:c.id,amount});
    c.amount-=amount;d.amount-=amount;
    if(!c.amount)creditors.shift();if(!d.amount)debtors.shift();
  }
  return transfers;
}
module.exports={computeAvailableTransfers,remainingClaim};
