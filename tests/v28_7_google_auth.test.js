'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const root=path.join(__dirname,'..');
const app=fs.readFileSync(path.join(root,'public/app.js'),'utf8');
const i18n=fs.readFileSync(path.join(root,'public/i18n.js'),'utf8');
const sw=fs.readFileSync(path.join(root,'public/firebase-messaging-sw.js'),'utf8');
const firebase=fs.readFileSync(path.join(root,'firebase.json'),'utf8');

test('Google auth never enters third-party-storage redirect flow',()=>{
  assert.doesNotMatch(app,/\bsignInWithRedirect\b(?=\s*\()/);
  assert.doesNotMatch(app,/\bgetRedirectResult\b(?=\s*\()/);
  assert.doesNotMatch(app,/signInWithPopup,\s*signInWithRedirect/);
  assert.match(app,/async function loginGoogle\(\)\s*\{\s*await signInWithPopup\(auth, googleProvider\);\s*\}/);
  assert.match(firebase,/"hosting"/);
});

test('popup-blocked leaves sign up via email available, with explicit error',async()=>{
  const code=app.slice(app.indexOf('function authError(e) {'),app.indexOf('async function resetPassword(email) {'));
  let popupCalls=0;
  const context=vm.createContext({auth:{},GoogleAuthProvider:class {},signInWithPopup:async()=>{popupCalls++;throw {code:'auth/popup-blocked'};}});
  vm.runInContext(code+'\nthis.loginGoogle=loginGoogle;this.authError=authError;',context);
  await assert.rejects(context.loginGoogle(),{code:'auth/popup-blocked'});
  assert.equal(popupCalls,1);
  assert.match(context.authError({code:'auth/popup-blocked'}),/pop-ups/);
  assert.match(context.authError({code:'auth/operation-not-supported-in-this-environment'}),/navigateur intégré/);
  assert.match(context.authError({code:'auth/missing-initial-state'}),/interrompue/);
});

test('new popup messages translated in four languages and PWA cache bumped',()=>{
  for(const phrase of ['La fenêtre Google a été bloquée.','La connexion Google n\'est pas disponible','Le stockage de ce navigateur est désactivé.','La connexion Google a été interrompue']){
    const ln=i18n.split('\n').find(v=>v.startsWith('"'+phrase));
    assert.ok(ln,phrase);
    for(const lang of ['en','pt','es'])assert.ok(ln.includes('"'+lang+'"'),lang+' '+phrase);
  }
  assert.match(sw,/kortiz-v28-8-typographie-landing/);
  assert.match(app,/if \(S\.authBusy\) return;/);
  assert.match(app,/data-act="auth-google" \$\{S\.authBusy\?'disabled':''\}/);
});
