'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const server=fs.readFileSync(path.join(__dirname,'../functions/index.js'),'utf8');
class Store {
  constructor(){this.docs=new Map();this.seq=0;}
  put(key,value){this.docs.set(key,value);}
  doc(key){return new Ref(this,key);}
  collection(key){return new Coll(this,key);}
  async runTransaction(f){
    const writes=[];
    const tx={get:r=>r.read(),set:(r,data)=>writes.push(['set',r.path,data]),update:(r,data)=>writes.push(['update',r.path,data]),create:(r,data)=>writes.push(['create',r.path,data]),delete:r=>writes.push(['delete',r.path])};
    const result=await f(tx);
    for(const [op,key,change] of writes){
      const old=this.docs.get(key);
      if(op==='delete')this.docs.delete(key);
      else if(op==='set'||op==='create'){
        if(op==='create'&&old)throw Error('existing doc');
        this.docs.set(key,change);
      }else{
        if(!old)throw Error('missing doc '+key);
        const next={...old};
        for(const [field,val] of Object.entries(change)){
          if(val?.op==='union')next[field]=[...new Set([...(next[field]||[]),...val.items])];
          else if(val?.op==='delete')delete next[field];
          else if(val?.op==='remove')next[field]=(next[field]||[]).filter(x=>!val.items.includes(x));
          else next[field]=val;
        }
        this.docs.set(key,next);
      }
    }
    return result;
  }
}
class Ref {
  constructor(store,key){this.store=store;this.path=key;this.id=key.split('/').at(-1);}
  collection(key){return new Coll(this.store,`${this.path}/${key}`);}
  async read(){const d=this.store.docs.get(this.path);return {exists:!!d,id:this.id,ref:this,data:()=>d};}
}
class Coll {
  constructor(store,prefix,field=null,value=null,max=Infinity){Object.assign(this,{store,prefix,field,value,max});}
  doc(id){return new Ref(this.store,`${this.prefix}/${id||'auto'+(++this.store.seq)}`);}
  where(field,op,value){assert.equal(op,'==');return new Coll(this.store,this.prefix,field,value,this.max);}
  limit(max){return new Coll(this.store,this.prefix,this.field,this.value,max);}
  async read(){
    let arr=[...this.store.docs].filter(([key])=>key.startsWith(this.prefix+'/')&&!key.slice(this.prefix.length+1).includes('/'));
    if(this.field)arr=arr.filter(([,d])=>d[this.field]===this.value);
    arr=arr.slice(0,this.max);
    return {docs:arr.map(([key,d])=>({id:key.split('/').at(-1),ref:new Ref(this.store,key),data:()=>d})),empty:arr.length===0};
  }
}
const field={serverTimestamp:()=>new Date('2026-10-15T21:00:00.000Z'),arrayUnion:(...items)=>({op:'union',items}),arrayRemove:(...items)=>({op:'remove',items}),delete:()=>({op:'delete'})};
function harness(){
  const db=new Store();let actor='alice';
  db.put('groups/holiday',{name:'Vacances',emoji:'✈️',memberIds:['alice'],createdBy:'alice',archived:false,currency:'EUR'});
  db.put('users/alice',{displayName:'Alice Dupont',avatarColor:'#aabbcc'});
  db.put('users/bob',{displayName:'Bob Martin',avatarColor:'#99ee11',shareIban:false,shareWero:false});
  db.put('users/charlie',{displayName:'Charlie L.',avatarColor:'#123abc'});
  db.put('friendships/alice_bob',{members:['alice','bob']});
  class HttpsError extends Error {constructor(code,message){super(message);this.code=code;}}
  const exported={};
  const context=vm.createContext({exports:exported,CALLABLE:{},onCall:(_,f)=>f,db,FieldValue:field,
    needAuth:()=>actor,requireId:v=>v,validId:s=>!!s,directId:(a,b)=>[a,b].sort().join('_'),
    throttle:async()=>{},normCode:v=>v,
    remainingClaim:d=>d.status==='pending'?d.amountCents:0,
    admin:{firestore:{Timestamp:{fromMillis:ms=>({toMillis:()=>ms})}}},
    HttpsError,groupByCode:async()=>db.doc('groups/holiday').read(),
  });
  const start=server.indexOf('exports.joinGroup = onCall(');
  const end=server.indexOf('/* ---------- Suppression d\'un groupe',start);
  assert.ok(start>=0&&end>start);
  vm.runInContext(server.slice(start,end),context);
  return {db,join:params=>exported.joinGroup({data:params}),setActor:value=>{actor=value;}};
}
test('parcours réel simulé : Alice invite Bob, Bob rejoint d’un clic avec son vrai profil',async()=>{
  const {db,join,setActor}=harness();
  const invited=await join({action:'inviteFriend',groupId:'holiday',friendUid:'bob'});
  assert.equal(invited.ok,true);
  const inbox=db.docs.get('users/bob/groupInvites/holiday');
  assert.equal(inbox.status,'pending');assert.equal(inbox.inviterUid,'alice');
  assert.equal(inbox.groupName,'Vacances');
  assert.equal(db.docs.get('groups/holiday/groupInvites/bob').status,'pending');
  setActor('bob');
  const joined=await join({action:'respondGroupInvite',groupId:'holiday',accept:true});
  assert.equal(joined.accepted,true);assert.equal(joined.groupId,'holiday');
  assert.deepEqual(db.docs.get('groups/holiday').memberIds,['alice','bob']);
  assert.equal(db.docs.get('users/bob/groupInvites/holiday').status,'accepted');
  const members=[...db.docs].filter(([p])=>p.startsWith('groups/holiday/members/'));
  assert.equal(members.length,1);assert.equal(members[0][1].name,'Bob Martin');assert.equal(members[0][1].uid,'bob');
});
test('un inconnu ne peut pas recevoir une invitation sous prétexte qu’on connaît son UID',async()=>{
  const {db,join}=harness();
  await assert.rejects(join({action:'inviteFriend',groupId:'holiday',friendUid:'charlie'}),/amis/);
  assert.equal(db.docs.has('users/charlie/groupInvites/holiday'),false);
});
test('une personne bloquée ne peut pas être invitée',async()=>{
  const {db,join}=harness();
  db.put('blocks/bob/users/alice',{createdAt:field.serverTimestamp()});
  await assert.rejects(join({action:'inviteFriend',groupId:'holiday',friendUid:'bob'}),/amis/);
});
test('un ami ne peut pas inviter quelqu’un dans un groupe dont il est absent',async()=>{
  const {db,join,setActor}=harness();
  setActor('bob');
  await assert.rejects(join({action:'inviteFriend',groupId:'holiday',friendUid:'alice'}),/membre d’un groupe/);
  assert.equal(db.docs.has('users/alice/groupInvites/holiday'),false);
});
test('une invitation envoyée deux fois ne crée pas de doublon',async()=>{
  const {db,join}=harness();
  assert.equal((await join({action:'inviteFriend',groupId:'holiday',friendUid:'bob'})).alreadyPending,false);
  assert.equal((await join({action:'inviteFriend',groupId:'holiday',friendUid:'bob'})).alreadyPending,true);
  assert.equal([...db.docs.keys()].filter(k=>k==='users/bob/groupInvites/holiday').length,1);
});
test('le destinataire peut refuser sans rejoindre',async()=>{
  const {db,join,setActor}=harness();
  await join({action:'inviteFriend',groupId:'holiday',friendUid:'bob'});
  setActor('bob');
  assert.equal((await join({action:'respondGroupInvite',groupId:'holiday',accept:false})).accepted,false);
  assert.equal(db.docs.get('users/bob/groupInvites/holiday').status,'declined');
  assert.deepEqual(db.docs.get('groups/holiday').memberIds,['alice']);
});
test('une invitation ne peut pas être acceptée une deuxième fois',async()=>{
  const {join,setActor}=harness();
  await join({action:'inviteFriend',groupId:'holiday',friendUid:'bob'});
  setActor('bob');
  await join({action:'respondGroupInvite',groupId:'holiday',accept:true});
  await assert.rejects(join({action:'respondGroupInvite',groupId:'holiday',accept:true}),/déjà traitée/);
});
test('on ne peut pas accepter une invitation après un blocage',async()=>{
  const {db,join,setActor}=harness();
  await join({action:'inviteFriend',groupId:'holiday',friendUid:'bob'});
  db.put('blocks/bob/users/alice',{createdAt:field.serverTimestamp()});
  setActor('bob');
  await assert.rejects(join({action:'respondGroupInvite',groupId:'holiday',accept:true}),/amis/);
  assert.equal(db.docs.get('users/bob/groupInvites/holiday').status,'pending');
});
test('une invitation en attente peut être refusée même si le groupe est supprimé',async()=>{
  const {db,join,setActor}=harness();
  await join({action:'inviteFriend',groupId:'holiday',friendUid:'bob'});
  db.docs.delete('groups/holiday');
  setActor('bob');
  assert.equal((await join({action:'respondGroupInvite',groupId:'holiday',accept:false})).accepted,false);
});
test('le lien/code associe le vrai compte et ignore un faux prénom envoyé depuis le navigateur',async()=>{
  const {db,join,setActor}=harness();
  setActor('charlie');
  const result=await join({code:'ABCDEFGH',newName:'Fausse identité',color:'#ff0000'});
  assert.equal(result.groupId,'holiday');
  const member=[...db.docs.values()].find(d=>d?.uid==='charlie');
  assert.equal(member.name,'Charlie L.');
  assert.equal(member.color,'#123abc');
});
