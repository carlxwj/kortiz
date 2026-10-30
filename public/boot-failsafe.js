/* Kortiz — démarrage de secours. Ne dépend PAS des modules Firebase.
 * Rend un problème de chargement visible plutôt que de laisser l’écran noir.
 */
(function () {
  'use strict';
  const messages = {
    fr: ['Kortiz ne parvient pas à démarrer', 'Le chargement prend plus de temps que prévu. Vérifie ta connexion puis réessaie. Si le problème persiste, désactive temporairement les extensions qui bloquent les scripts, puis recharge la page.', 'Réessayer', 'Voir la présentation de Kortiz'],
    en: ['Kortiz could not start', 'Loading is taking longer than expected. Check your connection and try again. If the issue persists, temporarily disable script-blocking extensions and reload the page.', 'Try again', 'View the Kortiz website'],
    pt: ['O Kortiz não conseguiu iniciar', 'O carregamento está a demorar mais do que o esperado. Verifica a ligação e tenta novamente. Se continuar, desativa temporariamente as extensões que bloqueiam scripts e atualiza a página.', 'Tentar novamente', 'Ver o site do Kortiz'],
    es: ['Kortiz no ha podido iniciarse', 'La carga está tardando demasiado. Comprueba tu conexión y vuelve a intentarlo. Si continúa el problema, desactiva temporalmente las extensiones que bloquean scripts y recarga la página.', 'Reintentar', 'Ver la web de Kortiz']
  };
  const language = function () {
    let lang = '';
    try { lang = localStorage.getItem('kortiz.language') || ''; } catch (_) { /* mode privé */ }
    if (!messages[lang]) lang = (navigator.language || 'fr').slice(0, 2).toLowerCase();
    return messages[lang] ? lang : 'fr';
  };
  const showStartupFailure = function () {
    const boot = document.getElementById('boot');
    if (!boot || boot.classList.contains('gone') || boot.classList.contains('boot-failed')) return;
    const t = messages[language()];
    const card = document.createElement('section');
    card.className = 'boot-error-card';
    card.setAttribute('role', 'alert');
    const heading = document.createElement('h1');
    heading.textContent = t[0];
    const detail = document.createElement('p');
    detail.textContent = t[1];
    const actions = document.createElement('div');
    actions.className = 'boot-error-actions';
    const retry = document.createElement('button');
    retry.type = 'button';
    retry.textContent = t[2];
    retry.addEventListener('click', function () { window.location.reload(); });
    const publicLink = document.createElement('a');
    publicLink.href = '/decouvrir.html';
    publicLink.textContent = t[3];
    actions.append(retry, publicLink);
    card.append(heading, detail, actions);
    boot.replaceChildren(card);
    boot.classList.add('boot-failed');
    console.warn('Kortiz: démarrage non terminé après 12 secondes. Vérifier la console et le chargement de /app.js.');
  };
  window.setTimeout(showStartupFailure, 12000);
})();
