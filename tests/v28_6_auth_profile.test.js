'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const root=path.join(__dirname,'..');
const app=fs.readFileSync(path.join(root,'public/app.js'),'utf8');
const sw=fs.readFileSync(path.join(root,'public/firebase-messaging-sw.js'),'utf8');
const i18n=fs.readFileSync(path.join(root,'public/i18n.js'),'utf8');

test('guest sign-in unavailable; legacy anonymous upgrading remains available',()=>{
  assert.doesNotMatch(app,/signInAnonymously|auth-guest|loginGuest\(/);
  assert.match(app,/async function linkEmailAccount\(/);
  assert.match(app,/async function linkGoogleAccount\(/);
  assert.match(app,/ACT\["upgrade-email"\]/);
});

test('reset password form invokes Firebase with language and durable UI result',()=>{
  assert.match(app,/sendPasswordResetEmail\(auth,address\)/);
  assert.match(app,/auth\.languageCode=I18N\.language\(\)/);
  assert.match(app,/id="forgot-form"/);
  assert.match(app,/type="submit" form="forgot-form"/);
  assert.match(app,/ACT\['forgot-send'\]\(button\)/);
  assert.match(app,/id="fg-result" role="status"/);
  assert.match(app,/id="fg-err" role="alert"/);
});

test('legacy name and handle skip onboarding; new users without handle still complete it',()=>{
  const code=app.slice(app.indexOf('const hasExistingIdentity ='),app.indexOf('const normalizeHandle ='));
  const ctx=vm.createContext({S:{user:{uid:'old'},profile:{displayName:'Léa Martin'}},SOC:{self:{handle:'leamartin'}}});
  vm.runInContext(code+'\nthis.needsWelcomeGuide=needsWelcomeGuide;this.needsHandleSetup=needsHandleSetup;this.hasExistingIdentity=hasExistingIdentity;',ctx);
  assert.equal(ctx.hasExistingIdentity(),true);
  assert.equal(ctx.needsWelcomeGuide(),false);
  assert.equal(ctx.needsHandleSetup(),false);
  ctx.S.profile.onboardingDone=true;
  assert.equal(ctx.needsWelcomeGuide(),false);
  ctx.S.profile.onboardingDone=false;ctx.SOC.self.handle='';
  assert.equal(ctx.needsWelcomeGuide(),true);
  assert.equal(ctx.needsHandleSetup(),true);
});

test('Firestore profile read failure does not create or overwrite a profile',async()=>{
  const code=app.slice(app.indexOf('async function ensureProfile(user) {'),app.indexOf('async function saveProfile(patch) {'));
  let writes=0;
  const s={profile:null};
  const context=vm.createContext({db:{},auth:{currentUser:{uid:'user-a'}},S:s,
    doc:(_,c,id)=>`${c}/${id}`, getDoc:async()=>{throw Object.assign(new Error('offline'),{code:'unavailable'})},
    setDoc:async()=>{writes++}, console:{warn(){}}, pickColor:()=> '#123456',serverTimestamp:()=>0,
    I18N:{language:()=>'fr'},saveProfile:async()=>{}});
  vm.runInContext(code+'\nthis.ensureProfile=ensureProfile;',context);
  await assert.rejects(context.ensureProfile({uid:'user-a'}),{code:'unavailable'});
  assert.equal(writes,0);
  assert.equal(s.profile,null);
  // Only a successful confirmed 'not exists' query may create the profile.
  context.getDoc=async()=>({exists:()=>false});
  await context.ensureProfile({uid:'user-a',displayName:'Nouveau'});
  assert.equal(writes,1);
});

test('account switching resets profile and rejects stale loading completions',()=>{
  assert.match(app,/const version=\+\+authSessionVersion;/);
  assert.match(app,/stopAll\(\);stopSocial\(\);S\.user=user;S\.profileLoadError=null;S\.authReady=false;/);
  assert.match(app,/if\(version!==authSessionVersion \|\| auth\.currentUser\?\.uid!==user\.uid\)return;/);
  assert.match(app,/if\(myUid\(\)!==uid \|\| SOC\.activeUid!==uid\)return;/);
});

test('translated recovery guidance and updated service worker cache',()=>{
  for(const line of ['Tes données existantes ne sont pas modifiées. Vérifie ta connexion puis réessaie.','Si tu utilises Google pour te connecter, choisis « Continuer avec Google » : il n’y a pas de mot de passe Kortiz à réinitialiser.']) {
    const found=i18n.split('\n').find(s=>s.startsWith(JSON.stringify(line)+':'));
    assert.ok(found,`translation missing: ${line}`);
    for(const locale of ['en','pt','es'])assert.ok(found.includes('"'+locale+'"'));
  }
  assert.match(sw,/kortiz-v28-8-typographie-landing/);
});
