/* ============================================================================
   Kortiz — Cloud Functions (2e génération, Node.js)
   - getInvite / joinGroup : rejoindre un groupe par code (le client n'est pas encore membre)
   - deleteGroup           : suppression complète d'un groupe (documents + photos)
   - deleteAccount         : RGPD — supprime le profil, détache l'utilisateur de ses groupes
   - onExpenseCreated / onSettlementCreated : notifications push aux autres membres
   - recurringExpenses     : tâche quotidienne qui recrée les dépenses récurrentes
   ============================================================================ */
const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { onDocumentCreated, onDocumentWritten } = require('firebase-functions/v2/firestore');
const { onSchedule } = require('firebase-functions/v2/scheduler');
const { setGlobalOptions } = require('firebase-functions/v2');
const admin = require('firebase-admin');

admin.initializeApp();
const db = admin.firestore();
const { FieldValue } = admin.firestore;
const {computeAvailableTransfers, remainingClaim} = require('./exit-debt-logic');
const {groupDebtsFor,directDebtsFor,externalExitDebtsFor} = require('./account-deletion-guard');
// Profil léger pour l'essai Google Cloud : chaque fonction a au maximum une
// instance, aucune instance chaude, 256 Mio de RAM et le CPU 1re génération
// (1/6 vCPU à 256 Mio). Cela réduit fortement le quota CPU régional pendant
// les déploiements. Contrepartie : démarrages à froid et traitements en file.
// Ces paramètres sont la source de vérité au prochain déploiement Firebase.
const LIGHT_RUNTIME = Object.freeze({
  region: 'europe-west1',
  memory: '256MiB',
  cpu: 'gcf_gen1',
  concurrency: 1,
  minInstances: 0,
  maxInstances: 1,
});
setGlobalOptions(LIGHT_RUNTIME);

// Certaines opérations traitent beaucoup de documents : RAM 512 Mio et
// CPU 1re génération (1/3 vCPU), toujours 1 instance max.
const HEAVY_RUNTIME = Object.freeze({ memory: '512MiB', cpu: 'gcf_gen1', maxInstances: 1, concurrency: 1 });

// App Check côté fonctions : ne PAS contourner cette vérification pour alléger le CPU.
const CALLABLE = { enforceAppCheck: process.env.ENFORCE_APP_CHECK === 'true' };
const SUPPORTED_LANGS = new Set(['fr', 'en', 'pt', 'es']);
const langOf = (u) => SUPPORTED_LANGS.has(u?.language) ? u.language : 'fr';
const trans = (lang, fr, en, pt, es) => ({ fr, en, pt, es })[lang] || en;

/* ---------- Utilitaires ---------- */
const normCode = (s) => String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
const needAuth = (req) => {
  if (!req.auth) throw new HttpsError('unauthenticated', 'Connecte-toi pour continuer.');
  return req.auth.uid;
};
const money = (cents, cur = 'EUR', lang = 'fr') => {
  try { return new Intl.NumberFormat(({ fr: 'fr-FR', en: 'en-US', pt: 'pt-BR', es: 'es-ES' })[lang] || 'en-US', { style: 'currency', currency: cur }).format(cents / 100); }
  catch (e) { return (cents / 100).toFixed(2) + ' ' + cur; }
};
const z2 = (n) => String(n).padStart(2, '0');
const daysInMonth = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate();
/** Date suivante d'une dépense récurrente (même logique que le client). */
function addPeriod(iso, freq, dom) {
  const [y, m, d] = iso.split('-').map(Number);
  if (freq === 'weekly') return new Date(Date.UTC(y, m - 1, d + 7)).toISOString().slice(0, 10);
  if (freq === 'yearly') return `${y + 1}-${z2(m)}-${z2(Math.min(dom || d, daysInMonth(y + 1, m)))}`;
  let ny = y, nm = m + 1;
  if (nm > 12) { nm = 1; ny++; }
  return `${ny}-${z2(nm)}-${z2(Math.min(dom || d, daysInMonth(ny, nm)))}`;
}
async function groupByCode(code) {
  if (code.length !== 8) throw new HttpsError('invalid-argument', 'Le code d\'invitation comporte 8 caractères.');
  const snap = await db.collection('groups').where('inviteCode', '==', code).limit(1).get();
  if (snap.empty) throw new HttpsError('not-found', 'Invitation introuvable. Vérifie le code ou demande un nouveau lien.');
  return snap.docs[0];
}

/* ---------- Invitations ---------- */
exports.getInvite = onCall(CALLABLE, async (req) => {
  const uid = needAuth(req);
  // Limiter les tentatives automatisées d'énumération des codes d'invitation.
  await throttle(uid,'inviteLookup',1500);
  const gdoc = await groupByCode(normCode(req.data && req.data.code));
  const g = gdoc.data();
  const ms = await gdoc.ref.collection('members').orderBy('createdAt').get();
  const members = ms.docs.map((d) => ({ id: d.id, name: d.data().name, color: d.data().color, taken: !!d.data().uid }));
  const owner = ms.docs.find((d) => d.data().uid === g.createdBy);
  return {
    groupId: gdoc.id, name: g.name, emoji: g.emoji, archived: !!g.archived,
    ownerName: owner ? owner.data().name : null, members, alreadyMember: g.memberIds.includes(uid),
  };
});

exports.joinGroup = onCall(CALLABLE, async (req) => {
  const uid = needAuth(req);
  // Invitation ciblée d'un ami connecté : création exclusivement côté serveur.
  // Le code et le lien traditionnels continuent de fonctionner indépendamment.
  if (req.data?.action === 'inviteFriend') {
    const gid=requireId(req.data?.groupId),other=requireId(req.data?.friendUid);
    if(other===uid)throw new HttpsError('invalid-argument','Tu ne peux pas t’inviter toi-même.');
    await throttle(uid,'groupInvitation',3000);
    const gref=db.collection('groups').doc(gid);
    const friendship=db.collection('friendships').doc(directId(uid,other));
    const groupRef=gref.collection('groupInvites').doc(other);
    const userRef=db.collection('users').doc(other).collection('groupInvites').doc(gid);
    const result=await db.runTransaction(async tx=>{
      const [g,friend,blockedByMe,blockedByThem,previous,targetProfile]=await Promise.all([
        tx.get(gref),tx.get(friendship),tx.get(db.doc(`blocks/${uid}/users/${other}`)),
        tx.get(db.doc(`blocks/${other}/users/${uid}`)),tx.get(userRef),tx.get(db.collection('users').doc(other)),
      ]);
      if(!g.exists||!g.data().memberIds.includes(uid)||g.data().archived)
        throw new HttpsError('permission-denied','Tu dois être membre d’un groupe actif pour inviter un ami.');
      if(!friend.exists||!friend.data().members?.includes(uid)||!friend.data().members?.includes(other)||blockedByMe.exists||blockedByThem.exists)
        throw new HttpsError('permission-denied','Vous devez être amis et ne pas vous être bloqués.');
      if(!targetProfile.exists)throw new HttpsError('not-found','Le compte invité n’est plus disponible.');
      if(g.data().memberIds.includes(other))throw new HttpsError('already-exists','Cet ami fait déjà partie du groupe.');
      if(previous.exists&&previous.data().status==='pending'&&previous.data().expiresAt?.toMillis?.()>Date.now())
        return {ok:true,alreadyPending:true};
      const now=FieldValue.serverTimestamp();
      const invite={groupId:gid,groupName:String(g.data().name||'Groupe').slice(0,60),
        groupEmoji:String(g.data().emoji||'🏠').slice(0,12),inviterUid:uid,status:'pending',
        createdAt:now,expiresAt:admin.firestore.Timestamp.fromMillis(Date.now()+14*24*60*60*1000)};
      tx.set(userRef,invite);
      tx.set(groupRef,{targetUid:other,inviterUid:uid,status:'pending',createdAt:now,expiresAt:invite.expiresAt});
      return {ok:true,alreadyPending:false};
    });
    if(!result.alreadyPending&&typeof pushRecipient==='function')await pushRecipient(other,'groupInvites',{title:'Kortiz',body:'Invitation à rejoindre un groupe',url:'/#/',tag:`invite-${gid}`},gid);
    return result;
  }
  if (req.data?.action === 'respondGroupInvite') {
    const gid=requireId(req.data?.groupId),accept=req.data?.accept===true;
    const gref=db.collection('groups').doc(gid);
    const ref=db.collection('users').doc(uid).collection('groupInvites').doc(gid);
    const canonical=gref.collection('groupInvites').doc(uid);
    return db.runTransaction(async tx=>{
      const [invite,g,original]=await Promise.all([tx.get(ref),tx.get(gref),tx.get(canonical)]);
      if(!invite.exists||invite.data().status!=='pending'||!original.exists||original.data().status!=='pending')
        throw new HttpsError('failed-precondition','Invitation déjà traitée ou indisponible.');
      if(!g.exists||!accept){
        tx.update(ref,{status:'declined',answeredAt:FieldValue.serverTimestamp()});
        tx.update(canonical,{status:'declined',answeredAt:FieldValue.serverTimestamp()});
        return {ok:true,accepted:false};
      }
      if(g.data().archived)throw new HttpsError('failed-precondition','Ce groupe est archivé.');
      if(invite.data().expiresAt?.toMillis?.()<Date.now())
        throw new HttpsError('failed-precondition','Invitation expirée. Demande une nouvelle invitation.');
      const inviter=invite.data().inviterUid;
      if(!validId(inviter)||!g.data().memberIds.includes(inviter))
        throw new HttpsError('permission-denied','La personne qui t’a invité ne fait plus partie du groupe.');
      const [friends,blockedA,blockedB,profile,former]=await Promise.all([
        tx.get(db.collection('friendships').doc(directId(inviter,uid))),
        tx.get(db.doc(`blocks/${uid}/users/${inviter}`)),tx.get(db.doc(`blocks/${inviter}/users/${uid}`)),
        tx.get(db.collection('users').doc(uid)),tx.get(gref.collection('members').where('uid','==',uid).limit(1)),
      ]);
      if(!friends.exists||blockedA.exists||blockedB.exists)
        throw new HttpsError('permission-denied','Vous devez toujours être amis pour rejoindre avec cette invitation.');
      if(!profile.exists||!String(profile.data().displayName||'').trim())
        throw new HttpsError('failed-precondition','Termine d’abord ton profil Kortiz.');
      const now=FieldValue.serverTimestamp();
      if(g.data().memberIds.includes(uid)){
        tx.update(ref,{status:'accepted',answeredAt:now});
        tx.update(canonical,{status:'accepted',answeredAt:now});
        return {ok:true,accepted:true,alreadyMember:true,groupId:gid};
      }
      if(g.data().memberIds.length>=50)throw new HttpsError('failed-precondition','Groupe complet (50 membres maximum).');
      const old=former.docs[0]||null;
      if(old&&!old.data().leftAt)
        throw new HttpsError('failed-precondition','Une ancienne fiche de membre doit être vérifiée avant de rejoindre.');
      if(old){
        const debts=await tx.get(gref.collection('exitDebts'));
        if(debts.docs.some(d=>d.data().participants?.includes(uid)&&remainingClaim(d)>0))
          throw new HttpsError('failed-precondition','Termine d’abord tes remboursements hors groupe.');
      }
      const pref=profile.data();
      const details={iban:pref.shareIban===true?String(pref.iban||''):'',
        weroContact:pref.shareWero===true?String(pref.weroContact||''):'',updatedAt:now};
      const name=String(pref.displayName).trim().slice(0,40);
      if(old){
        tx.update(old.ref,{leftAt:FieldValue.delete(),...details});
        tx.delete(db.collection('users').doc(uid).collection('formerGroups').doc(gid));
      }else{
        tx.create(gref.collection('members').doc(),{name,color:/^#[0-9a-fA-F]{6}$/.test(pref.avatarColor||'')?pref.avatarColor:'#6366f1',uid,
          ...details,createdAt:now});
      }
      tx.update(gref,{memberIds:FieldValue.arrayUnion(uid),updatedAt:now});
      tx.update(ref,{status:'accepted',answeredAt:now});
      tx.update(canonical,{status:'accepted',answeredAt:now});
      tx.set(gref.collection('activity').doc(),{type:'member_add',text:`${name} a rejoint le groupe`,meta:{},
        actorUid:uid,actorName:name,source:'server',createdAt:now});
      return {ok:true,accepted:true,groupId:gid};
    });
  }
  // Quitter un groupe est maintenant une opération financière atomique du serveur.
  // Le navigateur ne peut plus effacer son appartenance avant la création de ses dettes externes.
  if (req.data?.action === 'leaveGroup') {
    const gid = requireId(req.data?.groupId), gref=db.collection('groups').doc(gid);
    return db.runTransaction(async tx => {
      const [group,formerRecord,members,expenses,settlements,claims,payments,requests]=await Promise.all([
        tx.get(gref),tx.get(db.collection('users').doc(uid).collection('formerGroups').doc(gid)),
        tx.get(gref.collection('members')),tx.get(gref.collection('expenses')),
        tx.get(gref.collection('settlements')),tx.get(gref.collection('exitDebts')),
        tx.get(gref.collection('paymentRequests')),tx.get(gref.collection('moneyRequests')),
      ]);
      if(!group.exists || !group.data().memberIds.includes(uid)) {
        if(formerRecord.exists) return {ok:true,alreadyLeft:true,claimsCreated:0}; // retry sans doublon
        throw new HttpsError('permission-denied','Tu ne fais pas partie de ce groupe.');
      }
      const g=group.data(), others=g.memberIds.filter(id=>id!==uid);
      if(!others.length)throw new HttpsError('failed-precondition','Le dernier membre doit supprimer le groupe ou inviter un administrateur avant de partir.');
      const mine=members.docs.find(m=>m.data().uid===uid && !m.data().leftAt);
      if(!mine)throw new HttpsError('failed-precondition','Ta fiche de membre actif est introuvable.');
      const transfers=serverTransfers(expenses,settlements,claims).filter(t=>t.fromId===mine.id||t.toId===mine.id);
      const byId=new Map(members.docs.map(m=>[m.id,m.data()]));
      const openRequests=[...payments.docs.map(d=>({...d,kind:'payment'})),...requests.docs.map(d=>({...d,kind:'money'}))]
        .filter(d=>['pending','marked_paid'].includes(d.data().status) &&
          ['fromUid','toUid','creditorUid','debtorUid'].some(key=>d.data()[key]===uid));
      if(openRequests.length>250)throw new HttpsError('resource-exhausted','Trop de demandes en cours. Contacte le support avant de quitter ce groupe.');
      const now=FieldValue.serverTimestamp(), successors=(g.adminIds||[]).filter(id=>others.includes(id));
      const newOwner=successors[0]||others[0];
      tx.update(gref,{
        memberIds:FieldValue.arrayRemove(uid),adminIds:FieldValue.arrayRemove(uid),
        ...(g.createdBy===uid?{createdBy:newOwner}:{}),updatedAt:now,
      });
      // Conserver le membre et son UID (sans IBAN/Wero) préserve les anciennes
      // dépenses et l'accès du débiteur à SON suivi, mais pas au groupe lui-même.
      tx.update(mine.ref,{leftAt:now,iban:'',weroContact:'',updatedAt:now});
      tx.set(db.collection('users').doc(uid).collection('formerGroups').doc(gid),{
        groupId:gid,groupName:String(g.name||'Groupe').slice(0,60),memberId:mine.id,leftAt:now,
      });
      for(const d of openRequests)tx.update(d.ref,{status:'cancelled',updatedAt:now,closedReason:'member_left'});
      const created=[];
      for(const transfer of transfers) {
        const from=byId.get(transfer.fromId),to=byId.get(transfer.toId);
        if(!from || !to || !Number.isSafeInteger(transfer.amount) || transfer.amount<=0)
          throw new HttpsError('failed-precondition','Répartition impossible : vérifie les participants du groupe.');
        const id=gref.collection('exitDebts').doc().id;
        const fromUid=from.uid||null,toUid=to.uid||null;
        const debt={groupId:gid,groupName:String(g.name||'Groupe').slice(0,60),currency:g.currency,
          fromId:transfer.fromId,toId:transfer.toId,fromUid,toUid,
          fromName:String(from.name||'Membre').slice(0,60),toName:String(to.name||'Membre').slice(0,60),
          amountCents:transfer.amount,status:'pending',participants:[...new Set([fromUid,toUid].filter(Boolean))],
          leftUid:uid,createdAt:now,updatedAt:now};
        tx.create(gref.collection('exitDebts').doc(id),debt);
        for(const partyUid of debt.participants)
          tx.set(db.collection('users').doc(partyUid).collection('exitDebts').doc(`${gid}_${id}`),{...debt,debtId:id});
        created.push({id,amountCents:transfer.amount});
      }
      tx.set(gref.collection('activity').doc(),{type:'member_remove',text:`${String(mine.data().name||'Un membre').slice(0,40)} a quitté le groupe`,meta:{exitDebts:created.length},actorUid:uid,actorName:String(mine.data().name||'Membre').slice(0,60),source:'server',createdAt:now});
      return {ok:true,claimsCreated:created.length,amountTotalCents:transfers.filter(t=>t.fromId===mine.id).reduce((a,t)=>a+t.amount,0)};
    });
  }
  // On réutilise la fonction existante pour l'approbation : aucun nouveau
  // point d'entrée, ni instance Cloud Run supplémentaire.
  if (req.data?.action === 'reviewClaim') {
    const gid=String(req.data?.groupId || ''), targetUid=String(req.data?.claimantUid || '');
    if(!/^[A-Za-z0-9_-]{1,128}$/.test(gid) || !/^[A-Za-z0-9_-]{1,128}$/.test(targetUid))
      throw new HttpsError('invalid-argument','Demande invalide.');
    const gref=db.collection('groups').doc(gid), ref=gref.collection('memberClaims').doc(targetUid);
    return db.runTransaction(async tx=>{
      const [group,claim]=await Promise.all([tx.get(gref),tx.get(ref)]);
      if(!group.exists || !group.data().memberIds.includes(uid) ||
         (group.data().createdBy!==uid && !(group.data().adminIds||[]).includes(uid)))
        throw new HttpsError('permission-denied','Validation réservée aux administrateurs.');
      if(!claim.exists || claim.data().status!=='pending')throw new HttpsError('failed-precondition','Demande déjà traitée.');
      if(req.data.approve!==true){tx.update(ref,{status:'rejected',reviewedBy:uid,reviewedAt:FieldValue.serverTimestamp()});return {ok:true,approved:false};}
      const mid=claim.data().memberId, mref=gref.collection('members').doc(mid), member=await tx.get(mref);
      if(!member.exists || member.data().uid)throw new HttpsError('failed-precondition','Participant déjà lié ou supprimé.');
      if(group.data().memberIds.length>=50)throw new HttpsError('failed-precondition','Groupe complet.');
      const targetProfile=await tx.get(db.collection('users').doc(targetUid));
      const prefs=targetProfile.exists?targetProfile.data():{};
      tx.update(mref,{uid:targetUid,iban:prefs.shareIban===true?String(prefs.iban||''):'',weroContact:prefs.shareWero===true?String(prefs.weroContact||''):'',updatedAt:FieldValue.serverTimestamp()});
      tx.update(gref,{memberIds:FieldValue.arrayUnion(targetUid),updatedAt:FieldValue.serverTimestamp()});
      tx.update(ref,{status:'approved',reviewedBy:uid,reviewedAt:FieldValue.serverTimestamp()});
      tx.set(gref.collection('activity').doc(),{type:'member_add',text:`${member.data().name} a rejoint le groupe`,meta:{},actorUid:targetUid,actorName:member.data().name,createdAt:FieldValue.serverTimestamp()});
      return {ok:true,approved:true};
    });
  }
  if (req.data?.action === 'removeMember') {
    const gid = String(req.data?.groupId || ''), mid = String(req.data?.memberId || '');
    if (!/^[A-Za-z0-9_-]{1,128}$/.test(gid) || !/^[A-Za-z0-9_-]{1,128}$/.test(mid))
      throw new HttpsError('invalid-argument', 'Participant invalide.');
    const gref = db.collection('groups').doc(gid), mref = gref.collection('members').doc(mid);
    return db.runTransaction(async tx => {
      const [group, member] = await Promise.all([tx.get(gref),tx.get(mref)]);
      if (!group.exists || !group.data().memberIds.includes(uid) || group.data().archived)
        throw new HttpsError('permission-denied','Groupe inaccessible.');
      if (!member.exists || member.data().uid != null)
        throw new HttpsError('failed-precondition','Seul un participant sans compte peut être retiré.');
      const [expenses, settlements, payments, claims] = await Promise.all([
        tx.get(gref.collection('expenses')), tx.get(gref.collection('settlements')),
        tx.get(gref.collection('paymentRequests')), tx.get(gref.collection('memberClaims')),
      ]);
      const involved = expenses.docs.some(d => Object.hasOwn(d.data().payers || {}, mid) || Object.hasOwn(d.data().split || {}, mid))
        || settlements.docs.some(d => d.data().fromId === mid || d.data().toId === mid)
        || payments.docs.some(d => d.data().fromId === mid || d.data().toId === mid)
        || claims.docs.some(d => d.data().memberId === mid && d.data().status === 'pending');
      if (involved) throw new HttpsError('failed-precondition','Participant utilisé par une dépense, un remboursement ou une demande en attente.');
      tx.delete(mref);
      tx.update(gref,{updatedAt:FieldValue.serverTimestamp()});
      tx.set(gref.collection('activity').doc(),{type:'member_remove',text:`${member.data().name} a été retiré du groupe`,meta:{},actorUid:uid,actorName:String(req.auth.token.name||'Membre').slice(0,60),createdAt:FieldValue.serverTimestamp()});
      return {ok:true};
    });
  }
  const { memberId } = req.data || {};
  if (memberId && !/^[A-Za-z0-9_-]{1,128}$/.test(String(memberId))) throw new HttpsError('invalid-argument', 'Participant invalide.');
  await throttle(uid,'joinCode',2500);
  const gdoc = await groupByCode(normCode(req.data && req.data.code));
  const gref = gdoc.ref;

  return db.runTransaction(async (tx) => {
    const g = await tx.get(gref);
    const data = g.data();
    if (data.memberIds.includes(uid)) return { groupId: gref.id };
    if (data.archived) throw new HttpsError('failed-precondition', 'Ce groupe est archivé.');
    // Reprendre le même participant après un départ ne doit jamais effacer ses
    // dettes ni créer une seconde fiche pouvant fausser les comptes.
    const former = await tx.get(gref.collection('members').where('uid','==',uid).limit(1));
    if(!former.empty && former.docs[0].data().leftAt) {
      const exits=await tx.get(gref.collection('exitDebts'));
      if(exits.docs.some(d=>d.data().participants?.includes(uid) && remainingClaim(d)>0))
        throw new HttpsError('failed-precondition','Des remboursements hors groupe sont encore ouverts. Termine-les avant de rejoindre ce groupe.');
      const targetProfile=await tx.get(db.collection('users').doc(uid));
      const prefs=targetProfile.exists?targetProfile.data():{};
      tx.update(former.docs[0].ref,{leftAt:FieldValue.delete(),iban:prefs.shareIban===true?String(prefs.iban||''):'',
        weroContact:prefs.shareWero===true?String(prefs.weroContact||''):'',updatedAt:FieldValue.serverTimestamp()});
      tx.update(gref,{memberIds:FieldValue.arrayUnion(uid),updatedAt:FieldValue.serverTimestamp()});
      tx.delete(db.collection('users').doc(uid).collection('formerGroups').doc(gref.id));
      return {groupId:gref.id,rejoined:true};
    }
    if (data.memberIds.length >= 50) throw new HttpsError('failed-precondition', 'Ce groupe est complet (50 membres maximum).');

    let name;
    if (memberId) {
      // L'utilisateur se « relie » à un participant fantôme existant
      const mref = gref.collection('members').doc(String(memberId));
      const m = await tx.get(mref);
      if (!m.exists) throw new HttpsError('not-found', 'Participant introuvable.');
      if (m.data().uid) throw new HttpsError('failed-precondition', 'Ce participant est déjà relié à un compte.');
      name = m.data().name;
      const cref=gref.collection('memberClaims').doc(uid),existing=await tx.get(cref);
      if(existing.exists && existing.data().status==='pending')return {groupId:gref.id,pendingApproval:true};
      tx.set(cref,{uid,memberId:String(memberId),memberName:name,status:'pending',createdAt:FieldValue.serverTimestamp()});
      return {groupId:gref.id,pendingApproval:true};
    } else {
      const profile=await tx.get(db.collection('users').doc(uid));
      const prefs=profile.exists?profile.data():{};
      name=String(prefs.displayName||'').trim().slice(0,40);
      if(!name)throw new HttpsError('failed-precondition','Termine ton profil avant de rejoindre un groupe.');
      const color=/^#[0-9a-fA-F]{6}$/.test(String(prefs.avatarColor||''))?prefs.avatarColor:'#6366f1';
      tx.set(gref.collection('members').doc(), { name, color, uid,
        iban:prefs.shareIban===true?String(prefs.iban||''):'',weroContact:prefs.shareWero===true?String(prefs.weroContact||''):'',createdAt: FieldValue.serverTimestamp() });
    }
    tx.update(gref, { memberIds: FieldValue.arrayUnion(uid), updatedAt: FieldValue.serverTimestamp() });
    tx.set(gref.collection('activity').doc(), {
      type: 'member_add', text: `${name} a rejoint le groupe`, meta: {}, actorUid: uid, actorName: name, createdAt: FieldValue.serverTimestamp(),
    });
    return { groupId: gref.id };
  });
});

/* ---------- Suppression d'un groupe (créateur uniquement) ---------- */
exports.deleteGroup = onCall({ ...CALLABLE, ...HEAVY_RUNTIME }, async (req) => {
  const uid = needAuth(req);
  const gid = String((req.data && req.data.groupId) || '');
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(gid)) throw new HttpsError('invalid-argument', 'Groupe manquant.');
  const gref = db.collection('groups').doc(gid);
  const snap = await gref.get();
  if (!snap.exists) return { ok: true };
  if (snap.data().createdBy !== uid) throw new HttpsError('permission-denied', 'Seul le créateur du groupe peut le supprimer.');
  const openClaims=await gref.collection('exitDebts').get();
  if(openClaims.docs.some(d=>remainingClaim(d)>0))
    throw new HttpsError('failed-precondition','Impossible de supprimer ce groupe : des remboursements après départ restent ouverts.');
  // Aucune dette ne peut disparaître en supprimant son groupe : comptes actifs.
  const [expenses,settlements]=await Promise.all([
    gref.collection('expenses').get(),gref.collection('settlements').get(),
  ]);
  if(computeAvailableTransfers(expenses,settlements,openClaims).length)
    throw new HttpsError('failed-precondition','Impossible de supprimer ce groupe : des soldes restent à rembourser.');
  // Les invitations ciblées sont révoquées avec le groupe, y compris leurs
  // copies privées visibles chez des personnes qui n'avaient pas encore accepté.
  const invited=await gref.collection('groupInvites').get();
  for(const invite of invited.docs)
    await db.collection('users').doc(invite.id).collection('groupInvites').doc(gid).delete();
  await db.recursiveDelete(gref);
  await admin.storage().bucket().deleteFiles({ prefix: `groups/${gid}/` }).catch((e) => console.warn('Photos non supprimées :', e.message));
  await admin.storage().bucket().deleteFiles({ prefix: `chat/group/${gid}/` }).catch(() => {});
  return { ok: true };
});

/* ---------- Précondition serveur : aucun compte débiteur ne peut être effacé silencieusement. ---------- */
async function assertNoOpenDebtForAccount(uid, activeGroups) {
  // Lire intégralement les registres faisant autorité. Un échec de lecture
  // interrompt la suppression (fail closed), il ne vaut jamais "aucune dette".
  const scannedGroups=new Set();
  async function scanGroup(g, isActive) {
    if(!g.exists||scannedGroups.has(g.id))return;
    scannedGroups.add(g.id);
    const [members,expenses,settlements,exits]=await Promise.all([
      g.ref.collection('members').get(),g.ref.collection('expenses').get(),
      g.ref.collection('settlements').get(),g.ref.collection('exitDebts').get(),
    ]);
    const active=groupDebtsFor(uid,members,expenses,settlements,exits);
    if(active.length){
      const label=isActive?'dans un groupe':'après la sortie d’un groupe';
      throw new HttpsError('failed-precondition',
        `Suppression impossible : ${active.length} remboursement(s) non soldé(s) ${label}. Termine les remboursements confirmés avant de réessayer. Tu peux aussi contacter Kortiz pour exercer tes droits sur tes données.`);
    }
  }
  for(const g of activeGroups.docs)await scanGroup(g,true);
  // Les archives peuvent exister même si le miroir personnel a disparu.
  const former=await db.collection('users').doc(uid).collection('formerGroups').get();
  for(const item of former.docs){
    const gid=String(item.data().groupId||item.id);
    if(validId(gid)&&!scannedGroups.has(gid)){
      const g=await db.collection('groups').doc(gid).get();
      if(g.exists)await scanGroup(g,false);
    }
  }
  // Défense supplémentaire : suivre le miroir des créances après sortie et
  // revérifier chaque entrée au registre de groupe pour éviter un cache périmé.
  const personal=await db.collection('users').doc(uid).collection('exitDebts').get();
  for(const entry of personal.docs){
    if(!externalExitDebtsFor(uid,[entry]).length)continue;
    const info=entry.data();
    if(!validId(info.groupId)||!validId(info.debtId))
      throw new HttpsError('failed-precondition','Ancienne dette incohérente : contacte Kortiz avant de supprimer ton compte.');
    const canonical=await db.collection('groups').doc(info.groupId).collection('exitDebts').doc(info.debtId).get();
    if(canonical.exists&&externalExitDebtsFor(uid,[canonical]).length)
      throw new HttpsError('failed-precondition','Suppression impossible : tu as un remboursement hors groupe encore ouvert.');
  }
  // Les demandes privées unilatérales "pending" ne verrouillent jamais un
  // compte (sinon un correspondant pourrait empêcher abusivement le départ).
  // Les seules dettes privées bloquantes sont acceptées par le débiteur.
  const chats=await db.collection('directChats').where('members','array-contains',uid).get();
  for(const chat of chats.docs){
    const requests=await chat.ref.collection('moneyRequests').get();
    if(directDebtsFor(uid,requests).length)
      throw new HttpsError('failed-precondition','Suppression impossible : tu as une dette reconnue dans une discussion privée qui n’est pas confirmée comme remboursée.');
  }
}

/* ---------- RGPD : suppression du compte et des données personnelles ---------- */
exports.deleteAccount = onCall({ ...CALLABLE, ...HEAVY_RUNTIME }, async (req) => {
  const uid = needAuth(req);
  const groups = await db.collection('groups').where('memberIds', 'array-contains', uid).get();
  // Avant TOUT effet irréversible : pas de suppression si dette encore due.
  await assertNoOpenDebtForAccount(uid,groups);
  for (const g of groups.docs) {
    const data = g.data();
    const myMessages=await g.ref.collection('messages').where('uid','==',uid).get();
    await Promise.all(myMessages.docs.map(d=>d.ref.delete()));
    await admin.storage().bucket().deleteFiles({prefix:`chat/group/${g.id}/${uid}/`}).catch(()=>{});
    const others = data.memberIds.filter((x) => x !== uid);
    if (!others.length) {
      // Seul membre connecté : on supprime le groupe et ses photos
      await db.recursiveDelete(g.ref);
      await admin.storage().bucket().deleteFiles({ prefix: `groups/${g.id}/` }).catch(() => {});
      continue;
    }
    // Sinon on détache l'utilisateur : son prénom reste sur les dépenses passées pour que les comptes restent justes,
    // mais la fiche n'est plus reliée à son compte et ses coordonnées SEPA/Wero sont effacées.
    const batch = db.batch();
    batch.update(g.ref, { memberIds: FieldValue.arrayRemove(uid), adminIds:(data.adminIds||[]).filter(x=>x!==uid), ...(data.createdBy === uid ? { createdBy: others[0] } : {}), updatedAt: FieldValue.serverTimestamp() });
    const mine = await g.ref.collection('members').where('uid', '==', uid).get();
    mine.docs.forEach((m) => batch.update(m.ref, { uid: null, iban: '', weroContact: '' }));
    const acts = await g.ref.collection('activity').where('actorUid', '==', uid).get();
    acts.docs.forEach((a) => batch.update(a.ref, { actorUid: 'deleted', actorName: 'Ancien membre' }));
    await batch.commit();
    // Les prévisions sont partagées et ne créent aucune dette. On les conserve
    // si le groupe continue, mais l'identifiant du membre supprimé disparaît.
    const ownPlans=await g.ref.collection('plannedExpenses').where('createdBy','==',uid).get();
    for(const plan of ownPlans.docs) await plan.ref.update({createdBy:'deleted',updatedAt:FieldValue.serverTimestamp()});
    // Sondages : retirer l'identifiant du compte supprimé sans supprimer les
    // votes des autres membres. Les sondages restent lisibles par le groupe.
    const polls=await g.ref.collection('polls').get();
    for(const p of polls.docs){
      const votes={...(p.data().votes||{})};const patch={};
      if(Object.prototype.hasOwnProperty.call(votes,uid)){delete votes[uid];patch.votes=votes;}
      if(p.data().createdBy===uid)patch.createdBy='deleted';
      if(Object.keys(patch).length)await p.ref.update(patch);
    }
    // Conservation des montants partagés, retrait de l'identifiant personnel.
    for (const collectionName of ['moneyRequests','paymentRequests']) {
      const requests = await g.ref.collection(collectionName).get();
      for (const r of requests.docs) {
        const patch = {};
        for (const field of ['creditorUid','debtorUid','fromUid','toUid','requestedBy'])
          if (r.data()[field] === uid) patch[field] = 'deleted';
        if (Object.keys(patch).length) await r.ref.update(patch);
      }
    }
  }
  // Dissocier également les anciens membres sans dette (leurs archives
  // ne figurent pas dans la collection des groupes actifs de l'utilisateur).
  const formerGroups=await db.collection('users').doc(uid).collection('formerGroups').get();
  for(const former of formerGroups.docs) {
    const fg=former.data();
    if(validId(fg.groupId)&&validId(fg.memberId)) {
      const mref=db.collection('groups').doc(fg.groupId).collection('members').doc(fg.memberId);
      const member=await mref.get();
      if(member.exists && member.data().uid===uid)
        await mref.update({uid:null,iban:'',weroContact:'',updatedAt:FieldValue.serverTimestamp()});
    }
    await former.ref.delete();
  }
  // Le compte peut être supprimé conformément au RGPD sans effacer les
  // écritures comptables partagées. Les dettes de sortie deviennent anonymes
  // et le miroir privé de la personne supprimée disparaît.
  const personalExitDebts=await db.collection('users').doc(uid).collection('exitDebts').get();
  for(const mirror of personalExitDebts.docs) {
    const claim=mirror.data(),gid=claim.groupId,debtId=claim.debtId;
    if(!validId(gid)||!validId(debtId)) {await mirror.ref.delete();continue;}
    const groupRef=db.collection('groups').doc(gid),debtRef=groupRef.collection('exitDebts').doc(debtId);
    const patch={participants:FieldValue.arrayRemove(uid),updatedAt:FieldValue.serverTimestamp()};
    if(claim.fromUid===uid){patch.fromUid=null;patch.fromName='Ancien membre';}
    if(claim.toUid===uid){patch.toUid=null;patch.toName='Ancien membre';}
    const live=await debtRef.get();
    if(live.exists)await debtRef.update(patch);
    const other=claim.fromUid===uid?claim.toUid:claim.fromUid;
    if(other && other!==uid){
      const otherMirror=db.collection('users').doc(other).collection('exitDebts').doc(`${gid}_${debtId}`);
      if((await otherMirror.get()).exists)await otherMirror.update(patch);
    }
    // Le compte sorti du groupe conservait un UID d'historique pour un éventuel retour.
    // Cet identifiant est effacé lors de la suppression de compte.
    const mid=claim.fromUid===uid?claim.fromId:claim.toId;
    if(mid){const memberRef=groupRef.collection('members').doc(mid),member=await memberRef.get();
      if(member.exists && member.data().uid===uid)await memberRef.update({uid:null,iban:'',weroContact:'',updatedAt:FieldValue.serverTimestamp()});}
    await mirror.ref.delete();
  }
  // Remove identity, friends, requests, direct chat data, uploaded media and profile picture.
  const socialRef=db.collection('socialProfiles').doc(uid);
  const publicProfile=await socialRef.get();
  if(publicProfile.exists && publicProfile.data().handle) {
    await db.collection('handles').doc(publicProfile.data().handle).delete().catch(()=>{});
  }
  await socialRef.delete().catch(()=>{});
  for(const field of ['fromUid','toUid']) {
    const fs=await db.collection('friendRequests').where(field,'==',uid).get();
    await Promise.all(fs.docs.map(d=>d.ref.delete()));
  }
  for(const name of ['friendships','directChats']) {
    const fs=await db.collection(name).where('members','array-contains',uid).get();
    for(const d of fs.docs){
      if(name==='directChats') {
        // On efface les messages/médias de la personne, sans détruire ceux
        // de son correspondant. La conversation devient une archive fermée.
        const mine = await d.ref.collection('messages').where('uid','==',uid).get();
        for (const message of mine.docs) await message.ref.update({ uid:'deleted', name:'Ancien membre', text:'', type:'deleted', mediaPath:null, deletedAt:FieldValue.serverTimestamp() });
        const requests = await d.ref.collection('moneyRequests').get();
        for (const r of requests.docs) if (r.data().creditorUid===uid || r.data().debtorUid===uid)
          await r.ref.update({ creditorUid:r.data().creditorUid===uid?'deleted':r.data().creditorUid,
            debtorUid:r.data().debtorUid===uid?'deleted':r.data().debtorUid, status:'cancelled', updatedAt:FieldValue.serverTimestamp() });
        // v28.4 : sondages de discussions privées. Conserver les choix des
        // autres participants, retirer les votes et la signature du compte.
        const directPolls=await d.ref.collection('polls').get();
        for(const poll of directPolls.docs){
          const votes={...(poll.data().votes||{})};const patch={};
          if(Object.prototype.hasOwnProperty.call(votes,uid)){delete votes[uid];patch.votes=votes;}
          if(poll.data().createdBy===uid)patch.createdBy='deleted';
          if(Object.keys(patch).length)await poll.ref.update(patch);
        }
        await admin.storage().bucket().deleteFiles({prefix:`chat/direct/${d.id}/${uid}/`}).catch(()=>{});
        await d.ref.update({ members:d.data().members.filter(x=>x!==uid), closedAt:FieldValue.serverTimestamp(), updatedAt:FieldValue.serverTimestamp() });
      }else await d.ref.delete();
    }
  }
  for (const field of ['reporterUid','authorUid']) {
    const reports=await db.collection('reports').where(field,'==',uid).get();
    for(const report of reports.docs) await report.ref.update({[field]:'deleted'});
  }
  await db.recursiveDelete(db.collection('blocks').doc(uid)).catch(()=>{});
  await admin.storage().bucket().deleteFiles({prefix:`avatars/${uid}/`}).catch(()=>{});
  const inbox=await db.collection('users').doc(uid).collection('groupInvites').get();
  for(const invitation of inbox.docs){
    await db.collection('groups').doc(invitation.id).collection('groupInvites').doc(uid).delete().catch(()=>{});
    await invitation.ref.delete();
  }
  await admin.storage().bucket().deleteFiles({prefix:`supportReports/${uid}/`}).catch(()=>{});
  await db.recursiveDelete(db.collection('users').doc(uid)).catch(()=>{});
  await admin.auth().deleteUser(uid);
  return { ok: true };
});

/* ---------- Validation serveur d'une dépense ---------- */
const sumCents = (o) => Object.values(o || {}).reduce((a, v) => a + (Number.isInteger(v) && v >= 0 ? v : NaN), 0);
/** Retourne un message d'erreur, ou null si la dépense est cohérente (centimes entiers, parts et paiements = total, participants existants). */
async function checkExpense(gid, e, tx = null) {
  if (!e || !Number.isInteger(e.amountCents) || e.amountCents <= 0) return 'montant invalide';
  if (sumCents(e.split) !== e.amountCents) return 'la somme des parts ne correspond pas au montant';
  if (sumCents(e.payers) !== e.amountCents) return 'la somme des paiements ne correspond pas au montant';
  const q = db.collection('groups').doc(gid).collection('members').select();
  const ms = tx ? await tx.get(q) : await q.get();
  const ids = new Set(ms.docs.map((d) => d.id));
  for (const id of [...Object.keys(e.split || {}), ...Object.keys(e.payers || {})]) if (!ids.has(id)) return `participant inconnu (${id})`;
  return null;
}

/* v28 : filtrer côté serveur pour ne jamais envoyer un push désactivé. */
const PUSH_KEYS=['groupInvites','directMessages','groupMessages','expenses','moneyRequests','paymentConfirmations'];
function allowsPush(userData,kind,gid){
  const prefs=userData?.notificationPrefs||{};
  if(!PUSH_KEYS.includes(kind)||prefs[kind]===false)return false;
  if(gid&&Array.isArray(userData?.mutedGroupIds)&&userData.mutedGroupIds.includes(gid))return false;
  return true;
}
async function pushRecipient(uid,kind,detail,gid=null){
  try{
    const doc=await db.collection('users').doc(uid).get(),data=doc.data()||{};
    if(!allowsPush(data,kind,gid))return;
    const tokens=data.fcmTokens||[];if(!tokens.length)return;
    const lang=langOf(data);
    const localizedBody={
      groupInvites:trans(lang,'Invitation à rejoindre un groupe','Invitation to join a group','Convite para entrar em um grupo','Invitación para unirse a un grupo'),
      directMessages:trans(lang,'Nouveau message privé','New private message','Nova mensagem privada','Nuevo mensaje privado'),
      moneyRequests:trans(lang,'Nouvelle demande de remboursement','New repayment request','Novo pedido de reembolso','Nueva solicitud de reembolso'),
      paymentConfirmations:trans(lang,'Paiement confirmé','Payment confirmed','Pagamento confirmado','Pago confirmado')
    };
    const payload=localizedBody[kind]?{...detail,body:localizedBody[kind]}:detail;
    const response=await admin.messaging().sendEachForMulticast({tokens,data:payload});
    const dead=tokens.filter((t,i)=>!response.responses[i].success&&/not-registered|invalid-registration-token|invalid-argument/.test(response.responses[i].error?.code||''));
    if(dead.length)await doc.ref.update({fcmTokens:FieldValue.arrayRemove(...dead)});
  }catch(error){console.warn('Push Kortiz échoué',error);}
}

/* ---------- Notifications push personnalisées (opt-in : seuls les utilisateurs ayant activé les notifications ont un jeton) ---------- */
async function notifyMembers(gid, actorUid, build, kind) {
  const gref = db.collection('groups').doc(gid);
  const gsnap = await gref.get();
  if (!gsnap.exists) return;
  const g = gsnap.data();
  const uids = g.memberIds.filter((u) => u !== actorUid);
  if (!uids.length) return;
  const [users, ms] = await Promise.all([db.getAll(...uids.map((u) => db.collection('users').doc(u))), gref.collection('members').get()]);
  const memberOf = {};
  ms.docs.forEach((m) => { if (m.data().uid) memberOf[m.data().uid] = m.id; });
  await Promise.all(users.map(async (u) => {
    const userData=u.data()||{};
    if(!allowsPush(userData,kind,gid))return;
    const tokens=userData.fcmTokens||[];
    if (!tokens.length) return;
    const { title, body } = build(g, memberOf[u.id], langOf(u.data()));
    const res = await admin.messaging().sendEachForMulticast({
      tokens, data: { title, body, url: `/#/g/${gid}`, tag: `g-${gid}` }, webpush: { headers: { Urgency: 'high' } },
    });
    const dead = tokens.filter((t, i) => !res.responses[i].success && /not-registered|invalid-registration-token|invalid-argument/.test((res.responses[i].error || {}).code || ''));
    if (dead.length) await u.ref.update({ fcmTokens: FieldValue.arrayRemove(...dead) }).catch(() => {});
  }));
}

/**
 * Un seul déclencheur pour les dépenses (création / modification / suppression) :
 *  - validation serveur : une dépense incohérente est annulée (création → supprimée, modification → restaurée) ;
 *  - notifications : « Marc a ajouté « Courses » : tu dois 8,50 € » ;
 *  - nettoyage des photos de tickets orphelines.
 * ANTI-BOUCLE : ce déclencheur n'écrit que pour annuler une dépense invalide ; la version restaurée étant valide,
 * le déclenchement suivant ne produit aucune écriture. Il n'écrit jamais dans une dépense valide.
 */
exports.onExpenseWritten = onDocumentWritten({ document: 'groups/{gid}/expenses/{eid}', ...HEAVY_RUNTIME }, async (event) => {
  const { gid } = event.params;
  const before = event.data.before.exists ? event.data.before.data() : null;
  const after = event.data.after.exists ? event.data.after.data() : null;
  const bucket = admin.storage().bucket();
  if (!after) { // suppression
    if (before && before.receiptPath) await bucket.file(before.receiptPath).delete({ ignoreNotFound: true }).catch(() => {});
    if(before)await db.collection('groups').doc(gid).collection('activity').add({
      type:'expense_delete',text:`Dépense supprimée : ${String(before.title||'').slice(0,120)}`,meta:{expenseId:event.params.eid},
      actorUid:'system',actorName:'Kortiz',source:'server',createdAt:FieldValue.serverTimestamp()
    });
    return;
  }
  const problem = await checkExpense(gid, after);
  if (problem) {
    console.error(`Dépense ${event.params.eid} rejetée : ${problem}`);
    const gref = db.collection('groups').doc(gid);
    // Événements Firestore livrés au moins une fois et parfois en retard : une
    // ancienne validation ne doit JAMAIS écraser une correction plus récente.
    const rejectedUpdateTime = event.data.after.updateTime;
    if (!rejectedUpdateTime) {
      console.error('Impossible de vérifier la version de la dépense invalide', event.params.eid);
      return; // fail-safe, sans écriture destructrice sur un état inconnu
    }
    const canRestore = before && !(await checkExpense(gid, before));
    const repaired = await db.runTransaction(async tx => {
      const current=await tx.get(event.data.after.ref);
      if (!current.exists || !current.updateTime?.isEqual(rejectedUpdateTime)) return false;
      if (canRestore) tx.set(event.data.after.ref,before);
      else tx.delete(event.data.after.ref);
      return true;
    });
    if (repaired) await gref.collection('activity').add({ type: 'group_edit', text: `Une dépense incohérente (« ${String(after.title).slice(0, 60)} ») a été rejetée : ${problem}.`, meta: {}, actorUid: 'system', actorName: 'Kortiz', createdAt: FieldValue.serverTimestamp() });
    return;
  }
  if (before && before.receiptPath && !after.receiptPath) await bucket.file(before.receiptPath).delete({ ignoreNotFound: true }).catch(() => {});
  // Journal officiel créé uniquement après validation serveur (pas de libellé financier forgé côté client).
  if (!before || before.approvalStatus !== after.approvalStatus) {
    await db.collection('groups').doc(gid).collection('activity').add({
      type: 'expense_add',
      text: `Dépense ajoutée : ${String(after.title).slice(0,120)}`,
      meta: { expenseId: event.params.eid }, source:'server', actorUid: after.createdBy,
      actorName: 'Kortiz', createdAt: FieldValue.serverTimestamp(),
    });
  } else if (after.updatedBy && before.updatedAt?.toMillis?.() !== after.updatedAt?.toMillis?.()) {
    // Tracer toute correction manuelle d'une dépense déjà enregistrée.
    await db.collection('groups').doc(gid).collection('activity').add({
      type:'expense_edit', text:`Dépense modifiée : ${String(after.title).slice(0,120)}`,
      meta:{expenseId:event.params.eid},source:'server',actorUid:after.updatedBy,actorName:'Kortiz',createdAt:FieldValue.serverTimestamp()
    });
  }
  if (before || after.auto || after.note === 'Importé depuis un CSV bancaire' || after.approvalStatus === 'rejected') return; // notifie seulement les créations manuelles
  await notifyMembers(gid, after.createdBy, (g, mid, lang) => {
    const d = (after.split[mid] || 0) - (after.payers[mid] || 0);
    const n = (value) => money(value, g.currency, lang);
    const mine = !mid || (!(mid in after.split) && !(mid in after.payers))
      ? trans(lang, "tu n'es pas concerné(e)", 'not involved', 'não faz parte desta despesa', 'no participas en este gasto')
      : d > 0 ? trans(lang, `tu dois ${n(d)}`, `you owe ${n(d)}`, `você deve ${n(d)}`, `debes ${n(d)}`)
        : d < 0 ? trans(lang, `on te doit ${n(-d)}`, `you are owed ${n(-d)}`, `você tem ${n(-d)} a receber`, `te deben ${n(-d)}`)
          : trans(lang, 'tu es à jour', 'you are settled up', 'está tudo acertado', 'estás al día');
    const actor = after.createdByName || trans(lang, 'Un participant', 'A participant', 'Um participante', 'Un participante');
    return { title: `${g.emoji} ${g.name}`, body: trans(lang,
      `${actor} a ajouté « ${after.title} » : ${mine}`,
      `${actor} added “${after.title}”: ${mine}`,
      `${actor} adicionou “${after.title}”: ${mine}`,
      `${actor} añadió «${after.title}»: ${mine}`) };
  },'expenses');
});

exports.onSettlementCreated = onDocumentCreated('groups/{gid}/settlements/{sid}', async (event) => {
  const s = event.data && event.data.data();
  if (!s) return;
  await db.collection('groups').doc(event.params.gid).collection('activity').add({
    type:'settlement',text:`Remboursement confirmé : ${s.amountCents} centimes`,
    meta:{settlementId:event.params.sid},source:'server',actorUid:s.createdBy||'system',actorName:'Kortiz',createdAt:FieldValue.serverTimestamp(),
  });
  await notifyMembers(event.params.gid, s.createdBy, (g, mid, lang) => {
    const actor = s.createdByName || trans(lang, 'Un participant', 'A participant', 'Um participante', 'Un participante');
    const sum = money(s.amountCents, g.currency, lang), forYou = mid && s.toId === mid;
    return {title: `${g.emoji} ${g.name}`, body: trans(lang,
      `${actor} a enregistré un remboursement de ${sum}${forYou ? ' pour toi' : ''}`,
      `${actor} recorded a repayment of ${sum}${forYou ? ' for you' : ''}`,
      `${actor} registrou um reembolso de ${sum}${forYou ? ' para você' : ''}`,
      `${actor} registró un reembolso de ${sum}${forYou ? ' para ti' : ''}`)};
  },'paymentConfirmations');
});

/* ---------- Dépenses récurrentes (tous les jours à 06 h, heure de Bruxelles) ---------- */
// IMPORTANT: lire le modèle ET créer ses occurrences dans la même transaction.
// Sinon stopRecurring peut annuler le modèle pendant que cette tâche le recrée.
// Les deux opérations lisent le même document : Firestore recommence l'une des
// transactions si l'autre l'a modifié avant le commit.
async function processDueRecurringExpense(expenseRef, today) {
  const gref = expenseRef.parent.parent;
  if (!gref) return;
  return db.runTransaction(async (tx) => {
    // Toutes les lectures précèdent les écritures : contrainte de Firestore.
    const [groupSnap, expenseSnap] = await Promise.all([tx.get(gref), tx.get(expenseRef)]);
    if (!groupSnap.exists || groupSnap.data().archived || !expenseSnap.exists) return;
    const e = expenseSnap.data();
    const dueDate = e.recurringNext;
    if (typeof dueDate !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(dueDate) || dueDate > today) return;
    const freq = e.recurring?.freq;
    if (!['weekly','monthly','yearly'].includes(freq) || e.approvalStatus === 'rejected') {
      tx.update(expenseRef, { recurringNext: null });
      return;
    }
    const dom = e.recurring.dayOfMonth;
    if (!Number.isInteger(dom) || dom < 1 || dom > 31) {
      console.warn('Récurrence invalide, aucune occurrence produite :', expenseRef.path);
      tx.update(expenseRef, { recurringNext: null });
      return;
    }
    const members = await tx.get(gref.collection('members'));
    const activeIds = new Set(members.docs.filter(m=>!m.data().leftAt).map(m=>m.id));
    if ([...Object.keys(e.payers||{}), ...Object.keys(e.split||{})].some(id=>!activeIds.has(id))) {
      // Le départ d'un participant ne doit pas fabriquer une dette nouvelle.
      tx.update(expenseRef, { recurringNext: null });
      return;
    }
    const dates = [];
    for (let next=dueDate; next<=today && dates.length<12; next=addPeriod(next,freq,dom)) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(next) || dates.includes(next)) break;
      dates.push(next);
    }
    if (!dates.length) return;
    // L'identifiant stable rend les retries idempotents; la transaction empêche
    // qu'un arrêt ou une seconde exécution s'intercale entre lecture et écriture.
    const refs=dates.map(dt=>expenseRef.parent.doc(`${expenseRef.id}_${dt}`));
    const existing=[];
    for (const ref of refs) existing.push(await tx.get(ref));
    let created=0;
    dates.forEach((dt,i)=>{
      if(existing[i].exists)return;
      tx.create(refs[i],{
        title:e.title, amountCents:e.amountCents, paidBy:e.paidBy, payers:e.payers, split:e.split,
        splitMode:e.splitMode||'equal', splitInput:e.splitInput||{}, category:e.category,
        date:dt, note:e.note||'', approvalStatus:'approved', recurring:null, recurringNext:null,
        recurringFrom:expenseRef.id, auto:true, receiptPath:null, createdBy:e.createdBy,
        createdByName:e.createdByName||'', createdAt:FieldValue.serverTimestamp(),
        updatedAt:FieldValue.serverTimestamp(),
      });
      created++;
    });
    const nextDate=addPeriod(dates[dates.length-1],freq,dom);
    tx.update(expenseRef,{recurringNext:nextDate,updatedAt:FieldValue.serverTimestamp()});
    if(created>0)tx.create(gref.collection('activity').doc(),{
      type:'expense_add',text:`Dépense récurrente « ${String(e.title||'').slice(0,120)} » ajoutée automatiquement (${created}×)`,
      meta:{},actorUid:'system',actorName:'Kortiz',createdAt:FieldValue.serverTimestamp(),
    });
    return {created,nextDate};
  });
}
exports.recurringExpenses=onSchedule({schedule:'every day 06:00',timeZone:'Europe/Brussels',...HEAVY_RUNTIME},async()=>{
  const today=new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Brussels'}).format(new Date());
  const due=await db.collectionGroup('expenses').where('recurringNext','<=',today).get();
  // Un modèle endommagé ne doit pas bloquer les récurrences des autres groupes.
  for(const doc of due.docs){
    try { await processDueRecurringExpense(doc.ref,today); }
    catch(error){console.error('Échec récurrence',doc.ref.path,error);}
  }
});

/* ============================================================================
   Kortiz social and payments: server-owned operations, no bank transactions.
   All sensitive changes are made through callables. Client rules are read-only.
   ============================================================================ */
const validId = (s) => typeof s === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(s);
const requireId = (s) => { if (!validId(s)) throw new HttpsError('invalid-argument', 'Identifiant invalide.'); return s; };
const cleanText = (v, max) => {
  const s = String(v || '').trim();
  if (!s || s.length > max || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(s)) throw new HttpsError('invalid-argument', 'Texte invalide.');
  return s;
};
const directId = (a, b) => [a, b].sort().join('_');
const isAdmin = (g, uid) => g.createdBy === uid || (Array.isArray(g.adminIds) && g.adminIds.includes(uid));
async function getGroupFor(uid, gid) {
  const r = db.collection('groups').doc(requireId(gid)), s = await r.get();
  if (!s.exists || !s.data().memberIds.includes(uid)) throw new HttpsError('permission-denied', 'Accès au groupe interdit.');
  return { ref: r, data: s.data() };
}
async function getChatFor(uid, cid) {
  const r = db.collection('directChats').doc(requireId(cid)), s = await r.get();
  if (!s.exists || !s.data().members.includes(uid)) throw new HttpsError('permission-denied', 'Conversation privée inaccessible.');
  if (s.data().members.length !== 2 || await isBlocked(s.data().members[0], s.data().members[1]))
    throw new HttpsError('permission-denied', 'Cette conversation est fermée ou bloquée.');
  return { ref: r, data: s.data() };
}
async function isBlocked(a, b) {
  const [x, y] = await Promise.all([db.doc(`blocks/${a}/users/${b}`).get(), db.doc(`blocks/${b}/users/${a}`).get()]);
  return x.exists || y.exists;
}
async function throttle(uid, kind, milliseconds) {
  const ref = db.collection('rateLimits').doc(`${uid}_${kind}`);
  await db.runTransaction(async tx => {
    const s = await tx.get(ref), now = Date.now();
    if (s.exists && now - (s.data().last || 0) < milliseconds) throw new HttpsError('resource-exhausted', 'Patiente avant de recommencer.');
    tx.set(ref, { last: now, expiresAt: new Date(now + 86400000) });
  });
}
function cleanIbanForProfile(value) {
  const iban=String(value||'').toUpperCase().replace(/\s/g,'');
  if (!iban) return '';
  if (!/^[A-Z]{2}[0-9]{2}[A-Z0-9]{11,30}$/.test(iban) || iban.length > 34)
    throw new HttpsError('invalid-argument','IBAN invalide.');
  let rest=iban.slice(4)+iban.slice(0,4), mod=0;
  for(const ch of rest) {
    const expanded=/[A-Z]/.test(ch)?String(ch.charCodeAt(0)-55):ch;
    for(const d of expanded)mod=(mod*10+Number(d))%97;
  }
  if(mod!==1)throw new HttpsError('invalid-argument','Clé IBAN incorrecte.');
  return iban;
}
function cleanWeroContact(value) {
  const v=String(value||'').trim();
  if(v.length>254 || (v && !/^(?:\+?[0-9]{7,15}|[^\s@]+@[^\s@]+\.[^\s@]+)$/.test(v)))
    throw new HttpsError('invalid-argument','Contact Wero invalide.');
  return v;
}
exports.saveSocialProfile = onCall(CALLABLE, async req => {
  const uid = needAuth(req);
  // Atomic revocation of SEPA/Wero details across all joined groups.
  // No new Cloud Function is needed: reuse the profile callable.
  if (req.data?.action === 'syncPaymentDetails') {
    const iban=cleanIbanForProfile(req.data.iban), weroContact=cleanWeroContact(req.data.weroContact);
    const shareIban=req.data.shareIban===true,shareWero=req.data.shareWero===true;
    if (req.data.shareIban !== true && req.data.shareIban !== false || req.data.shareWero !== true && req.data.shareWero !== false)
      throw new HttpsError('invalid-argument','Préférences de partage invalides.');
    if (shareWero && !weroContact) throw new HttpsError('invalid-argument','Renseigne ton contact Wero avant de le partager.');
    // A user may opt to share a future IBAN while the field is still empty.
    const groups=await db.collection('groups').where('memberIds','array-contains',uid).get();
    if (groups.size > 120) throw new HttpsError('resource-exhausted','Trop de groupes pour synchroniser les coordonnées en une fois.');
    await db.runTransaction(async tx => {
      const userRef=db.collection('users').doc(uid),user=await tx.get(userRef);
      if(!user.exists)throw new HttpsError('failed-precondition','Profil privé introuvable.');
      const updates=[];
      for(const entry of groups.docs) {
        const g=await tx.get(entry.ref);
        if(!g.exists || !g.data().memberIds.includes(uid))continue;
        const members=await tx.get(entry.ref.collection('members').where('uid','==',uid));
        for(const m of members.docs)updates.push(m.ref);
      }
      if (updates.length > 400) throw new HttpsError('resource-exhausted','Trop de fiches à synchroniser.');
      tx.update(userRef,{iban,shareIban,weroContact,shareWero,updatedAt:FieldValue.serverTimestamp()});
      for(const ref of updates)tx.update(ref,{iban:shareIban?iban:'',weroContact:shareWero?weroContact:'',updatedAt:FieldValue.serverTimestamp()});
    });
    return {ok:true};
  }
  const displayName = cleanText(req.data?.displayName || 'Utilisateur', 60);
  const raw = req.data?.handle;
  const handle = raw == null ? null : String(raw).toLowerCase().replace(/^@/, '');
  if (handle !== null && !/^[a-z][a-z0-9_]{2,23}$/.test(handle)) throw new HttpsError('invalid-argument', 'Pseudo : 3 à 24 caractères (lettres, chiffres, _).');
  const avatarPath = req.data?.avatarPath;
  if (avatarPath != null && avatarPath !== `avatars/${uid}/profile.jpg` && avatarPath !== '') throw new HttpsError('invalid-argument', 'Photo invalide.');
  if (avatarPath) { try { await admin.storage().bucket().file(avatarPath).getMetadata(); } catch { throw new HttpsError('failed-precondition', 'Photo non trouvée.'); } }
  const ref = db.collection('socialProfiles').doc(uid);
  await db.runTransaction(async tx => {
    const prev = await tx.get(ref), old = prev.exists ? prev.data().handle : null;
    const mapRef = handle ? db.collection('handles').doc(handle) : null;
    const hit = mapRef && await tx.get(mapRef);
    if (hit?.exists && hit.data().uid !== uid) throw new HttpsError('already-exists', 'Ce pseudo est déjà utilisé.');
    const update = { displayName, updatedAt: FieldValue.serverTimestamp() };
    if (avatarPath != null) update.avatarPath = avatarPath;
    if (handle) { update.handle = handle; tx.set(mapRef, { uid }); }
    if (old && handle && old !== handle) tx.delete(db.collection('handles').doc(old));
    tx.set(ref, update, { merge: true });
  });
  return { ok: true };
});
exports.sendFriendRequest = onCall(CALLABLE, async req => {
  const uid = needAuth(req), handle = String(req.data?.handle || '').trim().replace(/^@/, '').toLowerCase();
  if (!/^[a-z][a-z0-9_]{2,23}$/.test(handle)) throw new HttpsError('invalid-argument', 'Pseudo invalide.');
  await throttle(uid, 'friends', 4000);
  const snap = await db.collection('handles').doc(handle).get();
  if (!snap.exists) throw new HttpsError('not-found', 'Pseudo introuvable.');
  const other = snap.data().uid;
  if (other === uid) throw new HttpsError('failed-precondition', 'Impossible de t’ajouter toi-même.');
  if (await isBlocked(uid, other)) throw new HttpsError('permission-denied', 'Demande non autorisée.');
  const fId = directId(uid, other), fr = db.collection('friendships').doc(fId);
  const requestRef = db.collection('friendRequests').doc(`${uid}_${other}`);
  await db.runTransaction(async tx => {
    const [friend, old] = await Promise.all([tx.get(fr), tx.get(requestRef)]);
    if (friend.exists || (old.exists && old.data().status === 'pending')) throw new HttpsError('already-exists', 'Demande déjà envoyée ou déjà amis.');
    tx.set(requestRef, { fromUid: uid, toUid: other, status: 'pending', createdAt: FieldValue.serverTimestamp() });
  });
  return { ok: true };
});
exports.respondFriendRequest = onCall(CALLABLE, async req => {
  const uid = needAuth(req), id = requireId(req.data?.id), accept = req.data?.accept === true;
  const r = db.collection('friendRequests').doc(id);
  await db.runTransaction(async tx => {
    const s = await tx.get(r);
    if (!s.exists || s.data().toUid !== uid || s.data().status !== 'pending') throw new HttpsError('permission-denied', 'Demande indisponible.');
    const from = s.data().fromUid, fr = db.collection('friendships').doc(directId(from, uid));
    const [firstBlock, secondBlock] = await Promise.all([
      tx.get(db.doc(`blocks/${uid}/users/${from}`)), tx.get(db.doc(`blocks/${from}/users/${uid}`))
    ]);
    if (accept && (firstBlock.exists || secondBlock.exists)) throw new HttpsError('permission-denied', 'Utilisateur bloqué.');
    tx.update(r, { status: accept ? 'accepted' : 'declined', handledAt: FieldValue.serverTimestamp() });
    if (accept) tx.set(fr, { members: [from, uid].sort(), createdAt: FieldValue.serverTimestamp() });
  });
  return { ok: true };
});
exports.blockUser = onCall(CALLABLE, async req => {
  const uid = needAuth(req), other = requireId(req.data?.uid);
  if (uid === other) throw new HttpsError('invalid-argument', 'Utilisateur invalide.');
  await db.doc(`blocks/${uid}/users/${other}`).set({ createdAt: FieldValue.serverTimestamp() });
  await db.collection('friendships').doc(directId(uid, other)).delete().catch(() => {});
  return { ok: true };
});
exports.removeFriend = onCall(CALLABLE, async req => {
  const uid = needAuth(req), other = requireId(req.data?.uid);
  await db.collection('friendships').doc(directId(uid, other)).delete();
  return { ok: true };
});
exports.openDirectChat = onCall(CALLABLE, async req => {
  const uid = needAuth(req), other = requireId(req.data?.uid);
  if (uid === other || await isBlocked(uid, other)) throw new HttpsError('permission-denied', 'Conversation non autorisée.');
  const id = directId(uid, other), friend = await db.collection('friendships').doc(id).get();
  if (!friend.exists) throw new HttpsError('permission-denied', 'Vous devez être amis pour discuter.');
  await db.collection('directChats').doc(id).set({ members: [uid, other].sort(), updatedAt: FieldValue.serverTimestamp() }, { merge: true });
  return { chatId: id };
});
const MEDIA = { image: { types: ['image/jpeg', 'image/png', 'image/webp'], max: 8*1024*1024 }, video: { types: ['video/mp4', 'video/webm', 'video/quicktime'], max: 25*1024*1024 }, audio: { types: ['audio/webm', 'audio/mp4', 'audio/mpeg', 'audio/ogg'], max: 10*1024*1024 } };
exports.sendChatMessage = onCall(CALLABLE, async req => {
  const uid = needAuth(req), d = req.data || {}, scope = d.scope, id = requireId(d.id);
  const chat = scope === 'group' ? await getGroupFor(uid, id) : scope === 'direct' ? await getChatFor(uid, id) : null;
  if (!chat) throw new HttpsError('invalid-argument', 'Conversation invalide.');
  if (scope === 'group' && chat.data.archived) throw new HttpsError('failed-precondition', 'Groupe archivé.');
  if (scope === 'direct' && await isBlocked(chat.data.members[0], chat.data.members[1])) throw new HttpsError('permission-denied', 'Conversation bloquée.');
  const text = d.text == null ? '' : String(d.text).trim();
  if (text.length > 2000 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(text)) throw new HttpsError('invalid-argument', 'Message trop long ou invalide.');
  const type = d.type || 'text';
  if (!['text', 'image', 'video', 'audio'].includes(type)) throw new HttpsError('invalid-argument', 'Type de message invalide.');
  if (type === 'text' && !text) throw new HttpsError('invalid-argument', 'Message vide.');
  let mediaPath = null;
  if (type !== 'text') {
    const basename = String(d.file || '');
    if (!/^[a-zA-Z0-9_-]{12,80}\.(jpg|png|webp|mp4|webm|mov|mp3|m4a|ogg)$/.test(basename)) throw new HttpsError('invalid-argument', 'Fichier invalide.');
    mediaPath = `chat/${scope}/${id}/${uid}/${basename}`;
    const [metadata] = await admin.storage().bucket().file(mediaPath).getMetadata().catch(() => { throw new HttpsError('failed-precondition', 'Fichier non transféré.'); });
    const opt = MEDIA[type];
    if (!opt.types.includes(metadata.contentType) || Number(metadata.size) > opt.max) throw new HttpsError('invalid-argument', 'Fichier non autorisé.');
  }
  await throttle(uid, 'messages', 700);
  const profile = await db.collection('socialProfiles').doc(uid).get();
  const name = profile.exists ? profile.data().displayName : 'Membre';
  // Le message et la dernière activité sont publiés atomiquement. Une clé fournie
  // par le client rend la reprise après coupure réseau idempotente.
  const key = req.data?.clientRequestId;
  if (key != null && !/^[a-f0-9-]{16,64}$/i.test(String(key))) throw new HttpsError('invalid-argument', 'Identifiant de requête invalide.');
  const messageRef = key ? chat.ref.collection('messages').doc(`${uid}_${key}`) : chat.ref.collection('messages').doc();
  await db.runTransaction(async tx => {
    const previous = await tx.get(messageRef);
    if (previous.exists) {
      if (previous.data().uid !== uid) throw new HttpsError('permission-denied', 'Message déjà utilisé.');
      return;
    }
    tx.set(messageRef, { uid, name: name.slice(0,60), text, type, mediaPath, createdAt: FieldValue.serverTimestamp() });
    tx.set(chat.ref, { updatedAt: FieldValue.serverTimestamp() }, { merge: true });
  });
  return { ok: true, id: messageRef.id };
});
exports.createMoneyRequest = onCall(CALLABLE, async req => {
  const uid = needAuth(req), d = req.data || {}, scope = d.scope, id = requireId(d.id), debtorUid = requireId(d.debtorUid);
  const cents = d.amountCents, currency = String(d.currency || 'EUR');
  if (debtorUid === uid || !Number.isSafeInteger(cents) || cents < 1 || cents > 100000000 || !/^[A-Z]{3}$/.test(currency)) throw new HttpsError('invalid-argument', 'Montant ou personne invalide.');
  const context = scope === 'group' ? await getGroupFor(uid, id) : scope === 'direct' ? await getChatFor(uid, id) : null;
  if (!context) throw new HttpsError('invalid-argument', 'Conversation invalide.');
  if (scope === 'group' && (context.data.archived || !context.data.memberIds.includes(debtorUid))) throw new HttpsError('permission-denied', 'Débiteur absent du groupe.');
  if (scope === 'direct' && (!context.data.members.includes(debtorUid) || await isBlocked(uid, debtorUid))) throw new HttpsError('permission-denied', 'Demande interdite.');
  if (scope === 'group' && context.data.currency !== currency) throw new HttpsError('invalid-argument', 'Devise du groupe différente.');
  await throttle(uid, 'requests', 2000);
  const note = String(d.note || '').trim().slice(0,200);
  const key = d.clientRequestId;
  if (key != null && !/^[a-f0-9-]{16,64}$/i.test(String(key))) throw new HttpsError('invalid-argument', 'Identifiant de requête invalide.');
  const ref = key ? context.ref.collection('moneyRequests').doc(`${uid}_${key}`) : context.ref.collection('moneyRequests').doc();
  const message = context.ref.collection('messages').doc(`request_${ref.id}`);
  await db.runTransaction(async tx => {
    const previous = await tx.get(ref);
    if (previous.exists) {
      if (previous.data().creditorUid !== uid || previous.data().debtorUid !== debtorUid || previous.data().amountCents !== cents)
        throw new HttpsError('already-exists', 'Cette demande existe déjà avec un autre montant.');
      return;
    }
    let fromId = null, toId = null;
    if (scope === 'group') {
      const group = await tx.get(context.ref);
      if (!group.exists || group.data().archived || !group.data().memberIds.includes(uid) || !group.data().memberIds.includes(debtorUid))
        throw new HttpsError('permission-denied', 'Groupe inaccessible.');
      const members = await tx.get(context.ref.collection('members'));
      fromId = memberByUid(members, debtorUid)?.id;
      toId = memberByUid(members, uid)?.id;
      if (!fromId || !toId || fromId === toId)
        throw new HttpsError('failed-precondition', 'Les deux participants doivent être liés à un compte dans ce groupe.');
      const outstanding = await outstandingLimit(context.ref, fromId, toId, tx);
      if (cents > outstanding)
        throw new HttpsError('failed-precondition', 'La demande dépasse la dette actuellement due. Consulte les Soldes du groupe.');
    }
    tx.set(ref, { creditorUid: uid, debtorUid, amountCents: cents, currency, note, status: 'pending',
      ...(scope === 'group' ? {fromId, toId} : {}),
      createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() });
    tx.set(message, { uid, name: 'Kortiz', text: '', type: 'request', requestId: ref.id, createdAt: FieldValue.serverTimestamp() });
    if (scope === 'direct') tx.set(context.ref, { updatedAt: FieldValue.serverTimestamp() }, { merge: true });
  });
  await pushRecipient(debtorUid,'moneyRequests',{title:'Kortiz',body:'Nouvelle demande de remboursement',url:scope==='group'?`/#/g/${id}/chat`:`/#/dm/${id}`,tag:`money-${id}`},scope==='group'?id:null);
  return { id: ref.id };
});
exports.updateMoneyRequest = onCall(CALLABLE, async req => {
  const uid = needAuth(req), { scope, action } = req.data || {}, id = requireId(req.data?.id), rid = requireId(req.data?.requestId);
  const chat = scope === 'group' ? await getGroupFor(uid, id) : scope === 'direct' ? await getChatFor(uid, id) : null;
  if (!chat) throw new HttpsError('invalid-argument', 'Conversation invalide.');
  const ref = chat.ref.collection('moneyRequests').doc(rid);
  const notification=await db.runTransaction(async tx => {
    const group = scope === 'group' ? await tx.get(chat.ref) : null;
    if (scope === 'group' && (!group.exists || !group.data().memberIds.includes(uid)))
      throw new HttpsError('permission-denied', 'Groupe inaccessible.');
    const snap = await tx.get(ref); if (!snap.exists) throw new HttpsError('not-found', 'Demande absente.');
    const r = snap.data(); let status;
    const adminOfGroup = scope === 'group' && isAdmin(group.data(),uid);
    const isCreditor = uid === r.creditorUid;
    const isDebtor = uid === r.debtorUid;
    // La personne qui reçoit l'argent peut en confirmer la réception, même si
    // le débiteur est admin. Le débiteur ne valide JAMAIS son propre paiement.
    // Un admin tiers peut toujours confirmer une déclaration de paiement.
    const neutralAdmin = adminOfGroup && !isDebtor;
    if (scope === 'direct' && action === 'acknowledge' && isDebtor && r.status === 'pending') status = 'accepted';
    else if (scope === 'direct' && action === 'decline' && isDebtor && r.status === 'pending') status = 'declined';
    else if (action === 'mark_paid' && isDebtor && (r.status === 'pending' || r.status === 'accepted')) status = 'marked_paid';
    else if (action === 'confirm' && !isDebtor && (scope === 'group'
      ? (isCreditor && ['pending','marked_paid'].includes(r.status)) || (neutralAdmin && r.status === 'marked_paid')
      : isCreditor && ['pending','accepted','marked_paid'].includes(r.status))) status = 'confirmed';
    else if (action === 'reject' && !isDebtor && (scope === 'group' ? (isCreditor || neutralAdmin) : isCreditor) && r.status === 'marked_paid') status = 'pending';
    else if (action === 'cancel' && isCreditor && ['pending','accepted'].includes(r.status)) status = 'cancelled';
    else if (scope === 'group' && action === 'reconcile' && neutralAdmin && r.status === 'confirmed' && !r.accountedAt) status = 'confirmed';
    else throw new HttpsError('permission-denied', 'Changement de statut interdit.');
    if (scope === 'group' && status === 'confirmed') {
      if(!group.data().memberIds.includes(r.debtorUid) || !group.data().memberIds.includes(r.creditorUid))
        throw new HttpsError('failed-precondition','Demande devenue obsolète après un départ : consulte les dettes hors groupe.');
      // Migration compatible with legacy requests that did not store member IDs.
      const members = (!r.fromId || !r.toId) ? await tx.get(chat.ref.collection('members')) : null;
      const fromId = r.fromId || memberByUid(members,r.debtorUid)?.id;
      const toId = r.toId || memberByUid(members,r.creditorUid)?.id;
      if (!fromId || !toId || fromId === toId)
        throw new HttpsError('failed-precondition', 'Participants de la demande introuvables.');
      const settlementRef=chat.ref.collection('settlements').doc(`money_${rid}`);
      const existingSettlement=await tx.get(settlementRef);
      if(existingSettlement.exists) {
        if(existingSettlement.data().moneyRequestId!==rid)throw new HttpsError('already-exists','Écriture de remboursement déjà utilisée.');
        tx.update(ref,{accountedAt:FieldValue.serverTimestamp(),updatedAt:FieldValue.serverTimestamp()});
        return;
      }
      const remaining = await outstandingLimit(chat.ref, fromId, toId, tx);
      if (r.amountCents > remaining)
        throw new HttpsError('failed-precondition', 'La dette a changé : la demande ne peut plus être confirmée.');
      tx.create(settlementRef, {
        fromId, toId, amountCents:r.amountCents, date:new Date().toISOString().slice(0,10),
        createdBy:uid, createdByName:'Validation Kortiz', createdAt:FieldValue.serverTimestamp(), moneyRequestId:rid, paymentRequestId:rid,
      });
      tx.update(chat.ref, { updatedAt: FieldValue.serverTimestamp() });
    }
    tx.update(ref, { status, updatedAt: FieldValue.serverTimestamp(),
      ...(status === 'confirmed' ? {
        ...(action !== 'reconcile' ? { confirmedBy: uid, confirmedAt: FieldValue.serverTimestamp() } : {}),
        ...(scope === 'group' ? {accountedAt: FieldValue.serverTimestamp()} : {})
      } : {}) });
    return status==='confirmed'&&action==='confirm'&&scope==='direct' ? r.debtorUid : null;
  });
  if(notification)await pushRecipient(notification,'paymentConfirmations',{title:'Kortiz',body:'Paiement confirmé',url:`/#/dm/${id}`,tag:`confirmed-${id}`});
  return { ok: true };
});
// Derive outstanding transfers from committed expenses and confirmed settlements.
// This guards balances against invented or excessive reimbursement confirmations.
function serverTransfers(expenses, settlements, exitClaims = []) {
  return computeAvailableTransfers(expenses,settlements,exitClaims);
}
function touchesReimbursedParticipant(expense, settlementDocs) {
  const ids = new Set([...Object.keys(expense?.payers || {}), ...Object.keys(expense?.split || {})]);
  return settlementDocs.some(doc => {
    const payment = doc.data();
    return ids.has(payment.fromId) || ids.has(payment.toId);
  });
}
function touchesReservedDebt(expense, claims) {
  const ids = new Set([...Object.keys(expense?.payers||{}),...Object.keys(expense?.split||{})]);
  return claims.some(doc=>{
    const d=doc.data();
    return remainingClaim(d)>0 && (ids.has(d.fromId)||ids.has(d.toId));
  });
}
function memberByUid(snapshot, uid) {
  return snapshot.docs.find(doc => doc.data().uid === uid) || null;
}
async function outstandingLimit(groupRef, fromId, toId, tx) {
  const [expenses,settlements,exitClaims] = await Promise.all([
    tx?tx.get(groupRef.collection('expenses')):groupRef.collection('expenses').get(),
    tx?tx.get(groupRef.collection('settlements')):groupRef.collection('settlements').get(),
    tx?tx.get(groupRef.collection('exitDebts')):groupRef.collection('exitDebts').get(),
  ]);
  return serverTransfers(expenses,settlements,exitClaims).find(x=>x.fromId===fromId&&x.toId===toId)?.amount||0;
}
/** Save/delete/import expenses with full server validation before Firestore writes.
 * Tout membre d'un groupe peut ajouter une dépense, immédiatement prise en compte.
 * Seul un administrateur confirme le REMBOURSEMENT via respondGroupSettlement.
 * Le nom historique de la callable est conservé pour éviter une nouvelle Cloud Function.
 */
const expenseFields=new Set(['title','amountCents','paidBy','payers','split','splitMode','splitInput','category','date','note','recurring','recurringNext','receiptPath']);
function checkedExpense(gid,eid,raw,ids) {
  if(!raw || typeof raw!=='object' || Array.isArray(raw) || Object.keys(raw).some(k=>!expenseFields.has(k)))
    throw new HttpsError('invalid-argument','Champs de dépense non autorisés.');
  const str=(v,max)=>typeof v==='string'&&v.trim().length>0&&v.length<=max;
  const map=(v)=>v && typeof v==='object'&&!Array.isArray(v);
  if(!str(raw.title,120)||!Number.isSafeInteger(raw.amountCents)||raw.amountCents<1||raw.amountCents>100000000)
    throw new HttpsError('invalid-argument','Montant ou libellé invalide.');
  if(!map(raw.split)||!map(raw.payers)||Object.keys(raw.split).length<1||Object.keys(raw.split).length>50||Object.keys(raw.payers).length<1||Object.keys(raw.payers).length>50)
    throw new HttpsError('invalid-argument','Répartition invalide.');
  for(const d of [raw.split,raw.payers])for(const [id,v] of Object.entries(d))
    if(!ids.has(id)||!Number.isSafeInteger(v)||v<0||v>raw.amountCents)throw new HttpsError('invalid-argument','Montant ou participant invalide.');
  if(sumCents(raw.split)!==raw.amountCents||sumCents(raw.payers)!==raw.amountCents)
    throw new HttpsError('invalid-argument','Les paiements et les parts doivent totaliser le montant exact.');
  if(!['equal','shares','percent','exact'].includes(raw.splitMode)||!str(raw.paidBy,128)||!ids.has(raw.paidBy))
    throw new HttpsError('invalid-argument','Mode de répartition invalide.');
  if(raw.splitInput!=null&&(!map(raw.splitInput)||Object.keys(raw.splitInput).length>50))throw new HttpsError('invalid-argument','Parts invalides.');
  if(!str(raw.category,20)||typeof raw.note!=='string'||raw.note.length>500||!/^\d{4}-\d{2}-\d{2}$/.test(raw.date))
    throw new HttpsError('invalid-argument','Catégorie, date ou note invalide.');
  const [year,month,day]=raw.date.split('-').map(Number),stamp=new Date(Date.UTC(year,month-1,day));
  if(stamp.getUTCFullYear()!==year||stamp.getUTCMonth()+1!==month||stamp.getUTCDate()!==day)
    throw new HttpsError('invalid-argument','Date invalide.');
  if(raw.recurring!=null && (!map(raw.recurring)||!['weekly','monthly','yearly'].includes(raw.recurring.freq)||!Number.isInteger(raw.recurring.dayOfMonth)||raw.recurring.dayOfMonth<1||raw.recurring.dayOfMonth>31))
    throw new HttpsError('invalid-argument','Récurrence invalide.');
  if(raw.recurringNext!=null && (typeof raw.recurringNext!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(raw.recurringNext)))
    throw new HttpsError('invalid-argument','Prochaine date invalide.');
  if(raw.receiptPath!=null && raw.receiptPath!==`groups/${gid}/receipts/${eid}.jpg`)
    throw new HttpsError('invalid-argument','Chemin du justificatif invalide.');
  return { title:raw.title.trim(),amountCents:raw.amountCents,paidBy:raw.paidBy,payers:raw.payers,split:raw.split,
    splitMode:raw.splitMode,splitInput:raw.splitInput||{},category:raw.category,date:raw.date,note:raw.note,
    recurring:raw.recurring||null,recurringNext:raw.recurringNext||null,receiptPath:raw.receiptPath||null };
}
exports.approveGroupExpense = onCall(CALLABLE, async req => {
  const uid=needAuth(req),gid=requireId(req.data?.groupId);
  const operation=req.data?.operation;
  // v28: arrêter une récurrence sans toucher aux montants, aux répartitions,
  // à l'historique ou aux remboursements déjà confirmés.
  if(operation==='stopRecurring') {
    const eid=requireId(req.data?.expenseId),gref=db.collection('groups').doc(gid),eref=gref.collection('expenses').doc(eid);
    await db.runTransaction(async tx=>{
      const [group,expense]=await Promise.all([tx.get(gref),tx.get(eref)]);
      if(!group.exists||!group.data().memberIds.includes(uid)||group.data().archived)
        throw new HttpsError('permission-denied','Groupe inaccessible ou archivé.');
      if(!expense.exists)throw new HttpsError('not-found','Dépense introuvable.');
      if(expense.data().createdBy!==uid&&!isAdmin(group.data(),uid))
        throw new HttpsError('permission-denied','Gestion de la récurrence interdite.');
      if(!expense.data().recurringNext)return;
      tx.update(eref,{recurring:null,recurringNext:null,updatedAt:FieldValue.serverTimestamp()});
    });
    return {ok:true};
  }
  if(['save','delete','import'].includes(operation)) {
    const gref=db.collection('groups').doc(gid);
    if(operation==='import') {
      const batchId=String(req.data?.batchId||'');
      if(!/^[a-f0-9-]{16,64}$/i.test(batchId) || !Array.isArray(req.data?.items) || req.data.items.length<1 || req.data.items.length>30)
        throw new HttpsError('invalid-argument','Lot CSV invalide (30 dépenses maximum).');
      const offset=req.data?.offset;
      if(!Number.isInteger(offset)||offset<0||offset>10000)throw new HttpsError('invalid-argument','Décalage de lot invalide.');
      await db.runTransaction(async tx=>{
        const g=await tx.get(gref);
        if(!g.exists||!g.data().memberIds.includes(uid)||g.data().archived)throw new HttpsError('permission-denied','Groupe inaccessible.');
        const members=await tx.get(gref.collection('members')),ids=new Set(members.docs.map(x=>x.id));
        const refs=req.data.items.map((_,i)=>gref.collection('expenses').doc(`${uid}_${batchId}_${offset+i}`));
        const old=await tx.getAll(...refs);
        req.data.items.forEach((raw,i)=>{
          const clean=checkedExpense(gid,refs[i].id,raw,ids);
          if(!old[i].exists)tx.create(refs[i],{...clean,approvalStatus:'approved',createdBy:uid,createdByName:String(req.auth.token.name||'').slice(0,60),createdAt:FieldValue.serverTimestamp(),updatedAt:FieldValue.serverTimestamp()});
        });
        tx.update(gref,{updatedAt:FieldValue.serverTimestamp()});
      });
      return {ok:true,count:req.data.items.length};
    }
    const eid=requireId(req.data?.expenseId),ref=gref.collection('expenses').doc(eid);
    if(operation==='save') {
      // Le justificatif doit avoir été téléchargé par la même personne, ou
      // correspondre à un document ancien déjà attaché à cette dépense.
      await db.runTransaction(async tx=>{
        const [group,old]=await Promise.all([tx.get(gref),tx.get(ref)]);
        if(!group.exists||!group.data().memberIds.includes(uid)||group.data().archived)
          throw new HttpsError('permission-denied','Groupe inaccessible ou archivé.');
        const ids=new Set((await tx.get(gref.collection('members'))).docs.filter(x=>!x.data().leftAt).map(x=>x.id));
        const clean=checkedExpense(gid,eid,req.data?.expense,ids);
        if(clean.receiptPath && (!old.exists || old.data().receiptPath !== clean.receiptPath)) {
          const [metadata]=await admin.storage().bucket().file(clean.receiptPath).getMetadata()
            .catch(()=>{throw new HttpsError('failed-precondition','Justificatif introuvable.');});
          if(metadata.metadata?.ownerUid!==uid || metadata.contentType!=='image/jpeg' || Number(metadata.size)>2*1024*1024)
            throw new HttpsError('permission-denied','Justificatif non autorisé.');
        }
        if(old.exists) {
          const prev=old.data();
          if(prev.createdBy!==uid && !isAdmin(group.data(),uid))throw new HttpsError('permission-denied','Modification interdite.');
          if(prev.approvalStatus==='rejected' && !isAdmin(group.data(),uid))throw new HttpsError('permission-denied','Dépense rejetée : contacter un administrateur.');
          // Never rewrite financial history already used by a confirmed settlement.
          const [settlements,external]=await Promise.all([
            tx.get(gref.collection('settlements')),tx.get(gref.collection('exitDebts')),
          ]);
          if(touchesReservedDebt(prev,external.docs)||touchesReservedDebt(clean,external.docs))
            throw new HttpsError('failed-precondition','Dépense protégée : remboursement hors groupe encore ouvert.');
          if(touchesReimbursedParticipant(prev,settlements.docs) || touchesReimbursedParticipant(clean,settlements.docs))
            throw new HttpsError('failed-precondition','Modification bloquée : cette dépense concerne une personne avec un remboursement confirmé.');
          tx.update(ref,{...clean,approvalStatus:'approved',updatedBy:uid,updatedAt:FieldValue.serverTimestamp()});
        } else {
          if(req.data?.isNew!==true)throw new HttpsError('not-found','Dépense à modifier introuvable.');
          tx.create(ref,{...clean,approvalStatus:'approved',createdBy:uid,createdByName:String(req.auth.token.name||'').slice(0,60),createdAt:FieldValue.serverTimestamp(),updatedAt:FieldValue.serverTimestamp()});
        }
        tx.update(gref,{updatedAt:FieldValue.serverTimestamp()});
      });
      return {ok:true,id:eid};
    }
    await db.runTransaction(async tx=>{
      const [group,old]=await Promise.all([tx.get(gref),tx.get(ref)]);
      if(!group.exists||!group.data().memberIds.includes(uid)||!old.exists)throw new HttpsError('not-found','Dépense introuvable.');
      if(!isAdmin(group.data(),uid)&&old.data().createdBy!==uid)
        throw new HttpsError('permission-denied','Suppression réservée au créateur de la dépense ou à un administrateur.');
      const [settlements,external]=await Promise.all([
        tx.get(gref.collection('settlements')),tx.get(gref.collection('exitDebts')),
      ]);
      if(touchesReservedDebt(old.data(),external.docs))
        throw new HttpsError('failed-precondition','Suppression bloquée : une dette hors groupe est encore ouverte.');
      if(touchesReimbursedParticipant(old.data(),settlements.docs))
        throw new HttpsError('failed-precondition','Suppression bloquée : cette dépense est liée à un remboursement confirmé.');
      tx.delete(ref);tx.update(gref,{updatedAt:FieldValue.serverTimestamp()});
    });
    return {ok:true};
  }
  // Plus d'approbation des dépenses : elles sont enregistrées et comptées immédiatement.
  // Les remboursements sont confirmés par le bénéficiaire ou un admin non débiteur.
  throw new HttpsError('invalid-argument','Utiliser save, import ou delete pour une dépense.');
});
exports.requestGroupSettlement = onCall(CALLABLE, async req => {
  const uid = needAuth(req), d = req.data || {}, gid = requireId(d.groupId), { ref, data } = await getGroupFor(uid, gid);
  if (data.archived) throw new HttpsError('failed-precondition', 'Groupe archivé.');
  const cents = d.amountCents;
  if (!Number.isSafeInteger(cents) || cents < 1 || cents > 100000000) throw new HttpsError('invalid-argument', 'Montant invalide.');
  const fromId = requireId(d.fromId), toId = requireId(d.toId);
  if (fromId === toId) throw new HttpsError('invalid-argument', 'Participants identiques.');
  const [from,to] = await Promise.all([ref.collection('members').doc(fromId).get(), ref.collection('members').doc(toId).get()]);
  if (!from.exists || !to.exists || !from.data().uid || !to.data().uid) throw new HttpsError('failed-precondition', 'Les participants doivent avoir un compte.');
  if(from.data().leftAt || to.data().leftAt || !data.memberIds.includes(from.data().uid) || !data.memberIds.includes(to.data().uid))
    throw new HttpsError('failed-precondition','Un participant a quitté le groupe : utilise le suivi des remboursements après départ.');
  if (!isAdmin(data,uid) && uid !== from.data().uid && uid !== to.data().uid) throw new HttpsError('permission-denied', 'Opération interdite.');
  const max=await outstandingLimit(ref,fromId,toId);
  if(cents>max)throw new HttpsError('failed-precondition','Le remboursement dépasse la dette encore due.');
  await throttle(uid, 'settlements', 2000);
  const key = d.clientRequestId;
  if (key != null && !/^[a-f0-9-]{16,64}$/i.test(String(key))) throw new HttpsError('invalid-argument', 'Identifiant de requête invalide.');
  const p = key ? ref.collection('paymentRequests').doc(`${uid}_${key}`) : ref.collection('paymentRequests').doc();
  await db.runTransaction(async tx => {
    const previous = await tx.get(p);
    if (previous.exists) {
      if (previous.data().requestedBy !== uid || previous.data().amountCents !== cents || previous.data().fromId !== fromId || previous.data().toId !== toId)
        throw new HttpsError('already-exists', 'Cette déclaration existe déjà.');
      return;
    }
    tx.set(p, { fromId, toId, fromUid: from.data().uid, toUid: to.data().uid, amountCents: cents, status: uid === from.data().uid ? 'marked_paid' : 'pending', requestedBy: uid, createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() });
    tx.set(ref.collection('messages').doc(`settlement_${p.id}`), { uid, name: 'Kortiz', type: 'settlement', text:'', requestId:p.id, createdAt:FieldValue.serverTimestamp() });
  });
  await pushRecipient(to.data().uid,'moneyRequests',{title:'Kortiz',body:'Nouvelle demande de remboursement',url:`/#/g/${gid}/balances`,tag:`settlement-${gid}`},gid);
  return { id: p.id };
});
exports.respondGroupSettlement = onCall(CALLABLE, async req => {
  const uid = needAuth(req);
  if(req.data?.scope==='exitDebt') {
    const gid=requireId(req.data?.groupId),rid=requireId(req.data?.requestId),action=req.data?.action;
    const gref=db.collection('groups').doc(gid),ref=gref.collection('exitDebts').doc(rid);
    return db.runTransaction(async tx => {
      const [g,s]=await Promise.all([tx.get(gref),tx.get(ref)]);
      if(!g.exists || !s.exists)throw new HttpsError('not-found','Dette extérieure introuvable.');
      const claim=s.data(),member=g.data().memberIds.includes(uid),adminMember=member&&isAdmin(g.data(),uid);
      const debtor=uid===claim.fromUid, creditor=uid===claim.toUid;
      const neutralAdmin=adminMember&&!debtor;
      // Les anciens membres qui attendent leur argent conservent le droit
      // de confirmer sa réception ; le débiteur admin ne peut pas s'auto-valider.
      let status;
      if(action==='mark_paid' && debtor && claim.status==='pending')status='marked_paid';
      else if(action==='dispute' && debtor && ['pending','marked_paid'].includes(claim.status))status='disputed';
      else if(action==='resume' && (creditor||neutralAdmin) && claim.status==='disputed')status='pending';
      else if(action==='reject' && (creditor||neutralAdmin) && claim.status==='marked_paid')status='pending';
      else if(action==='confirm' && !debtor && (
        (creditor && ['pending','marked_paid'].includes(claim.status)) ||
        (neutralAdmin && claim.status==='marked_paid')
      ))status='confirmed';
      else throw new HttpsError('permission-denied','Action interdite ou statut déjà modifié.');
      const now=FieldValue.serverTimestamp();
      if(status==='confirmed') {
        // Settlement + outside-debt status are committed TOGETHER.
        const settlement=gref.collection('settlements').doc(`exit_${rid}`);
        const prev=await tx.get(settlement);
        if(prev.exists)throw new HttpsError('already-exists','Règlement déjà comptabilisé.');
        tx.create(settlement,{fromId:claim.fromId,toId:claim.toId,amountCents:claim.amountCents,
          date:new Date().toISOString().slice(0,10),createdBy:uid,createdByName:'Validation Kortiz',
          createdAt:now,exitDebtId:rid});
      }
      tx.update(ref,{status,updatedAt:now,
        ...(status==='confirmed'?{confirmedBy:uid,confirmedAt:now}:{}),
        ...(status==='disputed'?{disputedAt:now}:{}),
      });
      for(const participant of claim.participants||[])
        tx.update(db.collection('users').doc(participant).collection('exitDebts').doc(`${gid}_${rid}`),{
          status,updatedAt:now,...(status==='confirmed'?{confirmedAt:now}:{}),
        });
      tx.update(gref,{updatedAt:now});
      return {ok:true,status};
    });
  }
  const gid = requireId(req.data?.groupId), rid = requireId(req.data?.requestId), action = req.data?.action;
  const { ref } = await getGroupFor(uid, gid), pRef = ref.collection('paymentRequests').doc(rid);
  await db.runTransaction(async tx => {
    // Relire le groupe dans la transaction : droits d'admin et appartenance à jour.
    const [groupSnap, s] = await Promise.all([tx.get(ref),tx.get(pRef)]);
    if (!groupSnap.exists || !groupSnap.data().memberIds.includes(uid))
      throw new HttpsError('permission-denied', 'Tu ne fais plus partie de ce groupe.');
    if (!s.exists) throw new HttpsError('not-found', 'Déclaration introuvable.');
    const p = s.data(), group = groupSnap.data(); let status;
    const debtor = uid === p.fromUid, creditor = uid === p.toUid;
    const neutralAdmin = isAdmin(group,uid) && !debtor;
    // Le bénéficiaire peut confirmer sa réception sans être administrateur.
    // Les autres admins peuvent confirmer un paiement déclaré, sauf s'ils
    // sont eux-mêmes le débiteur. Personne ne valide son propre remboursement.
    if (action === 'mark_paid' && debtor && p.status === 'pending') status = 'marked_paid';
    else if (action === 'confirm' && !debtor && (
      (creditor && ['pending','marked_paid'].includes(p.status)) ||
      (neutralAdmin && p.status === 'marked_paid')
    )) status = 'confirmed';
    else if (action === 'reject' && (creditor || neutralAdmin) && p.status === 'marked_paid') status = 'rejected';
    else if (action === 'cancel' && uid === p.requestedBy && p.status === 'pending') status = 'cancelled';
    else throw new HttpsError('permission-denied', 'Seul le bénéficiaire ou un administrateur tiers peut confirmer le remboursement.');
    if (status === 'confirmed') {
      if(!group.memberIds.includes(p.fromUid)||!group.memberIds.includes(p.toUid))
        throw new HttpsError('failed-precondition','Déclaration devenue obsolète après un départ du groupe.');
      const limit=await outstandingLimit(ref,p.fromId,p.toId,tx);
      if(p.amountCents>limit)throw new HttpsError('failed-precondition','La dette a changé : déclaration à renouveler.');
      tx.update(ref,{updatedAt:FieldValue.serverTimestamp()}); // serialize competing confirmations
      tx.set(ref.collection('settlements').doc(), { fromId:p.fromId, toId:p.toId, amountCents:p.amountCents, date:new Date().toISOString().slice(0,10), createdBy:uid, createdByName:'Validation Kortiz', createdAt:FieldValue.serverTimestamp(), paymentRequestId:rid });
    }
    tx.update(pRef, { status, updatedAt:FieldValue.serverTimestamp(), ...(status === 'confirmed' ? { confirmedBy:uid,confirmedAt:FieldValue.serverTimestamp() } : status==='rejected'?{rejectedBy:uid,rejectedAt:FieldValue.serverTimestamp()}: {}) });
  });
  return { ok: true };
});
exports.cancelConfirmedSettlement = onCall(CALLABLE, async req => {
  const uid = needAuth(req), gid = requireId(req.data?.groupId), sid = requireId(req.data?.settlementId);
  const {ref,data} = await getGroupFor(uid,gid);
  if (!isAdmin(data,uid)) throw new HttpsError('permission-denied','Réservé aux administrateurs.');
  const sr = ref.collection('settlements').doc(sid);
  const snap = await sr.get(); if (!snap.exists) throw new HttpsError('not-found','Remboursement introuvable.');
  if (snap.data().paymentRequestId || snap.data().exitDebtId) throw new HttpsError('failed-precondition','Ce règlement est validé : correction via assistance nécessaire.');
  const claims=await ref.collection('exitDebts').get();
  if(claims.docs.some(c=>remainingClaim(c)>0 && [c.data().fromId,c.data().toId].some(mid=>[snap.data().fromId,snap.data().toId].includes(mid))))
    throw new HttpsError('failed-precondition','Cette modification changerait une dette hors groupe encore ouverte.');
  await sr.delete();
  return {ok:true};
});
exports.setGroupAdmin = onCall(CALLABLE, async req => {
  const uid = needAuth(req), gid = requireId(req.data?.groupId), other = requireId(req.data?.uid);
  const {ref,data} = await getGroupFor(uid,gid);
  if (data.createdBy !== uid || !data.memberIds.includes(other)) throw new HttpsError('permission-denied','Seul le créateur peut nommer un administrateur membre.');
  if (other === uid) throw new HttpsError('invalid-argument','Déjà créateur.');
  await ref.update({ adminIds: req.data.enabled === true ? FieldValue.arrayUnion(other) : FieldValue.arrayRemove(other) });
  return {ok:true};
});

exports.deleteChatMessage = onCall(CALLABLE, async req => {
  const uid=needAuth(req),d=req.data||{},id=requireId(d.id),mid=requireId(d.messageId);
  const chat=d.scope==='group'?await getGroupFor(uid,id):d.scope==='direct'?await getChatFor(uid,id):null;
  if(!chat)throw new HttpsError('invalid-argument','Conversation invalide.');
  const ref=chat.ref.collection('messages').doc(mid),snap=await ref.get();
  if(!snap.exists || snap.data().uid!==uid)throw new HttpsError('permission-denied','Message inaccessible.');
  const file=snap.data().mediaPath;
  await ref.update({text:'',mediaPath:null,type:'deleted',deletedAt:FieldValue.serverTimestamp()});
  if(file&&file.startsWith(`chat/${d.scope}/${id}/${uid}/`))await admin.storage().bucket().file(file).delete({ignoreNotFound:true}).catch(()=>{});
  return {ok:true};
});
exports.onGroupChatMessage = onDocumentCreated('groups/{gid}/messages/{mid}',async event=>{
  const m=event.data?.data();if(!m || !m.uid)return;
  await notifyMembers(event.params.gid,m.uid,(group,_mid,lang)=>({
    title:group.name,body:trans(lang,'Nouveau message dans le groupe','New group message','Nova mensagem no grupo','Nuevo mensaje en el grupo'),
  }),'groupMessages');
});
exports.onDirectChatMessage = onDocumentCreated('directChats/{cid}/messages/{mid}',async event=>{
  const m=event.data?.data();if(!m || !m.uid)return;
  const snap=await db.collection('directChats').doc(event.params.cid).get();
  if(!snap.exists)return;
  const to=snap.data().members.find(x=>x!==m.uid);if(!to)return;
  await pushRecipient(to,'directMessages',{title:m.name||'Kortiz',body:'Nouveau message privé',url:`/#/dm/${event.params.cid}`,tag:`dm-${event.params.cid}`});
});

exports.reportChatMessage = onCall(CALLABLE,async req=>{
  const uid=needAuth(req),d=req.data||{},id=requireId(d.id),mid=requireId(d.messageId);
  const context=d.scope==='group'?await getGroupFor(uid,id):d.scope==='direct'?await getChatFor(uid,id):null;
  if(!context)throw new HttpsError('invalid-argument','Conversation introuvable.');
  await throttle(uid,'reports',30000);
  const snap=await context.ref.collection('messages').doc(mid).get();
  if(!snap.exists || snap.data().uid===uid)throw new HttpsError('invalid-argument','Signalement invalide.');
  await db.collection('reports').add({reporterUid:uid,authorUid:snap.data().uid,scope:d.scope,
    conversationId:id,messageId:mid,reason:String(d.reason||'abuse').slice(0,120),
    createdAt:FieldValue.serverTimestamp(),status:'open'});
  return {ok:true};
});
