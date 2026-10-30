/* Kortiz v28 — conversion d'affichage uniquement, jamais d'écriture comptable. */
(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  if(root)root.KortizCurrency=api;
})(typeof window!=='undefined'?window:null,function(){
  'use strict';
  const DISPLAY_CURRENCIES=Object.freeze(['EUR','USD','GBP','CHF','CAD','AUD','BRL','MXN','TRY','PLN','CZK','SEK','NOK','DKK','ARS','CLP','COP','PEN','UYU','PYG','BOB','MAD','TND']);
  function validRates(input){
    if(!input||typeof input!=='object'||!/^\d{4}-\d{2}-\d{2}$/.test(input.date||''))return false;
    if(!input.rates||typeof input.rates!=='object')return false;
    return Object.entries(input.rates).every(([code,rate])=>/^[A-Z]{3}$/.test(code)&&Number.isFinite(rate)&&rate>0);
  }
  function convert(cents,from,to,rates){
    if(!Number.isSafeInteger(cents)||!/^[A-Z]{3}$/.test(from)||!/^[A-Z]{3}$/.test(to))return null;
    if(from===to)return cents;
    if(!validRates(rates))return null;
    const a=from==='EUR'?1:rates.rates[from],b=to==='EUR'?1:rates.rates[to];
    if(!a||!b)return null;
    const output=Math.round(cents*b/a);
    return Number.isSafeInteger(output)?output:null;
  }
  function summarize(groupBalances,to,rates){
    const result={net:0,get:0,owe:0,unavailable:[],converted:false};
    if(!Array.isArray(groupBalances))return result;
    // Convertir chaque solde de groupe individuellement pour préserver les signes.
    for(const item of groupBalances){
      const v=convert(item.net,item.currency,to,rates);
      if(v===null){result.unavailable.push(item.currency);continue;}
      result.net+=v;if(v>0)result.get+=v;else result.owe-=v;
      if(item.currency!==to)result.converted=true;
    }
    result.unavailable=[...new Set(result.unavailable)];
    return result;
  }
  return Object.freeze({DISPLAY_CURRENCIES,validRates,convert,summarize});
});
