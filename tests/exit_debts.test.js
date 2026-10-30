'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const root=path.join(__dirname,'..');
const server=fs.readFileSync(path.join(root,'functions','index.js'),'utf8');
const frontend=fs.readFileSync(path.join(root,'public','app.js'),'utf8');
const rules=fs.readFileSync(path.join(root,'firestore.rules'),'utf8');
const {computeAvailableTransfers,remainingClaim}=require('../functions/exit-debt-logic');
const docs=rows=>({docs:rows.map(data=>({data:()=>data}))});

test('une dette est réservée lors du départ et ne peut plus apparaître comme une nouvelle dette interne',()=>{
  const ex=docs([{payers:{carlos:5000},split:{brenda:5000},approvalStatus:'approved'}]);
  assert.deepEqual(computeAvailableTransfers(ex,docs([])),[{fromId:'brenda',toId:'carlos',amount:5000}]);
  const debt={fromId:'brenda',toId:'carlos',amountCents:5000,status:'pending'};
  assert.deepEqual(computeAvailableTransfers(ex,docs([]),docs([debt])),[]);
  assert.deepEqual(computeAvailableTransfers(ex,docs([]),docs([{...debt,status:'marked_paid'}])),[]);
  assert.deepEqual(computeAvailableTransfers(ex,docs([]),docs([{...debt,status:'disputed'}])),[]);
  const confirmed=docs([{fromId:'brenda',toId:'carlos',amountCents:5000,exitDebtId:'d'}]);
  assert.deepEqual(computeAvailableTransfers(ex,confirmed,docs([{...debt,status:'confirmed'}])),[]);
});

test('les nouveaux achats du groupe ne modifient pas une ancienne dette réservée',()=>{
  const ex=docs([
    {payers:{alice:10000},split:{bob:5000,charlie:5000},approvalStatus:'approved'},
    {payers:{charlie:2000},split:{alice:2000},approvalStatus:'approved'},
  ]);
  assert.deepEqual(computeAvailableTransfers(ex,docs([]),docs([{fromId:'bob',toId:'alice',amountCents:5000,status:'pending'}])),
    [{fromId:'charlie',toId:'alice',amount:3000}]);
  assert.equal(remainingClaim({status:'cancelled',amountCents:5000}),0);
  assert.equal(remainingClaim({status:'confirmed',amountCents:5000}),0);
  assert.equal(remainingClaim({status:'pending',amountCents:5000}),5000);
});

test('les accès aux dettes sont privés et un départ direct du navigateur est interdit',()=>{
  assert.match(rules,/match \/users\/\{uid\}\/exitDebts\/\{debtId\}[\s\S]*?allow read: if signedIn\(\) && request\.auth\.uid == uid;/);
  assert.match(rules,/match \/groups\/\{gid\}\/exitDebts\/\{debtId\}[\s\S]*?allow create, update, delete: if false;/);
  assert.match(rules,/request\.resource\.data\.memberIds == resource\.data\.memberIds/);
  assert.match(rules,/request\.resource\.data\.uid == resource\.data\.uid/);
  assert.match(frontend,/action:'leaveGroup',groupId:gid/);
  assert.doesNotMatch(frontend,/batch\.update\(doc\(db, "groups", gid\), \{ memberIds: arrayRemove\(myUid\(\)\)/);
  assert.match(server,/openClaims\.docs\.some\(d=>remainingClaim\(d\)>0\)/);
  assert.match(server,/adminMember=member&&isAdmin/);
  assert.match(server,/tx\.create\(settlement/);
  assert.match(server,/tx\.update\(mine\.ref,\{leftAt:now,iban:'',weroContact:''/);
});

class MemoryFirestore {
  constructor(){this.data=new Map();this.seq=0;}
  put(path,data){this.data.set(path,structuredClone(data));}
  collection(name){return new Coll(this,name);}
  async runTransaction(callback){
    const writes=[];
    const tx={
      get:async ref=>ref instanceof Coll?ref.read():ref.read(),
      create:(ref,data)=>writes.push({op:'create',ref,data}),
      set:(ref,data)=>writes.push({op:'set',ref,data}),
      update:(ref,data)=>writes.push({op:'update',ref,data}),
      delete:ref=>writes.push({op:'delete',ref}),
    };
    const value=await callback(tx);
    for(const w of writes){
      const prior=this.data.get(w.ref.path);
      if(w.op==='create'&&prior)throw Error('already exists');
      if(w.op==='update'&&!prior)throw Error('missing doc '+w.ref.path);
      if(w.op==='delete')this.data.delete(w.ref.path);
      else if(w.op==='create'||w.op==='set')this.put(w.ref.path,w.data);
      else this.put(w.ref.path,applyChanges(prior,w.data));
    }
    return value;
  }
}
class Coll {
  constructor(store,prefix,field=null,value=null,limit=Infinity){Object.assign(this,{store,prefix,field,value,max:limit});}
  doc(id){return new Ref(this.store,`${this.prefix}/${id||`auto${++this.store.seq}`}`);}
  where(field,op,value){assert.equal(op,'==');return new Coll(this.store,this.prefix,field,value,this.max);}
  limit(max){return new Coll(this.store,this.prefix,this.field,this.value,max);}
  async get(){return this.read();}
  read(){
    const prefix=this.prefix+'/';
    let found=[...this.store.data].filter(([k])=>k.startsWith(prefix)&&!k.slice(prefix.length).includes('/'));
    if(this.field)found=found.filter(([,v])=>v[this.field]===this.value);
    return {docs:found.slice(0,this.max).map(([k,v])=>({id:k.split('/').at(-1),ref:new Ref(this.store,k),data:()=>structuredClone(v)})),empty:found.length===0};
  }
}
class Ref {
  constructor(store,path){Object.assign(this,{store,path,id:path.split('/').at(-1)});}
  collection(name){return new Coll(this.store,`${this.path}/${name}`);}
  async get(){return this.read();}
  read(){const data=this.store.data.get(this.path);return {id:this.id,ref:this,exists:data!==undefined,data:()=>structuredClone(data)};}
}
const FieldValue={
  serverTimestamp:()=>new Date('2026-10-15T00:00:00Z'),
  arrayRemove:(...args)=>({__op:'arrayRemove',items:args}),
  arrayUnion:(...args)=>({__op:'arrayUnion',items:args}),
  delete:()=>({__op:'delete'}),
};
function applyChanges(base,changes){
  const next={...base};
  for(const [k,v] of Object.entries(changes)){
    if(v?.__op==='delete')delete next[k];
    else if(v?.__op==='arrayRemove')next[k]=(next[k]||[]).filter(x=>!v.items.includes(x));
    else if(v?.__op==='arrayUnion')next[k]=[...new Set([...(next[k]||[]),...v.items])];
    else next[k]=v;
  }
  return next;
}
function makeHarness(){
  const db=new MemoryFirestore();
  db.put('groups/g1',{name:'Voyage à Paris',currency:'EUR',memberIds:['carlosUid','brendaUid'],createdBy:'carlosUid',adminIds:[],archived:false});
  db.put('groups/g1/members/carlos',{uid:'carlosUid',name:'Carlos',color:'#00aa44',iban:'FR00',weroContact:'carlos@example.com'});
  db.put('groups/g1/members/brenda',{uid:'brendaUid',name:'Brenda',color:'#00aa55',iban:'BE00',weroContact:'brenda@example.com'});
  db.put('groups/g1/expenses/e1',{payers:{carlos:5000},split:{brenda:5000},approvalStatus:'approved'});
  let actor='brendaUid';
  class HttpsError extends Error {constructor(code,message){super(message);this.code=code;}}
  const exportsObj={};
  const context=vm.createContext({
    exports:exportsObj,CALLABLE:{},HEAVY_RUNTIME:{},onCall:(_,fn)=>fn,needAuth:()=>actor,
    requireId:id=>id,normCode:s=>s,groupByCode:async()=>db.collection('groups').doc('g1').read(),db,FieldValue,HttpsError,
    throttle:async()=>{}, // vérification de débit exclue du simulateur comptable
    serverTransfers:(ex,sett,exits)=>computeAvailableTransfers(ex,sett,exits),
    remainingClaim,isAdmin:(group,uid)=>group.createdBy===uid||(group.adminIds||[]).includes(uid),
  });
  const join=server.slice(server.indexOf('exports.joinGroup = onCall('),server.indexOf('/* ---------- Suppression d\'un groupe',server.indexOf('exports.joinGroup = onCall(')));
  const respond=server.slice(server.indexOf('exports.respondGroupSettlement = onCall('),server.indexOf('exports.cancelConfirmedSettlement = onCall('));
  const deletion=server.slice(server.indexOf('exports.deleteGroup = onCall('),server.indexOf('/* ---------- RGPD',server.indexOf('exports.deleteGroup = onCall(')));
  vm.runInContext(join+'\n'+respond+'\n'+deletion,context);
  return {db,func:exportsObj,setActor:v=>{actor=v;}};
}

test('parcours simulé: quitter, consulter deux miroirs, déclarer payé puis confirmer sans double règlement',async()=>{
  const {db,func,setActor}=makeHarness();
  const left=await func.joinGroup({data:{action:'leaveGroup',groupId:'g1'}});
  assert.equal(left.ok,true);assert.equal(left.claimsCreated,1);assert.equal(left.amountTotalCents,5000);
  assert.deepEqual(db.data.get('groups/g1').memberIds,['carlosUid']);
  assert.equal(db.data.get('groups/g1/members/brenda').iban,'');
  assert.equal(db.data.get('groups/g1/members/brenda').weroContact,'');
  assert.ok(db.data.get('groups/g1/members/brenda').leftAt);
  const debtPath=[...db.data.keys()].find(k=>/^groups\/g1\/exitDebts\//.test(k));
  const id=debtPath.split('/').at(-1);
  assert.equal(db.data.get(debtPath).amountCents,5000);
  assert.deepEqual(db.data.get(debtPath).participants,['brendaUid','carlosUid']);
  assert.equal(db.data.get(`users/brendaUid/exitDebts/g1_${id}`).status,'pending');
  assert.equal(db.data.get(`users/carlosUid/exitDebts/g1_${id}`).status,'pending');
  assert.ok(db.data.get('users/brendaUid/formerGroups/g1'));
  const again=await func.joinGroup({data:{action:'leaveGroup',groupId:'g1'}});
  assert.equal(again.alreadyLeft,true);assert.equal([...db.data.keys()].filter(k=>k.startsWith('groups/g1/exitDebts/')).length,1);
  await assert.rejects(func.respondGroupSettlement({data:{scope:'exitDebt',groupId:'g1',requestId:id,action:'confirm'}}),/Action interdite/);
  await func.respondGroupSettlement({data:{scope:'exitDebt',groupId:'g1',requestId:id,action:'mark_paid'}});
  assert.equal(db.data.get(debtPath).status,'marked_paid');
  setActor('carlosUid');
  await func.respondGroupSettlement({data:{scope:'exitDebt',groupId:'g1',requestId:id,action:'confirm'}});
  assert.equal(db.data.get(debtPath).status,'confirmed');
  assert.equal(db.data.get(`users/brendaUid/exitDebts/g1_${id}`).status,'confirmed');
  assert.equal(db.data.get(`users/carlosUid/exitDebts/g1_${id}`).status,'confirmed');
  assert.equal(db.data.get(`groups/g1/settlements/exit_${id}`).amountCents,5000);
  assert.deepEqual(computeAvailableTransfers(
    docs([db.data.get('groups/g1/expenses/e1')]),
    docs([db.data.get(`groups/g1/settlements/exit_${id}`)]),
    docs([db.data.get(debtPath)])),[]);
  await assert.rejects(func.respondGroupSettlement({data:{scope:'exitDebt',groupId:'g1',requestId:id,action:'confirm'}}),/Action interdite/);
  assert.equal([...db.data.keys()].filter(k=>k.startsWith('groups/g1/settlements/')).length,1);
});

test('parcours simulé: le créateur peut quitter si un autre membre reprend le groupe',async()=>{
  const {db,func,setActor}=makeHarness();
  setActor('carlosUid');
  const result=await func.joinGroup({data:{action:'leaveGroup',groupId:'g1'}});
  assert.equal(result.claimsCreated,1);
  assert.equal(db.data.get('groups/g1').createdBy,'brendaUid');
  assert.deepEqual(db.data.get('groups/g1').memberIds,['brendaUid']);
  const debt=[...db.data].find(([key])=>key.startsWith('groups/g1/exitDebts/'))[1];
  assert.equal(debt.toUid,'carlosUid');
  assert.equal(debt.fromUid,'brendaUid');
  assert.equal(debt.amountCents,5000);
});


test('un groupe ne peut pas être supprimé si une dette extérieure reste ouverte',async()=>{
  const {func,setActor}=makeHarness();
  await func.joinGroup({data:{action:'leaveGroup',groupId:'g1'}});
  setActor('carlosUid');
  await assert.rejects(func.deleteGroup({data:{groupId:'g1'}}),/remboursements après départ restent ouverts/);
});

test('un ancien membre ne peut pas revenir avec une dette ouverte, puis récupère son identité après confirmation',async()=>{
  const {db,func,setActor}=makeHarness();
  await func.joinGroup({data:{action:'leaveGroup',groupId:'g1'}});
  await assert.rejects(func.joinGroup({data:{code:'ABCDEFGH',newName:'Brenda'}}),/remboursements hors groupe sont encore ouverts/);
  const id=[...db.data.keys()].find(k=>k.startsWith('groups/g1/exitDebts/')).split('/').at(-1);
  await func.respondGroupSettlement({data:{scope:'exitDebt',groupId:'g1',requestId:id,action:'mark_paid'}});
  setActor('carlosUid');
  await func.respondGroupSettlement({data:{scope:'exitDebt',groupId:'g1',requestId:id,action:'confirm'}});
  setActor('brendaUid');
  const rejoined=await func.joinGroup({data:{code:'ABCDEFGH',newName:'Brenda'}});
  assert.equal(rejoined.rejoined,true);
  assert.deepEqual(db.data.get('groups/g1').memberIds,['carlosUid','brendaUid']);
  assert.equal(db.data.get('groups/g1/members/brenda').leftAt,undefined);
  assert.equal(db.data.get('users/brendaUid/formerGroups/g1'),undefined);
  assert.equal([...db.data.keys()].filter(k=>k.startsWith('groups/g1/members/')).length,2);
});

test('dépenses remboursables protégées en présence de dettes de sortie ouvertes',()=>{
  assert.match(server,/function touchesReservedDebt\(expense, claims\)/);
  assert.match(server,/touchesReservedDebt\(prev,external\.docs\)/);
  assert.match(server,/touchesReservedDebt\(old\.data\(\),external\.docs\)/);
  assert.match(server,/const claims=await ref\.collection\('exitDebts'\)\.get\(\)/);
  assert.match(server,/tx\.update\(expenseRef, \{ recurringNext: null \}\)/);
});


test('un membre à jour peut partir sans générer une dette fictive',async()=>{
  const {db,func}=makeHarness();
  db.put('groups/g1/expenses/e1',{payers:{brenda:5000},split:{brenda:5000},approvalStatus:'approved'});
  const result=await func.joinGroup({data:{action:'leaveGroup',groupId:'g1'}});
  assert.equal(result.claimsCreated,0);
  assert.equal(result.amountTotalCents,0);
  assert.equal([...db.data.keys()].filter(k=>k.startsWith('groups/g1/exitDebts/')).length,0);
  assert.ok(db.data.get('users/brendaUid/formerGroups/g1'));
});

test('une contestation arrête la validation jusqu’à réouverture par un administrateur',async()=>{
  const {db,func,setActor}=makeHarness();
  await func.joinGroup({data:{action:'leaveGroup',groupId:'g1'}});
  const id=[...db.data.keys()].find(k=>k.startsWith('groups/g1/exitDebts/')).split('/').at(-1);
  const act=action=>func.respondGroupSettlement({data:{scope:'exitDebt',groupId:'g1',requestId:id,action}});
  await act('dispute');
  assert.equal(db.data.get(`groups/g1/exitDebts/${id}`).status,'disputed');
  setActor('carlosUid');
  await assert.rejects(act('confirm'),/Action interdite/);
  await act('resume');
  assert.equal(db.data.get(`groups/g1/exitDebts/${id}`).status,'pending');
  assert.equal([...db.data.keys()].filter(k=>k.startsWith('groups/g1/settlements/')).length,0);
});

test('le dernier utilisateur connecté ne peut pas quitter sans succession administrative',async()=>{
  const {db,func}=makeHarness();
  db.put('groups/g1',{...db.data.get('groups/g1'),memberIds:['brendaUid'],createdBy:'brendaUid'});
  await assert.rejects(func.joinGroup({data:{action:'leaveGroup',groupId:'g1'}}),/dernier membre/);
  assert.deepEqual(db.data.get('groups/g1').memberIds,['brendaUid']);
});

test('le créancier sorti du groupe confirme une dette due par une administratrice, sans auto-validation par celle-ci',async()=>{
  const {db,func,setActor}=makeHarness();
  const g=db.data.get('groups/g1');
  db.put('groups/g1',{...g,createdBy:'brendaUid'});
  setActor('carlosUid');
  const leaving=await func.joinGroup({data:{action:'leaveGroup',groupId:'g1'}});
  assert.equal(leaving.claimsCreated,1);
  const path=[...db.data.keys()].find(x=>x.startsWith('groups/g1/exitDebts/'));
  const id=path.split('/').at(-1);
  const claim=db.data.get(path);
  assert.equal(claim.fromUid,'brendaUid');
  assert.equal(claim.toUid,'carlosUid');
  setActor('brendaUid');
  const invoke=action=>func.respondGroupSettlement({data:{scope:'exitDebt',groupId:'g1',requestId:id,action}});
  await invoke('mark_paid');
  await assert.rejects(invoke('confirm'),e=>e.code==='permission-denied');
  assert.equal(db.data.get(path).status,'marked_paid');
  setActor('carlosUid');
  await invoke('confirm');
  assert.equal(db.data.get(path).status,'confirmed');
  assert.equal(db.data.get(`groups/g1/settlements/exit_${id}`).amountCents,5000);
  assert.equal(db.data.get(`users/brendaUid/exitDebts/g1_${id}`).status,'confirmed');
  assert.equal(db.data.get(`users/carlosUid/exitDebts/g1_${id}`).status,'confirmed');
});
