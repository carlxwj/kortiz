/* Kortiz — public contact form. No secret embedded: FormSubmit activation is required by the owner. */
(() => {
  'use strict';
  const EMAIL = 'carlxwj@gmail.com';
  const form = document.getElementById('contact-form');
  if (!form) return;
  const status = document.getElementById('contact-status');
  const button = document.getElementById('contact-submit');
  const fallback = document.getElementById('contact-fallback');
  const copyButton = document.getElementById('contact-copy-email');
  let pending = false;
  const t = s => window.KortizI18n?.translate?.(s) || s;
  const setStatus = (message, ok = false) => {
    status.textContent = t(message);
    status.classList.toggle('ok', !!ok);
    status.setAttribute('role', ok ? 'status' : 'alert');
  };
  const mailtoLink = values => {
    const subject = `Kortiz — ${values.topic}`;
    const body = [
      `Nom : ${values.name}`, `E-mail : ${values.email}`, `Sujet : ${values.topic}`,
      values.page ? `Page concernée : ${values.page}` : '', '', values.message
    ].join('\n');
    return `mailto:${EMAIL}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
  };
  copyButton?.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(EMAIL);
      setStatus('Adresse copiée.', true);
    } catch { setStatus('Copie indisponible. Adresse : ' + EMAIL); }
  });
  form.addEventListener('submit', async e => {
    e.preventDefault();
    if (pending) return;
    fallback.hidden = true;
    if (!form.checkValidity()) {
      form.reportValidity();
      setStatus('Merci de remplir correctement les champs obligatoires et de valider le consentement.');
      return;
    }
    // Anti-spam honeypot: never forward automated submissions.
    if (document.getElementById('contact-website').value.trim()) {
      setStatus('Le formulaire ne peut pas être envoyé.');
      return;
    }
    const values = Object.fromEntries(['name', 'email', 'topic', 'page', 'message'].map(key =>
      [key, String(form.elements.namedItem(key)?.value || '').trim()]));
    if (!values.name || !values.email || !values.topic || values.message.length < 20) {
      setStatus('Merci de préciser ton nom, ton e-mail, le sujet et un message suffisamment détaillé.');
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(values.email)) {
      setStatus('Vérifie ton adresse e-mail.');
      return;
    }
    const replyLink = mailtoLink(values);
    fallback.href = replyLink;
    pending = true;
    button.disabled = true;
    button.setAttribute('aria-busy', 'true');
    setStatus('Envoi en cours…', true);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    try {
      const endpoint = form.dataset.ajaxEndpoint;
      if (endpoint !== `https://formsubmit.co/ajax/${EMAIL}`) throw new Error('Invalid endpoint');
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {'Content-Type': 'application/json', 'Accept': 'application/json'},
        body: JSON.stringify({
          name: values.name,
          email: values.email,
          _replyto: values.email,
          _subject: `Kortiz — ${values.topic}`,
          _template: 'table',
          topic: values.topic,
          page: values.page || 'Non précisée',
          message: values.message,
          source: 'Kortiz /contact.html'
        }),
        signal: controller.signal,
        mode: 'cors',
        credentials: 'omit'
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = await response.json();
      // FormSubmit returns strings "true" or "false", including for HTTP 200 errors.
      const success = data?.success === true || data?.success === 'true';
      if (!success) {
        const message = String(data?.message || 'Envoi non confirmé.').slice(0, 300);
        if (/activation|activat|confirm/i.test(message)) {
          setStatus('Formulaire en attente d’activation : FormSubmit demande une confirmation de l’adresse Kortiz. Si aucun e-mail d’activation n’arrive, vérifie les spams et réessaie. Le message n’est pas encore transmis à Kortiz.');
        } else setStatus('L’envoi n’a pas été confirmé. Réessaie ou utilise ton application mail.');
        fallback.hidden = false;
        return;
      }
      setStatus('Ton message a été transmis au service de contact. Merci !', true);
      form.reset();
    } catch(err) {
      setStatus(err.name === 'AbortError'
        ? 'L’envoi prend trop de temps. Réessaie ou utilise ton application mail.'
        : 'Impossible de confirmer l’envoi. Vérifie ta connexion ou utilise ton application mail.');
      fallback.hidden = false;
    } finally {
      clearTimeout(timeout);
      pending = false;
      button.disabled = false;
      button.removeAttribute('aria-busy');
    }
  });
})();
