/* ============================================================================
   Kortiz — service worker
   1) Notifications push (Firebase Cloud Messaging) en arrière-plan
   2) Cache « coquille » de l'app : démarrage instantané et utilisable hors-ligne
   ⚠️  Remplace les valeurs VOTRE_… par la même configuration que dans index.html.
   ============================================================================ */
importScripts('https://www.gstatic.com/firebasejs/10.14.1/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.14.1/firebase-messaging-compat.js');

firebase.initializeApp({
  apiKey: 'AIzaSyCYGaqv2n6JUJHCZRQ7qL3abNA8Df1ViMM',
  authDomain: 'kortiz-de19f.firebaseapp.com',
  projectId: 'kortiz-de19f',
  storageBucket: 'kortiz-de19f.firebasestorage.app',
  messagingSenderId: '722491820058',
  appId: '1:722491820058:web:a415d27dc6a0e220f5e9a3',
});
const messaging = firebase.messaging();

// Les messages envoyés par la Cloud Function sont de type « data » : c'est ici qu'on affiche la notification.
messaging.onBackgroundMessage((payload) => {
  const d = payload.data || {};
  self.registration.showNotification(d.title || 'Kortiz', {
    body: d.body || '',
    icon: '/icon-192.png',
    badge: '/icon-192.png',
    tag: d.tag || undefined,
    data: { url: d.url || '/' },
  });
});
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const candidate = (event.notification.data && event.notification.data.url) || '/';
  const dest = new URL(candidate, self.location.origin);
  const url = dest.origin === self.location.origin ? dest.href : self.location.origin + '/';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      for (const c of list) { if ('focus' in c && new URL(c.url).origin === self.location.origin) { c.navigate(url); return c.focus(); } }
      return self.clients.openWindow(url);
    })
  );
});

/* ---------- Cache de l'app ---------- */
const CACHE = 'kortiz-v28-8-typographie-landing';
const SHELL = ['/', '/index.html', '/styles.css', '/app.js', '/landing-v23.js', '/landing-v23.css', '/design-v23.css', '/i18n.js', '/planning-logic.js', '/notification-logic.js', '/currency-logic.js', '/consent-v28.js', '/consent-v28.css', '/manifest.json', '/manifest-fr.json', '/manifest-en.json', '/manifest-pt.json', '/manifest-es.json', '/icon-192.png', '/icon-512.png', '/logo.svg', '/legal.html', '/legal.js', '/decouvrir.html', '/contact.html', '/contact.js'];
self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.pathname.startsWith('/__/')) return; // gestionnaire d'authentification Firebase : jamais intercepté
  if (url.origin === location.origin) {
    if (req.mode === 'navigate') { // Réseau d'abord, sans écraser l'app par une page publique.
      const pageKey = url.pathname === '/decouvrir.html' ? '/decouvrir.html'
        : url.pathname === '/legal.html' ? '/legal.html'
        : url.pathname === '/contact.html' ? '/contact.html' : '/index.html';
      e.respondWith(fetch(req).then((r) => {
        if (r.ok) { const cp = r.clone(); caches.open(CACHE).then((c) => c.put(pageKey, cp)); }
        return r;
      }).catch(() => caches.match(pageKey)));
      return;
    }
    e.respondWith(caches.match(req).then((hit) => {
      const net = fetch(req).then((r) => { if (r.ok) { const cp = r.clone(); caches.open(CACHE).then((c) => c.put(req, cp)); } return r; }).catch(() => hit);
      if (/\.(js|css)$/.test(url.pathname)) return net;
      return hit || net;
    }));
    return;
  }
  // SDK Firebase (gstatic) : mis en cache pour démarrer hors-ligne
  if (url.hostname === 'www.gstatic.com' && url.pathname.startsWith('/firebasejs/')) {
    e.respondWith(caches.match(req).then((hit) => hit || fetch(req).then((r) => { if (r.ok) { const cp = r.clone(); caches.open(CACHE).then((c) => c.put(req, cp)); } return r; })));
  }
});
