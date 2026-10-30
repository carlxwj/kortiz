/* Kortiz v28 — Préférences publicitaires sans chargement de traceurs.
 * IMPORTANT : ne remplace PAS une CMP certifiée Google compatible TCF.
 * Les annonces AdSense restent techniquement désactivées jusqu'à sa configuration.
 */
(function () {
  'use strict';
  const KEY='kortiz.adsPreferences.v28';
  const data={
    fr:['Votre confidentialité','Kortiz utilise des données techniques pour l’authentification et la sécurité. Aucune annonce Google n’est activée à ce stade. Vous pouvez enregistrer votre préférence pour les futures publicités, qui nécessiteront une plateforme de consentement certifiée avant activation.','Refuser','Personnaliser','Accepter','Préférences publicitaires','Autoriser les publicités non essentielles à l’avenir','Ce choix ne charge pas de publicités et ne remplace pas la collecte du consentement par une CMP certifiée.','Enregistrer','Confidentialité','Modifier le choix publicitaire'],
    en:['Your privacy','Kortiz uses essential data for login and security. Google ads are currently disabled. You can record a preference for future ads, which will require a certified consent platform before activation.','Reject','Preferences','Accept','Advertising preferences','Allow optional ads in the future','This choice does not load ads and is not a substitute for a certified CMP.','Save','Privacy policy','Change advertising choice'],
    pt:['Sua privacidade','O Kortiz usa dados técnicos essenciais para autenticação e segurança. Os anúncios Google estão desativados. Você pode registrar sua preferência futura, sujeita a uma plataforma de consentimento certificada.','Recusar','Personalizar','Aceitar','Preferências de publicidade','Permitir anúncios opcionais no futuro','Esta escolha não carrega anúncios nem substitui uma CMP certificada.','Salvar','Privacidade','Alterar preferências de publicidade'],
    es:['Tu privacidad','Kortiz usa datos técnicos necesarios para acceder y proteger la cuenta. Los anuncios de Google están desactivados. Puedes guardar tu preferencia futura, sujeta a una plataforma de consentimiento certificada.','Rechazar','Personalizar','Aceptar','Preferencias publicitarias','Permitir anuncios opcionales en el futuro','Esta opción no carga anuncios ni sustituye una CMP certificada.','Guardar','Privacidad','Modificar preferencia publicitaria']
  };
  const lang=()=>{try{let v=localStorage.getItem('kortiz.language');return data[v]?v:(navigator.language||'fr').slice(0,2).toLowerCase() in data?(navigator.language||'fr').slice(0,2).toLowerCase():'fr';}catch{return 'fr';}};
  let open=false;
  const stored=()=>{try{return JSON.parse(localStorage.getItem(KEY)||'null');}catch{return null;}};
  function save(ads){try{localStorage.setItem(KEY,JSON.stringify({optionalAds:ads,recordedAt:new Date().toISOString()}));}catch{}render(false);}
  function render(show=true,preferences=false){
    document.getElementById('kortiz-consent')?.remove();
    if(!show){open=false;return;}
    open=true;
    const t=data[lang()];
    const root=document.createElement('section');root.id='kortiz-consent';
    root.setAttribute('role','dialog');root.setAttribute('aria-label',t[0]);
    root.innerHTML=`<div class="kc-card"><div class="kc-main"><strong>${t[0]}</strong><p>${t[1]}</p><a href="/legal.html#cookies" target="_blank" rel="noopener">${t[9]}</a></div>${preferences?`<label class="kc-pref"><input id="kc-opt" type="checkbox" ${stored()?.optionalAds?'checked':''}>${t[6]}</label><p class="kc-note">${t[7]}</p>`:''}<div class="kc-actions">${preferences?`<button type="button" data-kc="save">${t[8]}</button>`:`<button type="button" data-kc="reject">${t[2]}</button><button type="button" data-kc="prefs">${t[3]}</button><button type="button" data-kc="accept">${t[4]}</button>`}</div></div>`;
    document.body.append(root);
    root.addEventListener('click',event=>{
      const button=event.target.closest('[data-kc]');if(!button)return;
      const action=button.dataset.kc;
      if(action==='reject')save(false);else if(action==='accept')save(true);
      else if(action==='save')save(!!root.querySelector('#kc-opt')?.checked);
      else if(action==='prefs')render(true,true);
    });
  }
  window.KortizConsent={open:()=>render(true,true),read:stored};
  const ready=()=>{
    if(!stored())render();
    document.addEventListener('click',e=>{if(e.target.closest('[data-open-consent]')){e.preventDefault();render(true,true);}});
  };
  document.readyState==='loading'?document.addEventListener('DOMContentLoaded',ready):ready();
})();
