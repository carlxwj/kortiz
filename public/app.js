
/* ==========================================================================
   SECTION 1 — CONFIGURATION FIREBASE
   ⚠️  Remplace les valeurs « VOTRE_… » par celles de ta console Firebase
       (Paramètres du projet → Vos applications → Application Web → Configuration du SDK).
   ========================================================================== */
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js";
import { initializeAppCheck, ReCaptchaEnterpriseProvider } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-app-check.js";
import {
  getAuth, onAuthStateChanged, signInWithEmailAndPassword, createUserWithEmailAndPassword,
  signInWithPopup, GoogleAuthProvider, EmailAuthProvider,
  linkWithCredential, linkWithPopup, sendPasswordResetEmail, updateProfile, signOut,
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js";
import {
  initializeFirestore, persistentLocalCache, persistentMultipleTabManager, collection, doc, getDoc, getDocs,
  setDoc, updateDoc, deleteDoc, writeBatch, onSnapshot, query, where, orderBy, limit, startAfter, FieldPath,
  serverTimestamp, Timestamp, arrayUnion, arrayRemove,
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";
import { getStorage, ref as sref, uploadBytes, getDownloadURL, deleteObject } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-storage.js";
import { getFunctions, httpsCallable } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-functions.js";
import { getMessaging, getToken, deleteToken, onMessage, isSupported as messagingSupported } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-messaging.js";

// Configuration du projet Firebase existant. Garder la configuration du projet déployé.
const firebaseConfig = {
  apiKey: "AIzaSyCYGaqv2n6JUJHCZRQ7qL3abNA8Df1ViMM",
  authDomain: "kortiz-de19f.firebaseapp.com",
  projectId: "kortiz-de19f",
  storageBucket: "kortiz-de19f.firebasestorage.app",
  messagingSenderId: "722491820058",
  appId: "1:722491820058:web:a415d27dc6a0e220f5e9a3",
};
// Clé « Web Push » : console Firebase → Paramètres → Cloud Messaging → Certificats Web Push → Générer une paire de clés
const VAPID_KEY = "BH5Kd2M2Y9Qb40SafJcsUkKtKqTvEDlo4_48_Q1yXWlLrQckyBvZ-4afJCOqnGBDiKYzvEGO_OdYOQwF7I4tgoM";
// Clé de site reCAPTCHA Enterprise (Fraud Defense) pour App Check : la même que dans console Firebase → App Check → ton app Web
const APPCHECK_SITE_KEY = "6Lfu4O0tAAAAADVXeNfPT4kOLG-2BscE1QK3qKVn";
const FUNCTIONS_REGION = "europe-west1";
// Fin de la configuration du projet.

const CONFIG_OK = !/^VOTRE_/.test(firebaseConfig.apiKey);
const APP_NAME = "Kortiz";
const I18N = window.KortizI18n;
const locale = () => I18N.locale();
const tr = (s) => I18N.translate(s);
const localePicker = (id) => `<div class="field" style="margin:8px 0"><select id="${id}" class="input" data-language-selector aria-label="${tr("Langue de l'application")}">${[['auto',"Selon l'appareil"],['fr','Français'],['en','English'],['pt','Português'],['es','Español']].map(([k,v])=>`<option value="${k}" ${I18N.setting()===k?'selected':''}>${tr(v)}</option>`).join('')}</select></div>`;
document.addEventListener('change', (e) => { if(e.target.matches('[data-language-selector]')) I18N.setLanguage(e.target.value); });

const app = initializeApp(firebaseConfig);
// App Check : prouve à Firebase que les requêtes viennent bien de ton site (anti-abus, anti-scripts).
if (!/^VOTRE_/.test(APPCHECK_SITE_KEY)) {
  initializeAppCheck(app, { provider: new ReCaptchaEnterpriseProvider(APPCHECK_SITE_KEY), isTokenAutoRefreshEnabled: true });
}
const auth = getAuth(app);
auth.languageCode = I18N.language();
// Persistance hors-ligne : l'app reste utilisable sans réseau, les écritures sont envoyées au retour de la connexion.
let db;
try {
  db = initializeFirestore(app, { localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }) });
} catch (e) {
  console.warn("Persistance hors-ligne indisponible :", e);
  db = initializeFirestore(app, {});
}
const storage = getStorage(app);
const functions = getFunctions(app, FUNCTIONS_REGION);
const call = (name, data) => httpsCallable(functions, name)(data).then((r) => r.data);
/* ==========================================================================
   SECTION 2 — LOGIQUE PURE
   Montants (centimes), répartition, soldes, remboursements minimaux, IBAN,
   QR SEPA (EPC), import CSV, générateur de QR code.
   Aucune dépendance au DOM ni à Firebase → testable sous Node.
   ========================================================================== */

const CATEGORIES = [
  { id: 'courses',   label: 'Courses',   icon: 'cart',    color: '#10b981' },
  { id: 'resto',     label: 'Resto',     icon: 'cup',     color: '#f59e0b' },
  { id: 'loyer',     label: 'Loyer',     icon: 'home',    color: '#6366f1' },
  { id: 'transport', label: 'Transport', icon: 'car',     color: '#0ea5e9' },
  { id: 'loisirs',   label: 'Loisirs',   icon: 'music',   color: '#ec4899' },
  { id: 'factures',  label: 'Factures',  icon: 'bolt',    color: '#eab308' },
  { id: 'autre',     label: 'Autre',     icon: 'receipt', color: '#64748b' },
];
const catById = (id) => CATEGORIES.find((c) => c.id === id) || CATEGORIES[CATEGORIES.length - 1];

const GROUP_TYPES = [
  { id: 'kot',     label: 'Kot / coloc', emoji: '🏠' },
  { id: 'voyage',  label: 'Voyage',      emoji: '✈️' },
  { id: 'sortie',  label: 'Sortie',      emoji: '🍻' },
  { id: 'autre',   label: 'Autre',       emoji: '🧾' },
];

const AVATAR_COLORS = ['#f43f5e', '#f97316', '#eab308', '#22c55e', '#14b8a6', '#0ea5e9', '#6366f1', '#a855f7', '#ec4899', '#64748b'];
const pickColor = (seed) => {
  let h = 0;
  for (const ch of String(seed)) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return AVATAR_COLORS[h % AVATAR_COLORS.length];
};

/* ---------- Petits utilitaires ---------- */
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const initials = (name) => {
  const p = String(name || '?').trim().split(/\s+/).filter(Boolean);
  return ((p[0]?.[0] || '?') + (p.length > 1 ? p[p.length - 1][0] : '')).toUpperCase();
};

/** Code d'invitation lisible : 8 caractères sans ambiguïté (pas de O/0/I/1). */
function genInviteCode() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const buf = new Uint32Array(8);
  globalThis.crypto.getRandomValues(buf);
  return Array.from(buf, (n) => alphabet[n % alphabet.length]).join('');
}
const normalizeCode = (s) => String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
const prettyCode = (c) => (c || '').replace(/^(.{4})(.{4})$/, '$1-$2');

/* ---------- Montants ---------- */

/** Saisie utilisateur ("12,5", "12.50", "1234") → centimes entiers, ou null si invalide. */
function parseAmountInput(str) {
  if (typeof str === 'number') return Number.isFinite(str) ? Math.round(str * 100) : null;
  let s = String(str ?? '').replace(/[\s\u00a0€$£R$]/g, '');
  // 1.234,56 et 1,234.56 sont tous deux compris, sans arrondir en flottant.
  if (s.includes(',') && s.includes('.')) s = s.lastIndexOf(',') > s.lastIndexOf('.') ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '');
  else if (/^\d{1,3}[,.]\d{3}$/.test(s)) s = s.replace(/[,.]/g, ''); // un séparateur + 3 chiffres : milliers
  else if ((s.match(/[,\.]/g) || []).length === 1) s = s.replace(',', '.');
  if (!/^\d*\.?\d{0,2}$/.test(s) || s === '' || s === '.') return null;
  const [i, d = ''] = s.split('.');
  return parseInt(i || '0', 10) * 100 + parseInt((d + '00').slice(0, 2), 10);
}
const centsToInput = (c) => (c / 100).toFixed(2).replace('.', locale().startsWith('en') ? '.' : ',');
function formatMoney(cents, cur = 'EUR') {
  try {
    return new Intl.NumberFormat(locale(), { style: 'currency', currency: cur }).format(cents / 100);
  } catch (e) {
    return (cents / 100).toFixed(2).replace('.', ',') + ' ' + cur;
  }
}

/* ---------- Dates (chaînes ISO yyyy-mm-dd, sans fuseau horaire) ---------- */
const z2 = (n) => String(n).padStart(2, '0');
function todayISO(d = new Date()) { return `${d.getFullYear()}-${z2(d.getMonth() + 1)}-${z2(d.getDate())}`; }
const daysInMonth = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate(); // m = 1..12

/** Date suivante d'une dépense récurrente. dom = jour du mois d'origine (pour ne pas "glisser" après un 28 février). */
function addPeriod(iso, freq, dom) {
  const [y, m, d] = iso.split('-').map(Number);
  if (freq === 'weekly') return new Date(Date.UTC(y, m - 1, d + 7)).toISOString().slice(0, 10);
  if (freq === 'yearly') return `${y + 1}-${z2(m)}-${z2(Math.min(dom || d, daysInMonth(y + 1, m)))}`;
  let ny = y, nm = m + 1;
  if (nm > 12) { nm = 1; ny++; }
  return `${ny}-${z2(nm)}-${z2(Math.min(dom || d, daysInMonth(ny, nm)))}`;
}

/* ---------- RÉPARTITION (centimes entiers, somme toujours exacte) ---------- */

/**
 * Méthode du plus fort reste : distribue `total` centimes proportionnellement à `weights`
 * (entiers ≥ 0). La somme du résultat vaut TOUJOURS exactement `total`.
 * 10,00 € / 3 → [334, 333, 333] (le reste va aux premiers, à égalité de reste).
 */
function allocate(total, weights) {
  const W = weights.reduce((a, b) => a + b, 0);
  if (W <= 0) throw new Error('Somme des poids nulle');
  const q = [], r = [];
  weights.forEach((w) => {
    const num = total * w;
    let k = Math.floor(num / W);
    while (k * W > num) k--;
    while ((k + 1) * W <= num) k++;
    q.push(k);
    r.push(num - k * W);
  });
  let left = total - q.reduce((a, b) => a + b, 0);
  const order = weights.map((_, i) => i).sort((a, b) => r[b] - r[a] || a - b);
  for (let i = 0; left > 0 && i < order.length; i++, left--) q[order[i]]++;
  return q;
}

/**
 * Répartit `totalCents` entre des participants.
 *  mode 'equal'   : entries = [{id}]
 *  mode 'shares'  : entries = [{id, value: nombre de parts (>0, décimales admises)}]
 *  mode 'percent' : entries = [{id, value: pourcentage}] — doit totaliser 100
 *  mode 'exact'   : entries = [{id, value: centimes}] — doit totaliser le montant
 * Retourne { ok:true, split:{id:centimes} } ou { ok:false, error }.
 */
function splitAmount(totalCents, mode, entries) {
  if (!Number.isInteger(totalCents) || totalCents <= 0) return { ok: false, error: 'Montant invalide.' };
  if (!entries || !entries.length) return { ok: false, error: 'Sélectionne au moins une personne.' };
  const ids = entries.map((e) => e.id);
  let parts;
  if (mode === 'equal') {
    parts = allocate(totalCents, ids.map(() => 1));
  } else if (mode === 'shares') {
    const w = entries.map((e) => Math.round(Number(e.value) * 100));
    if (w.some((x) => !(x > 0))) return { ok: false, error: 'Chaque part doit être positive.' };
    parts = allocate(totalCents, w);
  } else if (mode === 'percent') {
    const w = entries.map((e) => Math.round(Number(e.value) * 100)); // centièmes de %
    if (w.some((x) => !(x > 0))) return { ok: false, error: 'Chaque pourcentage doit être positif.' };
    if (w.reduce((a, b) => a + b, 0) !== 10000) return { ok: false, error: 'Les pourcentages doivent totaliser 100 %.' };
    parts = allocate(totalCents, w);
  } else if (mode === 'exact') {
    parts = entries.map((e) => e.value);
    if (parts.some((x) => !Number.isInteger(x) || x < 0)) return { ok: false, error: 'Montants invalides.' };
    const sum = parts.reduce((a, b) => a + b, 0);
    if (sum !== totalCents) return { ok: false, error: 'La somme des montants doit égaler le total.', diff: totalCents - sum };
  } else return { ok: false, error: 'Mode inconnu.' };
  const split = {};
  ids.forEach((id, i) => { split[id] = parts[i]; });
  return { ok: true, split };
}

/* ---------- SOLDES ---------- */

/** Soldes calculés à partir des dépenses et remboursements (jamais stockés). */
function computeBalances(memberIds, expenses, settlements) {
  const b = {};
  const get = (id) => (b[id] = b[id] || { paid: 0, owed: 0, sent: 0, received: 0, net: 0 });
  memberIds.forEach(get);
  for (const e of expenses) {
    const payers = e.payers && Object.keys(e.payers).length ? e.payers : e.paidBy ? { [e.paidBy]: e.amountCents } : {};
    for (const [id, c] of Object.entries(payers)) get(id).paid += c;
    for (const [id, c] of Object.entries(e.split || {})) get(id).owed += c;
  }
  for (const s of settlements) { get(s.fromId).sent += s.amountCents; get(s.toId).received += s.amountCents; }
  for (const id in b) b[id].net = b[id].paid - b[id].owed + b[id].sent - b[id].received;
  return b;
}

/**
 * Remboursement minimal : on sépare créanciers (solde > 0) et débiteurs (solde < 0),
 * puis on fait correspondre à chaque tour le plus gros débiteur au plus gros créancier.
 * Au plus (n − 1) virements.
 */
function minimalTransfers(balances) {
  const cred = [], deb = [];
  for (const id in balances) {
    const n = balances[id].net;
    if (n > 0) cred.push({ id, amt: n }); else if (n < 0) deb.push({ id, amt: -n });
  }
  const cmp = (a, b) => b.amt - a.amt || a.id.localeCompare(b.id);
  const out = [];
  while (cred.length && deb.length) {
    cred.sort(cmp); deb.sort(cmp);
    const c = cred[0], d = deb[0], x = Math.min(c.amt, d.amt);
    out.push({ from: d.id, to: c.id, amount: x });
    c.amt -= x; d.amt -= x;
    if (!c.amt) cred.shift();
    if (!d.amt) deb.shift();
  }
  return out;
}

/** Aperçu de l'argent à rembourser pour UNE dépense (pas les soldes du groupe). */
function previewExpenseTransfers(memberIds, payers, split) {
  return minimalTransfers(computeBalances(memberIds, [{ payers, split }], []));
}

/* ---------- Coordonnée Wero : simple information de destinataire, aucun paiement exécuté ---------- */
function normalizeWeroContact(value) {
  const raw = String(value ?? '').trim();
  if (raw.includes('@')) return raw.toLowerCase();
  return raw.replace(/[\s().-]/g, '');
}
function isValidWeroContact(value) {
  const v = normalizeWeroContact(value);
  if (!v || v.length > 254) return false;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v) || /^\+?[0-9]{7,15}$/.test(v);
}
function weroContactType(value) { return normalizeWeroContact(value).includes('@') ? 'E-mail' : 'Téléphone'; }

/* ---------- IBAN & QR SEPA (EPC) ---------- */
const cleanIban = (s) => String(s || '').replace(/[\s-]/g, '').toUpperCase();
const IBAN_LEN = { BE: 16, FR: 27, NL: 18, DE: 22, LU: 20, ES: 24, IT: 27, GB: 22, CH: 21, PT: 25, IE: 22, AT: 20 };
/** Validation IBAN : format, longueur par pays (si connue) et clé de contrôle modulo 97. */
function isValidIban(s) {
  const i = cleanIban(s);
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/.test(i)) return false;
  if (IBAN_LEN[i.slice(0, 2)] && IBAN_LEN[i.slice(0, 2)] !== i.length) return false;
  const r = i.slice(4) + i.slice(0, 4);
  let rem = 0;
  for (const ch of r) {
    const v = ch >= 'A' ? ch.charCodeAt(0) - 55 : Number(ch);
    rem = (rem * (v > 9 ? 100 : 10) + v) % 97;
  }
  return rem === 1;
}
const formatIban = (s) => cleanIban(s).replace(/(.{4})/g, '$1 ').trim();

/**
 * Charge utile du QR code de virement SEPA (norme EPC069-12, version 002, UTF-8, SCT).
 * Lignes : BCD / 002 / 1 / SCT / BIC / Nom / IBAN / EUR12.34 / Purpose / Réf. structurée / Communication
 */
function buildEpcPayload({ name, iban, amountCents, remittance, bic = '' }) {
  const lines = [
    'BCD', '002', '1', 'SCT',
    bic,
    String(name || '').trim().slice(0, 70),
    cleanIban(iban),
    amountCents > 0 ? 'EUR' + (amountCents / 100).toFixed(2) : '',
    '', '',
    String(remittance || '').replace(/\s+/g, ' ').trim().slice(0, 140),
  ];
  const text = lines.join('\n');
  if (new TextEncoder().encode(text).length > 331) throw new Error('Charge EPC trop longue');
  return text;
}

/* ---------- Import CSV (formats bancaires internationaux) ---------- */
function parseCSV(text) {
  text = String(text).replace(/^\uFEFF/, '');
  const sample = text.split(/\r?\n/).filter((l) => l.trim()).slice(0, 10);
  const score = { ';': 0, '\t': 0, ',': 0 };
  for (const line of sample) {
    let q = false;
    for (const ch of line) { if (ch === '"') q = !q; else if (!q && ch in score) score[ch]++; }
  }
  let delim = ';', best = -1;
  for (const k of [';', '\t', ',']) if (score[k] > best) { best = score[k]; delim = k; }
  const rows = [];
  let row = [], cell = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) {
      if (ch === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += ch;
    } else if (ch === '"') q = true;
    else if (ch === delim) { row.push(cell); cell = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(cell); cell = '';
      if (row.some((c) => c.trim() !== '')) rows.push(row);
      row = [];
    } else cell += ch;
  }
  row.push(cell);
  if (row.some((c) => c.trim() !== '')) rows.push(row);
  return { rows: rows.map((r) => r.map((c) => c.trim())), delimiter: delim };
}

/** Montant bancaire "-1.234,56", "12,50 EUR", "(45.20)" → centimes (négatif = débit) ou null. */
function parseLooseAmount(str) {
  let s = String(str ?? '').trim();
  if (!s) return null;
  let neg = false;
  if (/^\(.*\)$/.test(s)) { neg = true; s = s.slice(1, -1); }
  s = s.replace(/R\$/gi, '').replace(/\b(EUR|USD|BRL|MXN|ARS|CLP|COP|PEN|GBP|CAD|CHF|UYU|BOB|PYG|VES|CRC|GTQ|DOP)\b/gi, '').replace(/[\s\u00a0€$£]/g, '');
  if (s.endsWith('-')) { neg = true; s = s.slice(0, -1); }
  if (s.startsWith('-')) { neg = true; s = s.slice(1); } else if (s.startsWith('+')) s = s.slice(1);
  if (!/^[\d.,]+$/.test(s)) return null;
  const lc = s.lastIndexOf(','), ld = s.lastIndexOf('.');
  let dec = null;
  if (lc >= 0 && ld >= 0) dec = lc > ld ? ',' : '.';
  else if (lc >= 0) dec = ',';
  else if (ld >= 0) dec = (/\.\d{3}$/.test(s) || (s.match(/\./g) || []).length > 1) ? null : '.';
  let ip = s, dp = '';
  if (dec) { const idx = s.lastIndexOf(dec); ip = s.slice(0, idx); dp = s.slice(idx + 1); }
  ip = ip.replace(/[.,]/g, '');
  if (!/^\d*$/.test(ip) || !/^\d*$/.test(dp)) return null;
  const v = dp.length <= 2
    ? parseInt(ip || '0', 10) * 100 + parseInt((dp + '00').slice(0, 2), 10)
    : Math.round(Number(`${ip || '0'}.${dp}`) * 100);
  return neg ? -v : v;
}

/** "03/02/2025", "3-2-25", "2025-02-03", "20250203" → "2025-02-03" ou null. */
function parseBankDate(str) {
  const s = String(str ?? '').trim();
  const chk = (y, m, d) => {
    y = +y; m = +m; d = +d;
    const t = new Date(Date.UTC(y, m - 1, d));
    return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d ? `${y}-${z2(m)}-${z2(d)}` : null;
  };
  let m;
  if ((m = s.match(/^(\d{4})-(\d{2})-(\d{2})/))) return chk(m[1], m[2], m[3]);
  if ((m = s.match(/^(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{4})/))) {
    const us = locale().toLowerCase().endsWith('-us') && +m[1] <= 12 && +m[2] <= 31;
    return chk(m[3], us ? m[1] : m[2], us ? m[2] : m[1]);
  }
  if ((m = s.match(/^(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{2})$/))) {
    const us = locale().toLowerCase().endsWith('-us') && +m[1] <= 12 && +m[2] <= 31;
    return chk('20' + m[3], us ? m[1] : m[2], us ? m[2] : m[1]);
  }
  if ((m = s.match(/^(\d{4})(\d{2})(\d{2})$/))) return chk(m[1], m[2], m[3]);
  return null;
}

/** Détecte la ligne d'en-tête et les colonnes date / montant / description (mapping modifiable ensuite). */
function detectCsvLayout(rows) {
  const kw = /date|fecha|data|datum|montant|bedrag|amount|valor|valor\s+total|importe|libell|description|descri[cç][aã]o|descri[pç]ci[oó]n|omschrijving|comunica[cç][aã]o|concepto|communication|mededeling|nom|naam|valuta|devise|moeda/i;
  let h = 0;
  for (let i = 0; i < Math.min(rows.length, 15); i++) {
    const hits = rows[i].filter((c) => kw.test(c) && !/^[\d.,\-\s]+$/.test(c)).length;
    if (hits >= 2) { h = i; break; }
  }
  const header = rows[h] || [];
  const body = rows.slice(h + 1).filter((r) => r.length >= 2);
  const find = (...res) => { for (const re of res) { const i = header.findIndex((c) => re.test(c)); if (i >= 0) return i; } return -1; };
  const map = {
    date: find(/comptabilisation|boekingsdatum|ex[ée]cution|uitvoering/i, /^(date|datum|data|fecha)$/i, /date|datum|data|fecha/i),
    amount: find(/^(montant|bedrag|amount|valor|importe|quantia)$/i, /montant|bedrag|amount|valor|importe|total|somme/i),
    desc: find(/contrepartie|tegenpartij|^nom|^naam|libell|description|descrip|descri[cç][aã]o|conceito|concepto|omschrijving/i, /communication|comunica[cç][aã]o|mededeling|details|message|hist[oó]rico/i),
  };
  const col = (i) => body.slice(0, 50).map((r) => r[i] || '');
  const ratio = (i, fn) => { const v = col(i).filter((x) => x !== ''); return v.length ? v.filter((x) => fn(x) != null).length / v.length : 0; };
  const idx = header.map((_, i) => i);
  if (map.date < 0) { let best = 0; idx.forEach((i) => { const r = ratio(i, parseBankDate); if (r > best && r > 0.7) { best = r; map.date = i; } }); }
  if (map.amount < 0) { let best = 0; idx.forEach((i) => { if (i === map.date) return; const r = ratio(i, parseLooseAmount); if (r > best && r > 0.7) { best = r; map.amount = i; } }); }
  if (map.desc < 0) {
    let best = 0;
    idx.forEach((i) => {
      if (i === map.date || i === map.amount) return;
      const v = col(i).filter((x) => x && parseLooseAmount(x) == null && parseBankDate(x) == null);
      const avg = v.length ? v.reduce((a, x) => a + x.length, 0) / v.length : 0;
      if (avg > best) { best = avg; map.desc = i; }
    });
  }
  return { headerIndex: h, header, body, map };
}

/* ---------- Générateur de QR code (octets UTF-8, niveau de correction M, versions 1 à 13) ----------
   Implémentation compacte inspirée de l'algorithme de référence (ISO/IEC 18004).
   Capacité maximale : 331 octets, soit exactement la limite du QR EPC. */
const QR_ECC = { ecc: [-1, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26, 30, 22, 22], blocks: [-1, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5, 5, 8, 9] };
const qrRaw = (v) => {
  let r = (16 * v + 128) * v + 64;
  if (v >= 2) { const na = Math.floor(v / 7) + 2; r -= (25 * na - 10) * na - 55; if (v >= 7) r -= 36; }
  return r;
};
const qrDataCw = (v) => Math.floor(qrRaw(v) / 8) - QR_ECC.ecc[v] * QR_ECC.blocks[v];
const gfMul = (x, y) => { let z = 0; for (let i = 7; i >= 0; i--) { z = (z << 1) ^ ((z >>> 7) * 0x11d); z ^= ((y >>> i) & 1) * x; } return z; };
function rsDivisor(deg) {
  const res = Array(deg - 1).fill(0); res.push(1);
  let root = 1;
  for (let i = 0; i < deg; i++) {
    for (let j = 0; j < res.length; j++) { res[j] = gfMul(res[j], root); if (j + 1 < res.length) res[j] ^= res[j + 1]; }
    root = gfMul(root, 2);
  }
  return res;
}
function rsRemainder(data, div) {
  const res = div.map(() => 0);
  for (const b of data) { const f = b ^ res.shift(); res.push(0); div.forEach((c, i) => { res[i] ^= gfMul(c, f); }); }
  return res;
}

/** Texte → matrice de booléens (true = module sombre). */
function qrEncode(text) {
  const bytes = Array.from(new TextEncoder().encode(text));
  let ver = 1;
  for (; ver <= 13; ver++) if (4 + (ver <= 9 ? 8 : 16) + bytes.length * 8 <= qrDataCw(ver) * 8) break;
  if (ver > 13) throw new Error('Texte trop long pour le QR code');
  const bits = [];
  const push = (v, n) => { for (let i = n - 1; i >= 0; i--) bits.push((v >>> i) & 1); };
  push(4, 4); push(bytes.length, ver <= 9 ? 8 : 16); bytes.forEach((b) => push(b, 8));
  const cap = qrDataCw(ver) * 8;
  push(0, Math.min(4, cap - bits.length));
  push(0, (8 - (bits.length % 8)) % 8);
  for (let pad = 0xec; bits.length < cap; pad ^= 0xec ^ 0x11) push(pad, 8);
  const data = [];
  for (let i = 0; i < bits.length; i += 8) { let v = 0; for (let j = 0; j < 8; j++) v = (v << 1) | bits[i + j]; data.push(v); }

  // Correction d'erreurs Reed-Solomon + entrelacement des blocs
  const nb = QR_ECC.blocks[ver], eb = QR_ECC.ecc[ver], raw = Math.floor(qrRaw(ver) / 8);
  const nShort = nb - (raw % nb), shortLen = Math.floor(raw / nb), div = rsDivisor(eb);
  const blocks = [];
  for (let i = 0, k = 0; i < nb; i++) {
    const dat = data.slice(k, k + shortLen - eb + (i < nShort ? 0 : 1));
    k += dat.length;
    const ecc = rsRemainder(dat, div);
    if (i < nShort) dat.push(0);
    blocks.push(dat.concat(ecc));
  }
  const all = [];
  for (let i = 0; i < blocks[0].length; i++) blocks.forEach((blk, j) => { if (i !== shortLen - eb || j >= nShort) all.push(blk[i]); });

  // Dessin de la matrice
  const size = ver * 4 + 17;
  const m = Array.from({ length: size }, () => Array(size).fill(false));
  const fn = Array.from({ length: size }, () => Array(size).fill(false));
  const set = (x, y, d) => { m[y][x] = d; fn[y][x] = true; };
  for (let i = 0; i < size; i++) { set(6, i, i % 2 === 0); set(i, 6, i % 2 === 0); }
  const finder = (cx, cy) => {
    for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) {
      const d = Math.max(Math.abs(dx), Math.abs(dy)), x = cx + dx, y = cy + dy;
      if (x >= 0 && x < size && y >= 0 && y < size) set(x, y, d !== 2 && d !== 4);
    }
  };
  finder(3, 3); finder(size - 4, 3); finder(3, size - 4);
  const pos = [];
  if (ver > 1) {
    const n = Math.floor(ver / 7) + 2, step = Math.ceil((ver * 4 + 4) / (n * 2 - 2)) * 2;
    pos.push(6);
    for (let p = size - 7; pos.length < n; p -= step) pos.splice(1, 0, p);
  }
  pos.forEach((cy, i) => pos.forEach((cx, j) => {
    if ((i === 0 && j === 0) || (i === 0 && j === pos.length - 1) || (i === pos.length - 1 && j === 0)) return;
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) set(cx + dx, cy + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
  }));
  const getBit = (x, i) => ((x >>> i) & 1) !== 0;
  const formatBits = (mask) => {
    const d = (0 << 3) | mask; // niveau M = 00
    let rem = d;
    for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
    const bits = ((d << 10) | rem) ^ 0x5412;
    for (let i = 0; i <= 5; i++) set(8, i, getBit(bits, i));
    set(8, 7, getBit(bits, 6)); set(8, 8, getBit(bits, 7)); set(7, 8, getBit(bits, 8));
    for (let i = 9; i < 15; i++) set(14 - i, 8, getBit(bits, i));
    for (let i = 0; i < 8; i++) set(size - 1 - i, 8, getBit(bits, i));
    for (let i = 8; i < 15; i++) set(8, size - 15 + i, getBit(bits, i));
    set(8, size - 8, true);
  };
  formatBits(0); // réserve les zones (réécrites après choix du masque)
  if (ver >= 7) {
    let rem = ver;
    for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25);
    const bits = (ver << 12) | rem;
    for (let i = 0; i < 18; i++) { const c = getBit(bits, i), a = size - 11 + (i % 3), b = Math.floor(i / 3); set(a, b, c); set(b, a, c); }
  }
  // Placement des données en zigzag
  let bi = 0;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let vert = 0; vert < size; vert++) for (let j = 0; j < 2; j++) {
      const x = right - j, up = ((right + 1) & 2) === 0, y = up ? size - 1 - vert : vert;
      if (!fn[y][x] && bi < all.length * 8) { m[y][x] = getBit(all[bi >>> 3], 7 - (bi & 7)); bi++; }
    }
  }
  const applyMask = (mask) => {
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      let inv;
      switch (mask) {
        case 0: inv = (x + y) % 2 === 0; break;
        case 1: inv = y % 2 === 0; break;
        case 2: inv = x % 3 === 0; break;
        case 3: inv = (x + y) % 3 === 0; break;
        case 4: inv = (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0; break;
        case 5: inv = ((x * y) % 2) + ((x * y) % 3) === 0; break;
        case 6: inv = (((x * y) % 2) + ((x * y) % 3)) % 2 === 0; break;
        default: inv = (((x + y) % 2) + ((x * y) % 3)) % 2 === 0;
      }
      if (!fn[y][x] && inv) m[y][x] = !m[y][x];
    }
  };
  const penalty = () => {
    let res = 0;
    const addH = (len, h) => { if (h[0] === 0) len += size; h.pop(); h.unshift(len); };
    const count = (h) => {
      const n = h[1];
      const core = n > 0 && h[2] === n && h[3] === n * 3 && h[4] === n && h[5] === n;
      return (core && h[0] >= n * 4 && h[6] >= n ? 1 : 0) + (core && h[6] >= n * 4 && h[0] >= n ? 1 : 0);
    };
    const term = (color, len, h) => { if (color) { addH(len, h); len = 0; } len += size; addH(len, h); return count(h); };
    for (let pass = 0; pass < 2; pass++) {
      for (let a = 0; a < size; a++) {
        let color = false, run = 0; const h = [0, 0, 0, 0, 0, 0, 0];
        for (let b = 0; b < size; b++) {
          const v = pass === 0 ? m[a][b] : m[b][a];
          if (v === color) { run++; if (run === 5) res += 3; else if (run > 5) res++; }
          else { addH(run, h); if (!color) res += count(h) * 40; color = v; run = 1; }
        }
        res += term(color, run, h) * 40;
      }
    }
    for (let y = 0; y < size - 1; y++) for (let x = 0; x < size - 1; x++) {
      const c = m[y][x];
      if (c === m[y][x + 1] && c === m[y + 1][x] && c === m[y + 1][x + 1]) res += 3;
    }
    let dark = 0;
    m.forEach((r) => r.forEach((c) => { if (c) dark++; }));
    const total = size * size;
    res += (Math.ceil(Math.abs(dark * 20 - total * 10) / total) - 1) * 10;
    return res;
  };
  let bestMask = 0, bestPen = Infinity;
  for (let mask = 0; mask < 8; mask++) {
    applyMask(mask); formatBits(mask);
    const p = penalty();
    if (p < bestPen) { bestPen = p; bestMask = mask; }
    applyMask(mask);
  }
  applyMask(bestMask); formatBits(bestMask);
  return m;
}

/** Matrice → SVG (fond blanc, zone de silence de 4 modules). */
function qrToSvg(matrix, border = 4) {
  const n = matrix.length;
  let d = '';
  for (let y = 0; y < n; y++) {
    let x = 0;
    while (x < n) {
      if (!matrix[y][x]) { x++; continue; }
      let x2 = x; while (x2 < n && matrix[y][x2]) x2++;
      d += `M${x + border},${y + border}h${x2 - x}v1h-${x2 - x}z`;
      x = x2;
    }
  }
  const s = n + border * 2;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${s} ${s}" shape-rendering="crispEdges" role="img" aria-label="QR code de virement"><rect width="${s}" height="${s}" fill="#fff"/><path d="${d}" fill="#000"/></svg>`;
}

/* ==========================================================================
   SECTION 3 — DONNÉES : état global, écoutes temps réel, écritures
   Structure Firestore :
     users/{uid}                       profil (nom, couleur, IBAN, thème, jetons push)
     groups/{gid}                      groupe (memberIds = comptes connectés, code d'invitation…)
       members/{mid}                   participant : compte connecté (uid) OU « fantôme » (uid = null)
       expenses/{eid}                  dépense (montants en centimes entiers)
       settlements/{sid}               remboursements enregistrés
       activity/{aid}                  journal d'activité
   Les soldes ne sont JAMAIS stockés : ils sont recalculés ici à partir des dépenses et remboursements.
   ========================================================================== */

const S = {
  user: null, profile: null, authReady: false,
  groups: [], groupsReady: false, stores: new Map(),
  route: { name: "home" },
  ui: { q: "", cat: "", who: "", period: "", showFilters: false, expLimit: 30, statsPeriod: "all", archivedOpen: false, onboardStep: 1, publicScreen: "landing", publicReturn: "landing" },
  activity: { gid: null, live: [], older: [], last: null, hasMore: true, unsub: null, loading: false },
  unsubGroups: null, unsubExitDebts: null, exitDebts: [], exitDebtsReady: false, unsubGroupInvites: null, inviteOwner: null, groupInvites: [], installEvent: null,
};

/* ---------- Petits utilitaires ---------- */
const msOf = (t) => (t && t.toMillis ? t.toMillis() : typeof t === "number" ? t : Date.now());
const myUid = () => auth.currentUser?.uid || null;
const col = (gid, name) => collection(db, "groups", gid, name);
const myName = () => S.profile?.displayName || auth.currentUser?.displayName || (auth.currentUser?.isAnonymous ? tr("Invité") : tr("Moi"));
const online = () => navigator.onLine !== false;
const isIosDevice = () => /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const isStandaloneApp = () => window.matchMedia?.('(display-mode: standalone)')?.matches || navigator.standalone === true;
const WELCOME_KEY = 'kortiz.welcomeViewed.v2';
const welcomeViewed = () => { try { return localStorage.getItem(WELCOME_KEY) === '1'; } catch { return false; } };
const markWelcomeViewed = () => { try { localStorage.setItem(WELCOME_KEY, '1'); } catch {} };
// Les profils anciens possèdent déjà un nom et un pseudo, mais n'ont pas le
// marqueur onboardingDone ajouté dans une version plus récente. Ne jamais les
// renvoyer dans le formulaire de création pour cette seule raison.
const hasExistingIdentity = () => !!S.user && !!S.profile && !!SOC.self
  && !!String(S.profile.displayName || '').trim() && !!String(SOC.self.handle || '').trim();
const needsWelcomeGuide = () => !!S.profile && S.profile.onboardingDone !== true && !hasExistingIdentity();
const needsHandleSetup = () => !!S.user && !!S.profile && !!SOC.self && !String(SOC.self.handle || '').trim();
const normalizeHandle = (v = '') => String(v).trim().toLowerCase().replace(/^@/, '');
const validHandle = (v) => /^[a-z][a-z0-9_]{2,23}$/.test(v);


// Les gestionnaires d’actions sont nécessaires dès les préférences v28.
// Les déclarer avant le premier enregistrement des actions ACT[...].
const ACT = {}, INP = {}, CHG = {};

/* ---------- Badges de nouveautés : accusés de lecture privés par compte ---------- */
const NL = window.KortizNotifications;
const NOTIF = {
  uid:null, unsub:null, ready:false, reads:new Map(), bootstrapping:new Set(), saving:new Set(),
  groupMessages:new Map(), directMessages:new Map(), groupUnsubs:new Map(), directUnsubs:new Map(),
};
const notifDocId = (kind,id) => `${kind}_${id}`;
const notifPath = () => doc(db,'users',myUid());
const notifReadAt = (kind,id,field) => NOTIF.reads.get(notifDocId(kind,id))?.[field] || null;
const notifCount = (kind,id,field) => {
  if(!NOTIF.ready || !NOTIF.reads.has(notifDocId(kind,id)))return 0;
  const stamp=notifReadAt(kind,id,field);
  if(kind==='group' && field==='expenseReadAt') return NL.unread(S.stores.get(id)?.expenses,stamp,myUid(),'createdBy');
  return NL.unread((kind==='group'?NOTIF.groupMessages:NOTIF.directMessages).get(id),stamp,myUid(),'uid');
};
const notifGroupCount=(id)=>notifCount('group',id,'chatReadAt')+notifCount('group',id,'expenseReadAt');
const notifDmCount=(id)=>notifCount('direct',id,'chatReadAt');
const notifFriendsCount=()=>SOC.requests.filter(r=>r.status==='pending').length+
  SOC.direct.reduce((n,c)=>n+notifDmCount(c.id),0)+S.groupInvites.filter(i=>i.status==='pending').length;
const notifBadge=(count,extra='')=>count>0?`<span class="notif-pill ${extra}" aria-label="${count} ${tr('nouveautés')}">${NL.label(count)}</span>`:'';
function stopNotificationReads(){
  NOTIF.unsub?.();NOTIF.unsub=null;
  for(const stop of NOTIF.groupUnsubs.values())stop();
  for(const stop of NOTIF.directUnsubs.values())stop();
  NOTIF.uid=null;NOTIF.ready=false;NOTIF.reads.clear();NOTIF.bootstrapping.clear();NOTIF.saving.clear();
  NOTIF.groupMessages.clear();NOTIF.directMessages.clear();NOTIF.groupUnsubs.clear();NOTIF.directUnsubs.clear();
}
function startNotificationReads(uid){
  if(NOTIF.uid===uid)return;
  stopNotificationReads(); NOTIF.uid=uid;
  NOTIF.unsub=onSnapshot(doc(db,'users',uid),snap=>{
    if(NOTIF.uid!==uid)return;
    const values=snap.data()?.notificationReads||{};
    NOTIF.reads=new Map(Object.entries(values));NOTIF.ready=true;
    syncNotificationSubscriptions();markVisibleNotifications();scheduleRender();
  },e=>{console.warn('Kortiz unread state',e);NOTIF.ready=false;});
}
function initializeNotificationRead(kind,id){
  if(!NOTIF.ready || !myUid() || NOTIF.uid!==myUid())return;
  const key=notifDocId(kind,id);
  if(NOTIF.reads.has(key)||NOTIF.bootstrapping.has(key))return;
  NOTIF.bootstrapping.add(key);
  // Sur une première utilisation, les anciens messages/dépenses ne sont pas présentés comme nouveaux.
  const values=kind==='group'
    ? [new FieldPath('notificationReads',key,'chatReadAt'),serverTimestamp(),
       new FieldPath('notificationReads',key,'expenseReadAt'),serverTimestamp()]
    : [new FieldPath('notificationReads',key,'chatReadAt'),serverTimestamp()];
  updateDoc(notifPath(),...values).catch(e=>console.warn('Initialisation compteurs',e))
    .finally(()=>NOTIF.bootstrapping.delete(key));
}
function syncNotificationSubscriptions(){
  if(!NOTIF.ready || NOTIF.uid!==myUid())return;
  const groups=new Set(S.groups.map(g=>g.id));
  const directs=new Set(SOC.direct.map(c=>c.id));
  for(const [id,stop] of NOTIF.groupUnsubs){if(!groups.has(id)){stop();NOTIF.groupUnsubs.delete(id);NOTIF.groupMessages.delete(id);}}
  for(const [id,stop] of NOTIF.directUnsubs){if(!directs.has(id)){stop();NOTIF.directUnsubs.delete(id);NOTIF.directMessages.delete(id);}}
  for(const id of groups){
    if(!NOTIF.reads.has(notifDocId('group',id))){initializeNotificationRead('group',id);continue;}
    if(NOTIF.groupUnsubs.has(id))continue;
    const q=query(col(id,'messages'),orderBy('createdAt','desc'),limit(20));
    const stop=onSnapshot(q,snap=>{
      if(NOTIF.uid!==myUid())return;
      NOTIF.groupMessages.set(id,snap.docs.map(d=>({id:d.id,...d.data()})));
      if(S.route.name==='group'&&S.route.gid===id&&S.route.tab==='chat')markNotificationRead('group',id,'chatReadAt');
      scheduleRender();
    },e=>{if(e.code!=='permission-denied')console.warn('Unread group',e);});
    NOTIF.groupUnsubs.set(id,stop);
  }
  for(const id of directs){
    if(!NOTIF.reads.has(notifDocId('direct',id))){initializeNotificationRead('direct',id);continue;}
    if(NOTIF.directUnsubs.has(id))continue;
    const q=query(collection(db,'directChats',id,'messages'),orderBy('createdAt','desc'),limit(20));
    const stop=onSnapshot(q,snap=>{
      if(NOTIF.uid!==myUid())return;
      NOTIF.directMessages.set(id,snap.docs.map(d=>({id:d.id,...d.data()})));
      if(S.route.name==='direct'&&S.route.cid===id)markNotificationRead('direct',id,'chatReadAt');
      scheduleRender();
    },e=>{NOTIF.directMessages.delete(id);scheduleRender();if(e.code!=='permission-denied')console.warn('Unread direct',e);});
    NOTIF.directUnsubs.set(id,stop);
  }
}
function markNotificationRead(kind,id,field){
  if(NOTIF.uid!==myUid() || !NOTIF.ready || notifCount(kind,id,field)===0)return;
  const k=`${notifDocId(kind,id)}/${field}`;
  if(NOTIF.saving.has(k))return;
  NOTIF.saving.add(k);
  updateDoc(notifPath(),new FieldPath('notificationReads',notifDocId(kind,id),field),serverTimestamp())
    .catch(e=>console.warn('Marquer notification comme lue',e))
    .finally(()=>NOTIF.saving.delete(k));
}
function markVisibleNotifications(){
  if(S.route.name==='direct')markNotificationRead('direct',S.route.cid,'chatReadAt');
  if(S.route.name==='group'){
    if(S.route.tab==='chat')markNotificationRead('group',S.route.gid,'chatReadAt');
    if(S.route.tab==='expenses')markNotificationRead('group',S.route.gid,'expenseReadAt');
  }
}

function errMsg(e) {
  const c = e?.code || "";
  if (c.startsWith("functions/")) return e.message || "Le service est momentanément indisponible.";
  const map = {
    "permission-denied": "Action non autorisée.", unavailable: "Connexion indisponible. Réessaie dans un instant.",
    "not-found": "Élément introuvable.", "storage/unauthorized": "Envoi de la photo non autorisé.",
    "storage/canceled": "Envoi annulé.", "resource-exhausted": "Quota dépassé, réessaie plus tard.",
  };
  return map[c] || e?.message || "Une erreur est survenue.";
}
/** Lance une écriture sans bloquer l'interface : hors-ligne, la promesse ne se résout qu'au retour du réseau,
 *  mais Firestore met déjà à jour les écoutes locales (compensation de latence). */
function fire(p) { p.catch((e) => { console.error(e); toast(errMsg(e), "err"); }); return p; }

function authError(e) {
  const m = {
    "auth/invalid-email": "Adresse e-mail invalide.", "auth/user-not-found": "E-mail ou mot de passe incorrect.",
    "auth/wrong-password": "E-mail ou mot de passe incorrect.", "auth/invalid-credential": "E-mail ou mot de passe incorrect.",
    "auth/email-already-in-use": "Un compte existe déjà avec cet e-mail. Connecte-toi plutôt.",
    "auth/weak-password": "Mot de passe trop court (6 caractères minimum).",
    "auth/too-many-requests": "Trop de tentatives. Patiente quelques minutes ou réinitialise ton mot de passe.",
    "auth/network-request-failed": "Pas de connexion internet.", "auth/popup-closed-by-user": "", "auth/cancelled-popup-request": "",
    "auth/credential-already-in-use": "Ce compte existe déjà : déconnecte-toi puis connecte-toi avec.",
    "auth/provider-already-linked": "Ce compte est déjà lié.", "auth/operation-not-allowed": "Cette méthode de connexion n'est pas activée dans la console Firebase.",
    "auth/unauthorized-domain": "Ce domaine n'est pas autorisé dans Firebase Authentication (Paramètres → Domaines autorisés).",
    "auth/popup-blocked": "La fenêtre Google a été bloquée. Autorise les pop-ups pour Kortiz, puis réessaie, ou inscris-toi par e-mail.",
    "auth/operation-not-supported-in-this-environment": "La connexion Google n'est pas disponible dans ce navigateur intégré. Ouvre Kortiz dans Chrome, Firefox ou Safari, ou inscris-toi par e-mail.",
    "auth/web-storage-unsupported": "Le stockage de ce navigateur est désactivé. Ouvre Kortiz dans un navigateur normal et autorise les données du site.",
    "auth/missing-initial-state": "La connexion Google a été interrompue par le navigateur. Recharge Kortiz et réessaie en autorisant les pop-ups.",
    "auth/missing-password": "Saisis ton mot de passe.", "auth/missing-email": "Saisis ton adresse e-mail.",
    "auth/requires-recent-login": "Reconnecte-toi pour effectuer cette action.",
  };
  return e?.code in m ? m[e.code] : e?.message || "Connexion impossible.";
}

/* ---------- Authentification ---------- */
const googleProvider = new GoogleAuthProvider();
async function loginEmail(email, pw) { await signInWithEmailAndPassword(auth, email.trim(), pw); }
async function signupEmail(name, email, pw) {
  const cred = await createUserWithEmailAndPassword(auth, email.trim(), pw);
  if (name) await updateProfile(cred.user, { displayName: name.trim() });
  S.pendingName = name.trim();
}
// La redirection automatique est volontairement désactivée : sur web.app
// et avec l'authDomain firebaseapp.com, elle peut échouer lorsque les
// stockages tiers sont bloqués (état initial OAuth manquant). Le popup
// reste le chemin recommandé sans migration des URI OAuth existantes.
async function loginGoogle() {
  await signInWithPopup(auth, googleProvider);
}
async function resetPassword(email) {
  const address=String(email||'').trim();
  if(!address)throw {code:'auth/missing-email'};
  if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address)||address.length>254)throw {code:'auth/invalid-email'};
  // Le lien de réinitialisation est traité par Firebase Auth, sans stocker
  // aucun mot de passe ni faire intervenir le formulaire Contact.
  auth.languageCode=I18N.language();
  await sendPasswordResetEmail(auth,address);
}
/** Transforme le compte invité en vrai compte SANS perdre les données (même uid, linkWithCredential). */
async function linkEmailAccount(name, email, pw) {
  const cred = EmailAuthProvider.credential(email.trim(), pw);
  const res = await linkWithCredential(auth.currentUser, cred);
  if (name) await updateProfile(res.user, { displayName: name.trim() });
  await afterLink(name);
}
async function linkGoogleAccount() {
  try { await linkWithPopup(auth.currentUser, googleProvider); }
  catch (e) { if (e.code === "auth/popup-blocked") throw new Error("Autorise les fenêtres pop-up pour lier ton compte Google."); throw e; }
  await afterLink();
}
async function afterLink(name) {
  await auth.currentUser.reload();
  S.user = auth.currentUser;
  const patch = {};
  if (!S.profile?.displayName) patch.displayName = name || auth.currentUser.displayName || "";
  if (Object.keys(patch).length) await saveProfile(patch);
  scheduleRender();
}
async function doLogout() {
  stopAll(); stopSocial();
  await signOut(auth);
}

/* ---------- Profil ---------- */
async function ensureProfile(user) {
  const r = doc(db, "users", user.uid);
  let snap = null;
  try { snap = await getDoc(r); } catch (e) {
    // Ne JAMAIS prendre une erreur réseau/permissions pour un nouveau compte.
    // Cela affichait à tort le guide et pouvait créer un profil vide.
    console.warn("Lecture du profil impossible", e);
    throw e;
  }
  // Une lecture lente de l'ancien compte ne doit pas remplacer le compte actif.
  if(auth.currentUser?.uid!==user.uid)return;
  if (snap && snap.exists()) {
    S.profile = { id: user.uid, ...snap.data() };
  } else {
    const p = {
      displayName: S.pendingName || user.displayName || "", avatarColor: pickColor(user.uid), iban: "", shareIban: false, weroContact: "", shareWero: false,
      language: I18N.language(), fcmTokens: [], createdAt: serverTimestamp(),
    };
    // Ne pas simuler une création réussie si Firestore a rejeté l'écriture.
    await setDoc(r, p);
    S.profile = { id: user.uid, ...p };
  }
  // Ancien champ « theme » ignoré ; l'application reste sombre.
  if (S.profile.language !== I18N.language()) { saveProfile({ language: I18N.language() }).catch(console.warn); }
}
async function saveProfile(patch) {
  const uid = myUid();
  await setDoc(doc(db, "users", uid), { ...patch, updatedAt: serverTimestamp() }, { merge: true });
  S.profile = { ...S.profile, ...patch };
  if ("displayName" in patch || "avatarColor" in patch) syncMyMemberDocs();
  scheduleRender();
}
/** Recopie nom / couleur / IBAN (si partage activé) dans mes fiches « participant » de chaque groupe. */
async function syncMyMemberDocs() {
  const uid = myUid(); if (!uid || !S.profile) return;
  const p = S.profile, batch = writeBatch(db); let n = 0;
  for (const [gid, st] of S.stores) {
    const me = st.members.find((m) => m.uid === uid);
    if (!me) continue;
    // Never write SEPA/Wero copies here: saveSocialProfile(syncPaymentDetails) does
    // that atomically for every group, including groups not currently loaded.
    const want = { name: p.displayName || me.name, color: p.avatarColor || me.color };
    if (me.name !== want.name || me.color !== want.color) {
      batch.update(doc(col(gid, "members"), me.id), { ...want, updatedAt: serverTimestamp() }); n++;
    }
  }
  if (n) fire(batch.commit());
}

/* ---------- Écoutes temps réel ---------- */
function startExitDebtsListener(uid) {
  if(S.unsubExitDebts)S.unsubExitDebts();
  S.exitDebts=[];S.exitDebtsReady=false;
  S.unsubExitDebts=onSnapshot(collection(db,'users',uid,'exitDebts'),snap=>{
    S.exitDebts=snap.docs.map(d=>({id:d.id,...d.data()}))
      .sort((a,b)=>(a.status==='confirmed')-(b.status==='confirmed')||msOf(b.createdAt)-msOf(a.createdAt));
    S.exitDebtsReady=true;scheduleRender();
  },err=>{console.error('Dettes hors groupe',err);S.exitDebtsReady=true;toast(errMsg(err),'err');scheduleRender();});
}
// Invitations ciblées privées, lues uniquement par leur destinataire.
function startGroupInvites(uid){
  if(S.inviteOwner===uid && S.unsubGroupInvites)return;
  S.unsubGroupInvites?.();S.inviteOwner=uid;S.groupInvites=[];
  S.unsubGroupInvites=onSnapshot(
    query(collection(db,'users',uid,'groupInvites'),orderBy('createdAt','desc'),limit(80)),
    snap=>{if(myUid()!==uid)return;S.groupInvites=snap.docs.map(d=>({id:d.id,...d.data()}));scheduleRender();},
    e=>{console.warn('Invitations de groupe',e);toast(tr('Impossible de charger les invitations de groupe.'),'err');}
  );
}
const pendingGroupInvites=()=>S.groupInvites.filter(x=>x.status==='pending');
function groupInvitationsUI(){
  const invites=pendingGroupInvites();if(!invites.length)return '';
  return `<section class="group-invitations" aria-label="${tr('Invitations de groupe')}">
    <div class="section-title">${tr('Invitations de groupe')} ${notifBadge(invites.length)}</div>
    <div class="group-invitations-list">${invites.map(i=>{
      const expired=i.expiresAt?.toMillis?.()<Date.now();
      const sender=profileName(i.inviterUid);
      return `<article class="group-invite-card"><span class="group-invite-icon">${groupIcon(i.groupEmoji||'🏠')}</span>
        <div class="group-invite-details"><strong>${esc(i.groupName||tr('Groupe'))}</strong>
          <small>${esc(sender)} · ${tr(expired?'Invitation expirée':'T’invite à rejoindre son groupe')}</small></div>
        <div class="group-invite-actions">${expired?'':`<button class="btn brand sm" data-act="accept-group-invite" data-id="${esc(i.id)}">${tr('Rejoindre')}</button>`}
          <button class="btn soft sm" data-act="decline-group-invite" data-id="${esc(i.id)}">${tr('Refuser')}</button></div></article>`;
    }).join('')}</div></section>`;
}
function startGroupsListener(uid) {
  if (S.unsubGroups) S.unsubGroups();
  const q = query(collection(db, "groups"), where("memberIds", "array-contains", uid));
  S.unsubGroups = onSnapshot(q, (snap) => {
    S.groups = snap.docs.map((d) => ({ id: d.id, ...d.data() })).sort((a, b) => msOf(b.updatedAt || b.createdAt) - msOf(a.updatedAt || a.createdAt));
    S.groupsReady = true;
    const ids = new Set(S.groups.map((g) => g.id));
    S.groups.forEach((g) => ensureStore(g.id));
    for (const [id, st] of S.stores) if (!ids.has(id)) { st.unsubs.forEach((u) => u()); S.stores.delete(id); }
    syncNotificationSubscriptions();
    scheduleRender();
  }, (e) => { console.error(e); S.groupsReady = true; toast(errMsg(e), "err"); scheduleRender(); });
}

// Met à jour la coordonnée Wero après une adhésion (y compris approbation d'un participant existant).
// On ne publie jamais la coordonnée si l'utilisateur n'a pas explicitement activé le partage.
/** Une « boutique » par groupe : participants, dépenses et remboursements écoutés en direct.
 *  Avec la persistance hors-ligne, seuls les documents modifiés sont relus après la première synchronisation. */
function ensureStore(gid) {
  let st = S.stores.get(gid);
  if (st) return st;
  st = { gid, members: [], expenses: [], settlements: [], exitDebts: [], exitDebtsReady:false, paymentRequests: [], plans: [], plansReady: false, polls: [], pollsReady: false, pollError: null, ready: { m: false, e: false, s: false }, unsubs: [], v: 0, memo: null };
  const listen = (name, key, flag, sorter) => onSnapshot(col(gid, name), (snap) => {
    st[key] = snap.docs.map((d) => ({ id: d.id, ...d.data() })).sort(sorter);
    st.ready[flag] = true; st.v++;
    if(name==='expenses' && S.route.name==='group' && S.route.gid===gid && S.route.tab==='expenses')markNotificationRead('group',gid,'expenseReadAt');
    scheduleRender();
  }, (e) => { if (e.code !== "permission-denied") console.error(e); st.ready[flag] = true; scheduleRender(); });
  st.unsubs.push(listen("members", "members", "m", (a, b) => msOf(a.createdAt) - msOf(b.createdAt)));
  st.unsubs.push(listen("expenses", "expenses", "e", (a, b) => (b.date || "").localeCompare(a.date || "") || msOf(b.createdAt) - msOf(a.createdAt)));
  st.unsubs.push(listen("settlements", "settlements", "s", (a, b) => (b.date || "").localeCompare(a.date || "") || msOf(b.createdAt) - msOf(a.createdAt)));
  // Les dettes externes sont chargées seulement lorsque le groupe est ouvert.
  st.startExitDebts=()=>{
    if(st.unsubExitDebts)return;
    st.unsubExitDebts=onSnapshot(col(gid,'exitDebts'),snap=>{
      st.exitDebts=snap.docs.map(d=>({id:d.id,...d.data()}));st.exitDebtsReady=true;st.v++;scheduleRender();
    },err=>{console.error('Suivi des dettes du groupe',err);st.exitDebtsReady=true;scheduleRender();});
    st.unsubs.push(st.unsubExitDebts);
  };
  // Les déclarations de paiement ne sont nécessaires qu'à l'écran du groupe actif.
  // Sur un compte avec 20 groupes, cela évite 19 abonnements permanents.
  st.startPayments=()=>{
    if(st.unsubPayments)return;
    st.unsubPayments=listen("paymentRequests", "paymentRequests", "p", (a,b)=>msOf(b.createdAt)-msOf(a.createdAt));
    st.unsubs.push(st.unsubPayments);
  };
  // Les prévisions ne sont écoutées que lorsqu'un membre ouvre l'onglet dédié.
  st.startPlans = () => {
    if (st.unsubPlans) return;
    st.planError = null;
    st.unsubPlans = onSnapshot(col(gid, 'plannedExpenses'), snap => {
      st.planError = null;
      st.plans = snap.docs.map(d => ({id:d.id,...d.data()}))
        .sort((a,b) => (a.date || '9999').localeCompare(b.date || '9999') || msOf(b.createdAt)-msOf(a.createdAt));
      st.plansReady = true; st.v++; scheduleRender();
    }, e => { st.plansReady = true; st.planError = e?.code || 'unknown'; console.error('Prévisions :',e); scheduleRender(); });
    st.unsubs.push(st.unsubPlans);
  };
  // Sondages : abonnement seulement quand la page dédiée est ouverte.
  st.startPolls=()=>{
    if(st.unsubPolls)return;
    st.pollError=null;
    st.unsubPolls=onSnapshot(col(gid,'polls'),snap=>{
      st.polls=snap.docs.map(d=>({id:d.id,...d.data()})).sort((a,b)=>msOf(b.createdAt)-msOf(a.createdAt));
      st.pollsReady=true;st.pollError=null;st.v++;scheduleRender();
    },err=>{
      // Firestore arrête cet écouteur après une erreur fatale. Libérer la
      // référence permet au bouton « Réessayer » de réabonner le groupe.
      st.unsubPolls=null;
      st.pollsReady=true;st.pollError=err?.code||'unknown';
      console.error('Sondages',err);scheduleRender();
    });
    st.unsubs.push(st.unsubPolls);
  };
  S.stores.set(gid, st);
  return st;
}
const storeReady = (st) => st && st.ready.m && st.ready.e && st.ready.s;

/** Vue calculée d'un groupe (mémoïsée tant que les données ne changent pas). */
function groupInfo(gid) {
  const group = S.groups.find((g) => g.id === gid);
  const st = S.stores.get(gid);
  if (!group || !st) return null;
  const key = st.v + ":" + (group.updatedAt ? msOf(group.updatedAt) : 0);
  if (st.memo && st.memo.key === key) return st.memo.val;
  const memberMap = Object.fromEntries(st.members.map((m) => [m.id, m]));
  const ids = st.members.map((m) => m.id);
  const balances = computeBalances(ids, st.expenses.filter(e=>e.approvalStatus!=='rejected'), st.settlements);
  const reserved = Object.fromEntries(Object.entries(balances).map(([id,b])=>[id,{...b}]));
  for(const claim of st.exitDebts){
    if(!['pending','marked_paid','disputed'].includes(claim.status))continue;
    const amount=claim.amountCents;
    if(!Number.isSafeInteger(amount)||amount<=0||!reserved[claim.fromId]||!reserved[claim.toId])continue;
    reserved[claim.fromId].net+=amount;
    reserved[claim.toId].net-=amount;
  }
  // Les remboursements déjà réservés en dehors du groupe ne peuvent pas être proposés une seconde fois.
  const transfers = minimalTransfers(reserved).filter(t=>!memberMap[t.from]?.leftAt&&!memberMap[t.to]?.leftAt);
  const me = st.members.find((m) => m.uid === myUid()) || null;
  const total = st.expenses.filter(e=>e.approvalStatus!=='rejected').reduce((a, e) => a + e.amountCents, 0);
  const val = { group, st, members: st.members, memberMap, balances, availableBalances: reserved, transfers, me, total, ready: storeReady(st), expenses: st.expenses, settlements: st.settlements };
  st.memo = { key, val };
  return val;
}

function stopAll() {
  stopNotificationReads();
  S.unsubGroupInvites?.();S.unsubGroupInvites=null;S.inviteOwner=null;S.groupInvites=[];
  if (S.unsubGroups) S.unsubGroups();
  if (S.unsubExitDebts) S.unsubExitDebts();
  S.unsubExitDebts=null;S.exitDebts=[];S.exitDebtsReady=false;
  S.unsubGroups = null;
  for (const st of S.stores.values()) st.unsubs.forEach((u) => u());
  S.stores.clear(); S.groups = []; S.groupsReady = false;
  stopActivity();
  S.profile = null;
}

/* ---------- Journal d'activité (50 derniers en direct, le reste à la demande) ---------- */
function listenActivity(gid) {
  if (S.activity.gid === gid && S.activity.unsub) return;
  stopActivity();
  Object.assign(S.activity, { gid, live: [], older: [], last: null, hasMore: true, loading: true });
  const q = query(col(gid, "activity"), orderBy("createdAt", "desc"), limit(30));
  S.activity.unsub = onSnapshot(q, (snap) => {
    S.activity.live = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    if (!S.activity.older.length) { S.activity.last = snap.docs[snap.docs.length - 1] || null; S.activity.hasMore = snap.docs.length >= 30; }
    S.activity.loading = false; scheduleRender();
  }, (e) => { S.activity.loading = false; console.error(e); });
}
function stopActivity() { if (S.activity.unsub) S.activity.unsub(); Object.assign(S.activity, { gid: null, unsub: null, live: [], older: [], last: null, hasMore: true }); }
async function loadMoreActivity() {
  const a = S.activity; if (!a.last || a.loading) return;
  a.loading = true; scheduleRender();
  const snap = await getDocs(query(col(a.gid, "activity"), orderBy("createdAt", "desc"), startAfter(a.last), limit(30)));
  a.older.push(...snap.docs.map((d) => ({ id: d.id, ...d.data() })));
  a.last = snap.docs[snap.docs.length - 1] || a.last; a.hasMore = snap.docs.length >= 30; a.loading = false; scheduleRender();
}
function logAct(batch, gid, type, text, meta = {}) {
  // Les événements financiers doivent être consignés par le serveur après
  // vérification et non par un texte libre fourni depuis le navigateur.
  if (type.startsWith('expense_') || type.startsWith('settlement')) return;
  batch.set(doc(col(gid, "activity")), { type, text, meta, actorUid: myUid(), actorName: myName(), createdAt: serverTimestamp() });
}

/* ---------- Groupes ---------- */
function nextColor(members) {
  const used = new Set(members.map((m) => m.color));
  return AVATAR_COLORS.find((c) => !used.has(c)) || AVATAR_COLORS[members.length % AVATAR_COLORS.length];
}
function myMemberFields(color) {
  const p = S.profile || {};
  return { name: myName(), color: color || p.avatarColor || pickColor(myUid()), uid: myUid(), iban: p.shareIban === true ? cleanIban(p.iban) : "",
    weroContact: p.shareWero === true && isValidWeroContact(p.weroContact) ? normalizeWeroContact(p.weroContact) : "" };
}
/** Création du groupe avec le créateur uniquement. Les autres membres doivent
 * accepter eux-mêmes une invitation ciblée ou utiliser le code/lien. */
async function createGroup({ name, emoji, currency, type, budgetCents = null }) {
  const gid = doc(collection(db, "groups")).id, uid = myUid(), batch = writeBatch(db);
  batch.set(doc(db, "groups", gid), {
    name, emoji, currency, type, budgetCents, createdBy: uid, memberIds: [uid], inviteCode: genInviteCode(), archived: false,
    createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
  });
  batch.set(doc(col(gid, "members")), { ...myMemberFields(), createdAt: serverTimestamp() });
  logAct(batch, gid, "group_create", `${myName()} a créé le groupe « ${name} »`);
  await batch.commit();
  return gid;
}
function updateGroup(gid, patch, actText) {
  const batch = writeBatch(db);
  batch.update(doc(db, "groups", gid), { ...patch, updatedAt: serverTimestamp() });
  if (actText) logAct(batch, gid, "group_edit", actText);
  return fire(batch.commit());
}
function updateMember(gid, mid, patch) { return fire(updateDoc(doc(col(gid, "members"), mid), { ...patch, updatedAt: serverTimestamp() })); }
function memberIsUsed(gid, mid) {
  const st = S.stores.get(gid);
  return st.expenses.some((e) => (e.payers && mid in e.payers) || (e.split && mid in e.split)) || st.settlements.some((s) => s.fromId === mid || s.toId === mid);
}
function removeMember(gid, mid) {
  return call('joinGroup',{action:'removeMember',groupId:gid,memberId:mid});
}
function leaveGroup(gid) {
  if (!online()) throw new Error(tr('Une connexion Internet est nécessaire pour quitter un groupe en conservant les dettes.'));
  return call('joinGroup',{action:'leaveGroup',groupId:gid});
}
async function deleteGroupRemote(gid) { await call("deleteGroup", { groupId: gid }); }

/* ---------- Groupe de démonstration (1er lancement, supprimable) ---------- */
let seeding = false;
async function maybeSeedDemo() {
  if (seeding || !S.profile || S.profile.demoSeeded || S.groups.length || S.route.name === "join" || localStorage.getItem("pendingJoin")) return;
  seeding = true;
  try { await saveProfile({ demoSeeded: true }); createDemoGroup(); } catch (e) { console.warn("Démo non créée :", e); }
}
/** Un kot de 4 personnes avec quelques dépenses et un remboursement partiel : tout dans UN batch atomique. */
function createDemoGroup() {
  const gid = doc(collection(db, "groups")).id, uid = myUid(), batch = writeBatch(db);
  const ago = (d) => todayISO(new Date(Date.now() - d * 864e5));
  batch.set(doc(db, "groups", gid), { name: "Kot démo", emoji: "🏠", currency: "EUR", type: "kot", createdBy: uid, memberIds: [uid], inviteCode: genInviteCode(), archived: false, demo: true, createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
  const people = [{ ...myMemberFields() }, { name: "Julie", color: "#ec4899", uid: null, iban: "" }, { name: "Théo", color: "#14b8a6", uid: null, iban: "" }, { name: "Léa", color: "#f97316", uid: null, iban: "" }];
  const mids = people.map((p, i) => { const ref = doc(col(gid, "members")); batch.set(ref, { ...p, createdAt: new Date(Date.now() - 10000 + i * 100) }); return ref.id; });
  const all = [0, 1, 2, 3];
  [["Loyer du mois", 180000, 1, "loyer", 12, all], ["Courses Delhaize", 6240, 0, "courses", 9, all], ["Internet Proximus", 3999, 2, "factures", 8, all],
   ["Pizzas du vendredi", 4800, 3, "resto", 5, [0, 1, 3]], ["Tickets de bus", 1350, 0, "transport", 3, [0, 2]], ["Soirée jeux de société", 2760, 1, "loisirs", 1, all]]
    .forEach(([title, cents, payer, cat, d, parts]) => {
      const sp = splitAmount(cents, "equal", parts.map((i) => ({ id: mids[i] })));
      batch.set(doc(col(gid, "expenses")), { title, amountCents: cents, paidBy: mids[payer], payers: { [mids[payer]]: cents }, split: sp.split, splitMode: "equal", splitInput: {}, category: cat, date: ago(d), note: "", approvalStatus:'approved', recurring: null, recurringNext: null, receiptPath: null, createdAt: serverTimestamp(), updatedAt: serverTimestamp(), createdBy: uid, createdByName: myName() });
    });

  logAct(batch, gid, "group_create", `${myName()} a créé le groupe de démonstration « Kot démo »`);
  fire(batch.commit());
}

/* ---------- Invitations (Cloud Functions : le client n'est pas encore membre) ---------- */
const getInviteInfo = (code) => call("getInvite", { code: normalizeCode(code) });
async function joinByCode(code, memberId) {
  const res = await call("joinGroup", { code: normalizeCode(code), memberId: memberId || null });
  return res.groupId;
}

/* ---------- Dépenses ---------- */
async function loadImageFile(file) {
  let bmp;
  try { bmp = await createImageBitmap(file, { imageOrientation: "from-image" }); }
  catch (e) {
    bmp = await new Promise((res, rej) => {
      const im = new Image();
      const url = URL.createObjectURL(file);
      im.onload = () => { URL.revokeObjectURL(url); res(im); };
      im.onerror = (err) => { URL.revokeObjectURL(url); rej(err); };
      im.src = url;
    });
  }
  return bmp;
}
async function canvasToBlob(canvas, quality = 0.7) {
  return new Promise((res, rej) => canvas.toBlob((b) => (b ? res(b) : rej(new Error("Compression impossible"))), "image/jpeg", quality));
}
async function compressImage(file, maxW = 1280, quality = 0.7) {
  const bmp = await loadImageFile(file);
  const w = bmp.width || bmp.naturalWidth, h = bmp.height || bmp.naturalHeight, k = Math.min(1, maxW / w);
  const c = document.createElement("canvas"); c.width = Math.round(w * k); c.height = Math.round(h * k);
  const ctx = c.getContext("2d"); ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, c.width, c.height); ctx.drawImage(bmp, 0, 0, c.width, c.height);
  return canvasToBlob(c, quality);
}
async function openAvatarCropper(file) {
  const img = await loadImageFile(file);
  const iw = img.width || img.naturalWidth, ih = img.height || img.naturalHeight;
  const viewport = 320;
  const baseScale = Math.max(viewport / iw, viewport / ih);
  let zoom = 1, minZoom = 1, maxZoom = 4, dx = 0, dy = 0;
  let dragging = false, px = 0, py = 0;
  return new Promise((resolve) => {
    const sh = openSheet({
      title: tr('Recadrer la photo de profil'),
      body: `<div class="avatar-cropper">
        <div class="avatar-cropper-copy">${esc(tr('Déplace et zoome la photo pour choisir la partie visible dans le rond.'))}</div>
        <canvas id="avatar-crop-canvas" class="avatar-crop-canvas" width="${viewport}" height="${viewport}"></canvas>
        <div class="avatar-crop-tools">
          <label for="avatar-crop-zoom">${esc(tr('Zoom'))}</label>
          <input id="avatar-crop-zoom" type="range" min="100" max="400" step="1" value="100">
        </div>
        <div class="avatar-crop-preview-wrap">
          <div class="avatar-crop-preview-label">${esc(tr('Aperçu'))}</div>
          <canvas id="avatar-crop-preview" class="avatar-crop-preview" width="96" height="96"></canvas>
        </div>
      </div>`,
      footer: `<button class="btn soft" id="avatar-cancel">${esc(tr('Annuler'))}</button><button class="btn brand" id="avatar-apply">${esc(tr('Utiliser cette photo'))}</button>`,
      onClose: () => resolve(null),
      onMount: (sheet, entry) => {
        let closed = false;
        const done = (blob) => { if (closed) return; closed = true; entry.onClose = null; closeSheet(entry); resolve(blob); };
        const canvas = $('#avatar-crop-canvas', sheet), ctx = canvas.getContext('2d');
        const preview = $('#avatar-crop-preview', sheet), pctx = preview.getContext('2d');
        const zoomInput = $('#avatar-crop-zoom', sheet);
        const circleR = viewport * 0.39;
        const clampOffsets = () => {
          const s = baseScale * zoom, dw = iw * s, dh = ih * s;
          const maxX = Math.max(0, (dw - viewport) / 2), maxY = Math.max(0, (dh - viewport) / 2);
          dx = Math.max(-maxX, Math.min(maxX, dx));
          dy = Math.max(-maxY, Math.min(maxY, dy));
        };
        const drawInto = (target, tctx, size, withOverlay) => {
          tctx.clearRect(0,0,size,size);
          tctx.fillStyle = '#111318';
          tctx.fillRect(0,0,size,size);
          const s = baseScale * zoom * (size / viewport), dw = iw * s, dh = ih * s;
          const ox = dx * (size / viewport), oy = dy * (size / viewport);
          tctx.drawImage(img, size/2 - dw/2 + ox, size/2 - dh/2 + oy, dw, dh);
          if (withOverlay) {
            tctx.save();
            tctx.fillStyle = 'rgba(0,0,0,.46)';
            tctx.beginPath();
            tctx.rect(0,0,size,size);
            tctx.arc(size/2,size/2,circleR * (size/viewport),0,Math.PI*2,true);
            tctx.fill('evenodd');
            tctx.restore();
            tctx.save();
            tctx.strokeStyle = 'rgba(255,255,255,.95)';
            tctx.lineWidth = 3;
            tctx.beginPath();
            tctx.arc(size/2,size/2,circleR * (size/viewport),0,Math.PI*2);
            tctx.stroke();
            tctx.restore();
          }
        };
        const render = () => { clampOffsets(); drawInto(canvas, ctx, viewport, true); drawInto(preview, pctx, 96, false); };
        const setZoomFromInput = () => { zoom = Number(zoomInput.value || 100) / 100; render(); };
        const point = (e) => ('touches' in e && e.touches[0]) ? e.touches[0] : e;
        const down = (e) => { dragging = true; const pt = point(e); px = pt.clientX; py = pt.clientY; canvas.classList.add('dragging'); e.preventDefault?.(); };
        const move = (e) => { if (!dragging) return; const pt = point(e); dx += pt.clientX - px; dy += pt.clientY - py; px = pt.clientX; py = pt.clientY; render(); e.preventDefault?.(); };
        const up = () => { dragging = false; canvas.classList.remove('dragging'); };
        canvas.addEventListener('mousedown', down);
        window.addEventListener('mousemove', move);
        window.addEventListener('mouseup', up);
        canvas.addEventListener('touchstart', down, { passive:false });
        window.addEventListener('touchmove', move, { passive:false });
        window.addEventListener('touchend', up);
        canvas.addEventListener('wheel', (e) => {
          e.preventDefault();
          const next = Math.max(minZoom, Math.min(maxZoom, zoom + (e.deltaY < 0 ? 0.08 : -0.08)));
          zoom = next; zoomInput.value = String(Math.round(next * 100)); render();
        }, { passive:false });
        zoomInput.addEventListener('input', setZoomFromInput);
        $('#avatar-cancel', sheet).addEventListener('click', () => done(null));
        $('#avatar-apply', sheet).addEventListener('click', async () => {
          const out = document.createElement('canvas'); out.width = 800; out.height = 800;
          const octx = out.getContext('2d');
          drawInto(out, octx, 800, false);
          done(await canvasToBlob(out, 0.9));
        });
        entry.onClose = () => {
          window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up);
          window.removeEventListener('touchmove', move); window.removeEventListener('touchend', up);
          if (!closed) resolve(null);
        };
        render();
      }
    });
  });
}
async function uploadReceipt(gid, eid, file) {
  const blob = await compressImage(file);
  const r = sref(storage, `groups/${gid}/receipts/${eid}.jpg`);
  await uploadBytes(r, blob, { contentType: "image/jpeg", customMetadata: { ownerUid: myUid() } });
  return r.fullPath;
}
const receiptUrl = (path) => getDownloadURL(sref(storage, path));

/** Enregistre (création ou modification) une dépense. data = champs métier déjà validés. */
/** Écriture financière contrôlée côté serveur : pas de création/modification
 * directe de dépenses, sauf démo interne créée au premier lancement. */
async function saveExpense(gid, eid, data, { receiptFile = null, removeReceipt = false, oldPath = null, isNew = false } = {}) {
  const id = eid || doc(col(gid, 'expenses')).id;
  let receiptPath = removeReceipt ? null : oldPath;
  if (receiptFile) {
    if (oldPath) throw new Error(tr('Le justificatif existant est protégé. Retire-le, enregistre, puis ajoute une nouvelle photo.'));
    if (!online()) throw new Error(tr('Connexion requise pour envoyer une photo.'));
    receiptPath = await uploadReceipt(gid, id, receiptFile);
  }
  if(!online()) throw new Error(tr('Connexion requise pour enregistrer une dépense sécurisée.'));
  await call('approveGroupExpense', {
    operation:'save', groupId:gid, expenseId:id, isNew:isNew||!eid,
    expense:{...data,receiptPath:receiptPath||null}
  });
  return {id};
}
function deleteExpense(gid, e) {
  if(!online())throw new Error(tr('Connexion requise pour supprimer une dépense.'));
  return call('approveGroupExpense',{operation:'delete',groupId:gid,expenseId:e.id});
}

/* ---------- Remboursements ---------- */
async function addSettlement(gid, { fromId, toId, amountCents }) {
  // Declaration only: balances change AFTER explicit validation by group admin.
  return call('requestGroupSettlement',{groupId:gid,fromId,toId,amountCents,clientRequestId:crypto.randomUUID()});
}
async function deleteSettlement(gid,s) {
  return call('cancelConfirmedSettlement',{groupId:gid,settlementId:s.id});
}

/* ---------- Préférences de notifications v28 ---------- */
const PUSH_TOPICS=[
 ['groupInvites','Invitations de groupe','users'],
 ['directMessages','Messages privés','mail'],
 ['groupMessages','Messages de groupe','users'],
 ['expenses','Nouvelles dépenses','receipt'],
 ['moneyRequests','Demandes de remboursement','wallet'],
 ['paymentConfirmations','Confirmations de paiement','check']
];
const wantsPush=(key)=>S.profile?.notificationPrefs?.[key]!==false;
const groupMuted=(gid)=>Array.isArray(S.profile?.mutedGroupIds)&&S.profile.mutedGroupIds.includes(gid);
ACT['notification-preference']=async b=>{
  const key=b.dataset.kind;
  if(!PUSH_TOPICS.some(x=>x[0]===key))return;
  const next={...(S.profile?.notificationPrefs||{}),[key]:!wantsPush(key)};
  try{await saveProfile({notificationPrefs:next});toast(tr('Préférence enregistrée'));}
  catch(e){toast(errMsg(e),'err');}
};
ACT['group-mute']=async()=>{
  const gid=S.route?.gid;
  if(!gid||!S.groups.some(g=>g.id===gid))return;
  const willMute=!groupMuted(gid);
  const muted=(S.profile?.mutedGroupIds||[]).filter(x=>x!==gid);
  if(willMute)muted.push(gid);
  try{await saveProfile({mutedGroupIds:muted});closeSheet();toast(tr(willMute?'Groupe mis en sourdine':'Notifications du groupe réactivées'));}
  catch(e){toast(errMsg(e),'err');}
};
/* ---------- Notifications push (FCM) ---------- */
async function pushSupported() { try { return "Notification" in window && "serviceWorker" in navigator && (await messagingSupported()); } catch (e) { return false; } }
async function enableNotifications() {
  if (!(await pushSupported())) throw new Error("Les notifications ne sont pas supportées ici. Sur iPhone, ajoute d'abord l'app à l'écran d'accueil.");
  if (/^VOTRE_/.test(VAPID_KEY)) throw new Error("Clé VAPID non configurée (voir le guide de déploiement).");
  const perm = await Notification.requestPermission();
  if (perm !== "granted") throw new Error("Notifications refusées dans le navigateur.");
  const reg = await navigator.serviceWorker.register("/firebase-messaging-sw.js");
  await navigator.serviceWorker.ready;
  const messaging = getMessaging(app);
  const token = await getToken(messaging, { vapidKey: VAPID_KEY, serviceWorkerRegistration: reg });
  await updateDoc(doc(db, "users", myUid()), { fcmTokens: arrayUnion(token), updatedAt: serverTimestamp() });
  localStorage.setItem("fcmToken", token);
  S.profile.fcmTokens = [...new Set([...(S.profile.fcmTokens || []), token])];
  onMessage(messaging, (p) => toast(`${p.data?.title || APP_NAME} — ${p.data?.body || ""}`));
}
async function disableNotifications() {
  const token = localStorage.getItem("fcmToken");
  try { await deleteToken(getMessaging(app)); } catch (e) { /* ignoré */ }
  if (token) await updateDoc(doc(db, "users", myUid()), { fcmTokens: arrayRemove(token), updatedAt: serverTimestamp() });
  localStorage.removeItem("fcmToken");
  S.profile.fcmTokens = (S.profile.fcmTokens || []).filter((t) => t !== token);
}
const notificationsOn = () => !!localStorage.getItem("fcmToken") && typeof Notification !== "undefined" && Notification.permission === "granted";

/* ---------- RGPD : export et suppression ---------- */
async function collectAllData() {
  const former=(await getDocs(collection(db,'users',myUid(),'formerGroups'))).docs.map(d=>({id:d.id,...d.data()}));
  const out = { exportedAt: new Date().toISOString(), profile: { ...S.profile, fcmTokens: undefined }, exitDebts: S.exitDebts, formerGroups: former, groups: [] };
  for (const g of S.groups) {
    const sub = async (n) => (await getDocs(col(g.id, n))).docs.map((d) => ({ id: d.id, ...d.data() }));
    out.groups.push({ ...g, members: await sub("members"), expenses: await sub("expenses"), plannedExpenses: await sub("plannedExpenses"), polls: await sub("polls"), settlements: await sub("settlements"), activity: await sub("activity") });
  }
  return JSON.parse(JSON.stringify(out, (k, v) => (v && v.toDate ? v.toDate().toISOString() : v)));
}
async function deleteMyAccount() {
  await call("deleteAccount", {});
  stopAll();
  try { await signOut(auth); } catch (e) { /* le compte n'existe déjà plus */ }
}

/* ==========================================================================
   SECTION 4 — INTERFACE : briques de base
   ========================================================================== */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
const el = (tag, cls = "", html = "") => { const e = document.createElement(tag); if (cls) e.className = cls; if (html) e.innerHTML = html; return e; };
const haptic = (p = 8) => { try { navigator.vibrate && navigator.vibrate(p); } catch (e) { /* non supporté */ } };

/* ---------- Icônes (SVG intégrés, style trait) ---------- */
const ICONS = {
  plus: '<line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>',
  back: '<polyline points="15 18 9 12 15 6"/>', next: '<polyline points="9 18 15 12 9 6"/>',
  check: '<polyline points="20 6 9 17 4 12"/>', x: '<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>',
  home: '<path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/>',
  users: '<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
  user: '<path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>',
  wallet: '<path d="M20 12V8H6a2 2 0 0 1-2-2c0-1.1.9-2 2-2h12v4"/><path d="M4 6v12c0 1.1.9 2 2 2h14v-4"/><path d="M18 12a2 2 0 0 0-2 2c0 1.1.9 2 2 2h4v-4h-4z"/>',
  pie: '<path d="M21.21 15.89A10 10 0 1 1 8 2.83"/><path d="M22 12A10 10 0 0 0 12 2v10z"/>',
  activity: '<polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/>',
  list: '<line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/>',
  search: '<circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>',
  filter: '<polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"/>',
  share: '<circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/>',
  copy: '<rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>',
  camera: '<path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/>',
  trash: '<polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/>',
  edit: '<path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4z"/>',
  moon: '<path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>',
  sun: '<circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/>',
  bell: '<path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/>',
  logout: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/>',
  download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>',
  upload: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/>',
  repeat: '<polyline points="17 1 21 5 17 9"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><polyline points="7 23 3 19 7 15"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/>',
  arrow: '<line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/>',
  link: '<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>',
  archive: '<polyline points="21 8 21 21 3 21 3 8"/><rect x="1" y="3" width="22" height="5"/><line x1="10" y1="12" x2="14" y2="12"/>',
  qr: '<rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><path d="M14 14h3v3h-3zM20 14v3M17 20h4"/>',
  more: '<circle cx="12" cy="12" r="1.2"/><circle cx="19" cy="12" r="1.2"/><circle cx="5" cy="12" r="1.2"/>',
  mail: '<path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/>',
  lock: '<rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>',
  printer: '<polyline points="6 9 6 2 18 2 18 9"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8"/>',
  calendar: '<rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>',
  cart: '<circle cx="9" cy="21" r="1"/><circle cx="20" cy="21" r="1"/><path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6"/>',
  cup: '<path d="M18 8h1a4 4 0 0 1 0 8h-1"/><path d="M2 8h16v9a4 4 0 0 1-4 4H6a4 4 0 0 1-4-4V8z"/><line x1="6" y1="1" x2="6" y2="4"/><line x1="10" y1="1" x2="10" y2="4"/><line x1="14" y1="1" x2="14" y2="4"/>',
  car: '<path d="M5 17h14M3 13l2-6a2 2 0 0 1 2-1h10a2 2 0 0 1 2 1l2 6v4h-3M3 13v4h3M3 13h18"/><circle cx="7.5" cy="17" r="1.6"/><circle cx="16.5" cy="17" r="1.6"/>',
  music: '<path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/>',
  bolt: '<polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>',
  receipt: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/>',
  split: '<circle cx="9" cy="12" r="6"/><circle cx="15" cy="12" r="6"/>',
  info: '<circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/>',
  mic: '<rect x="9" y="2" width="6" height="13" rx="3"/><path d="M5 10a7 7 0 0 0 14 0M12 17v5M8 22h8"/>',
  plane: '<path d="M21.5 2.5 14 10l-7.2-2.6-2.3 2.3 6.2 4.1-3 3-3.2-.7-1.7 1.7 4.3 2.1 2.1 4.3 1.7-1.7-.7-3.2 3-3 4.1 6.2 2.3-2.3L17 13l7.5-7.5a2.12 2.12 0 0 0-3-3z" transform="translate(-1 -1) scale(.96)"/>',
  beer: '<path d="M5 9v10a2 2 0 0 0 2 2h9a2 2 0 0 0 2-2V9"/><path d="M18 10h2a3 3 0 0 1 0 6h-2"/><path d="M5 10a3 3 0 0 1 .8-5.9 4 4 0 0 1 7.1-.9 3 3 0 0 1 5.6 2c2.2.2 3 3.3.5 4.8H5z"/><path d="M9 12v6M13 12v6"/>',
  beach: '<path d="M3 12a9 9 0 0 1 18 0c-2.2-1.7-4-1.7-6 0-2.2-1.7-4-1.7-6 0-2.2-1.7-4-1.7-6 0z"/><path d="M12 3v16M13 18l4 3H7l-3 2M2 23h20"/>',
  party: '<path d="m3 21 6.6-18L21 14.4z"/><path d="m6.6 13.2 9.4 4.2M9.1 6.1l8.8 8.8"/><path d="M15 3v2M20 5l2-2M20 10h2M13 1l-1 2"/><circle cx="18.5" cy="2" r=".5"/><circle cx="21" cy="14" r=".5"/>',
  pizza: '<path d="M4 21 9.5 3A19 19 0 0 1 22 15z"/><path d="M8 8c4.3-.6 8 1 11 4"/><circle cx="12" cy="11" r="1.2"/><circle cx="9.5" cy="16" r="1"/><circle cx="17" cy="15" r="1"/>',
  skier: '<circle cx="16" cy="3.5" r="2"/><path d="m14 7-4 3-3 3m3-3 5 3 3 5M7 13l6 2m-8 2 6 2 10 1M3 21c6 3 13 3 19 0M5 9l-2 8m16-7 3 8"/>',
  graduation: '<path d="m2 9 10-5 10 5-10 5z"/><path d="M6 11v6c4 3 8 3 12 0v-6M22 9v8M22 20v1"/>',
  camping: '<path d="m2 19 7-10 4 5 3-3 6 8H2z"/><path d="m11 19 5-13 6 13M6 23c2-3 6-3 8-1M2 22h4"/><path d="m14 11 2 2 2-2"/>',
  gamepad: '<path d="M7 7h10c2.7 0 4.2 1.8 4.6 4.2l1.1 6c.5 3-2.4 4.5-4.7 2.7L16 18H8l-2 1.9c-2.3 1.8-5.2.3-4.7-2.7l1.1-6C2.8 8.8 4.3 7 7 7z"/><path d="M6.5 11v5M4 13.5h5M16.7 12h.01M19.5 15h.01"/>',
  utensils: '<path d="M4 2v8a3 3 0 0 0 6 0V2M7 2v20M14 2v20M14 13h7c0-6.5-2.5-10-7-11"/>',
  wave: '<path d="M8 13 5 9.5a1.8 1.8 0 0 1 2.7-2.4l3.6 4.4-1.4-7a1.8 1.8 0 0 1 3.5-.7l1.3 6.5-1-5.3a1.8 1.8 0 0 1 3.5-.7L18.8 9l-.4-2.2a1.7 1.7 0 0 1 3.3-.7l.8 5.1c1 6-1.8 10.2-7 11.3C11 23.4 8.1 19.6 8 13z" transform="translate(-.7 -.3) scale(.98)"/><path d="m3 5-2-1M4 2l-1-2M3 9 1 10"/>',
  tap: '<path d="M9 12V5a2 2 0 0 1 4 0v7l1-1a2 2 0 0 1 3.5 1 2 2 0 0 1 3.5 1l-.5 5c-.3 2.3-2.3 4-4.7 4H11c-2.3 0-3.5-1-4.5-2.7l-2.8-4.5a2 2 0 0 1 3.2-2.4L9 15"/><path d="M6 6c0-3 2-5 5-5M14 2c2 1 3 3 3 5"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  google: '<path d="M21.6 12.2c0-.7-.1-1.3-.2-1.9H12v3.6h5.4a4.6 4.6 0 0 1-2 3v2.5h3.2c1.9-1.7 3-4.3 3-7.2z" fill="#4285F4" stroke="none"/><path d="M12 22c2.7 0 5-.9 6.6-2.4l-3.2-2.5c-.9.6-2 1-3.4 1-2.6 0-4.8-1.8-5.6-4.1H3.1v2.6A10 10 0 0 0 12 22z" fill="#34A853" stroke="none"/><path d="M6.4 14c-.2-.6-.3-1.3-.3-2s.1-1.4.3-2V7.4H3.1a10 10 0 0 0 0 9.2z" fill="#FBBC05" stroke="none"/><path d="M12 5.9c1.5 0 2.8.5 3.8 1.5l2.9-2.9A10 10 0 0 0 3.1 7.4L6.4 10c.8-2.3 3-4.1 5.6-4.1z" fill="#EA4335" stroke="none"/>',
};
const ico = (n, cls = "") => `<svg class="i ${cls}" viewBox="0 0 24 24" aria-hidden="true">${ICONS[n] || ""}</svg>`;

// Icônes monochromes uniformes : nous conservons les emojis historiques dans
// Firestore et les liens de partage, mais les affichons sous forme de SVG.
// Cela permet aux groupes existants de garder leur symbole sans migration.
const GROUP_ICON_TYPES = Object.freeze({
  '🏠': ['home', 'Maison'], '✈️': ['plane', 'Voyage'], '✈': ['plane', 'Voyage'],
  '🍻': ['beer', 'Sortie'], '🏖️': ['beach', 'Vacances'], '🏖': ['beach', 'Vacances'],
  '🎉': ['party', 'Fête'], '🛒': ['cart', 'Courses'], '🍕': ['pizza', 'Restaurant'],
  '⛷️': ['skier', 'Ski'], '⛷': ['skier', 'Ski'], '🚗': ['car', 'Voiture'],
  '🎓': ['graduation', 'Études'], '🏕️': ['camping', 'Camping'], '🏕': ['camping', 'Camping'],
  '🎮': ['gamepad', 'Jeux'], '🧾': ['receipt', 'Autre'], '🍽️': ['utensils', 'Restaurant'],
  '🍽': ['utensils', 'Restaurant'], '📅': ['calendar', 'Calendrier'],
  '👋': ['wave', 'Bonjour'], '👇': ['tap', 'Appuyer'], 'ℹ️': ['info', 'Information'],
});
const groupIconKey = (emoji) => (GROUP_ICON_TYPES[emoji] || ['receipt'])[0];
const groupIconLabel = (emoji) => tr((GROUP_ICON_TYPES[emoji] || ['receipt','Autre'])[1]);
const groupIcon = (emoji, cls = '') => ico(groupIconKey(emoji), `group-symbol ${cls}`.trim());


/* ---------- Formatage ---------- */
const fmtDate = (iso) => { try { const [y, m, d] = iso.split("-").map(Number); return new Intl.DateTimeFormat(locale(), { day: "numeric", month: "short", year: "numeric" }).format(new Date(y, m - 1, d)); } catch (e) { return iso || ""; } };
function dayLabel(iso) {
  const t = todayISO(), y = todayISO(new Date(Date.now() - 864e5));
  if (iso === t) return "Aujourd'hui";
  if (iso === y) return "Hier";
  const [yy, m, d] = iso.split("-").map(Number);
  return new Intl.DateTimeFormat(locale(), { weekday: "long", day: "numeric", month: "long", year: yy === new Date().getFullYear() ? undefined : "numeric" }).format(new Date(yy, m - 1, d));
}
function relTime(ms) {
  const s = Math.round((Date.now() - ms) / 1000);
  if (s < 45) return "à l'instant";
  if (s < 3600) return `il y a ${Math.round(s / 60)} min`;
  if (s < 86400) return `il y a ${Math.round(s / 3600)} h`;
  if (s < 7 * 86400) return `il y a ${Math.round(s / 86400)} j`;
  return fmtDate(todayISO(new Date(ms)));
}
const money = (c, cur = "EUR") => formatMoney(c, cur);
const avatar = (m, cls = "") => {
  const url=m?.uid?avatarPhoto(m.uid):'';
  const ownUnresolved=m?.uid===myUid()&&!SOC.self&&!SOC.profileLoadError;
  const hasPhoto=ownUnresolved||!!(m?.uid&&SOC.self?.avatarPath&&m.uid===myUid())||!!(m?.uid&&SOC.profiles.get(m.uid)?.avatarPath);
  const waiting=hasPhoto&&!url&&!SOC.photoFailed.has(m.uid);
  return `<div class="avatar ${cls} ${waiting?'avatar-photo-pending':''}" style="background:${hasPhoto?'var(--surface3)':esc(m?.color||'#64748b')}" aria-hidden="true">${url?`<img loading="${cls==='lg'?'eager':'lazy'}" decoding="async" src="${esc(url)}" alt="" style="width:100%;height:100%;border-radius:inherit;object-fit:cover">`:waiting?'':esc(initials(m?.name))}</div>`;
};
/** Libellé de solde : « On te doit 23,50 € » (vert) / « Tu dois 12 € » (rouge) / « Tout est réglé ». */
function balanceLabel(net, cur) {
  if (net > 0) return { text: `On te doit ${money(net, cur)}`, cls: "pos" };
  if (net < 0) return { text: `Tu dois ${money(-net, cur)}`, cls: "neg" };
  return { text: "Tout est réglé", cls: "muted" };
}

/* ---------- Toasts ---------- */
function toast(msg, type = "ok") {
  if (!msg) return;
  msg = tr(msg);
  const t = el("div", "toast " + type, `${type === "err" ? ico("info", "sm") : ico("check", "sm")}<span>${esc(msg)}</span>`);
  $("#toast-root").append(t);
  if (type === "err") haptic([20, 40, 20]); else haptic(12);
  setTimeout(() => { t.classList.add("out"); setTimeout(() => t.remove(), 320); }, type === "err" ? 4200 : 2400);
}

/* ---------- Feuilles modales (montent par le bas, glisser vers le bas pour fermer) ---------- */
const sheetStack = [];
function openSheet({ title = "", body = "", footer = "", full = false, onMount, onClose } = {}) {
  const root = $("#sheet-root");
  const back = el("div", "backdrop"), sh = el("div", "sheet" + (full ? " full" : ""));
  sh.setAttribute("role", "dialog"); sh.setAttribute("aria-modal", "true"); sh.setAttribute("aria-label", tr(title));
  sh.innerHTML = `<div class="grab"></div><div class="head"><h2>${esc(tr(title))}</h2><button class="icon-btn" data-act="close-sheet" aria-label="Fermer">${ico("x", "sm")}</button></div><div class="body">${body}</div>${footer ? `<div class="foot">${footer}</div>` : ""}`;
  root.append(back, sh);
  requestAnimationFrame(() => requestAnimationFrame(() => { back.classList.add("in"); sh.classList.add("in"); }));
  const entry = { back, sh, onClose, closed: false, previousFocus: document.activeElement };
  sheetStack.push(entry);
  requestAnimationFrame(()=>{if(!entry.closed)sh.querySelector('[data-act="close-sheet"]')?.focus({preventScroll:true});});
  sh.addEventListener('keydown',e=>{
    if(e.key==='Escape'){e.stopPropagation();e.preventDefault();closeSheet(entry);return;}
    if(e.key!=='Tab')return;
    const controls=[...sh.querySelectorAll('button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),a[href]')]
      .filter(x=>x.getClientRects().length>0);
    if(!controls.length)return;
    const first=controls[0],last=controls[controls.length-1];
    if(e.shiftKey&&document.activeElement===first){e.preventDefault();last.focus();}
    else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first.focus();}
  });
  back.addEventListener("click", () => closeSheet(entry));
  // glisser pour fermer
  const handle = $(".grab", sh), head = $(".head", sh); let y0 = null, dy = 0;
  [handle, head].forEach((h) => {
    h.addEventListener("touchstart", (e) => { y0 = e.touches[0].clientY; dy = 0; sh.style.transition = "none"; }, { passive: true });
    h.addEventListener("touchmove", (e) => { if (y0 == null) return; dy = Math.max(0, e.touches[0].clientY - y0); sh.style.transform = `translate(-50%,${dy}px)`; }, { passive: true });
    h.addEventListener("touchend", () => { if (y0 == null) return; y0 = null; sh.style.transition = ""; if (dy > 110) closeSheet(entry); else sh.style.transform = ""; });
  });
  if (onMount) onMount(sh, entry);
  I18N.translateDOM(sh); // Libellés et attributs des formulaires créés dynamiquement
  return { el: sh, entry, close: () => closeSheet(entry), body: $(".body", sh) };
}
function closeSheet(entry = sheetStack[sheetStack.length - 1]) {
  if (!entry || entry.closed) return;
  entry.closed = true;
  const i = sheetStack.indexOf(entry); if (i >= 0) sheetStack.splice(i, 1);
  entry.sh.style.transform = ""; entry.sh.classList.remove("in"); entry.back.classList.remove("in");
  setTimeout(() => { entry.sh.remove(); entry.back.remove(); }, 420);
  const target=sheetStack.at(-1)?.sh.querySelector('[data-act="close-sheet"]') || entry.previousFocus;
  if(target?.isConnected)target.focus({preventScroll:true});
  if (entry.onClose) entry.onClose();
}
const closeAllSheets = () => [...sheetStack].reverse().forEach(closeSheet);
document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeSheet(); });

/** Boîte de dialogue de confirmation (façon alerte iOS). Retourne une promesse booléenne. */
function confirmDialog({ title, message = "", ok = "Confirmer", cancel = "Annuler", danger = false }) {
  return new Promise((resolve) => {
    const back = el("div", "backdrop"), box = el("div", "alert");
    box.setAttribute("role", "alertdialog");
    box.innerHTML = `<h3>${esc(tr(title))}</h3><p>${esc(tr(message))}</p><div class="btns"><button class="btn ${danger ? "danger" : ""}" data-r="1">${esc(tr(ok))}</button><button class="btn soft" data-r="0">${esc(tr(cancel))}</button></div>`;
    const beforeFocus=document.activeElement;
    $("#sheet-root").append(back, box);
    I18N.translateDOM(box);
    requestAnimationFrame(()=>box.querySelector('[data-r="0"]')?.focus({preventScroll:true}));
    box.addEventListener('keydown',e=>{
      if(e.key==='Escape'){e.preventDefault();e.stopPropagation();done(false);}
      if(e.key==='Tab'){
        const controls=[...box.querySelectorAll('button:not([disabled])')];
        if(controls.length<2)return;
        if(e.shiftKey&&document.activeElement===controls[0]){e.preventDefault();controls.at(-1).focus();}
        else if(!e.shiftKey&&document.activeElement===controls.at(-1)){e.preventDefault();controls[0].focus();}
      }
    });
    requestAnimationFrame(() => requestAnimationFrame(() => { back.classList.add("in"); box.classList.add("in"); }));
    let finished=false;
    const done = (v) => {if(finished)return;finished=true; back.classList.remove("in"); box.classList.remove("in"); setTimeout(() => { back.remove(); box.remove(); }, 300); if(beforeFocus?.isConnected)beforeFocus.focus({preventScroll:true}); resolve(v); };
    box.addEventListener("click", (e) => { const b = e.target.closest("[data-r]"); if (b) done(b.dataset.r === "1"); });
    back.addEventListener("click", () => done(false));
  });
}

/* ---------- Utilitaires navigateur ---------- */
async function copyText(text, msg = "Copié") {
  try { await navigator.clipboard.writeText(text); }
  catch (e) { const t = el("textarea"); t.value = text; document.body.append(t); t.select(); try { document.execCommand("copy"); } catch (_) { /* rien */ } t.remove(); }
  toast(msg);
}
async function shareText({ title, text, url }) {
  if (navigator.share) { try { await navigator.share({ title, text, url }); return; } catch (e) { if (e.name === "AbortError") return; } }
  await copyText([text, url].filter(Boolean).join("\n"), "Texte copié");
}
const whatsapp = (text) => window.open("https://wa.me/?text=" + encodeURIComponent(text), "_blank", "noopener");
function downloadFile(name, content, mime = "text/plain") {
  const blob = new Blob([content], { type: mime + ";charset=utf-8" });
  const a = el("a"); a.href = URL.createObjectURL(blob); a.download = name; document.body.append(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
}
const csvCell = (v) => {
  let s = String(v ?? '');
  // Protection contre l'injection de formules Excel / LibreOffice.
  if (/^[\u0000-\u0020]*[=+@-]/.test(s)) s = '\'' + s;
  const sep = locale().toLowerCase().startsWith('en') ? ',' : ';';
  return s.includes(sep) || /["\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
};
const toCsv = (rows) => "\uFEFF" + rows.map((r) => r.map(csvCell).join(locale().toLowerCase().startsWith('en') ? ',' : ';')).join("\r\n");
const slug = (s) => String(s).normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").toLowerCase() || "export";

/* ---------- Routage par hash : #/ , #/g/{id}/{onglet} , #/settings , #/join/{code} ---------- */
function parseRoute() {
  const p = location.hash.replace(/^#\/?/, "").split("?")[0].split("/").filter(Boolean);
  if (p[0] === "g" && p[1]) return { name: "group", gid: p[1], tab: p[2] === "polls" ? "chat" : ["expenses", "plans", "calendar", "recurring", "balances", "chat", "stats", "activity"].includes(p[2]) ? p[2] : "expenses" };
  if (p[0] === "friends") return { name: "friends" };
  if (p[0] === "dm" && p[1] && /^[A-Za-z0-9_-]{1,128}$/.test(p[1])) return { name: "direct", cid: p[1] };
  if (p[0] === "debts") return { name: "debts" };
  if (p[0] === "settings") return { name: "settings" };
  if (p[0] === "join" && p[1]) return { name: "join", code: normalizeCode(p[1]) };
  return { name: "home" };
}
const go = (path) => { location.hash = "#" + path; };
const routeDepth = (r) => (r.name === "group" ? 1 : 0);
let animateNext = null;
window.addEventListener("hashchange", () => {
  const prev = S.route; S.route = parseRoute();
  if (prev.name !== S.route.name || prev.gid !== S.route.gid) animateNext = routeDepth(S.route) >= routeDepth(prev) ? "enter" : "enter-back";
  else animateNext = null;
  if (S.route.name !== "group") stopActivity();
  if ((prev.name === "group" ? `group/${prev.gid}` : prev.name === "direct" ? `direct/${prev.cid}` : "") !== (S.route.name === "group" && S.route.tab === "chat" ? `group/${S.route.gid}` : S.route.name === "direct" ? `direct/${S.route.cid}` : "")) stopSocialChat();
  // Un seul flux de prévisions pour les vues Prévisions / Calendrier.
  if (prev.name === 'group' && ['plans','calendar'].includes(prev.tab) &&
      !(S.route.name === 'group' && S.route.gid === prev.gid && ['plans','calendar'].includes(S.route.tab))) {
    const oldStore=S.stores.get(prev.gid);
    if(oldStore?.unsubPlans){const unsubscribe=oldStore.unsubPlans;unsubscribe();oldStore.unsubs=oldStore.unsubs.filter(u=>u!==unsubscribe);oldStore.unsubPlans=null;oldStore.plansReady=false;}
  }
  S.ui.expLimit = 30;
  markVisibleNotifications();
  closeAllSheets(); window.scrollTo(0, 0); scheduleRender();
});

/* ---------- Rendu : on dessine l'écran courant, en conservant focus et position de saisie ---------- */
let renderQueued = false;
function scheduleRender() {
  if (renderQueued) return;
  renderQueued = true;
  requestAnimationFrame(() => { renderQueued = false; try { render(); } catch (e) { console.error(e); } });
}
function paint({ top = "", body = "", nav = "", fab = null, bare = false }) {
  const act = document.activeElement, keep = act && act.id && $("#view").contains(act)
    ? { id: act.id, s: act.selectionStart, e: act.selectionEnd, value: ('value' in act ? act.value : undefined) } : null;
  // Remember the current chat position before replacing the view. The former
  // implementation accidentally used window.scroll and always reset to top.
  const threadBefore = document.getElementById('social-thread');
  const chatScroll = threadBefore ? {
    top: threadBefore.scrollTop,
    height: threadBefore.scrollHeight,
    stick: threadBefore.scrollHeight - threadBefore.clientHeight - threadBefore.scrollTop < 90,
  } : null;
  $("#topbar").innerHTML = top; $("#topbar").hidden = bare;
  const view = $("#view");
  view.innerHTML = body;
  if (animateNext) { view.classList.remove("enter", "enter-back"); void view.offsetWidth; view.classList.add(animateNext); animateNext = null; }
  $("#bottomnav").innerHTML = nav ? `<div class="bar">${nav}</div>` : "";
  paintSidebar(bare);
  const f = $("#fab");
  if (fab) { f.innerHTML = `${ico("plus")}<span>${esc(tr(fab))}</span>`; f.classList.remove("out"); } else f.classList.add("out");
  // Ne pas dépendre du prochain cycle de MutationObserver pour traduire l’interface.
  I18N.translateDOM($("#topbar"));
  I18N.translateDOM(view);
  I18N.translateDOM($("#bottomnav"));
  I18N.translateDOM($("#sidebar"));
  const threadAfter = document.getElementById('social-thread');
  if (threadAfter) {
    const offset = SOC.preserveOlderScroll && chatScroll ? threadAfter.scrollHeight-chatScroll.height : 0;
    threadAfter.scrollTop = SOC.preserveOlderScroll && chatScroll ? chatScroll.top+offset
      : chatScroll?.stick === false ? chatScroll.top : threadAfter.scrollHeight;
    SOC.preserveOlderScroll = false;
  }
  if (keep) { const n = document.getElementById(keep.id); if (n) { // Le sélecteur de devise suit le profil confirmé ou la valeur en attente, jamais un ancien DOM.
    if(keep.value!==undefined && keep.id!=='home-currency')n.value=keep.value;
    n.focus(); try { n.setSelectionRange(keep.s, keep.e); } catch (e) { /* champ sans sélection */ } } }
}
window.addEventListener("scroll", () => $("#topbar").classList.toggle("scrolled", window.scrollY > 6), { passive: true });

/* ---------- Délégation d'événements : data-act (clic), data-in (saisie), data-ch (changement) ---------- */
// Gestionnaires ACT / INP / CHG déjà initialisés plus haut. 
document.addEventListener("click", (e) => {
  const t = e.target.closest("[data-act]");
  if (!t || t.disabled) return;
  const fn = ACT[t.dataset.act];
  if (fn) { haptic(); Promise.resolve(fn(t, e)).catch((err) => { console.error(err); toast(errMsg(err), "err"); }); }
});
document.addEventListener("input", (e) => { const t = e.target.closest("[data-in]"); if (t && INP[t.dataset.in]) INP[t.dataset.in](t, e); });
document.addEventListener("change", (e) => { const t = e.target.closest("[data-ch]"); if (t && CHG[t.dataset.ch]) CHG[t.dataset.ch](t, e); });
ACT["close-sheet"] = () => closeSheet();
ACT['accept-group-invite']=async b=>{
  const gid=b.dataset.id;
  try{const result=await withBusy(b,()=>call('joinGroup',{action:'respondGroupInvite',groupId:gid,accept:true}));
    if(result.accepted){toast(tr('Bienvenue dans le groupe !'));go(`/g/${result.groupId||gid}`);}}
  catch(e){toast(errMsg(e),'err');}
};
ACT['decline-group-invite']=async b=>{
  try{await withBusy(b,()=>call('joinGroup',{action:'respondGroupInvite',groupId:b.dataset.id,accept:false}));toast(tr('Invitation refusée.'));}
  catch(e){toast(errMsg(e),'err');}
};

/** Met un bouton en état « chargement » pendant une action asynchrone. */
async function withBusy(btn, fn) {
  if (!btn) return fn();
  const html = btn.innerHTML; btn.disabled = true; btn.innerHTML = '<span class="spin"></span>';
  try { return await fn(); } finally { btn.disabled = false; btn.innerHTML = html; }
}

/* ---------- Éléments communs ---------- */
const topBar = ({ back = null, title = "", right = "" }) =>
  `${back ? `<button class="icon-btn" data-act="nav" data-to="${back}" aria-label="Retour">${ico("back", "sm")}</button>` : ""}<div class="title ellipsis">${title}</div>${right}`;
const emptyState = ({ icon, title, text, cta = "", act = "", id = "" }) =>
  `<div class="empty"><div class="ill">${ico(icon)}</div><h3>${esc(tr(title))}</h3><p>${esc(tr(text))}</p>${cta ? `<button class="btn brand" data-act="${act}" data-id="${esc(id)}">${esc(tr(cta))}</button>` : ""}</div>`;
const skeletonList = (n = 4) => `<div class="card"><div class="list">${Array.from({ length: n }, () => `<div class="item"><div class="skel" style="width:42px;height:42px;border-radius:13px"></div><div class="grow col" style="gap:7px"><div class="skel" style="height:14px;width:60%"></div><div class="skel" style="height:11px;width:35%"></div></div></div>`).join("")}</div></div>`;
ACT.nav = (b) => go(b.dataset.to);

/* ==========================================================================
   SECTION 5 — ÉCRANS : orchestrateur, authentification, accueil, réglages, invitations
   ========================================================================== */
function render() {
  if (!S.authReady) return;
  document.body.classList.remove('onboarding-active');
  $("#boot").classList.add("gone");
  $("#app").hidden = false;
  if (!CONFIG_OK) return renderSetup();
  if (!S.user) {
    document.body.classList.add('onboarding-active');
    if ((S.ui.publicScreen || "landing") === "landing") return renderPublicLanding();
    if (welcomeViewed() && !S.ui.reviewWelcome && S.ui.onboardStep < 3) S.ui.onboardStep = 3;
    return S.ui.onboardStep < 3 ? renderOnboarding() : renderAuth();
  }
  if (!S.profile) {
    if (S.profileLoadError) return paint({bare:true,body:`<div class="card pad col" style="margin:12vh auto;max-width:520px"><h1>${tr('Impossible de charger ton profil.')}</h1><p class="muted">${tr('Tes données existantes ne sont pas modifiées. Vérifie ta connexion puis réessaie.')}</p><button class="btn brand" data-act="profile-retry">${tr('Réessayer')}</button><button class="btn soft" data-act="onboard-logout">${tr('Changer de compte')}</button></div>`});
    return paint({ top: topBar({ title: APP_NAME }), body: skeletonList(3) });
  }
  for(const [gid,st] of S.stores){
    const active=S.route.name==='group'&&S.route.gid===gid;
    if(active)st.startPayments?.();
    else if(st.unsubPayments){st.unsubPayments();st.unsubs=st.unsubs.filter(x=>x!==st.unsubPayments);st.unsubPayments=null;st.paymentRequests=[];}
  }
  // Attendre le profil social pour vérifier réellement si le pseudo est défini.
  if (!SOC.self) {
    document.body.classList.add('onboarding-active');
    return renderSocialProfileLoading();
  }
  const onboarding = needsWelcomeGuide() || needsHandleSetup();
  document.body.classList.toggle('onboarding-active', onboarding);
  if (onboarding) return renderOnboarding();
  switch (S.route.name) {
    case "group": return renderGroup();
    case "debts": return renderExitDebts();
    case "settings": return renderSettings();
    case "friends": return renderFriends();
    case "direct": return renderDirectChat();
    case "join": return renderJoin();
    default: return renderHome();
  }
}
const mainNav = (active) =>
  [["home", "/", "Groupes", "home"], ["friends", "/friends", "Messages", "mail"], ["debts", "/debts", "Dettes", "wallet"], ["settings", "/settings", "Réglages", "user"]]
    .map(([k, to, label, ic]) => `<button class="nav-item ${active === k ? "active" : ""}" data-act="nav" data-to="${to}">${ico(ic)}<span>${tr(label)}</span>${k==='friends'?notifBadge(notifFriendsCount()):''}</button>`).join("");

/* ---------- Barre latérale (version PC) ---------- */
let lastSidebar = "";
function paintSidebar(bare) {
  document.body.classList.toggle("bare", !!bare);
  document.body.dataset.route = S.route.name;
  const sb = $("#sidebar"); if (!sb) return;
  let html = "";
  if (!bare && S.user && S.profile) {
    const r = S.route, active = S.groups.filter((g) => !g.archived);
    const cur = r.name === "group" ? S.groups.find((g) => g.id === r.gid) : null;
    const it = (on, to, icn, label, count=0) => `<button class="sb-item ${on ? "active" : ""}" data-act="nav" data-to="${esc(to)}">${icn}<span class="grow ellipsis">${label}</span>${notifBadge(count)}</button>`;
    html = `<div class="sb-brand"><span class="sb-brand-mark"><img src="/logo.svg" alt="${APP_NAME}"></span><span class="sb-brand-copy"><strong>${APP_NAME}</strong><small>${tr('Dépenses partagées')}</small></span></div>
      ${!S.groups.length ? `<button class="btn brand sb-cta" data-act="new-group">${ico("plus", "sm")} ${tr('Nouveau groupe')}</button>` : cur?.archived ? "" : `<button class="btn brand sb-cta" data-act="fab">${ico("plus", "sm")} ${tr('Nouvelle dépense')}</button>`}
      <div class="sb-label">${tr('Navigation')}</div>
      ${it(r.name === "home", "/", ico("home", "sm"), tr("Accueil"))}${it(r.name === "friends" || r.name === "direct", "/friends", ico("users", "sm"), tr("Amis et messages"), notifFriendsCount())}${it(r.name === "settings", "/settings", ico("user", "sm"), tr("Réglages"))}${it(r.name === "debts", "/debts", ico("wallet", "sm"), tr("Remboursements hors groupe"))}
      ${active.length ? `<div class="sb-label">${tr('Mes groupes')}</div>${active.slice(0, 12).map((g) => it(r.name === "group" && r.gid === g.id, `/g/${g.id}`, `<span class="sb-emoji">${groupIcon(g.emoji || "🧾")}</span>`, esc(g.name),notifGroupCount(g.id))).join("")}` : ""}
      ${cur ? `<div class="sb-label">${esc(cur.name)}</div>${GROUP_TABS.map(([k, l, ic]) => it(r.tab === k, `/g/${cur.id}/${k}`, ico(ic, "sm"), tr(l), k==='chat'?notifCount('group',cur.id,'chatReadAt'):k==='expenses'?notifCount('group',cur.id,'expenseReadAt'):0)).join("")}` : ""}
      <div class="sb-spacer"></div>
      <button class="sb-user" data-act="nav" data-to="/settings">${avatar({ uid:myUid(), name: S.profile.displayName || "?", color: S.profile.avatarColor }, "sm")}<span class="grow" style="min-width:0"><b class="ellipsis" style="display:block">${esc(S.profile.displayName || tr('Sans nom'))}</b><span class="muted ellipsis" style="display:block;font-size:12.5px">${S.user.isAnonymous ? tr("Compte invité") : esc(S.user.email || "")}</span></span></button>`;
  }
  if (html !== lastSidebar) { sb.innerHTML = html; lastSidebar = html; }
}

/* ---------- Configuration Firebase manquante ---------- */
function renderSetup() {
  paint({ bare: true, body: `<div class="auth"><div class="col" style="align-items:center"><div class="logo"><img src="/logo.svg" alt="Kortiz"></div><h1 class="h-large center">Configuration requise</h1></div>
    <div class="card pad col"><p>Ouvre <b>index.html</b> et remplace les valeurs <code>VOTRE_…</code> de l'objet <code>firebaseConfig</code> (tout en haut du script) par celles de ton projet Firebase.</p>
    <p class="muted">Le guide de déploiement (GUIDE.md) explique où les trouver.</p></div></div>` });
}

function renderPublicLanding() {
  const content = `<div aria-label="Présentation de Kortiz" class="mk-page lp-page">
<div aria-hidden="true" class="lp-ambient"><span class="lp-glow lp-glow-a"></span><span class="lp-glow lp-glow-b"></span><span class="lp-glow lp-glow-c"></span></div>

<header class="lp-header" id="haut">
<div class="lp-header-inner">
<a aria-label="Kortiz — Accueil" class="lp-brand" href="/decouvrir.html"><span class="lp-brand-img"><img alt="" height="26" src="/logo.svg" width="26"/></span><strong>Kortiz</strong></a>
<nav aria-label="Navigation de présentation" class="lp-nav" id="lp-nav">
<a data-landing-scroll="" href="#fonctionnalites">Fonctionnalités</a>
<a data-landing-scroll="" href="#faq">FAQ</a>
<a href="/contact.html">Contact</a>
<a class="lp-menu-get-started" href="/?entry=guide" data-landing-go="guide">Commencer <span aria-hidden="true">↗</span></a>
</nav>
<div class="lp-header-end"><a class="lp-login lp-link-go" data-landing-go="login" href="/?entry=login">Connexion <span aria-hidden="true">↗</span></a>
<button aria-controls="lp-nav" aria-expanded="false" aria-label="Ouvrir le menu" class="lp-mobile-toggle" data-landing-menu="" type="button"><span></span><span></span></button>
</div>
</div>
</header>
<main class="lp-content">
<section aria-labelledby="lp-title" class="lp-hero">
<h1 class="lp-enter-1" id="lp-title"><span>Les dépenses de groupe.</span><span class="lp-shine">Sans prise de tête.</span></h1>
<p class="lp-hero-sub lp-enter-2">Kortiz aide les colocs, groupes d’amis, couples et voyageurs à prévoir un budget, suivre les dépenses, organiser les remboursements et discuter au même endroit — sans transférer d’argent directement dans l’application.</p>
<a class="lp-button lp-button-light lp-link-go lp-enter-3" data-landing-go="guide" href="/?entry=guide">Commencer <span aria-hidden="true">↗</span></a>
<p class="lp-hero-micro lp-enter-4">Gratuit pour commencer · Accessible sur mobile et ordinateur</p>
</section>
<section aria-label="Aperçu de Kortiz" class="lp-showcase lp-reveal">
<div aria-hidden="true" class="lp-macbar"><span class="lp-traffic"><i></i><i></i><i></i></span><strong>Kortiz</strong><span>Voyage à Paris · Aperçu</span></div>
<div class="lp-preview-grid">
<aside aria-hidden="true" class="lp-preview-side">
<span class="lp-preview-symbol"><img alt="" height="23" src="/logo.svg" width="23"/> Kortiz</span>
<div class="lp-preview-label">ESPACE GROUPE</div>
<div class="lp-preview-link selected"><span>▦</span> Aperçu</div>
<div class="lp-preview-link"><span>▱</span> Dépenses</div>
<div class="lp-preview-link"><span>▤</span> Prévisions</div>
<div class="lp-preview-link"><span>↗</span> Soldes</div>
<div class="lp-preview-link"><span>◌</span> Discussion</div>
<span class="lp-preview-bottom">Les moments comptent.</span>
</aside>
<div class="lp-preview-main">
<div class="lp-preview-top"><div><span class="lp-overline">GROUPE / VOYAGE</span><h2>Voyage à Paris</h2><p>Planifier ensemble, sans surprise.</p></div><span class="lp-preview-members">4 personnes</span></div>
<div class="lp-preview-budget"><span>Budget du groupe</span><strong>1 200,00 €</strong><div class="lp-preview-bar"><span style="width:68%"></span></div><div class="lp-preview-budget-leg"><span>Déjà dépensé <b>340 €</b></span><span>Prévu <b>476 €</b></span><span>Disponible <b>384 €</b></span></div></div>
<div class="lp-preview-list-head"><strong>Dépenses &amp; prévisions</strong><span>Aperçu illustratif</span></div>
<div class="lp-preview-expense"><span class="lp-preview-expense-ico">⌂</span><div><strong>Hébergement</strong><small>Prévu · Groupe</small></div><b>320 €</b></div>
<div class="lp-preview-expense"><span class="lp-preview-expense-ico">◇</span><div><strong>Restaurant</strong><small>Payé · Brenda</small></div><b>120 €</b></div>
<div class="lp-preview-expense"><span class="lp-preview-expense-ico">↗</span><div><strong>Transport</strong><small>Prévu · Groupe</small></div><b>156 €</b></div>
</div>
<aside class="lp-preview-detail">
<span class="lp-overline">LES SOLDES</span><h3>Tout est clair.</h3><p>Suivez qui a payé et qui doit rembourser, au même endroit.</p>
<div class="lp-preview-payment"><span>À rembourser</span><strong>25,00 €</strong><small>Exemple de suivi de règlement</small></div>
<div class="lp-preview-chat"><div class="lp-preview-message">On réserve pour samedi ?</div><div class="lp-preview-message mine">Oui, je l’ajoute aux prévisions !</div></div>
</aside>
</div>
</section>
<div class="lp-infobar lp-reveal"><span>UN MÊME ESPACE POUR</span><div><span>Les voyages</span><i>·</i><span>La colocation</span><i>·</i><span>Les restaurants</span><i>·</i><span>Les sorties</span></div></div>
<section class="mk-section lp-section lp-reveal lp-mobile-section" id="mobile">
<div class="mk-section-head">
<span>Présentation mobile</span>
<h2>Conçu pour aller vite sur téléphone.</h2>
<p class="mk-section-intro">Une interface claire pour consulter un groupe, suivre un budget et confirmer un remboursement sans perdre de temps.</p>
</div>
<div class="lp-mobile-layout">
  <div class="lp-phone-shell" aria-hidden="true">
    <div class="lp-phone-top"></div>
    <div class="lp-phone-screen">
      <div class="lp-phone-card big"><span>Budget voyage</span><strong>1 200 €</strong><small>Prévu 476 € · Dépensé 340 €</small></div>
      <div class="lp-phone-row"><span>Dîner</span><b>84 €</b></div>
      <div class="lp-phone-row"><span>Train</span><b>156 €</b></div>
      <div class="lp-phone-row"><span>À rembourser</span><b>25 €</b></div>
    </div>
  </div>
  <div class="lp-mobile-copy">
    <article class="lp-mini-card"><span class="lp-mini-ico" aria-hidden="true"><svg viewBox="0 0 24 24"><rect x="7" y="2.5" width="10" height="19" rx="2.5"></rect><path d="M10 5.5h4"></path><path d="M11 18.5h2"></path></svg></span><div><h3>Lecture immédiate</h3><p>Les informations clés restent visibles dès l’ouverture : solde, groupe, dépenses récentes et budget.</p></div></article>
    <article class="lp-mini-card"><span class="lp-mini-ico" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M4 12h16"></path><path d="M12 4v16"></path></svg></span><div><h3>Actions rapides</h3><p>Créer une dépense, inviter un ami ou rejoindre un groupe reste accessible même sur petit écran.</p></div></article>
    <article class="lp-mini-card"><span class="lp-mini-ico" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M12 3 4 7v5c0 5 3.4 8.6 8 9 4.6-.4 8-4 8-9V7l-8-4Z"></path><path d="m9.5 12 1.7 1.7 3.6-3.6"></path></svg></span><div><h3>Parcours rassurant</h3><p>Les confirmations, demandes de remboursement et coordonnées de paiement sont expliquées sans jargon.</p></div></article>
  </div>
</div>
</section>
<section class="mk-section mk-section-alt lp-section lp-reveal" id="interactive-preview">
<div class="mk-section-head">
<span>Aperçu interactif</span>
<h2>Découvrir Kortiz en quelques gestes.</h2>
<p class="mk-section-intro">Choisis un angle pour voir ce que l’utilisateur comprend tout de suite en arrivant sur l’application.</p>
</div>
<div class="lp-interactive">
  <div class="lp-tablist" role="tablist" aria-label="Aperçu interactif de Kortiz">
    <button class="lp-tab is-active" type="button" data-preview-tab="budget" role="tab" aria-selected="true">Budget</button>
    <button class="lp-tab" type="button" data-preview-tab="expenses" role="tab" aria-selected="false">Dépenses</button>
    <button class="lp-tab" type="button" data-preview-tab="refunds" role="tab" aria-selected="false">Remboursements</button>
    <button class="lp-tab" type="button" data-preview-tab="chat" role="tab" aria-selected="false">Discussion</button>
  </div>
  <div class="lp-demo-controls"><span class="lp-demo-caption">Une démonstration avec des données fictives</span><span class="lp-demo-progress" aria-hidden="true"><i></i></span><button type="button" class="lp-demo-toggle" data-preview-play aria-pressed="false" aria-label="Mettre la démo en pause"><span data-preview-icon>Ⅱ</span><span data-preview-play-label>Pause</span></button></div>
  <div class="lp-interactive-panels">
    <article class="lp-interactive-panel is-active" data-preview-panel="budget">
      <div><span class="lp-overline">VISION GLOBALE</span><h3>Voir le budget avant les surprises.</h3><p>Le groupe peut définir un plafond indicatif, ajouter des prévisions et comparer ensuite avec les dépenses réelles.</p></div>
      <div class="lp-demo-card"><span>Budget du groupe</span><strong>1 200 €</strong><div class="lp-preview-bar"><span style="width:72%"></span></div><small>Disponible 384 €</small></div>
    </article>
    <article class="lp-interactive-panel" data-preview-panel="expenses">
      <div><span class="lp-overline">SUIVI CLAIR</span><h3>Ajouter et relire les dépenses facilement.</h3><p>Chaque ajout reste lisible : titre, montant, payeur, catégorie et participants concernés.</p></div>
      <div class="lp-demo-list"><div><span>Courses</span><b>42 €</b></div><div><span>Restaurant</span><b>120 €</b></div><div><span>Transport</span><b>156 €</b></div></div>
    </article>
    <article class="lp-interactive-panel" data-preview-panel="refunds">
      <div><span class="lp-overline">REMBOURSEMENTS</span><h3>Savoir qui doit payer, sans confusion.</h3><p>Kortiz calcule les soldes et suit les confirmations. L’argent circule en dehors de l’application, mais le suivi reste propre.</p></div>
      <div class="lp-demo-card"><span>À rembourser</span><strong>25 €</strong><small>Brenda → Carlos</small></div>
    </article>
    <article class="lp-interactive-panel" data-preview-panel="chat">
      <div><span class="lp-overline">COORDINATION</span><h3>Discuter au même endroit.</h3><p>Les groupes peuvent préparer un resto, un week-end ou un voyage sans alterner entre plusieurs applications.</p></div>
      <div class="lp-demo-chat"><p>On réserve pour vendredi ?</p><p class="mine">Oui, je l’ajoute aux prévisions.</p></div>
    </article>
  </div>
</div>
</section>
<section class="mk-section lp-section lp-reveal" id="cas-usage">
<div class="mk-section-head">
<span>Cas d’usage</span>
<h2>Kortiz s’adapte à plusieurs moments du quotidien.</h2>
</div>
<div class="lp-usecases">
  <article class="lp-usecase-card"><span class="mk-step-icon" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M3 11 12 4l9 7"></path><path d="M6 10v10h12V10"></path></svg></span><h3>Colocation</h3><p>Courses, internet, ménage, charges communes : chacun voit où en sont les comptes.</p></article>
  <article class="lp-usecase-card"><span class="mk-step-icon" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M2 11.5 21 3l-7.2 18-2.6-6.2L2 11.5Z"></path><path d="M11.2 14.8 21 3"></path></svg></span><h3>Voyage</h3><p>Prévoir un budget, répartir l’hébergement, le transport et les repas dans un même espace.</p></article>
  <article class="lp-usecase-card"><span class="mk-step-icon" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M4 6h2l2.2 8.4a1 1 0 0 0 1 .8h8.8a1 1 0 0 0 1-.76L21 8H7"></path><circle cx="10" cy="19" r="1.3"></circle><circle cx="17" cy="19" r="1.3"></circle></svg></span><h3>Sortie / restaurant</h3><p>Créer un groupe éphémère, ajouter le repas et confirmer rapidement les remboursements.</p></article>
  <article class="lp-usecase-card"><span class="mk-step-icon" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M6 8h12"></path><path d="M8 5h8"></path><path d="M7 11h10"></path><path d="M7 14h10"></path><path d="M8 17h8"></path><path d="M9 20h6"></path></svg></span><h3>Pot commun</h3><p>Préparer les dépenses à venir, suivre les contributions et garder l’historique clair pour tous.</p></article>
</div>
</section>
<section class="mk-section lp-section lp-reveal" id="nouveautes-v28">
  <div class="mk-section-head"><span>Nouveautés Kortiz v28</span><h2>Organiser ensemble, au-delà des dépenses.</h2><p class="mk-section-intro">Un calendrier partagé, des votes pour décider à plusieurs et une meilleure visibilité sur les échéances récurrentes. Les comptes restent séparés de la planification.</p></div>
  <div class="lp-v28-grid">
    <article class="lp-v28-card"><span class="lp-v28-icon" aria-hidden="true"><svg viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M7 3v4M17 3v4M3 10h18M7 14h3M14 14h3"/></svg></span><h3>Calendrier partagé</h3><p>Retrouvez les dépenses prévues et les échéances de chaque groupe sur un calendrier commun, avec les montants estimés.</p></article>
    <article class="lp-v28-card"><span class="lp-v28-icon" aria-hidden="true"><svg viewBox="0 0 24 24"><rect x="4" y="3" width="16" height="18" rx="2"/><path d="m8 9 2 2 4-4M8 16h8"/></svg></span><h3>Votes et sondages</h3><p>Créez des sondages dans les discussions de groupe et privées pour choisir ensemble un restaurant, une activité, une date ou un budget.</p></article>
    <article class="lp-v28-card"><span class="lp-v28-icon" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M20 7v5h-5M4 17v-5h5"/><path d="M5.5 9a7.5 7.5 0 0 1 12.8-2L20 12M4 12l1.7 5a7.5 7.5 0 0 0 12.8-2"/></svg></span><h3>Dépenses régulières</h3><p>Retrouvez vos loyers et abonnements, consultez les prochaines occurrences et arrêtez une récurrence sans effacer l'historique.</p></article>
    <article class="lp-v28-card"><span class="lp-v28-icon" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9M10 21h4"/></svg></span><h3>Notifications personnalisées</h3><p>Choisissez les alertes qui vous intéressent et mettez un groupe en sourdine sans le quitter.</p></article>
    <article class="lp-v28-card"><span class="lp-v28-icon" aria-hidden="true"><svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c-6 6-6 12 0 18M12 3c6 6 6 12 0 18"/></svg></span><h3>Soldes en plusieurs devises</h3><p>Consultez votre solde global dans la devise de votre choix, avec une conversion indicative et des taux de change actualisés.</p></article>
  </div>
  <p class="lp-v28-note">Les prévisions et les votes ne créent pas de dette. Les rappels des dépenses régulières s'affichent dans l'application ; aucune alerte push d'échéance n'est promise.</p>
</section>
<section class="mk-section lp-section lp-reveal" id="retours-usage">
  <div class="mk-section-head"><span>Ils pourraient utiliser Kortiz</span><h2>À chacun son groupe, à chacun ses projets.</h2><p class="mk-section-intro">Voici des mises en situation fictives, pour illustrer les usages de Kortiz. Ce ne sont pas des avis clients vérifiés.</p></div>
  <div class="lp-story-grid">
    <article class="lp-story-card"><blockquote>« On part à six. Chacun ajoute ses dépenses prévues, et on sait tout de suite où en est le budget. »</blockquote><div class="lp-story-foot">Exemple fictif · Groupe de voyage</div></article>
    <article class="lp-story-card"><blockquote>« Plus besoin de recalculer les courses et les factures dans une discussion : tout reste dans le groupe. »</blockquote><div class="lp-story-foot">Exemple fictif · Colocation</div></article>
    <article class="lp-story-card"><blockquote>« On prévoit le dîner, puis la personne qui reçoit l’argent confirme simplement le remboursement. »</blockquote><div class="lp-story-foot">Exemple fictif · Sortie entre amis</div></article>
  </div>
</section>
<section class="mk-section mk-section-alt lp-section lp-reveal" id="guide-iban-wero">
<div class="mk-section-head">
<span>Guide IBAN / Wero</span>
<h2>Pourquoi renseigner ses coordonnées de remboursement ?</h2>
<p class="mk-section-intro">L’utilisateur reste libre de partager ou non ces informations. Lorsqu’il le fait, le groupe comprend mieux comment le rembourser.</p>
</div>
<div class="lp-iban-grid">
  <article class="lp-iban-card"><span class="mk-trust-symbol" aria-hidden="true"><svg viewBox="0 0 24 24"><rect x="3" y="6" width="18" height="12" rx="2"></rect><path d="M3 10h18"></path><path d="M7 14h4"></path></svg></span><h3>Gagner du temps</h3><p>Ajouter un IBAN ou un contact Wero évite les allers-retours au moment de rembourser.</p></article>
  <article class="lp-iban-card"><span class="mk-trust-symbol" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M4 12h16"></path><path d="m13 5 7 7-7 7"></path></svg></span><h3>Réduire les erreurs</h3><p>Le groupe voit directement quelle méthode privilégier, au lieu de demander les coordonnées à la dernière minute.</p></article>
  <article class="lp-iban-card"><span class="mk-trust-symbol" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M12 3 4 7v5c0 5 3.4 8.6 8 9 4.6-.4 8-4 8-9V7l-8-4Z"></path><path d="m9.5 12 1.7 1.7 3.6-3.6"></path></svg></span><h3>Garder le contrôle</h3><p>Le partage reste optionnel et peut être activé ou désactivé depuis le profil, selon les préférences de l’utilisateur.</p></article>
</div>
<div class="lp-guide-note">Lorsqu’un utilisateur ouvre pour la première fois le réglage IBAN / Wero, un guide peut lui expliquer le bénéfice, le fonctionnement et le choix d’affichage.</div>
</section>
<section class="mk-section lp-section lp-reveal" id="fonctionnalites">
<div class="mk-section-head">
<span>Pourquoi Kortiz</span>
<h2>Une application pensée pour la vraie vie de groupe.</h2>
</div>
<div class="mk-feature-grid">
<article class="mk-feature-card">
<div class="mk-feature-icon" aria-hidden="true"><svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M7 3v4M17 3v4M4 9h16M6 5h12a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2Z"/><path d="M8 13h3M8 17h5"/></svg></div>
<h3>Prévoir avant de dépenser</h3>
<p>Créez des dépenses prévues pour un voyage, un week-end ou un restaurant, puis comparez le budget prévu aux dépenses réelles.</p>
</article>
<article class="mk-feature-card">
<div class="mk-feature-icon" aria-hidden="true"><svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M7 7h10v10"/><path d="m17 7-4 4"/><path d="M17 17H7V7"/><path d="m7 17 4-4"/></svg></div>
<h3>Suivre qui doit quoi</h3>
<p>Les soldes sont calculés automatiquement, y compris lorsque quelqu’un quitte un groupe et que sa dette doit continuer à être suivie hors groupe.</p>
</article>
<article class="mk-feature-card">
<div class="mk-feature-icon" aria-hidden="true"><svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M12 3 5 6v6c0 4.6 2.9 7.9 7 9 4.1-1.1 7-4.4 7-9V6l-7-3Z"/><path d="m9.5 12.5 1.8 1.8 3.7-4"/></svg></div>
<h3>Confirmer les remboursements clairement</h3>
<p>Kortiz suit les remboursements. L’application ne déplace pas l’argent : elle enregistre simplement les confirmations de paiement de manière sécurisée.</p>
</article>
</div>
</section>
<section class="mk-section mk-section-alt lp-section lp-reveal">
<div class="mk-section-head">
<span>Comment ça marche</span>
<h2>3 étapes pour commencer avec ton groupe.</h2>
</div>
<div class="mk-steps">
<article class="mk-step-card"><div class="mk-step-icon" aria-hidden="true"><svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M16 19a4 4 0 0 0-8 0"/><circle cx="12" cy="11" r="3"/><path d="M19 8v6"/><path d="M16 11h6"/><path d="M5 18a3.5 3.5 0 0 1 3.2-3.4"/></svg></div><h3>Créer ou rejoindre un groupe</h3><p>Coloc, vacances, pot commun ou repas : choisis le contexte qui te correspond.</p></article>
<article class="mk-step-card"><div class="mk-step-icon" aria-hidden="true"><svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M7 3h10v18l-2-1.5L12 21l-3-1.5L7 21V3Z"/><path d="M9 8h6M9 12h6M9 16h4"/></svg></div><h3>Ajouter dépenses et prévisions</h3><p>Ajoute les frais réels, mais aussi les dépenses prévues et un budget optionnel pour garder le cap.</p></article>
<article class="mk-step-card"><div class="mk-step-icon" aria-hidden="true"><svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M4 6.5A2.5 2.5 0 0 1 6.5 4h11A2.5 2.5 0 0 1 20 6.5v7A2.5 2.5 0 0 1 17.5 16H10l-4 4v-4H6.5A2.5 2.5 0 0 1 4 13.5v-7Z"/><path d="M8 9h8M8 12h5"/></svg></div><h3>Discuter et suivre les remboursements</h3><p>Les membres échangent dans le groupe, puis confirment les règlements pour garder des comptes propres.</p></article>
</div>
</section>
<section class="mk-section mk-about-section lp-section lp-reveal" id="apropos">
<div class="mk-about-layout">
<div class="mk-about-intro">
<span class="mk-eyebrow">À propos de Kortiz</span>
<h2>Moins de calculs, plus de moments ensemble.</h2>
<p>Kortiz est un projet indépendant conçu pour simplifier l’organisation des dépenses partagées : une colocation, un voyage entre amis, une soirée ou un restaurant. Chaque groupe retrouve ses frais réels, ses prévisions et ses conversations au même endroit.</p>
<p>L’objectif est de rendre les comptes compréhensibles pour tous, sans obliger les membres à réaliser les paiements à l’intérieur de Kortiz.</p>
<a class="mk-inline-link" href="#faq">Lire notre présentation complète <span aria-hidden="true">↗</span></a>
</div>
<div aria-label="Notre démarche" class="mk-about-quote">
<div class="mk-about-index">K / 01</div>
<p>Prévoir ensemble. Dépenser sereinement. Savoir qui rembourse qui.</p>
<div class="mk-about-foot">Pensé pour les groupes du quotidien.</div>
</div>
</div>
</section>
<section class="mk-section lp-section lp-reveal" id="confiance">
<div class="mk-section-head">
<span>Transparence et confiance</span>
<h2>Tu gardes le contrôle de tes comptes.</h2>
</div>
<div class="mk-trust-grid">
<article class="mk-trust-card">
<span class="mk-trust-symbol" aria-hidden="true"><svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M3 9 12 4l9 5"/><path d="M5 10v8M9.5 10v8M14.5 10v8M19 10v8"/><path d="M3 20h18"/></svg></span>
<h3>Pas de fonds détenus par Kortiz</h3>
<p>Kortiz ne conserve pas ton argent et ne déclenche aucun virement. Les remboursements sont réalisés séparément, puis déclarés et confirmés par les personnes concernées.</p>
</article>
<article class="mk-trust-card">
<span class="mk-trust-symbol" aria-hidden="true"><svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 1 1 8 0v3"/><path d="M12 15v2"/></svg></span>
<h3>Données et préférences</h3>
<p>Tu peux gérer ton profil et exporter tes données. Les règles d’accès des groupes et des conversations sont prévues pour limiter qui consulte les informations partagées.</p>
</article>
<article class="mk-trust-card">
<span class="mk-trust-symbol" aria-hidden="true"><svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><rect x="3" y="5" width="14" height="10" rx="2"/><path d="M8 19h4"/><path d="M10 15v4"/><rect x="18" y="9" width="3" height="8" rx="1.2"/></svg></span>
<h3>Disponible sur plusieurs appareils</h3>
<p>Kortiz est une application web installable sur l’écran d’accueil de nombreux téléphones. Il est également accessible depuis un navigateur sur ordinateur ou tablette.</p>
</article>
</div>
<p class="mk-trust-note">Pour connaître les données traitées, les durées de conservation et tes droits, consulte nos documents de confidentialité. Les confirmations de remboursement sont déclaratives et ne constituent pas une preuve bancaire.
        <a href="/legal.html#privacy">Lire la politique de confidentialité</a>.</p>
</section>
<section class="mk-section mk-faq-section lp-section lp-reveal" id="faq">
<div class="mk-section-head">
<span>FAQ</span>
<h2>Les réponses aux questions fréquentes.</h2>
<p class="mk-section-intro">Voici comment Kortiz fonctionne avant de créer ton premier groupe.</p>
</div>
<div class="lp-faq-search"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="6.5"></circle><path d="m16 16 4 4"></path></svg><input type="search" id="lp-faq-search" autocomplete="off" placeholder="Rechercher une question…" aria-label="Rechercher dans la FAQ"><button type="button" data-faq-clear hidden>Effacer</button></div>
<p class="lp-faq-results" id="lp-faq-results" role="status" aria-live="polite"></p>
<div class="lp-faq-empty" id="lp-faq-empty" hidden>Aucun résultat. Essaie un autre mot-clé ou <a href="/contact.html">contacte Kortiz</a>.</div>
<div class="mk-faq-list">
<details class="mk-faq-item"><summary>À quoi sert Kortiz ?<span aria-hidden="true">+</span></summary><p>Kortiz organise les dépenses partagées, calcule les soldes entre membres et aide à suivre les remboursements. Tu peux également planifier des frais futurs et discuter avec ton groupe.</p></details>
<details class="mk-faq-item"><summary>Est-ce que Kortiz est gratuit ?<span aria-hidden="true">+</span></summary><p>L’accès aux fonctionnalités actuellement proposées est gratuit. Le service peut évoluer et présenter de la publicité ; tout changement important sera indiqué clairement.</p></details>
<details class="mk-faq-item"><summary>Est-ce que Kortiz effectue les virements ?<span aria-hidden="true">+</span></summary><p>Non. Kortiz ne réalise pas de paiement et ne vérifie pas directement les transactions bancaires. Il peut afficher des informations de remboursement SEPA ou Wero, à utiliser ensuite dans ton application bancaire.</p></details>
<details class="mk-faq-item"><summary>Peut-on fixer un budget avant un voyage ?<span aria-hidden="true">+</span></summary><p>Oui. Un groupe peut ajouter des dépenses prévisionnelles et son créateur peut fixer un plafond indicatif. Les prévisions ne modifient pas les dettes tant qu’elles ne deviennent pas des dépenses réelles.</p></details>
<details class="mk-faq-item"><summary>Que se passe-t-il si quelqu’un quitte un groupe avec une dette ?<span aria-hidden="true">+</span></summary><p>Le suivi des remboursements encore dus peut se poursuivre hors du groupe. Il s’agit d’un historique déclaratif qui ne remplace ni une preuve de paiement ni un titre juridique de créance.</p></details>
<details class="mk-faq-item"><summary>Comment installer Kortiz sur iPhone ou Android ?<span aria-hidden="true">+</span></summary><p>Sur iPhone, ouvre Kortiz dans Safari, touche Partager puis « Sur l’écran d’accueil ». Sur Android, utilise le menu du navigateur et choisis « Installer l’application » ou « Ajouter à l’écran d’accueil », si disponible.</p></details>
<details class="mk-faq-item"><summary>Comment demander la suppression de mes données ?<span aria-hidden="true">+</span></summary><p>Tu peux exporter tes données et demander la suppression de ton compte dans les réglages. Pour toute question relative à tes données personnelles, contacte l’éditeur depuis la section Contact.</p></details>
</div>
</section>
<section class="mk-section mk-contact-section lp-section lp-reveal" id="contact">
<div class="mk-contact-panel">
<div>
<span class="mk-eyebrow">Contact</span>
<h2>Une question, une idée ou un problème ?</h2>
<p>Tu peux nous contacter pour un bug visuel, un problème fonctionnel, une question, une suggestion ou une collaboration professionnelle. Nous avons préparé une vraie page de contact avec formulaire et e-mail de destination déjà configuré.</p>
<div class="mk-contact-meta">Éditeur indépendant · Colmar, France</div>
</div>
<a class="mk-btn mk-btn-primary mk-contact-email" href="/contact.html">Ouvrir la page contact <span aria-hidden="true">↗</span></a>
</div>
</section>
<section class="mk-section mk-final-cta lp-section lp-reveal">
<div>
<span>Prêt à essayer ?</span>
<h2>Organise tes dépenses partagées avec Kortiz.</h2>
<p>Inscris-toi, choisis ton pseudo, crée un groupe et commence à suivre ton budget en quelques minutes.</p>
</div>
<a class="lp-button lp-button-light lp-link-go" data-landing-go="guide" href="/?entry=guide">Commencer</a></section>
<footer class="mk-footer lp-footer">
<div class="mk-footer-brand">Kortiz · Partage de dépenses et suivi de remboursements</div>
<div class="mk-footer-links">
<a href="/legal.html#privacy" rel="noopener" target="_blank">Confidentialité</a>
<a href="/legal.html#terms" rel="noopener" target="_blank">Conditions d’utilisation</a>
<a href="/legal.html#notice" rel="noopener" target="_blank">Mentions légales</a>
<a href="/legal.html#cookies" rel="noopener" target="_blank">Cookies</a>
<a data-landing-scroll="" href="#faq">FAQ</a>
<a href="/contact.html">Contact</a>
<a href="/decouvrir.html">Page publique</a>
</div>
</footer>
</main></div>`;
  paint({ bare: true, body: content });
  window.KortizLanding?.init(document.querySelector('.lp-page'));
}

/* ---------- Authentification ---------- */
S.authMode = "login"; S.authForm = { name: "", email: "" }; S.authErr = ""; S.authBusy = false;
function renderAuth() {
  const m = S.authMode, f = S.authForm;
  // Connexion / inscription = étape 3, AVANT la saisie du profil.
  const content = `<div class="welcome-hero compact"><div class="welcome-badge">${tr('Étape 3 · Compte')}</div><h1>${tr('Connexion ou inscription')}</h1><p>${tr('Connecte-toi ou crée un compte avant de choisir ton prénom, ton nom et ton pseudo.')}</p></div>
  <div class="welcome-auth">
    <div class="segmented"><button data-act="auth-mode" data-m="login" class="${m === 'login'?'on':''}">${tr('Connexion')}</button><button data-act="auth-mode" data-m="signup" class="${m === 'signup'?'on':''}">${tr('Inscription')}</button></div>
    ${S.authErr ? `<div class="err-msg" role="alert">${esc(S.authErr)}</div>` : ''}
    <div class="input-wrap">${ico('mail','sm')}<input id="au-email" class="input" data-in="auth-f" data-k="email" type="email" inputmode="email" placeholder="${tr('Adresse e-mail')}" autocomplete="email" autocapitalize="none" value="${esc(f.email)}"></div>
    <div class="input-wrap">${ico('lock','sm')}<input id="au-pw" class="input" type="password" placeholder="${tr('Mot de passe')}" autocomplete="${m==='login'?'current-password':'new-password'}"></div>
    <button class="btn brand" data-act="auth-submit" ${S.authBusy?'disabled':''}>${tr(m==='login'?'Se connecter':'Créer mon compte')}</button>
    ${m==='login' ? `<button class="link-btn center" data-act="auth-forgot">${tr('Mot de passe oublié ?')}</button>`:''}
    <div class="divider">${tr('ou')}</div>
    <button class="btn google" data-act="auth-google" ${S.authBusy?'disabled':''}>${ico('google')} ${tr('Continuer avec Google')}</button>
    <p class="hint center"><a href="#" data-open-consent>${tr('Préférences publicitaires')}</a> · <a href="/legal.html#privacy" target="_blank" rel="noopener">${tr('Confidentialité')}</a> · <a href="/legal.html#terms" target="_blank" rel="noopener">${tr('Conditions d’utilisation')}</a> · <a href="/legal.html#notice" target="_blank" rel="noopener">${tr('Mentions légales')}</a></p>
  </div>`;
  paintWelcomeFrame(3, content, '', { back: true });
}
INP["auth-f"] = (t) => { S.authForm[t.dataset.k] = t.value; };
ACT["auth-mode"] = (b) => { S.authMode = b.dataset.m; S.authErr = ""; scheduleRender(); };
ACT["marketing-start"] = () => { S.ui.publicScreen = "guide"; S.ui.publicReturn = "guide"; S.ui.onboardStep = 1; S.ui.reviewWelcome = true; scheduleRender(); };
ACT["marketing-guide"] = () => { S.ui.publicScreen = "guide"; S.ui.publicReturn = "guide"; S.ui.onboardStep = 1; S.ui.reviewWelcome = true; scheduleRender(); };
ACT["marketing-login"] = () => { S.ui.publicScreen = "auth"; S.ui.publicReturn = "landing"; S.authMode = "login"; S.authErr = ""; scheduleRender(); };
ACT["marketing-signup"] = () => { S.ui.publicScreen = "auth"; S.ui.publicReturn = "landing"; S.authMode = "signup"; S.authErr = ""; scheduleRender(); };
async function authRun(fn) {
  if (S.authBusy) return;
  S.authErr = ""; S.authBusy = true; scheduleRender();
  try { await fn(); } catch (e) { S.authErr = authError(e); console.warn(e); }
  S.authBusy = false; scheduleRender();
}
ACT["auth-submit"] = () => {
  const email = ($("#au-email")?.value || "").trim(), pw = $("#au-pw")?.value || "";
  S.authForm = { ...S.authForm, email };
  return authRun(async () => {
    if (!email) throw { code: "auth/missing-email" };
    if (!pw) throw { code: "auth/missing-password" };
    if (S.authMode === "signup") await signupEmail("", email, pw);
    else await loginEmail(email, pw);
  });
};
ACT["auth-google"] = () => authRun(loginGoogle);
ACT["auth-forgot"] = () => {
  const sh = openSheet({
    title: tr("Mot de passe oublié"),
    body: `<form id="forgot-form" class="col" novalidate><p class="muted">${tr("Saisis ton adresse e-mail : un lien de réinitialisation te sera envoyé si un compte existe.")}</p><label for="fg-email">${tr('Adresse e-mail')}</label><input id="fg-email" class="input" type="email" inputmode="email" autocomplete="email" autocapitalize="none" spellcheck="false" required placeholder="${tr('Adresse e-mail')}" value="${esc(S.authForm.email)}"><div id="fg-err" role="alert" aria-live="assertive"></div><div id="fg-result" role="status" aria-live="polite" hidden></div><p class="hint">${tr('Si tu utilises Google pour te connecter, choisis « Continuer avec Google » : il n’y a pas de mot de passe Kortiz à réinitialiser.')}</p></form>`,
    footer: `<button class="btn brand" type="submit" form="forgot-form" id="forgot-submit">${tr('Envoyer le lien')}</button>`,
    onMount: (modal) => modal.querySelector('#forgot-form')?.addEventListener('submit', (event) => {
      event.preventDefault();
      const button=modal.querySelector('#forgot-submit') || modal.parentElement?.querySelector('#forgot-submit');
      if(button && !button.disabled)ACT['forgot-send'](button);
    }),
  });
  setTimeout(() => { if (sh.el.isConnected) $("#fg-email", sh.el)?.focus(); }, 150);
};
ACT["forgot-send"] = async (b) => {
  const email = $("#fg-email")?.value?.trim() || '';
  const error = $("#fg-err"), result = $("#fg-result");
  if(error){error.textContent='';error.className='';}
  if(result){result.hidden=true;result.textContent='';}
  try {
    await withBusy(b, () => resetPassword(email));
    S.authForm.email=email;
    // Confirmation durable : un toast de 2 s pouvait donner l'impression
    // que le lien n'avait pas été envoyé.
    if(result){result.textContent=tr('Si cette adresse est liée à un compte e-mail, vérifie ta boîte de réception et les courriers indésirables.');result.className='banner';result.hidden=false;}
  } catch(e) {
    if(error){error.textContent=tr(authError(e));error.className='err-msg';}
    console.warn('Réinitialisation du mot de passe', e?.code || 'unknown');
  }
};


/* ---------- Guide avant connexion, compte puis profil obligatoire ---------- */
function paintWelcomeFrame(step, content, actions = '', {back=true} = {}) {
  const welcomeShowcase = `<aside class="welcome-showcase" aria-label="${tr('Présentation de Kortiz')}">
    <div class="welcome-showcase-brand"><span class="welcome-showcase-mark"><img src="/logo.svg" alt=""></span><span>${APP_NAME}</span><span class="welcome-showcase-chip">${tr('Guide de bienvenue')}</span></div>
    <div class="welcome-showcase-center">
      <div class="welcome-showcase-glow" aria-hidden="true"><span class="welcome-glow-one"></span><span class="welcome-glow-two"></span><span class="welcome-glow-three"></span></div>
      <div class="welcome-showcase-copy"><span class="welcome-showcase-eyebrow">${tr('BIENVENUE SUR KORTIZ')}</span><h2>${tr('Les comptes entre amis, simplifiés.')}</h2><p>${tr('Partage les dépenses, discute avec tes proches et suis les remboursements sans changer d’application.')}</p></div>
    </div>
    <div class="welcome-showcase-bottom"><span>${tr('Un espace pour vos dépenses, vos amis et vos groupes.')}</span><span class="welcome-showcase-page">${String(step).padStart(2,'0')} <i>/</i> 04</span></div>
  </aside>`;
  const progress = `<div class="welcome-progress">${[1,2,3,4].map(n=>`<span class="${n===step?'active':n<step?'done':''}">${n}</span>`).join('')}</div>`;
  const backButton = back ? `<button class="welcome-back" data-act="onboard-back" aria-label="${tr('Retour')}"><span aria-hidden="true">←</span></button>`
    : '<span class="welcome-stepbar-spacer" aria-hidden="true"></span>';
  paint({bare:true,body:`<section class="welcome-screen"><div class="welcome-shell">${welcomeShowcase}<div class="welcome-main"><div class="welcome-stepbar">${backButton}${progress}<span class="welcome-stepbar-spacer" aria-hidden="true"></span></div><div class="welcome-panel"><div class="logo welcome-logo"><img src="/logo.svg" alt="${APP_NAME}"></div><div class="center"><div class="welcome-topline">${tr('Guide rapide')}</div></div>${content}${actions?`<div class="welcome-actions">${actions}</div>`:''}</div></div></div></section>`});
}
function renderSocialProfileLoading() {
  const message = SOC.profileLoadError ? `<div class="err-msg" role="alert">${tr('Impossible de charger ton profil.')}</div><button class="btn soft" data-act="onboard-retry">${tr('Réessayer')}</button>`
    : `<p class="center muted" role="status">${tr('Chargement du profil…')}</p>`;
  paintWelcomeFrame(4, `<div class="welcome-hero compact"><h1>${tr('Préparons ton profil')}</h1></div>${message}`,'',{back:false});
}
function renderOnboarding() {
  const step = !S.user ? Math.max(1, Math.min(S.ui.onboardStep || 1,2)) : 4;
  const isIos = isIosDevice(), alreadyInstalled = isStandaloneApp();
  let content = '';
  if (step === 1) {
    content = `<div class="welcome-hero"><div class="welcome-badge">${APP_NAME}</div><h1>${tr('Bienvenue sur Kortiz')}</h1><p>${tr('Gère les dépenses de groupe, les remboursements et les discussions au même endroit.')}</p></div>
    <div class="welcome-cards"><article class="welcome-card"><span>1</span><div><b>${tr('Partager les dépenses')}</b><p>${tr('Crée ou rejoins un groupe pour une colocation, un voyage, un couple ou une sortie.')}</p></div></article><article class="welcome-card"><span>2</span><div><b>${tr('Suivre les remboursements')}</b><p>${tr('Ajoute les dépenses et laisse Kortiz calculer les soldes automatiquement.')}</p></div></article><article class="welcome-card"><span>3</span><div><b>${tr('Discuter en groupe')}</b><p>${tr('Discute dans le groupe, demande un remboursement et confirme les paiements en sécurité.')}</p></div></article></div>`;
  }
  if (step === 2) {
    const installBlock = isIos
      ? `<div class="ios-tip"><h3>${tr('Installer l’app sur iPhone')}</h3><ol><li>${tr('Ouvre Kortiz dans Safari.')}</li><li>${tr('Touche le bouton Partager en bas de l’écran.')}</li><li>${tr('Choisis “Sur l’écran d’accueil”.')}</li></ol><p>${tr('Ouvre l’application depuis l’écran d’accueil pour une meilleure expérience plein écran.')}</p></div>`
      : alreadyInstalled
        ? `<div class="ios-tip"><h3>${tr('Application installée')}</h3><p>${tr('Kortiz est déjà ajouté à l’écran d’accueil sur cet appareil.')}</p></div>`
        : `<div class="ios-tip"><h3>${tr('Installer l’application')}</h3><p>${tr('Ajoute Kortiz à l’écran d’accueil pour l’ouvrir comme une vraie app et recevoir plus facilement les notifications.')}</p>${S.installEvent ? `<button class="btn brand" data-act="install">${tr('Ajouter à l’écran d’accueil')}</button>` : `<p class="muted">${tr('Ton navigateur ne propose pas encore l’installation sur cette page.')}</p>`}</div>`;
    content = `<div class="welcome-hero compact"><div class="welcome-badge">${tr('Guide rapide')}</div><h1>${tr('Installe Kortiz comme une app')}</h1><p>${tr('Cela améliore le confort sur iPhone, iPad et Android.')}</p></div>${installBlock}`;
  }
  if (step === 4) {
    const displayName = String(S.profile?.displayName || S.user?.displayName || '').trim();
    const sep = displayName.indexOf(' ');
    const firstname = S.profile?.givenName || (sep >= 0 ? displayName.slice(0,sep) : displayName);
    const lastname = S.profile?.familyName || (sep >= 0 ? displayName.slice(sep+1) : '');
    const handle = SOC.self?.handle || '';
    content = `<div class="welcome-hero compact"><div class="welcome-badge">@ ${tr('Pseudo')}</div><h1>${tr('Finalise ton profil')}</h1><p>${tr('Renseigne ton prénom, ton nom et un pseudo unique pour accéder à Kortiz.')}</p></div>
    <form class="welcome-form card pad" id="onboard-profile-form"><div class="welcome-name-fields"><div class="field"><label for="ob-first">${tr('Prénom')}</label><input id="ob-first" name="givenName" class="input" maxlength="40" autocomplete="given-name" required value="${esc(firstname)}"></div><div class="field"><label for="ob-last">${tr('Nom de famille')}</label><input id="ob-last" name="familyName" class="input" maxlength="40" autocomplete="family-name" required value="${esc(lastname)}"></div></div><div class="field"><label for="ob-handle">${tr('Pseudo unique')}</label><div class="welcome-handle-input"><span aria-hidden="true">@</span><input id="ob-handle" name="handle" class="input" maxlength="24" autocapitalize="none" spellcheck="false" autocomplete="off" required value="${esc(handle)}" placeholder="${tr('Ex. carlosdc')}"></div><p class="hint">${tr('3 à 24 caractères : commence par une lettre, puis lettres, chiffres ou tiret bas.')}</p></div><button class="btn brand welcome-submit" type="submit" id="onboard-save">${tr('Terminer')}</button></form>`;
  }
  const actions = step === 4
    ? `<button class="btn soft" data-act="onboard-logout">${tr('Changer de compte')}</button>`
    : `${step === 2 ? `<button class="btn soft" data-act="onboard-back">${tr('Retour')}</button>` : '<span></span>'}<button class="btn brand" data-act="onboard-next">${tr('Continuer')}</button>`;
  paintWelcomeFrame(step, content, actions, {back:step===2});
}
ACT['onboard-next']=()=>{
  if(S.user)return;
  S.ui.onboardStep = Math.min((S.ui.onboardStep || 1) + 1, 3);
  if(S.ui.onboardStep === 3){markWelcomeViewed();S.ui.reviewWelcome=false;}
  scheduleRender();
};
ACT['onboard-back']=()=>{
  if(S.user)return;
  // A direct marketing connection has to return to the public landing.
  if (S.ui.publicScreen === 'auth' && S.ui.publicReturn === 'landing') {
    S.ui.publicScreen = 'landing';
    S.ui.onboardStep = 1;
    S.ui.reviewWelcome = false;
    scheduleRender();
    return;
  }
  S.ui.publicScreen = 'guide';
  S.ui.onboardStep = Math.max((S.ui.onboardStep || 1) - 1, 1);
  S.ui.reviewWelcome=true;
  scheduleRender();
};
ACT['onboard-logout']=async()=>{
  if(S.user?.isAnonymous && !(await confirmDialog({title:tr('Changer de compte'),message:tr('Attention : en mode invité, tu perdras l’accès à ton compte temporaire si tu te déconnectes.'),ok:tr('Se déconnecter'),danger:true})))return;
  try {await doLogout();S.ui.onboardStep=3;S.ui.reviewWelcome=false;scheduleRender();}
  catch(e){toast(errMsg(e),'err');}
};
ACT['onboard-retry']=()=>{SOC.activeUid=null;SOC.profileLoadError=null;startSocial().catch(console.warn);scheduleRender();};
ACT['onboard-finish']=async (button)=>{
  const first = ($('#ob-first')?.value || '').trim().replace(/\s+/g,' ');
  const last = ($('#ob-last')?.value || '').trim().replace(/\s+/g,' ');
  const handle = normalizeHandle($('#ob-handle')?.value || '');
  if (!first || !last) return toast(tr('Prénom et nom obligatoires.'), 'err');
  if (first.length > 40 || last.length > 40 || (first+' '+last).length > 60) return toast(tr('Nom trop long.'),'err');
  if (!validHandle(handle)) return toast(tr('Pseudo : 3 à 24 caractères, lettres, chiffres et tiret bas.'),'err');
  if(!SOC.self)return toast(tr('Chargement du profil…'),'err');
  const name=`${first} ${last}`;
  try {
    await withBusy(button, async()=>{
      await call('saveSocialProfile',{displayName:name,handle});
      // Les règles n'autorisent que ces champs validés ; aucun droit de groupe n'est modifié.
      await saveProfile({displayName:name,givenName:first,familyName:last,onboardingDone:true});
      try{await updateProfile(auth.currentUser,{displayName:name});}catch(_){}
      SOC.self={...SOC.self,displayName:name,handle};
      SOC.profiles.set(myUid(),SOC.self);
      S.ui.onboardStep=4;
      scheduleRender();
    });
    toast(tr('Ton espace est prêt.'));
  }catch(e){console.warn('Onboarding profile',e);toast(errMsg(e),'err');}
};
// Le formulaire est soumis au clic ou avec Entrée sans navigation/rechargement.
document.addEventListener('submit',e=>{
  if(e.target.id!=='onboard-profile-form')return;
  e.preventDefault();
  const button=e.target.querySelector('#onboard-save');
  if(button && !button.disabled)ACT['onboard-finish'](button);
});

/* ---------- v28: préférences de devise et taux actualisés ---------- */
const FX = { data:null, fetchedAt:0, state:'idle', error:'',retryAfter:0, pendingCurrency:null, currencySaving:false, currencySelectionVersion:0 };
// Sérialise les sauvegardes pour éviter qu'une réponse Firestore ancienne écrase le dernier choix.
let currencySaveQueue=Promise.resolve();
const currencyAPI = window.KortizCurrency;
const FX_CACHE_KEY='kortiz.rates.eur.v28';
const FX_TTL=24*60*60*1000;
try {
  const saved=JSON.parse(localStorage.getItem(FX_CACHE_KEY)||'null');
  if(saved&&currencyAPI.validRates(saved.data)&&Number.isFinite(saved.fetchedAt)){
    FX.data=saved.data;FX.fetchedAt=saved.fetchedAt;FX.state='cached';
  }
}catch(e){}
function displayCurrency(){
  const pref=FX.pendingCurrency || S.profile?.displayCurrency;
  return currencyAPI.DISPLAY_CURRENCIES.includes(pref)?pref:'EUR';
}
async function refreshExchangeRates(force=false){
  if(FX.state==='loading'||(!force&&Date.now()<FX.retryAfter)||(!force&&FX.data&&Date.now()-FX.fetchedAt<FX_TTL))return;
  FX.state='loading'; FX.error='';
  try{
    let data;
    try {
      // Fournisseur quotidien avec couverture large (inclut BRL, ARS, CLP, MAD, etc.).
      // Attribution affichée dans le tableau de bord conformément à ses conditions.
      const res=await fetch('https://open.er-api.com/v6/latest/EUR',{cache:'no-store',signal:AbortSignal.timeout(9000)});
      if(!res.ok)throw Error('HTTP '+res.status);
      const payload=await res.json();
      if(payload.result!=='success'||!payload.time_last_update_unix||payload.base_code!=='EUR')throw Error('Réponse change invalide');
      data={date:new Date(payload.time_last_update_unix*1000).toISOString().slice(0,10),rates:payload.rates,provider:'ExchangeRate-API'};
    }catch(firstError){
      // Fallback : Frankfurter publie les taux des jours ouvrés, couverture réduite.
      const res=await fetch('https://api.frankfurter.dev/v1/latest?base=EUR',{cache:'no-store',signal:AbortSignal.timeout(9000)});
      if(!res.ok)throw firstError;
      data={...(await res.json()),provider:'Frankfurter'};
    }
    if(!currencyAPI.validRates(data))throw Error('Taux de change invalides');
    FX.data=data;FX.fetchedAt=Date.now();FX.state='ready';
    try{localStorage.setItem(FX_CACHE_KEY,JSON.stringify({data,fetchedAt:FX.fetchedAt}));}catch(e){}
  }catch(e){FX.state=FX.data?'stale':'error';FX.error=String(e?.message||e);FX.retryAfter=Date.now()+2*60*1000;}
  if(S.route?.name==='home')scheduleRender();
}
CHG['home-currency']=b=>{
  const value=b.value;
  if(!currencyAPI.DISPLAY_CURRENCIES.includes(value))return;
  // Le choix est immédiatement visible ; l'écriture Firestore peut être lente ou rejetée.
  FX.pendingCurrency=value;
  const selectionVersion=++FX.currencySelectionVersion;
  FX.currencySaving=true;
  scheduleRender();
  refreshExchangeRates();
  // Si plusieurs choix sont effectués rapidement, conserver uniquement le dernier à l'écran.
  currencySaveQueue=currencySaveQueue.catch(()=>{}).then(async()=>{
    try{
      await saveProfile({displayCurrency:value});
      if(FX.currencySelectionVersion===selectionVersion){FX.pendingCurrency=null;FX.currencySaving=false;}
    }catch(e){
      // La valeur distante n'a pas changé : rétablir l'affichage et le sélecteur.
      if(FX.currencySelectionVersion===selectionVersion){FX.pendingCurrency=null;FX.currencySaving=false;}
      toast(`${tr('Devise non enregistrée')} : ${errMsg(e)}`,'err');
    }finally{scheduleRender();}
  });
};
ACT['currency-refresh']=()=>{if(FX.state==='loading')return; if(FX.state==='ready'&&Date.now()-FX.fetchedAt<60*60*1000)return toast(tr('Les taux sont déjà à jour.'));refreshExchangeRates(true);};

/* ---------- Accueil : mes groupes + résumé global ---------- */
function renderHome() {
  const first = (myName().split(/\s+/)[0]) || "";
  const active = S.groups.filter((g) => !g.archived), archived = S.groups.filter((g) => g.archived);
  const loading = !S.groupsReady || active.some((g) => !storeReady(S.stores.get(g.id)));
  const balancesInGroups=[];
  active.forEach(g=>{
    const i=groupInfo(g.id);
    if(!i||!i.me||!i.ready)return;
    balancesInGroups.push({currency:g.currency,net:i.balances[i.me.id]?.net||0});
  });
  const cur=displayCurrency();
  if(!loading&&active.length)refreshExchangeRates();
  const values=currencyAPI.summarize(balancesInGroups,cur,FX.data);
  const ratesReady=!values.unavailable.length;
  const forexUsed=values.converted;
  const stale=FX.state==='stale';
  const fxLabel=FX.data ? `${tr('Taux indicatifs du')} ${esc(FX.data.date)}${stale?' · '+tr('Taux enregistrés (hors ligne)'):''}` : tr('Taux en cours de chargement');
  const picker=`<label class="fx-picker-label" for="home-currency">${tr('Devise du tableau de bord')}</label><select id="home-currency" data-ch="home-currency" aria-label="${tr('Devise du tableau de bord')}" class="input fx-picker">${currencyAPI.DISPLAY_CURRENCIES.map(c=>`<option value="${c}" ${c===cur?'selected':''}>${c}</option>`).join('')}</select>${FX.currencySaving?`<span class="fx-saving" role="status">${tr('Enregistrement…')}</span>`:''}`;
  let hero='';
  if(!loading&&active.length){
    const t=values,cls=t.net>0?'pos-hero':t.net<0?'neg-hero':'';
    hero=`<div class="hero ${cls}"><div class="fx-hero-top"><div class="lbl">${tr(ratesReady?(t.net>0?'On te doit au total':t.net<0?'Tu dois au total':'Tu es à jour'):'Conversion temporairement indisponible')}</div>${picker}</div>
    ${ratesReady?`<div class="big num">${money(Math.abs(t.net),cur)}</div><div class="row" style="gap:8px;flex-wrap:wrap"><span class="pill">${ico('arrow','xs')} ${tr('À recevoir')} ${money(t.get,cur)}</span><span class="pill">${tr('À payer')} ${money(t.owe,cur)}</span></div>`
      : FX.state==='loading'?`<div class="fx-unavailable" role="status">${tr('Chargement des taux de change…')}</div>`
      :`<div class="fx-unavailable" role="alert">${tr('Impossible de convertir toutes les devises :')} ${esc(t.unavailable.join(', '))}. ${tr('Les montants exacts restent accessibles dans chaque groupe.')}${FX.state==='error'?` ${tr('Service de change inaccessible. Vérifiez votre connexion.')}`:''}</div>`}
    <div class="fx-source">${forexUsed||!ratesReady?`${tr('Estimation convertie')} · ${fxLabel} · ${FX.data?.provider==='ExchangeRate-API'?'<a href="https://www.exchangerate-api.com" target="_blank" rel="noopener noreferrer">Rates By Exchange Rate API</a> · ':FX.data?.provider==='Frankfurter'?'<a href="https://frankfurter.dev" target="_blank" rel="noopener noreferrer">Frankfurter</a> · ':''}<button class="link-btn" type="button" data-act="currency-refresh">${tr('Actualiser')}</button>`:tr('Montants affichés dans leur devise d’origine')}</div></div>`;
  }else if(loading&&S.groups.length)hero=`<div class="skel" style="height:152px;border-radius:26px"></div>`;
  const card = (g) => {
    const i = groupInfo(g.id), ty = GROUP_TYPES.find((x) => x.id === g.type) || GROUP_TYPES[3];
    const bl = i && i.ready && i.me ? balanceLabel(i.balances[i.me.id]?.net || 0, g.currency) : null;
    return `<button class="card group-card" data-act="open-group" data-id="${esc(g.id)}">
      <div class="tile group-icon-tile" style="background:var(--brand-soft)">${groupIcon(g.emoji || ty.emoji)}</div>
      <div class="grow"><div class="t ellipsis" style="font-weight:700;font-size:17px">${esc(g.name)}</div>
      <div class="s muted ellipsis" style="font-size:13.5px">${ty.label} · ${i ? i.members.length : "…"} participant${i && i.members.length > 1 ? "s" : ""}${g.demo ? " · <b style='color:var(--brand)'>Démo</b>" : ""}</div></div>
      <div class="right">${notifBadge(notifGroupCount(g.id))}${bl ? `<div class="${bl.cls}" style="font-weight:700;font-size:14px">${bl.text}</div>` : `<div class="skel" style="width:90px;height:14px"></div>`}</div></button>`;
  };
  let list;
  if (!S.groupsReady) list = `<div class="col">${[1, 2, 3].map(() => `<div class="skel" style="height:82px;border-radius:18px"></div>`).join("")}</div>`;
  else if (!active.length) list = emptyState({ icon: "users", title: "Crée ton premier groupe", text: "Un kot, un city-trip, une soirée : ajoute vos dépenses et laisse l'appli faire les comptes.", cta: "Nouveau groupe", act: "new-group" });
  else list = `<div class="col grid-groups" style="gap:12px">${active.map(card).join("")}</div>`;
  const arch = archived.length ? `<button class="section-title link-btn" style="display:block;margin-top:26px" data-act="toggle-archived">${ico("archive", "xs")} Archivés (${archived.length}) ${S.ui.archivedOpen ? "▴" : "▾"}</button>${S.ui.archivedOpen ? `<div class="col grid-groups" style="gap:12px">${archived.map(card).join("")}</div>` : ""}` : "";
  paint({
    top: topBar({ title: APP_NAME, right: `<button class="icon-btn" data-act="join-code" aria-label="Rejoindre avec un code">${ico("link", "sm")}</button><button class="icon-btn" data-act="new-group" aria-label="Nouveau groupe">${ico("plus", "sm")}</button>` }),
    body: `<h1 class="h-large">${first ? `${tr('Salut')} <span class="welcome-user-inline">${esc(first)}${userMark('welcome-name-mark')}</span>` : tr("Mes groupes")}</h1><p class="h-sub" style="margin-bottom:18px">${active.length ? tr("Voici où vous en êtes.") : tr("Bienvenue !")}</p>${hero}${groupInvitationsUI()}${S.exitDebts.some(d=>d.status!=='confirmed')?`<button class="exit-debt-home-link" data-act="nav" data-to="/debts">${ico("wallet","sm")} <span class="grow">${tr("Mes remboursements hors groupe")} · ${S.exitDebts.filter(d=>d.status!=='confirmed').length}</span>${ico("next","xs")}</button>`:""}<div class="section-title">${active.length ? tr("Mes groupes") : ""}</div>${list}${arch}`,
    nav: mainNav("home"), fab: null, // Action disponible seulement dans un groupe.
  });
}
ACT["open-group"] = (b) => go(`/g/${b.dataset.id}`);
ACT["toggle-archived"] = () => { S.ui.archivedOpen = !S.ui.archivedOpen; scheduleRender(); };
ACT.fab = () => {
  if (S.route.name === "group") return openExpenseForm(S.route.gid);
  const act = S.groups.filter((g) => !g.archived);
  if (!act.length) return openGroupForm();
  if (act.length === 1) return openExpenseForm(act[0].id);
  openSheet({ title: "Dans quel groupe ?", body: `<div class="card"><div class="list">${act.map((g) => `<button class="item" data-act="fab-pick" data-id="${esc(g.id)}"><div class="tile group-icon-tile" style="background:var(--brand-soft);width:42px;height:42px">${groupIcon(g.emoji)}</div><div class="grow t">${esc(g.name)}</div>${ico("next", "sm")}</button>`).join("")}</div></div>` });
};
ACT["fab-pick"] = (b) => { closeSheet(); setTimeout(() => openExpenseForm(b.dataset.id), 250); };
ACT["new-group"] = () => openGroupForm();
ACT["join-code"] = () => {
  const sh = openSheet({
    title: "Rejoindre un groupe",
    body: `<div class="col"><p class="muted">Saisis le code d'invitation que t'a transmis un ami (8 caractères).</p><input id="jc-code" class="input" placeholder="XXXX-XXXX" autocapitalize="characters" autocomplete="off" style="text-align:center;font-size:22px;font-weight:700;letter-spacing:.12em"></div>`,
    footer: `<button class="btn brand" data-act="join-code-go">Continuer</button>`,
  });
  setTimeout(() => $("#jc-code", sh.el)?.focus(), 450);
};
ACT["join-code-go"] = () => { const c = normalizeCode($("#jc-code").value); if (c.length < 8) return toast("Le code comporte 8 caractères.", "err"); closeSheet(); go("/join/" + c); };

/* ---------- Réglages ---------- */
/** Suivi durable, privé et indépendant de l'appartenance au groupe. */
function exitDebtCard(debt,inGroup=false) {
  const admin=!!(inGroup && groupAdmin(S.groups.find(g=>g.id===debt.groupId)));
  const debtor=debt.fromUid===myUid(),creditor=debt.toUid===myUid(),status=debt.status;
  const neutralAdmin=admin&&!debtor;
  const statusText={pending:'À rembourser',marked_paid:'Paiement déclaré',disputed:'Contesté',confirmed:'Confirmé'}[status]||status;
  const btn=(action,label,brand=false)=>`<button type="button" class="btn sm ${brand?'brand':'soft'}" data-act="exit-debt-update" data-action="${action}" data-gid="${esc(debt.groupId)}" data-did="${esc(debt.debtId||debt.id)}">${tr(label)}</button>`;
  const actions=[];
  if(debtor&&status==='pending')actions.push(btn('mark_paid','J’ai payé',true),btn('dispute','Contester'));
  if(debtor&&status==='marked_paid')actions.push(btn('dispute','Contester'));
  if(creditor && (status==='pending'||status==='marked_paid'))actions.push(btn('confirm','Confirmer la réception',true));
  if(neutralAdmin && !creditor && status==='marked_paid')actions.push(btn('confirm','Confirmer le paiement',true));
  if((creditor||neutralAdmin)&&status==='marked_paid')actions.push(btn('reject','Refuser'));
  if((creditor||neutralAdmin)&&status==='disputed')actions.push(btn('resume','Rouvrir la demande'));
  return `<article class="exit-debt-card"><div class="exit-debt-top"><div class="exit-debt-group">${esc(debt.groupName||'Groupe')}</div><span class="exit-debt-status status-${esc(status)}">${tr(statusText)}</span></div>
  <div class="exit-debt-amount">${money(debt.amountCents,debt.currency||'EUR')}</div>
  <p>${esc(debt.fromName||tr('Membre'))} → ${esc(debt.toName||tr('Membre'))}</p>
  <div class="exit-debt-meta">${debtor?tr('Tu dois rembourser cette somme.'):debt.toUid===myUid()?tr('Cette somme doit t’être remboursée.'):tr('Remboursement suivi après départ.')}</div>
  ${actions.length?`<div class="exit-debt-actions">${actions.join('')}</div>`:''}</article>`;
}
function renderExitDebts() {
  const debts=S.exitDebts||[];
  const open=debts.filter(d=>d.status!=='confirmed');
  const history=debts.filter(d=>d.status==='confirmed');
  paint({top:topBar({back:'/',title:tr('Mes remboursements hors groupe')}),nav:mainNav('debts'),
    body:`<div class="exit-debt-page"><div class="exit-debt-intro"><h1>${tr('Mes remboursements hors groupe')}</h1><p>${tr('Tu peux quitter un groupe sans perdre le suivi des sommes à payer ou à recevoir. Aucun paiement n’est effectué dans Kortiz : le bénéficiaire ou un administrateur non débiteur peut confirmer le règlement.')}</p></div>
      <div class="section-title">${tr('En cours')} · ${open.length}</div>${open.length?`<div class="exit-debt-grid">${open.map(d=>exitDebtCard(d)).join('')}</div>`:S.exitDebtsReady?emptyState({icon:'check',title:'Aucune dette en attente',text:'Tes remboursements après départ apparaîtront ici.'}):skeletonList(2)}
      ${history.length?`<div class="section-title">${tr('Historique confirmé')} · ${history.length}</div><div class="exit-debt-grid">${history.map(d=>exitDebtCard(d)).join('')}</div>`:''}</div>`});
}
ACT['exit-debt-update']=async b=>{
  const act=b.dataset.action;
  if(act==='confirm'&&!(await confirmDialog({title:tr('Confirmer ce remboursement ?'),message:tr('Confirme uniquement si le paiement a réellement été reçu. Les soldes du groupe seront mis à jour.'),ok:tr('Confirmer le paiement')})))return;
  if(act==='dispute'&&!(await confirmDialog({title:tr('Contester ce remboursement ?'),message:tr('Le remboursement reste suivi mais sa confirmation sera suspendue jusqu’à résolution.'),ok:tr('Contester')})))return;
  try{await withBusy(b,()=>call('respondGroupSettlement',{scope:'exitDebt',groupId:b.dataset.gid,requestId:b.dataset.did,action:act}));toast(tr('Statut mis à jour.'));}
  catch(err){toast(errMsg(err),'err');}
};

function renderSettings() {
  const p = S.profile, u = S.user, guest = u.isAnonymous;
  const row = (icn, label, right, act, extra = "") => `<button class="item" data-act="${act}" ${extra}><span style="color:var(--brand)">${ico(icn)}</span><span class="grow t">${label}</span>${right || ico("next", "sm")}</button>`;
  paint({
    top: topBar({ title: "Réglages" }),
    body: `<div class="card pad row" style="margin-top:8px;gap:16px">${avatar({ uid:myUid(), name: p.displayName || "?", color: p.avatarColor }, "lg")}<div class="grow"><div style="font-size:20px;font-weight:800;letter-spacing:-.02em">${esc(p.displayName || tr('Sans nom'))}</div><div class="muted ellipsis">${guest ? `<span class="badge brand">Compte invité</span>` : esc(u.email || "")}</div></div><button class="icon-btn" data-act="edit-profile" aria-label="Modifier le profil">${ico("edit", "sm")}</button></div>
    ${guest ? `<div class="banner" style="margin-top:14px"><div class="grow"><b>Sauvegarde ton compte</b><div class="muted" style="font-size:14px">Ajoute un e-mail ou Google pour retrouver tes groupes sur tous tes appareils.</div></div><button class="btn sm" data-act="upgrade">Créer</button></div>` : ""}
    <div class="section-title">Profil et remboursements</div>
    <div class="card"><div class="list">${row("wallet", "Mes remboursements hors groupe", `${S.exitDebts.filter(d=>d.status!=='confirmed').length} ${tr('en cours')}`, "open-exit-debts")}</div></div>
    <div class="card"><div class="list">${row("users", "Amis et conversations", "", "friends-open")}</div></div>
    <div class="card"><div class="list">${row("wallet", tr("Mon IBAN (SEPA)"), `<span class="muted num ellipsis" style="max-width:170px;font-size:13px">${p.iban ? esc(formatIban(p.iban)) : tr("Non renseigné")}</span>`, "payment-details-guide", 'data-target="iban"')}
    ${row("wallet", tr("Mon contact Wero"), `<span class="muted ellipsis" style="max-width:190px;font-size:13px">${p.shareWero === true && isValidWeroContact(p.weroContact) ? esc(normalizeWeroContact(p.weroContact)) : tr('Non partagé')}</span>`, "payment-details-guide", 'data-target="wero"')}</div></div>
    <p class="hint" style="margin-top:8px">${tr('SEPA : QR bancaire avec IBAN. Wero : remboursement par téléphone ou e-mail associés à Wero. Aucune transaction ne passe par Kortiz.')}</p>
    <div class="section-title">${tr("Langue de l'application")}</div>
    ${localePicker('settings-lang')}
    <div class="section-title">${tr('Notifications')}</div>
    <div class="card"><div class="list"><button class="item" data-act="toggle-push"><span style="color:var(--brand)">${ico('bell')}</span><span class="grow"><div class="t">${tr('Autoriser les notifications push')}</div><div class="s">${tr('Nécessite ton autorisation dans le navigateur ; sur iPhone, installe Kortiz sur l’écran d’accueil.')}</div></span><span class="switch ${notificationsOn()?'on':''}"></span></button>
    ${PUSH_TOPICS.map(([key,label,icon])=>`<button class="item" type="button" data-act="notification-preference" data-kind="${key}" aria-pressed="${wantsPush(key)}"><span style="color:var(--brand)">${ico(icon)}</span><span class="grow t">${tr(label)}</span><span class="switch ${wantsPush(key)?'on':''}"></span></button>`).join('')}</div></div>
    <p class="hint" style="margin-top:8px">${tr('Les préférences sont synchronisées sur ton compte. Tu peux mettre un groupe en sourdine depuis son menu.')}</p>
    ${S.installEvent ? `<div class="section-title">Application</div><div class="card"><div class="list">${row("download", "Installer sur l'écran d'accueil", "", "install")}</div></div>` : ""}
    <div class="section-title">${tr('Assistance et contact')}</div>
    <div class="card"><div class="list">${row('bug',tr('Signaler un bug dans Kortiz'),'','report-bug')}${row('mail', tr('Signaler un problème ou proposer une collaboration'), '', 'open-contact')}</div></div>
    <p class="hint" style="margin-top:8px">${tr('Bug visuel, erreur fonctionnelle, suggestion ou partenariat : contacte directement Kortiz.')}</p>
    <div class="section-title">Mes données</div>
    <div class="card"><div class="list">${row("download", "Exporter tout (JSON)", "", "export-json")}${row("receipt", "Exporter mes dépenses (CSV)", "", "export-all-csv")}</div></div>
    <div class="section-title">Compte</div>
    <div class="card"><div class="list">${row("logout", "Se déconnecter", "", "logout")}<button class="item" data-act="delete-account" style="color:var(--neg)">${ico("trash")}<span class="grow t">Supprimer mon compte et mes données</span></button></div></div>
    <p class="hint center"><a href="/legal.html#privacy" target="_blank" rel="noopener">${tr('Confidentialité')}</a> · <a href="/legal.html#terms" target="_blank" rel="noopener">${tr('Conditions d’utilisation')}</a> · <a href="/legal.html#notice" target="_blank" rel="noopener">${tr('Mentions légales')}</a> · <a href="/legal.html#cookies" target="_blank" rel="noopener">${tr('Cookies')}</a></p>
    <p class="hint center" style="margin-top:22px">${APP_NAME} · Les montants sont calculés en centimes entiers · Aucune connexion bancaire.</p>`,
    nav: mainNav("settings"),
  });
}

/* Support v28 : rapport privé, créé directement dans le compte.
 * Lisible par l'éditeur dans la console Firebase Admin (pas par d'autres utilisateurs). */
ACT['report-bug']=()=>{
  const sh=openSheet({title:tr('Signaler un problème'),body:`<div class="col bug-report-form" style="gap:14px">
    <p class="hint">${tr('Décris un bug visuel, fonctionnel ou une suggestion. Ne joins pas de données bancaires, de mots de passe ou d’autres informations sensibles.')}</p>
    <div class="field"><label for="bug-kind">${tr('Type de signalement')}</label><select class="input" id="bug-kind"><option value="visual">${tr('Bug visuel')}</option><option value="functional">${tr('Bug fonctionnel')}</option><option value="idea">${tr('Suggestion')}</option></select></div>
    <div class="field"><label for="bug-page">${tr('Page concernée')}</label><input class="input" id="bug-page" maxlength="120" value="${esc(location.hash.slice(0,120)||'/')}"></div>
    <div class="field"><label for="bug-details">${tr('Description du problème')}</label><textarea class="input" id="bug-details" rows="5" minlength="30" maxlength="3000" placeholder="${tr('Explique les étapes pour reproduire le problème…')}"></textarea></div>
    <div class="field"><label for="bug-screenshot">${tr('Capture d’écran (facultative, 2 Mo max.)')}</label><input type="file" id="bug-screenshot" class="input" accept="image/jpeg,image/png,image/webp"></div>
    <p class="hint" id="bug-status" role="status"></p></div>`,footer:`<button type="button" class="btn brand" id="bug-send">${tr('Envoyer le signalement')}</button>`});
  const btn=$('#bug-send',sh.el);
  btn.addEventListener('click',async()=>{
    const kind=$('#bug-kind',sh.el).value,description=$('#bug-details',sh.el).value.trim(),page=$('#bug-page',sh.el).value.trim(),file=$('#bug-screenshot',sh.el).files?.[0];
    if(description.length<30||description.length>3000||page.length>120)return toast(tr('Ajoute une description d’au moins 30 caractères.'),'err');
    if(file&&(!/^image\/(jpeg|png|webp)$/.test(file.type)||file.size>2*1024*1024))return toast(tr('Capture invalide (2 Mo maximum).'),'err');
    let screenshotPath='';
    const refDoc=doc(collection(db,'users',myUid(),'bugReports'));
    try{await withBusy(btn,async()=>{
      if(file){const blob=await compressImage(file);if(blob.size>2*1024*1024)throw Error(tr('Capture trop volumineuse.'));
        screenshotPath=`supportReports/${myUid()}/${refDoc.id}.jpg`;
        await uploadBytes(sref(storage,screenshotPath),blob,{contentType:'image/jpeg'});
      }
      await setDoc(refDoc,{uid:myUid(),kind,description,page,screenshotPath,status:'new',createdAt:serverTimestamp()});
    });closeSheet();toast(tr('Signalement enregistré. Merci !'));}
    catch(error){if(screenshotPath)deleteObject(sref(storage,screenshotPath)).catch(()=>{});toast(errMsg(error),'err');}
  });
};
ACT["open-contact"] = () => { window.location.assign('/contact.html'); };
ACT["friends-open"] = () => go("/friends");
ACT["open-exit-debts"] = () => go("/debts");
ACT.logout = async () => { if (await confirmDialog({ title: "Se déconnecter ?", message: S.user.isAnonymous ? "Attention : en mode invité, tu perdras l'accès à tes groupes. Crée d'abord un compte." : "Tu pourras te reconnecter à tout moment.", ok: "Se déconnecter", danger: S.user.isAnonymous })) { await doLogout(); go("/"); } };
ACT.install = async () => { const e = S.installEvent; if (!e) return; e.prompt(); await e.userChoice; S.installEvent = null; scheduleRender(); };
window.addEventListener("beforeinstallprompt", (e) => { e.preventDefault(); S.installEvent = e; scheduleRender(); });
ACT["toggle-push"] = async (b) => {
  if (notificationsOn()) { await disableNotifications(); toast("Notifications désactivées"); }
  else { await enableNotifications(); toast("Notifications activées"); }
  scheduleRender();
};
/* ---------- Tutoriel non intrusif sur les coordonnées de remboursement ---------- */
function openPaymentProfile(target='iban'){
  ACT['edit-profile']();
  requestAnimationFrame(()=>{
    const field=document.getElementById(target==='wero'?'pf-wero':'pf-iban');
    field?.focus({preventScroll:true});
    field?.scrollIntoView({block:'center',behavior:'smooth'});
  });
}
function openPaymentGuide(target='iban',fromProfile=false){
  let choice = S.profile?.paymentGuideMode === 'always' ? 'always' : 'once';
  const sh=openSheet({
    title:tr('Comprendre les remboursements SEPA et Wero'),
    body:`<div class="payment-guide">
      <div class="payment-guide-hero"><div class="payment-guide-icon" aria-hidden="true">${ico('wallet')}</div><h3>${tr('Facilite les remboursements entre amis')}</h3>
        <p>${tr('Renseigner tes coordonnées est facultatif. Elles aident tes proches à préparer un remboursement, sans envoyer d’argent dans Kortiz.')}</p></div>
      <div class="payment-guide-grid">
        <article><div class="payment-guide-card-top">${ico('wallet','sm')} <b>${tr('IBAN · Virement SEPA')}</b></div>
          <p>${tr('En ajoutant ton IBAN, tes amis pourront consulter les informations nécessaires au virement et afficher un QR SEPA dans Kortiz, puis confirmer le virement dans leur banque.')}</p></article>
        <article><div class="payment-guide-card-top">${ico('users','sm')} <b>${tr('Wero · Téléphone ou e-mail')}</b></div>
          <p>${tr('Avec le numéro ou l’adresse e-mail associés à Wero, les membres pourront retrouver plus facilement ton contact dans leur application bancaire compatible.')}</p></article>
      </div>
      <div class="payment-guide-steps"><b>${tr('Comment activer cette option ?')}</b>
        <ol><li>${tr('Renseigne ton IBAN ou ton contact Wero dans ton profil.')}</li>
        <li>${tr('Active le partage correspondant si tu souhaites que les membres de tes groupes voient cette coordonnée.')}</li>
        <li>${tr('Enregistre ton profil. Les membres autorisés pourront utiliser ces informations pour te rembourser hors de Kortiz.')}</li></ol>
      </div>
      <div class="payment-guide-privacy">${ico('info','sm')}<p>${tr('Les coordonnées partagées sont visibles par les membres de tes groupes et peuvent être copiées. Tu peux désactiver le partage, mais les copies déjà faites par d’autres personnes ne peuvent pas être effacées à distance. Kortiz ne vérifie pas les virements bancaires.')}</p></div>
      <fieldset class="payment-guide-frequency"><legend>${tr('Quand revoir ce guide ?')}</legend>
        <label><input type="radio" name="payment-guide-frequency" value="once" ${choice==='once'?'checked':''}><span><b>${tr('Seulement cette fois-ci')}</b><small>${tr('Tu pourras toujours le rouvrir depuis ton profil.')}</small></span></label>
        <label><input type="radio" name="payment-guide-frequency" value="always" ${choice==='always'?'checked':''}><span><b>${tr('À chaque ouverture des coordonnées')}</b><small>${tr('Le guide apparaîtra avant de modifier IBAN ou Wero.')}</small></span></label>
      </fieldset>
    </div>`,
    footer:`<button type="button" class="btn soft" id="payment-guide-close">${tr('Fermer')}</button><button type="button" class="btn brand" id="payment-guide-continue">${tr('Compris, continuer')}</button>`,
  });
  const closeBtn=$('#payment-guide-close',sh.el);
  const nextBtn=$('#payment-guide-continue',sh.el);
  sh.el.addEventListener('change',e=>{
    if(e.target?.name==='payment-guide-frequency')choice=e.target.value;
  });
  closeBtn.addEventListener('click',()=>sh.close());
  nextBtn.addEventListener('click',async()=>{
    try{
      await withBusy(nextBtn,()=>saveProfile({paymentGuideSeen:true,paymentGuideMode:choice}));
      sh.close();
      if(!fromProfile)openPaymentProfile(target);
    }catch(e){toast(errMsg(e),'err');}
  });
}
ACT['payment-details-guide']=b=>{
  const target=b.dataset.target==='wero'?'wero':'iban';
  if(S.profile?.paymentGuideSeen===true && S.profile?.paymentGuideMode!=='always')openPaymentProfile(target);
  else openPaymentGuide(target);
};
ACT['payment-guide-help']=()=>openPaymentGuide('iban',true);

ACT["edit-profile"] = () => {
  const p = S.profile; let color = p.avatarColor, share = p.shareIban === true, shareWero = p.shareWero === true;
  const displayed = String(p.displayName || '').trim(), split = displayed.indexOf(' ');
  const first = p.givenName || (split > 0 ? displayed.slice(0,split) : displayed);
  const last = p.familyName || (split > 0 ? displayed.slice(split+1) : '');
  const sh = openSheet({
    title: "Mon profil",
    body: `<div class="col" style="gap:16px">
      <div class="field"><label for="pf-handle">${tr('Pseudo unique')} (@)</label><input id="pf-handle" class="input" maxlength="24" placeholder="pseudo" value="${esc(SOC.self?.handle || '')}" autocomplete="off"></div>
      <div class="field"><label>${tr('Photo de profil')}</label><div class="row profile-photo-row"><div id="pf-avatar-preview-wrap">${avatar({uid:myUid(),name:p.displayName,color:p.avatarColor},'lg')}</div><div class="col" style="gap:8px;align-items:flex-start"><button type="button" class="btn soft sm" data-act="avatar-select">${tr('Choisir une photo')}</button><div class="hint" style="padding:0">${tr('Tu pourras recadrer la zone visible dans un rond.')}</div></div><input type="file" id="profile-file" data-ch="profile-photo" accept="image/*" hidden></div></div>
      <div class="welcome-name-fields"><div class="field"><label for="pf-first">${tr('Prénom')}</label><input id="pf-first" class="input" maxlength="40" value="${esc(first)}" autocomplete="given-name"></div><div class="field"><label for="pf-last">${tr('Nom de famille')}</label><input id="pf-last" class="input" maxlength="40" value="${esc(last)}" autocomplete="family-name"></div></div>
      <div class="field"><label>Couleur de l'avatar</label><div class="swatches" id="pf-sw">${AVATAR_COLORS.map((c) => `<button class="swatch ${c === color ? "on" : ""}" style="background:${c}" data-c="${c}" aria-label="Couleur ${c}"></button>`).join("")}</div></div>
      <div class="field"><label for="pf-iban">${tr('IBAN SEPA (facultatif)')}</label><input id="pf-iban" class="input num" placeholder="BE68 5390 0754 7034" autocapitalize="characters" autocomplete="off" value="${esc(formatIban(p.iban || ""))}"><div id="pf-iban-err"></div></div>
      <button class="row" type="button" id="pf-share" style="text-align:left"><span class="grow"><b>${tr('Partager mon IBAN avec mes groupes')}</b><div class="hint" style="padding:0">${tr('Permet à tes amis de te rembourser par QR SEPA.')}</div></span><span class="switch ${share ? "on" : ""}"></span></button>
      <div class="field"><label for="pf-wero">${tr('Contact Wero (facultatif)')}</label><input id="pf-wero" class="input" type="text" maxlength="254" inputmode="email" autocomplete="off" spellcheck="false" placeholder="+33612345678 ou ami@exemple.com" value="${esc(p.weroContact || '')}"><p class="hint">${tr('Entre le numéro de téléphone ou l’e-mail associé à ton compte Wero. Vérifie cette information dans ton application bancaire.')}</p><div id="pf-wero-err"></div></div>
      <button class="row" type="button" id="pf-share-wero" style="text-align:left"><span class="grow"><b>${tr('Partager mon contact Wero avec mes groupes')}</b><div class="hint" style="padding:0">${tr('Les membres de tes groupes pourront voir et copier cette coordonnée pour te rembourser.')}</div></span><span class="switch ${shareWero ? "on" : ""}"></span></button>
      <button type="button" class="btn soft sm" data-act="payment-guide-help">${ico('info','sm')} ${tr('Pourquoi partager ces coordonnées ?')}</button>
    </div>`,
    footer: `<button class="btn brand" id="pf-save">Enregistrer</button>`,
  });
  $("#pf-sw", sh.el).addEventListener("click", (e) => { const s = e.target.closest(".swatch"); if (!s) return; color = s.dataset.c; $$(".swatch", sh.el).forEach((x) => x.classList.toggle("on", x === s)); });
  $("#pf-share", sh.el).addEventListener("click", (e) => { share = !share; $(".switch", e.currentTarget).classList.toggle("on", share); });
  $("#pf-share-wero", sh.el).addEventListener("click", (e) => { shareWero = !shareWero; $(".switch", e.currentTarget).classList.toggle("on", shareWero); });
  $("#pf-save", sh.el).addEventListener("click", async (e) => {
    const givenName = $('#pf-first',sh.el).value.trim(), familyName = $('#pf-last',sh.el).value.trim();
    const name = `${givenName} ${familyName}`.trim(), iban = cleanIban($("#pf-iban").value);
    const weroContact = normalizeWeroContact($('#pf-wero', sh.el)?.value || '');
    if (weroContact && !isValidWeroContact(weroContact)) {
      $('#pf-wero-err', sh.el).textContent = tr('Adresse e-mail ou numéro de téléphone Wero invalide.');
      return;
    }
    if (shareWero && !weroContact) {
      $('#pf-wero-err', sh.el).textContent = tr('Ajoute ton contact Wero avant de le partager.');
      return;
    }
    if (!givenName || !familyName) return toast(tr('Prénom et nom obligatoires.'), 'err');
    if (name.length > 60) return toast(tr('Nom trop long.'),'err');
    if (iban && !isValidIban(iban)) { $("#pf-iban").classList.add("err"); $("#pf-iban-err").innerHTML = `<div class="err-msg">IBAN invalide (clé de contrôle incorrecte). Vérifie ta saisie.</div>`; return; }
    try { await withBusy(e.currentTarget, async () => {
      const handle=normalizeHandle($('#pf-handle',sh.el).value);
      if(!validHandle(handle)) throw new Error(tr('Pseudo : 3 à 24 caractères, lettres, chiffres et tiret bas.'));
      await call('saveSocialProfile',{displayName:name,handle});
      // Write personal banking data + all group copies in a single server transaction.
      // If revocation fails, do not tell the user that sharing has been disabled.
      await call('saveSocialProfile',{action:'syncPaymentDetails',iban,shareIban:share,weroContact,shareWero});
      await saveProfile({ displayName: name, givenName, familyName, avatarColor: color });
      S.profile={...S.profile,iban,shareIban:share,weroContact,shareWero};
      scheduleRender();
      const fresh=await getDoc(doc(db,'socialProfiles',myUid()));SOC.self=fresh.data();SOC.profiles.set(myUid(),SOC.self);
    }); }catch(error){return toast(errMsg(error),'err');}
    try { await updateProfile(auth.currentUser, { displayName: name }); } catch (_) { /* non bloquant */ }
    closeSheet(); toast("Profil enregistré");
  });
};
ACT.upgrade = () => {
  const sh = openSheet({
    title: "Créer mon compte",
    body: `<div class="col"><p class="muted">Tes groupes et dépenses sont conservés : seul l'accès à ton compte change.</p><div id="up-err"></div>
      <input id="up-name" class="input" placeholder="Ton prénom" value="${esc(S.profile.displayName || "")}"><input id="up-email" class="input" type="email" placeholder="Adresse e-mail" autocapitalize="none"><input id="up-pw" class="input" type="password" placeholder="Mot de passe (6 caractères min.)" autocomplete="new-password">
      <button class="btn brand" data-act="upgrade-email">Créer le compte</button><div class="divider">ou</div><button class="btn google" data-act="upgrade-google">${ico("google")} Lier mon compte Google</button></div>`,
  });
  sh.el.dataset.up = "1";
};
ACT["upgrade-email"] = async (b) => {
  try { await withBusy(b, () => linkEmailAccount($("#up-name").value, $("#up-email").value, $("#up-pw").value)); closeSheet(); toast("Compte créé : tes données sont conservées."); }
  catch (e) { $("#up-err").innerHTML = `<div class="err-msg">${esc(authError(e))}</div>`; }
};
ACT["upgrade-google"] = async (b) => {
  try { await withBusy(b, linkGoogleAccount); closeSheet(); toast("Compte Google lié : tes données sont conservées."); }
  catch (e) { const m = authError(e); if (m) $("#up-err").innerHTML = `<div class="err-msg">${esc(m)}</div>`; }
};
ACT["export-json"] = async (b) => { const d = await withBusy(b, collectAllData); downloadFile(`${slug(APP_NAME)}-export-${todayISO()}.json`, JSON.stringify(d, null, 2), "application/json"); toast("Export téléchargé"); };
ACT["export-all-csv"] = async (b) => {
  const d = await withBusy(b, collectAllData), rows = [["Groupe", "Date", "Titre", "Catégorie", "Montant", "Devise", "Payé par", "Répartition", "Note"].map(tr)];
  d.groups.forEach((g) => { const mm = Object.fromEntries(g.members.map((m) => [m.id, m.name])); g.expenses.forEach((e) => rows.push([g.name, e.date, e.title, catById(e.category).label, centsToInput(e.amountCents), g.currency, Object.keys(e.payers || {}).map((i) => mm[i]).join(" + "), Object.entries(e.split || {}).map(([i, c]) => `${mm[i] || "?"}: ${centsToInput(c)}`).join(" | "), e.note || ""])); });
  downloadFile(`${slug(APP_NAME)}-depenses-${todayISO()}.csv`, toCsv(rows), "text/csv"); toast("Export téléchargé");
};
ACT["delete-account"] = async () => {
  if (!(await confirmDialog({ title: "Supprimer ton compte ?", message: tr("Ton compte ne peut être supprimé que si tes remboursements en groupe, après départ et tes dettes privées reconnues sont réglés. Une demande privée non reconnue ne bloque pas la suppression."), ok: "Continuer", danger: true }))) return;
  const sh = openSheet({ title: "Confirmation", body: `<div class="col"><p class="muted">Cette action est définitive. Tape <b>${({fr:'SUPPRIMER',en:'DELETE',pt:'EXCLUIR',es:'ELIMINAR'})[I18N.language()]}</b> pour confirmer.</p><input id="del-conf" class="input" autocapitalize="characters" placeholder="${({fr:'SUPPRIMER',en:'DELETE',pt:'EXCLUIR',es:'ELIMINAR'})[I18N.language()]}"></div>`, footer: `<button class="btn danger" data-act="delete-account-go">Supprimer définitivement</button>` });
};
ACT["delete-account-go"] = async (b) => {
  if (!["SUPPRIMER","DELETE","EXCLUIR","ELIMINAR"].includes($("#del-conf").value.trim().toUpperCase())) return toast(tr("Tape SUPPRIMER pour confirmer."), "err");
  try {
    await withBusy(b,deleteMyAccount);closeAllSheets();go("/");toast(tr("Compte supprimé"));
  }catch(e){
    // Ne jamais faire croire à une suppression quand le backend refuse une dette.
    const isDebt=e?.code==='functions/failed-precondition';
    toast(isDebt?tr('Suppression bloquée : vérifie tes remboursements non réglés (groupes, dettes après départ et discussions privées). Consulte le message détaillé ou contacte le support.'):(e?.message||tr('Suppression impossible.')), 'err');
    const pane=b?.closest?.('.sheet, .modal, [role="dialog"]');
    if(pane){let div=pane.querySelector('#del-server-error');if(!div){div=document.createElement('p');div.id='del-server-error';div.className='err-msg';pane.append(div);}
      div.textContent=e?.message||tr('Suppression impossible.');}
  }
};

/* ---------- Invitation : « Tu es qui dans ce groupe ? » ---------- */
S.join = { code: null, status: "idle", info: null, choice: null, err: "" };
function renderJoin() {
  const code = S.route.code, J = S.join;
  if (J.code !== code) {
    Object.assign(J, { code, status: "loading", info: null, choice: null, err: "" });
    getInviteInfo(code).then((info) => { if (J.code !== code) return; J.info = info; J.status = "ready"; scheduleRender(); })
      .catch((e) => { if (J.code !== code) return; J.status = "error"; J.err = e.message || "Invitation introuvable."; scheduleRender(); });
  }
  let body;
  if (J.status === "loading") body = `<div class="col" style="margin-top:30px"><div class="skel" style="height:90px"></div><div class="skel" style="height:200px"></div></div>`;
  else if (J.status === "error") body = emptyState({ icon: "link", title: "Invitation introuvable", text: J.err || "Ce lien n'est plus valide. Demande un nouveau lien à ton ami.", cta: "Retour à l'accueil", act: "nav" }).replace('data-act="nav"', 'data-act="nav" data-to="/"');
  else if (J.status === 'awaiting') body=emptyState({icon:'clock',title:'Demande en attente',text:'Un administrateur doit confirmer ton identité. Reviens sur cette invitation après son accord.',cta:'Retour à l’accueil',act:'nav'}).replace('data-act="nav"','data-act="nav" data-to="/"');
  else {
    const i = J.info, free = i.members.filter((m) => !m.taken);
    const sel = J.choice;
    body = `<div class="col" style="align-items:center;text-align:center;margin:16px 0 8px"><div class="tile group-icon-tile" style="width:76px;height:76px;border-radius:24px;background:var(--brand-soft)">${groupIcon(i.emoji)}</div><h1 class="h-large" style="margin:6px 0 0">${esc(i.name)}</h1><p class="h-sub">${i.members.length} participant${i.members.length > 1 ? "s" : ""} · invité par ${esc(i.ownerName || "un ami")}</p></div>
    ${i.alreadyMember ? `<button class="btn brand" data-act="join-open">Ouvrir le groupe</button>` : !free.length ? `
      <div class="card pad col" style="text-align:center;gap:12px"><p class="hint">${tr('Tu rejoindras ce groupe avec ton profil Kortiz.')}</p>
        <button class="btn brand" data-act="join-go">${tr('Rejoindre le groupe')}</button></div>` : `
    <div class="section-title">Tu es qui dans ce groupe ?</div>
    <div class="card"><div class="list">${free.map((m) => `<button class="item" data-act="join-pick" data-id="${esc(m.id)}">${avatar(m)}<span class="grow t">${esc(m.name)}</span><span class="check ${sel === m.id ? "on" : ""}">${ico("check")}</span></button>`).join("")}
      <button class="item" data-act="join-pick" data-id="__new"><div class="avatar" style="background:var(--surface3);color:var(--muted)">${ico("plus", "sm")}</div><span class="grow"><div class="t">Je ne suis pas dans la liste</div><div class="s">Je m'ajoute comme nouveau participant</div></span><span class="check ${sel === "__new" ? "on" : ""}">${ico("check")}</span></button></div></div>
    <div class="sp-16"></div><button class="btn brand" data-act="join-go" ${sel ? "" : "disabled"}>Rejoindre le groupe</button>`}`;
  }
  paint({ top: topBar({ back: "/", title: "Invitation" }), body, nav: "" });
}
ACT["join-pick"] = (b) => { S.join.choice = b.dataset.id; scheduleRender(); };
ACT["join-open"] = () => go(`/g/${S.join.info.groupId}`);
ACT["join-go"] = async (b) => {
  const J = S.join, noLegacy=J.info?.members?.every(m=>m.taken),isNew=noLegacy||J.choice === "__new";
  try {
    const result = await withBusy(b, () => call("joinGroup", { code: J.code, memberId: isNew ? null : J.choice }));
    if(result.pendingApproval) {
      J.status='awaiting';toast(tr('Le créateur doit confirmer ton identité avant de te relier à ce participant.'));
      scheduleRender();return;
    }
    J.code = null; toast("Bienvenue dans le groupe !"); go(`/g/${result.groupId}`);
  } catch(e){toast(errMsg(e),'err');}
};

/* ==========================================================================
   SECTION 6 — ÉCRANS D'UN GROUPE : Dépenses · Soldes · Statistiques · Activité
   ========================================================================== */
const norm = (s) => String(s || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
const catIcon = (cid, size = "") => { const c = catById(cid); return `<div class="cat-ico" style="background:${c.color}1f;color:${c.color}">${ico(c.icon, size)}</div>`; };
const GROUP_TABS = [["expenses", "Dépenses", "list"], ["plans", "Prévisions", "calendar"], ["calendar", "Calendrier", "calendar"], ["recurring", "Récurrences", "repeat"], ["balances", "Soldes", "wallet"], ["chat", "Discussion", "mail"], ["stats", "Stats", "pie"], ["activity", "Activité", "activity"]];
// On small screens the chat action must never be pushed off-screen by other tabs.
const GROUP_MOBILE_TABS = ["expenses", "plans", "chat", "balances"];
ACT['group-more-tabs'] = () => {
  const gid = S.route.gid;
  if(S.route.name !== 'group' || !groupInfo(gid))return;
  const entries = GROUP_TABS.filter(([key])=>!GROUP_MOBILE_TABS.includes(key));
  openSheet({title:tr('Autres rubriques'),body:`<div class="card"><div class="list">${entries.map(([key,label,ic])=>`<button type="button" class="item" data-act="nav" data-to="/g/${esc(gid)}/${key}">${ico(ic,'sm')}<span class="grow t">${tr(label)}</span>${ico('arrow','sm')}</button>`).join('')}</div></div>`});
};

function renderGroup() {
  const {gid, tab}=S.route;
  S.stores.get(gid)?.startExitDebts?.();
  const info = groupInfo(gid);
  if (!info) {
    return paint({ top: topBar({ back: "/", title: "Groupe" }), body: S.groupsReady ? emptyState({ icon: "users", title: "Groupe introuvable", text: "Ce groupe n'existe plus ou tu n'en fais plus partie.", cta: "Retour", act: "nav" }).replace('data-act="nav"', 'data-act="nav" data-to="/"') : skeletonList(4) });
  }
  if (tab === "activity") listenActivity(gid);
  if (tab === "plans" || tab === "calendar") info.st.startPlans();
  const g = info.group;
  const nav = GROUP_TABS.filter(([k]) => GROUP_MOBILE_TABS.includes(k))
    .map(([k,l,ic])=>`<button class="nav-item ${tab===k?'active':''}" data-act="nav" data-to="/g/${esc(gid)}/${k}">${ico(ic)}<span>${tr(l)}</span>${notifBadge(k==='chat'?notifCount('group',gid,'chatReadAt'):k==='expenses'?notifCount('group',gid,'expenseReadAt'):0)}</button>`).join('')
    + `<button class="nav-item ${!GROUP_MOBILE_TABS.includes(tab)?'active':''}" type="button" data-act="group-more-tabs" aria-label="${tr('Autres rubriques')}">${ico('more')}<span>${tr('Plus')}</span></button>`;
  let body = "";
  if (!info.ready || !info.st.exitDebtsReady) body = skeletonList(5);
  else body = ({ expenses: tabExpenses, plans: tabPlans, calendar: tabCalendar, recurring: tabRecurring, balances: tabBalances, chat: tabGroupChat, stats: tabStats, activity: tabActivity }[tab])(info);
  paint({
    top: topBar({ back: "/", title: `${groupIcon(g.emoji || "🧾", "group-header-symbol")} <span>${esc(g.name)}</span>`, right: `<button class="icon-btn" data-act="invite" aria-label="Inviter">${ico("share", "sm")}</button><button class="icon-btn" data-act="group-menu" aria-label="Menu du groupe">${ico("more", "sm")}</button>` }),
    body: (g.demo ? `<div class="banner" style="margin:6px 0 12px">${ico("info")}<div class="grow"><b>Groupe de démonstration</b><div class="muted" style="font-size:14px">Pour découvrir l'appli. Supprime-le quand tu veux : menu ⋯ → Supprimer le groupe.</div></div></div>` : "") + (g.archived ? `<div class="banner" style="margin:6px 0 12px">${ico("archive")}<div class="grow"><b>Groupe archivé</b><div class="muted" style="font-size:14px">Il est en lecture seule dans ta liste.</div></div><button class="btn sm soft" data-act="unarchive">Réactiver</button></div>` : "") + body,
    nav, fab: info.ready && (tab === "expenses" || tab === "balances") && !g.archived ? "Dépense" : null,
  });
}
ACT.unarchive = () => { if(!groupAdmin(groupInfo(S.route.gid)?.group))return toast(tr('Action non autorisée.'),'err'); return updateGroup(S.route.gid, { archived: false }, `${myName()} a réactivé le groupe`).then(() => toast("Groupe réactivé")); };

/* ---------- Onglet Prévisions : coûts estimés, sans dette ---------- */
const planTotals = (info) => window.KortizPlanning.compute(info.expenses, info.st.plans, info.group.budgetCents);
const planCanEdit = (p, g) => p.createdBy === myUid() || groupAdmin(g);
function planBudgetCard(info) {
  const { group:g } = info, t = planTotals(info), pct = t.ratio === null ? 0 : Math.min(100, Math.round(t.ratio*100));
  const status = t.exceeded ? 'over' : t.ratio !== null && t.ratio >= .8 ? 'near' : 'safe';
  return `<section class="plan-budget" aria-label="${tr('Budget du groupe')}">
    <div class="plan-budget-head"><div><div class="plan-eyebrow">${tr('Budget du groupe')}</div><h2>${t.hasBudget ? money(t.budget,g.currency) : tr('Aucun plafond défini')}</h2></div>
    ${g.createdBy === myUid() && !g.archived ? `<button type="button" class="btn soft sm" data-act="budget-edit">${tr(t.hasBudget ? 'Modifier le budget' : 'Définir un budget')}</button>` : ''}</div>
    <p class="hint plan-budget-description">${tr('Les prévisions ne créent aucune dette. Seules les dépenses payées comptent dans les soldes.')}</p>
    <div class="plan-totals"><div><span>${tr('Déjà dépensé')}</span><strong>${money(t.spent,g.currency)}</strong></div>
    <div><span>${tr('Encore prévu')}</span><strong>${money(t.planned,g.currency)}</strong></div>
    <div><span>${tr('Total projeté')}</span><strong>${money(t.projected,g.currency)}</strong></div>
    ${t.hasBudget ? `<div><span>${tr('Budget restant')}</span><strong class="${t.remaining<0?'neg':'pos'}">${money(t.remaining,g.currency)}</strong></div>` : ''}</div>
    ${t.hasBudget ? `<div class="plan-progress ${status}" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${pct}" aria-label="${tr('Budget utilisé')}"><span style="width:${pct}%"></span></div>
      <p class="plan-budget-alert ${status}" role="status">${t.exceeded ? tr('Attention : vos dépenses et prévisions dépassent le budget fixé.') : t.ratio >= .8 ? tr('Vous approchez du budget maximal.') : tr('Vous êtes dans le budget prévu.')}</p>` : `<p class="hint">${tr('Seul le créateur du groupe peut fixer un budget. Cette option est facultative.')}</p>`}
  </section>`;
}
function planListRow(p,info) {
  const {group:g} = info, edit = planCanEdit(p,g) && !g.archived;
  const label = p.status === 'done' ? tr('Réalisée') : p.status === 'cancelled' ? tr('Annulée') : tr('Prévue');
  const when = p.date ? fmtDate(p.date) : tr('Date à définir');
  const author = p.createdBy === myUid() ? tr('Moi') : (info.members.find(m=>m.uid===p.createdBy)?.name || tr('Un membre'));
  return `<article class="plan-item ${p.status !== 'planned' ? 'muted-plan' : ''}"><div class="plan-item-symbol">${catIcon(p.category)}</div><div class="plan-item-content"><div class="plan-item-top"><div class="plan-item-title">${esc(p.title)}</div><strong class="plan-item-amount">${money(p.amountCents,g.currency)}</strong></div>
    <div class="plan-item-meta">${esc(tr(catById(p.category).label))} · ${esc(when)} · ${esc(author)} <span class="plan-state ${p.status}">${label}</span></div>
    ${p.note ? `<p class="plan-item-note">${esc(p.note)}</p>` : ''}
    ${edit ? `<div class="plan-actions">${p.status === 'planned' ? `<button type="button" class="btn soft sm" data-act="plan-realize" data-id="${esc(p.id)}">${tr('Enregistrer la dépense réelle')}</button>` : ''}
    <button type="button" class="btn soft sm" data-act="plan-edit" data-id="${esc(p.id)}">${tr('Modifier')}</button>
    ${p.status === 'planned' ? `<button type="button" class="btn soft sm" data-act="plan-mark-done" data-id="${esc(p.id)}">${tr('Dépense déjà enregistrée')}</button><button type="button" class="btn soft sm" data-act="plan-cancel" data-id="${esc(p.id)}">${tr('Annuler la prévision')}</button>` : ''}
    ${p.status !== 'planned' ? `<button type="button" class="btn soft sm" data-act="plan-restore" data-id="${esc(p.id)}">${tr('Remettre en prévision')}</button>` : ''}
    <button type="button" class="btn soft sm" data-act="plan-delete" data-id="${esc(p.id)}">${tr('Supprimer')}</button></div>` : ''}
  </div></article>`;
}
function tabPlans(info) {
  const {group:g,st} = info;
  if(st.planError) return `<div class="banner" role="alert">${tr('Impossible de charger les prévisions. Vérifie les règles Firestore.')}: ${esc(st.planError)}</div>`;
  if(!st.plansReady) return skeletonList(3);
  const current = st.plans.filter(p=>p.status==='planned');
  const past = st.plans.filter(p=>p.status!=='planned');
  const plans = [...current,...past];
  return `<div class="plan-page"><div class="plan-intro"><div><div class="plan-eyebrow">${tr('Organisez votre prochain projet')}</div><h1>${tr('Prévisions et budget')}</h1><p>${tr('Préparez un voyage, un restaurant ou une sortie avant de dépenser.')}</p></div>
    ${!g.archived ? `<button type="button" class="btn brand" data-act="plan-new">${ico('plus','sm')} ${tr('Prévoir une dépense')}</button>` : ''}</div>
    ${planBudgetCard(info)}
    ${!plans.length ? `<div class="plan-empty"><div class="plan-empty-icon">${ico(g.type==='voyage'?'plane':g.type==='sortie'?'utensils':'calendar','group-symbol')}</div><h2>${tr('Commencez à préparer vos dépenses')}</h2><p>${tr('Exemples : trajet, hébergement, repas, billets, activités. Ajoutez des estimations sans créer de dettes.')}</p>${!g.archived?`<button class="btn brand" data-act="plan-new">${tr('Ajouter une prévision')}</button>`:''}</div>` :
      `<div class="plan-list-heading"><h2>${tr('À prévoir')} (${current.length})</h2></div><div class="plan-list">${current.length?current.map(p=>planListRow(p,info)).join(''):`<p class="hint">${tr('Aucune prévision en attente.')}</p>`}</div>
      ${past.length?`<div class="plan-list-heading"><h2>${tr('Historique des prévisions')}</h2></div><div class="plan-list">${past.map(p=>planListRow(p,info)).join('')}</div>`:''}`}
    <p class="hint plan-footnote">${tr('Le budget est indicatif : Kortiz avertit en cas de dépassement, mais ne bloque pas les paiements externes ni les dépenses déjà effectuées.')}</p>
  </div>`;
}
function openBudgetSheet() {
  const info = groupInfo(S.route.gid); if(!info || info.group.createdBy!==myUid())return toast(tr('Seul le créateur peut définir le budget.'),'err');
  if(info.group.archived)return toast(tr('Ce groupe est archivé.'),'err');
  const g=info.group;
  const sh=openSheet({title:tr('Budget maximum du groupe'),body:`<div class="col" style="gap:14px"><p class="muted">${tr('Définis un plafond facultatif pour le groupe. Les membres verront une alerte si les dépenses et prévisions le dépassent.')}</p><div class="field"><label for="pg-budget">${tr('Budget maximum (facultatif)')} (${esc(g.currency)})</label><input id="pg-budget" class="input" inputmode="decimal" placeholder="${tr('Aucun plafond')}" value="${g.budgetCents ? esc(centsToInput(g.budgetCents)) : ''}"></div><p class="hint">${tr('Laisse le champ vide pour supprimer le plafond.')}</p></div>`,footer:`<button type="button" class="btn brand" id="pg-save">${tr('Enregistrer')}</button>`});
  $('#pg-save',sh.el).addEventListener('click',async e=>{
    const value=$('#pg-budget',sh.el).value.trim();const cents=value?parseAmountInput(value):null;
    if(value && (!Number.isInteger(cents)||cents<=0||cents>1000000000))return toast(tr('Budget invalide.'),'err');
    try{await withBusy(e.currentTarget,()=>updateGroup(g.id,{budgetCents:cents},null));closeSheet();toast(tr('Budget enregistré.'));}
    catch(err){toast(errMsg(err),'err');}
  });
}
ACT['budget-edit']=()=>openBudgetSheet();
function findPlan(gid,id){return S.stores.get(gid)?.plans.find(p=>p.id===id);}
function openPlanSheet(gid,plan=null,defaultDate=""){
  const info=groupInfo(gid);if(!info || info.group.archived)return toast(tr('Ce groupe est archivé.'),'err');
  if(plan && !planCanEdit(plan,info.group))return toast(tr('Action non autorisée.'),'err');
  const g=info.group,edit=!!plan;
  const sh=openSheet({title:tr(edit?'Modifier la prévision':'Prévoir une dépense'),body:`<div class="col" style="gap:16px">
    <p class="hint">${tr('Une prévision est une estimation, pas une dépense payée. Elle ne change pas les soldes.')}</p>
    <div class="field"><label for="plan-title">${tr('Nom de la dépense prévue')}</label><input id="plan-title" class="input" maxlength="120" placeholder="${tr(g.type==='voyage'?'Ex. Hôtel, train, activités':'Ex. Restaurant, boissons, billets')}" value="${esc(plan?.title||'')}"></div>
    <div class="field"><label for="plan-amount">${tr('Montant estimé')} (${esc(g.currency)})</label><input id="plan-amount" class="input" inputmode="decimal" placeholder="0,00" value="${plan?esc(centsToInput(plan.amountCents)):''}"></div>
    <div class="field"><label for="plan-cat">${tr('Catégorie')}</label><select id="plan-cat" class="input">${CATEGORIES.map(c=>`<option value="${esc(c.id)}" ${plan?.category===c.id?'selected':''}>${esc(tr(c.label))}</option>`).join('')}</select></div>
    <div class="field"><label for="plan-date">${tr('Date prévue (facultatif)')}</label><input id="plan-date" type="date" class="input" value="${esc(plan?.date||defaultDate)}"></div>
    <div class="field"><label for="plan-note">${tr('Note (facultatif)')}</label><textarea id="plan-note" class="input" maxlength="500" placeholder="${tr('Ex. Réservation pour 4 personnes, tarif estimé')}">${esc(plan?.note||'')}</textarea></div>
    <div class="plan-form-alert" id="plan-form-budget" aria-live="polite"></div>
  </div>`,footer:`<button type="button" class="btn brand" id="plan-save">${tr(edit?'Enregistrer':'Ajouter la prévision')}</button>`});
  const budgetAlert=()=>{
    const t=planTotals(info),input=parseAmountInput($('#plan-amount',sh.el).value)||0;
    const projected=t.projected-(plan?.status==='planned'?plan.amountCents:0)+(plan?.status==='planned'||!plan?input:0);
    const box=$('#plan-form-budget',sh.el);
    box.innerHTML=t.hasBudget&&projected>t.budget?`<div class="banner plan-warning">${ico('info','sm')} ${tr('Cette prévision ferait dépasser le budget estimé de')} ${money(projected-t.budget,g.currency)}. ${tr('Vous pouvez l’ajouter, mais le groupe sera averti.')}</div>`:'';
  };
  $('#plan-amount',sh.el).addEventListener('input',budgetAlert);budgetAlert();
  $('#plan-save',sh.el).addEventListener('click',async e=>{
    const title=$('#plan-title',sh.el).value.trim(),amountCents=parseAmountInput($('#plan-amount',sh.el).value),category=$('#plan-cat',sh.el).value,date=$('#plan-date',sh.el).value,note=$('#plan-note',sh.el).value.trim();
    if(!title)return toast(tr('Indique un nom pour la prévision.'),'err');
    if(!Number.isInteger(amountCents)||amountCents<=0||amountCents>100000000)return toast(tr('Saisis un montant estimé valide.'),'err');
    if(date && !/^\d{4}-\d{2}-\d{2}$/.test(date))return toast(tr('Date invalide.'),'err');
    const base={title,amountCents,category,date,note,updatedAt:serverTimestamp()};
    try{
      await withBusy(e.currentTarget,()=>edit
        ? updateDoc(doc(col(gid,'plannedExpenses'),plan.id),base)
        : setDoc(doc(col(gid,'plannedExpenses')),{...base,status:'planned',createdBy:myUid(),createdAt:serverTimestamp()}));
      closeSheet();toast(tr(edit?'Prévision modifiée.':'Prévision ajoutée.'));
    }catch(err){toast(errMsg(err),'err');}
  });
  setTimeout(()=>$('#plan-title',sh.el)?.focus(),320);
}
ACT['plan-new']=()=>openPlanSheet(S.route.gid);
ACT['plan-edit']=(b)=>{const plan=findPlan(S.route.gid,b.dataset.id);if(plan)openPlanSheet(S.route.gid,plan);};
ACT['plan-realize']=(b)=>{const gid=S.route.gid,p=findPlan(gid,b.dataset.id),info=groupInfo(gid);if(!p||p.status!=='planned'||!planCanEdit(p,info.group))return;openExpenseForm(gid,null,p);};
ACT['plan-mark-done']=async b=>{
  const gid=S.route.gid,p=findPlan(gid,b.dataset.id),info=groupInfo(gid);
  if(!p||p.status!=='planned'||!planCanEdit(p,info.group)||info.group.archived)return;
  if(!(await confirmDialog({title:tr('Dépense déjà enregistrée ?'),message:tr('À utiliser uniquement si la dépense réelle existe déjà dans Kortiz. Cette prévision ne comptera alors plus dans le total projeté.'),ok:tr('Marquer comme réalisée')})))return;
  try{await withBusy(b,()=>updateDoc(doc(col(gid,'plannedExpenses'),p.id),{status:'done',updatedAt:serverTimestamp()}));toast(tr('Prévision marquée comme réalisée.'));}catch(e){toast(errMsg(e),'err');}
};
ACT['plan-cancel']=async b=>{
  const gid=S.route.gid,p=findPlan(gid,b.dataset.id),info=groupInfo(gid);if(!p||!planCanEdit(p,info.group)||info.group.archived)return;
  try{await withBusy(b,()=>updateDoc(doc(col(gid,'plannedExpenses'),p.id),{status:'cancelled',updatedAt:serverTimestamp()}));toast(tr('Prévision annulée.'));}catch(e){toast(errMsg(e),'err');}
};
ACT['plan-restore']=async b=>{
  const gid=S.route.gid,p=findPlan(gid,b.dataset.id),info=groupInfo(gid);if(!p||!planCanEdit(p,info.group)||info.group.archived)return;
  try{await withBusy(b,()=>updateDoc(doc(col(gid,'plannedExpenses'),p.id),{status:'planned',updatedAt:serverTimestamp()}));toast(tr('Prévision réactivée.'));}catch(e){toast(errMsg(e),'err');}
};
ACT['plan-delete']=async b=>{
  const gid=S.route.gid,p=findPlan(gid,b.dataset.id),info=groupInfo(gid);if(!p||!planCanEdit(p,info.group)||info.group.archived)return;
  if(!(await confirmDialog({title:tr('Supprimer la prévision ?'),message:tr('Cette action ne supprime aucune dépense réelle.'),ok:tr('Supprimer'),danger:true})))return;
  try{await withBusy(b,()=>deleteDoc(doc(col(gid,'plannedExpenses'),p.id)));toast(tr('Prévision supprimée.'));}catch(e){toast(errMsg(e),'err');}
};

/* ---------- v28 : calendrier partagé, sondages, récurrences ---------- */
const ISO_DATE=/^\d{4}-\d{2}-\d{2}$/;
const dateUTC=(iso)=>new Date(`${iso}T12:00:00Z`);
function goodDate(iso){if(!ISO_DATE.test(iso))return false;const dt=dateUTC(iso);return !Number.isNaN(dt.getTime())&&dt.toISOString().slice(0,10)===iso;}
const dayOffset=(iso,base=todayISO())=>Math.round((dateUTC(iso)-dateUTC(base))/86400000);
const toYearMonth=(d)=>`${d.getUTCFullYear()}-${z2(d.getUTCMonth()+1)}`;
function recurringTemplates(info){return info.expenses.filter(e=>e.recurringNext&&e.recurring?.freq&&e.approvalStatus!=='rejected');}
function upcomingRecurring(info,maxDate){
  const events=[];
  for(const e of recurringTemplates(info)){
    let next=e.recurringNext;
    if(!goodDate(next))continue;
    for(let i=0;i<60 && next<=maxDate;i++){
      events.push({id:e.id,date:next,title:e.title,amountCents:e.amountCents,kind:'recurring',freq:e.recurring.freq});
      const n=addPeriod(next,e.recurring.freq,e.recurring.dayOfMonth);
      if(n<=next||!goodDate(n))break;
      next=n;
    }
  }
  return events;
}
function calendarItems(info,start,end){
  const plans=info.st.plans.filter(p=>p.date&&goodDate(p.date)&&p.status==='planned'&&p.date>=start&&p.date<=end)
    .map(p=>({id:p.id,date:p.date,title:p.title,amountCents:p.amountCents,kind:'plan'}));
  return [...plans,...upcomingRecurring(info,end).filter(e=>e.date>=start)].sort((a,b)=>a.date.localeCompare(b.date)||a.title.localeCompare(b.title));
}
function calendarMonth(info){
  const ym=/^\d{4}-(0[1-9]|1[0-2])$/.test(S.ui.calendarMonth||'')?S.ui.calendarMonth:todayISO().slice(0,7);
  const [year,month]=ym.split('-').map(Number),first=new Date(Date.UTC(year,month-1,1)),last=new Date(Date.UTC(year,month,0));
  const firstISO=`${ym}-01`,lastISO=`${ym}-${z2(last.getUTCDate())}`;
  const events=calendarItems(info,firstISO,lastISO),byDate={};
  events.forEach(e=>(byDate[e.date]??=[]).push(e));
  const labels=[tr('Lun'),tr('Mar'),tr('Mer'),tr('Jeu'),tr('Ven'),tr('Sam'),tr('Dim')];
  const monthLabel=new Intl.DateTimeFormat(locale(),{month:'long',year:'numeric',timeZone:'UTC'}).format(first);
  const cells=[],blank=(first.getUTCDay()+6)%7;
  for(let i=0;i<blank;i++)cells.push('<div class="v28-cal-cell empty" aria-hidden="true"></div>');
  for(let d=1;d<=last.getUTCDate();d++){
    const date=`${ym}-${z2(d)}`,items=byDate[date]||[];
    cells.push(`<button type="button" class="v28-cal-cell ${date===todayISO()?'today':''} ${items.length?'has-items':''}" data-act="calendar-day" data-date="${date}" aria-label="${esc(fmtDate(date))} · ${items.length} ${tr('événements')}"><span class="v28-cal-day">${d}</span>${items.slice(0,2).map(e=>`<span class="v28-cal-dot ${e.kind}" title="${esc(e.title)}">${esc(e.title)}</span>`).join('')}${items.length>2?`<small>+${items.length-2}</small>`:''}</button>`);
  }
  return `<section class="v28-calendar" aria-label="${tr('Calendrier partagé')}">
    <div class="v28-cal-head"><div><div class="plan-eyebrow">${tr('Calendrier partagé')}</div><h1>${tr('Échéances et prévisions')}</h1><p class="hint">${tr('Les prévisions ne créent pas de dette. Les récurrences restent liées aux dépenses réelles.')}</p></div><div class="v28-cal-controls"><button class="btn soft sm" type="button" data-act="calendar-prev" aria-label="${tr('Mois précédent')}">${ico('back','sm')}</button><strong>${esc(monthLabel)}</strong><button class="btn soft sm" type="button" data-act="calendar-next" aria-label="${tr('Mois suivant')}">${ico('next','sm')}</button></div></div>
    <div class="v28-calendar-grid">${labels.map(x=>`<span class="v28-weekday">${esc(x)}</span>`).join('')}${cells.join('')}</div>
    <div class="v28-calendar-legend"><span>${tr('Prévision')}</span><span>${tr('Dépense récurrente')}</span></div>
    ${!info.group.archived?`<button class="btn brand" data-act="calendar-new">${ico('plus','sm')} ${tr('Ajouter une prévision')}</button>`:''}
    <div class="section-title">${tr('Échéances de ce mois')}</div>${events.length?`<div class="card"><div class="list">${events.map(e=>`<button class="item" data-act="calendar-day" data-date="${e.date}"><span class="v28-date-stamp">${e.date.slice(8)}</span><div class="grow"><div class="t">${esc(e.title)}</div><div class="s">${tr(e.kind==='plan'?'Prévision':'Récurrence')} · ${esc(fmtDate(e.date))}</div></div><b>${money(e.amountCents,info.group.currency)}</b></button>`).join('')}</div></div>`:`<p class="hint">${tr('Aucune échéance ce mois-ci.')}</p>`}
  </section>`;
}
function tabCalendar(info){if(info.st.planError)return `<div class="banner">${tr('Impossible de charger les prévisions. Vérifie les règles Firestore.')}: ${esc(info.st.planError)}</div>`;if(!info.st.plansReady)return skeletonList(3);return calendarMonth(info);}
function calendarChange(delta){const ym=/^\d{4}-\d{2}$/.test(S.ui.calendarMonth||'')?S.ui.calendarMonth:todayISO().slice(0,7),[y,m]=ym.split('-').map(Number);const d=new Date(Date.UTC(y,m-1+delta,1));S.ui.calendarMonth=toYearMonth(d);scheduleRender();}
ACT['calendar-prev']=()=>calendarChange(-1);ACT['calendar-next']=()=>calendarChange(1);
ACT['calendar-new']=()=>openPlanSheet(S.route.gid,null,S.ui.calendarMonth?`${S.ui.calendarMonth}-01`:todayISO());
ACT['calendar-day']=(b)=>{
  const date=b.dataset.date,info=groupInfo(S.route.gid);if(!info||!goodDate(date))return;
  const items=calendarItems(info,date,date),sh=openSheet({title:`${tr('Échéances')} · ${fmtDate(date)}`,body:`<div class="col" style="gap:12px">${items.length?items.map(e=>`<div class="card pad"><b>${esc(e.title)}</b><div class="hint">${tr(e.kind==='plan'?'Prévision':'Dépense récurrente')} · ${money(e.amountCents,info.group.currency)}</div></div>`).join(''):`<p class="hint">${tr('Aucune échéance ce jour-là.')}</p>`}${!info.group.archived?`<button class="btn brand" data-act="calendar-plan-date" data-date="${date}">${ico('plus','sm')} ${tr('Prévoir une dépense')}</button>`:''}</div>`});
};
ACT['calendar-plan-date']=(b)=>{const date=b.dataset.date;closeSheet();setTimeout(()=>openPlanSheet(S.route.gid,null,date),250);};

const pollCanManage=(p,g)=>p.createdBy===myUid()||groupAdmin(g);
const pollIsOpen=p=>p.status==='open' && (p.closesAt?.toMillis?.()||0)>Date.now();
function tabPolls(info){
  const st=info.st,g=info.group;
  if(st.pollError){
    const denied=String(st.pollError).includes('permission-denied');
    const explanation=denied
      ? tr('Accès refusé par Firebase. Les règles Firestore déployées doivent autoriser la lecture des sondages aux membres du groupe. Vérifie également que ton compte appartient toujours au groupe.')
      : tr('Vérifie ta connexion puis réessaie. Si le problème persiste, contacte le support.');
    return `<section class="v28-polls"><div class="card pad" role="alert"><h2>${tr('Impossible de charger les sondages.')}</h2><p class="hint">${explanation}</p><button class="btn soft" type="button" data-act="poll-retry">${tr('Réessayer le chargement')}</button></div></section>`;
  }
  if(!st.pollsReady)return skeletonList(3);
  return `<section class="v28-polls"><div class="plan-intro"><div><div class="plan-eyebrow">${tr('Votes de groupe')}</div><h1>${tr('Décider ensemble')}</h1><p>${tr('Votez pour un restaurant, une activité, une date ou un budget. Un sondage ne crée aucune dépense.')}</p></div>${!g.archived?`<button class="btn brand" data-act="poll-create">${ico('plus','sm')} ${tr('Nouveau sondage')}</button>`:''}</div>
    ${st.polls.length?st.polls.map(p=>{
      const votes=p.votes||{},opts=p.options||[],counts=opts.map((_,i)=>Object.values(votes).filter(x=>x===i).length),total=Object.keys(votes).length,open=pollIsOpen(p),mine=votes[myUid()];
      return `<article class="v28-poll-card"><div class="v28-poll-title"><div><h2>${esc(p.question)}</h2><p>${tr(open?'Vote ouvert':'Vote terminé')} · ${total} ${tr('votes')}</p></div><span class="badge ${open?'brand':''}">${tr(open?'En cours':'Clôturé')}</span></div><div class="v28-poll-answers">${opts.map((label,i)=>`<button type="button" data-act="poll-vote" data-id="${esc(p.id)}" data-option="${i}" class="v28-poll-answer ${mine===i?'selected':''}" ${!open||g.archived?'disabled':''}><span class="v28-poll-answer-top"><span>${esc(label)}</span><strong>${total?Math.round(counts[i]/total*100):0}%</strong></span><span class="v28-poll-track"><i style="width:${total?counts[i]/total*100:0}%"></i></span></button>`).join('')}</div><div class="v28-poll-meta">${total} ${tr('participations')} · ${tr('Fin prévue')} : ${esc(new Date(p.closesAt?.toMillis?.()||Date.now()).toLocaleDateString(locale()))}${open&&pollCanManage(p,g)?`<button class="btn soft sm" data-act="poll-close" data-id="${esc(p.id)}">${tr('Clôturer')}</button>`:''}</div></article>`;
    }).join(''):`<div class="card pad"><h2>${tr('Aucun sondage pour le moment.')}</h2><p class="hint">${tr('Posez une question à votre groupe pour organiser un projet ensemble.')}</p></div>`}
  </section>`;
}
ACT['poll-retry']=()=>{
  const store=groupInfo(S.route.gid)?.st;
  if(!store)return;
  store.pollError=null;store.pollsReady=false;
  store.startPolls();
  scheduleRender();
};
function pollActiveContext(scope,id){
  if(!['group','direct'].includes(scope)||!id)return null;
  if(scope==='group'){
    const g=groupInfo(id)?.group;
    if(S.route.name!=='group'||S.route.gid!==id||S.route.tab!=='chat'||!g||g.archived)return null;
  }else if(S.route.name!=='direct'||S.route.cid!==id||!SOC.direct.some(c=>c.id===id&&c.members.length===2))return null;
  if(SOC.chatKey!==`${scope}/${id}`)return null;
  return scope==='group'?doc(db,'groups',id):doc(db,'directChats',id);
}
ACT['poll-create']=(b)=>{
  const scope=b?.dataset?.scope || 'group',id=b?.dataset?.chat || S.route.gid;
  const root=pollActiveContext(scope,id);
  if(!root)return toast(tr('Action non autorisée.'),'err');
  const sh=openSheet({title:tr('Nouveau sondage'),body:`<div class="col" style="gap:16px"><div class="field"><label for="v28-poll-question">${tr('Question')}</label><input class="input" id="v28-poll-question" maxlength="160" placeholder="${tr('Quel restaurant choisir ?')}"></div><div class="field"><label for="v28-poll-options">${tr('Propositions (une par ligne, 2 à 6)')}</label><textarea class="input" id="v28-poll-options" rows="6" maxlength="600" placeholder="${tr('Option 1')}\n${tr('Option 2')}"></textarea></div><div class="field"><label for="v28-poll-deadline">${tr('Date de fin')}</label><input type="date" id="v28-poll-deadline" class="input" min="${todayISO()}" value="${todayISO(new Date(Date.now()+7*864e5))}"></div><p class="hint">${tr('Les votes ne déclenchent aucune dépense ni paiement.')}</p></div>`,footer:`<button class="btn brand" id="v28-poll-save">${tr('Publier le sondage')}</button>`});
  $('#v28-poll-save',sh.el).addEventListener('click',async ev=>{
    const question=$('#v28-poll-question',sh.el).value.trim(),opts=$('#v28-poll-options',sh.el).value.split(/\r?\n/).map(x=>x.trim()).filter(Boolean),deadline=$('#v28-poll-deadline',sh.el).value;
    if(question.length<5||question.length>160)return toast(tr('Question trop courte ou trop longue.'),'err');
    if(opts.length<2||opts.length>6||opts.some(x=>x.length>100)||new Set(opts.map(x=>x.toLocaleLowerCase())).size!==opts.length)return toast(tr('Indique 2 à 6 propositions distinctes.'),'err');
    if(!goodDate(deadline)||deadline<todayISO()||dayOffset(deadline)>365)return toast(tr('Date de fin invalide.'),'err');
    const end=new Date(`${deadline}T23:59:59`);if(!Number.isFinite(end.getTime()))return toast(tr('Date invalide.'),'err');
    if(!pollActiveContext(scope,id))return toast(tr('Conversation indisponible'),'err');
    try{await withBusy(ev.currentTarget,()=>setDoc(doc(collection(root,'polls')),{question,options:opts,votes:{},status:'open',createdBy:myUid(),closesAt:Timestamp.fromDate(end),createdAt:serverTimestamp(),updatedAt:serverTimestamp()}));closeSheet();toast(tr('Sondage publié.'));}catch(err){toast(errMsg(err),'err');}
  });
};
ACT['poll-vote']=async b=>{
  const scope=b.dataset.scope,id=b.dataset.chat,root=pollActiveContext(scope,id);
  const p=SOC.polls.find(x=>x.id===b.dataset.id),index=Number(b.dataset.option);
  if(!root||!p||!pollIsOpen(p)||!Number.isInteger(index)||index<0||index>=p.options.length)return;
  try{await withBusy(b,()=>updateDoc(doc(root,'polls',p.id),new FieldPath('votes',myUid()),index,'updatedAt',serverTimestamp()));toast(tr('Vote enregistré.'));}catch(err){toast(errMsg(err),'err');}
};
ACT['poll-close']=async b=>{
  const scope=b.dataset.scope,id=b.dataset.chat,root=pollActiveContext(scope,id),p=SOC.polls.find(x=>x.id===b.dataset.id);
  if(!root||!p||!pollIsOpen(p)||!(p.createdBy===myUid()||(scope==='group'&&groupAdmin(groupInfo(id)?.group))))return;
  if(!(await confirmDialog({title:tr('Clôturer ce sondage ?'),message:tr('Les résultats resteront visibles, mais les votes seront fermés.'),ok:tr('Clôturer')})))return;
  try{await withBusy(b,()=>updateDoc(doc(root,'polls',p.id),{status:'closed',updatedAt:serverTimestamp()}));toast(tr('Sondage clôturé.'));}catch(err){toast(errMsg(err),'err');}
};

function tabRecurring(info){
  const g=info.group,templates=recurringTemplates(info),horizon=todayISO(new Date(Date.now()+30*864e5)),upcoming=upcomingRecurring(info,horizon).filter(e=>e.date>=todayISO()).sort((a,b)=>a.date.localeCompare(b.date)).slice(0,30);
  const name=f=>tr(({weekly:'Hebdomadaire',monthly:'Mensuelle',yearly:'Annuelle'})[f]||f);
  return `<section class="v28-recurring"><div class="plan-intro"><div><div class="plan-eyebrow">${tr('Dépenses régulières')}</div><h1>${tr('Loyers, abonnements et échéances')}</h1><p>${tr('Les échéances futures sont générées à partir des dépenses récurrentes existantes, sans créer de doublons.')}</p></div>${!g.archived?`<button class="btn brand" data-act="recurring-new">${ico('plus','sm')} ${tr('Nouvelle récurrence')}</button>`:''}</div>
    <h2>${tr('Récurrences actives')} (${templates.length})</h2>${templates.length?`<div class="card"><div class="list">${templates.map(e=>`<div class="item v28-recurring-row"><span class="v28-recurring-icon">${ico('repeat')}</span><div class="grow"><div class="t">${esc(e.title)}</div><div class="s">${esc(name(e.recurring.freq))} · ${tr('Prochaine échéance')} : ${esc(fmtDate(e.recurringNext))}</div></div><b>${money(e.amountCents,g.currency)}</b>${!g.archived&&(groupAdmin(g)||e.createdBy===myUid())?`<div class="v28-recurring-actions"><button class="btn soft sm" data-act="recurring-edit" data-id="${esc(e.id)}">${tr('Modifier')}</button><button class="btn soft sm" data-act="recurring-stop" data-id="${esc(e.id)}">${tr('Arrêter')}</button></div>`:''}</div>`).join('')}</div></div>`:`<div class="card pad"><p class="hint">${tr('Aucune dépense récurrente active.')}</p></div>`}
    <h2>${tr('Rappels des 30 prochains jours')}</h2>${upcoming.length?`<div class="card"><div class="list">${upcoming.map(e=>`<div class="item"><span class="v28-date-stamp">${e.date.slice(8)}</span><div class="grow"><div class="t">${esc(e.title)}</div><div class="s">${esc(fmtDate(e.date))} · ${dayOffset(e.date)<=7?tr('Échéance proche'):tr('À venir')}</div></div><b>${money(e.amountCents,g.currency)}</b></div>`).join('')}</div></div>`:`<p class="hint">${tr('Aucune échéance prévue sur les 30 prochains jours.')}</p>`}
    <p class="hint">${tr('Ces rappels sont visibles dans Kortiz. Ils ne constituent pas des notifications push planifiées. Les dépenses réelles restent créées par le service récurrent existant.')}</p>
  </section>`;
}
ACT['recurring-new']=()=>openExpenseForm(S.route.gid);
ACT['recurring-edit']=b=>{const info=groupInfo(S.route.gid),e=info?.expenses.find(x=>x.id===b.dataset.id);if(!e||(!groupAdmin(info.group)&&e.createdBy!==myUid()))return;openExpenseForm(S.route.gid,e);};
ACT['recurring-stop']=async b=>{
  const gid=S.route.gid,info=groupInfo(gid),e=info?.expenses.find(x=>x.id===b.dataset.id);
  if(!e?.recurringNext||info.group.archived||(!groupAdmin(info.group)&&e.createdBy!==myUid()))return;
  if(!(await confirmDialog({title:tr('Arrêter cette récurrence ?'),message:tr('Les dépenses passées restent inchangées. Aucune nouvelle occurrence ne sera créée.'),ok:tr('Arrêter la récurrence')})))return;
  try{await withBusy(b,()=>call('approveGroupExpense',{operation:'stopRecurring',groupId:gid,expenseId:e.id}));toast(tr('Récurrence arrêtée.'));}catch(err){toast(errMsg(err),'err');}
};

/* ---------- Onglet Dépenses ---------- */
function filterExpenses(list, info) {
  const { q, cat, who, period } = S.ui, t = todayISO(), nq = norm(q);
  const since30 = todayISO(new Date(Date.now() - 30 * 864e5));
  return list.filter((e) => {
    if (cat && e.category !== cat) return false;
    if (who && !(e.payers && who in e.payers)) return false;
    if (period === "month" && e.date.slice(0, 7) !== t.slice(0, 7)) return false;
    if (period === "30d" && e.date < since30) return false;
    if (period === "year" && e.date.slice(0, 4) !== t.slice(0, 4)) return false;
    if (nq) {
      const payers = Object.keys(e.payers || {}).map((i) => info.memberMap[i]?.name).join(" ");
      if (!norm(`${e.title} ${e.note || ""} ${catById(e.category).label} ${payers} ${(e.amountCents / 100).toFixed(2)}`).includes(nq)) return false;
    }
    return true;
  });
}
function expenseRow(e, info) {
  const { memberMap, me, group: g } = info, ids = Object.keys(e.payers || {});
  const names = ids.map((i) => memberMap[i]?.name || "?");
  const who = names.length > 1 ? `${names.join(" + ")} ont payé` : `${names[0] || "?"} a payé`;
  let mine = "";
  if (e.approvalStatus==='rejected') mine = `<span class="muted">${tr('Refusée')}</span>`;
  else if (me) {
    const d = (e.payers?.[me.id] || 0) - (e.split?.[me.id] || 0);
    if (!(me.id in (e.split || {})) && !(me.id in (e.payers || {}))) mine = `<span class="faint">pas concerné</span>`;
    else if (d > 0) mine = `<span class="pos">tu récupères ${money(d, g.currency)}</span>`;
    else if (d < 0) mine = `<span class="neg">ta part ${money(-d, g.currency)}</span>`;
    else mine = `<span class="muted">à jour</span>`;
  }
  return `<button class="item" data-act="open-expense" data-id="${esc(e.id)}">${catIcon(e.category)}
    <div class="grow"><div class="t ellipsis">${esc(e.title)} ${e.approvalStatus==='rejected'?`<span class="badge">${tr('Refusée')}</span>`:''} ${e.recurringNext ? `<span style="color:var(--brand)" title="Récurrente">${ico("repeat", "xs")}</span>` : ""}${e.receiptPath ? `<span class="faint" title="Ticket">${ico("camera", "xs")}</span>` : ""}</div><div class="s ellipsis">${esc(who)} · ${esc(catById(e.category).label)}</div></div>
    <div class="right"><div class="num" style="font-weight:700">${money(e.amountCents, g.currency)}</div><div style="font-size:12.5px;font-weight:600">${mine}</div></div></button>`;
}
function tabExpenses(info) {
  const { group: g, members, me, balances, total, expenses } = info, U = S.ui;
  const myNet = me ? balances[me.id]?.net || 0 : 0, bl = balanceLabel(myNet, g.currency);
  const filtered = filterExpenses(expenses, info), shown = filtered.slice(0, U.expLimit);
  const activeFilters = [U.cat, U.who, U.period].filter(Boolean).length;
  const sel = (id, k, opts, label) => `<div class="field"><label for="${id}">${label}</label><select id="${id}" class="input" data-ch="ex-filter" data-k="${k}">${opts.map(([v, l]) => `<option value="${esc(v)}" ${U[k] === v ? "selected" : ""}>${esc(l)}</option>`).join("")}</select></div>`;
  let list = "";
  if (!expenses.length) list = emptyState({ icon: "receipt", title: "Aucune dépense pour l'instant", text: "Ajoute la première : courses, resto, loyer… L'appli calcule qui doit quoi à qui.", cta: g.archived ? "" : "Ajouter une dépense", act: "fab" });
  else if (!filtered.length) list = emptyState({ icon: "search", title: "Aucun résultat", text: "Aucune dépense ne correspond à ta recherche ou à tes filtres.", cta: "Réinitialiser", act: "ex-reset" });
  else {
    let cur = "", html = "";
    shown.forEach((e) => { if (e.date !== cur) { if (cur) html += `</div></div>`; cur = e.date; html += `<div class="day-h">${esc(dayLabel(e.date))}</div><div class="card"><div class="list">`; } html += expenseRow(e, info); });
    list = html + `</div></div>` + (filtered.length > shown.length ? `<div class="center" style="margin-top:16px"><button class="btn soft sm" data-act="ex-more">Voir plus (${filtered.length - shown.length})</button></div>` : "");
  }
  const kpis = `<div class="kpis" style="margin-top:6px"><div class="kpi"><div class="l">Total dépensé</div><div class="v num">${money(total, g.currency)}</div></div>
    <div class="kpi"><div class="l">${tr("Mon solde")}</div><div class="v ${me ? bl.cls : "muted"}" style="font-size:${me ? 16 : 21}px;line-height:1.5">${me ? bl.text : "—"}</div></div></div>`;
  return `<div class="dgrid"><div class="dmain">
    <div class="row" style="margin:16px 0 4px"><div class="input-wrap grow">${ico("search", "sm")}<input id="ex-q" class="input" data-in="ex-q" placeholder="Rechercher une dépense" value="${esc(U.q)}" enterkeyhint="search"></div>
      <button class="icon-btn" style="width:50px;height:50px;border-radius:14px;${activeFilters ? "background:var(--ink);color:var(--ink-fg)" : ""}" data-act="ex-filters" aria-label="Filtres">${ico("filter", "sm")}</button></div>
    ${U.showFilters ? `<div class="card pad col" style="margin:10px 0">${sel("f-cat", "cat", [["", "Toutes les catégories"], ...CATEGORIES.map((c) => [c.id, c.label])], "Catégorie")}${sel("f-who", "who", [["", "Tout le monde"], ...members.map((m) => [m.id, m.name])], "Payé par")}${sel("f-per", "period", [["", "Toutes les dates"], ["month", "Ce mois-ci"], ["30d", "30 derniers jours"], ["year", "Cette année"]], "Période")}${activeFilters ? `<button class="link-btn" data-act="ex-reset" style="text-align:left">Réinitialiser les filtres</button>` : ""}</div>` : ""}
    ${list}</div><div class="dside">${kpis}<div class="desk-only">${deskBalances(info)}</div></div></div>`;
}
INP["ex-q"] = (t) => { S.ui.q = t.value; S.ui.expLimit = 30; scheduleRender(); };
CHG["ex-filter"] = (t) => { S.ui[t.dataset.k] = t.value; S.ui.expLimit = 30; scheduleRender(); };
ACT["ex-filters"] = () => { S.ui.showFilters = !S.ui.showFilters; scheduleRender(); };
ACT["ex-reset"] = () => { Object.assign(S.ui, { q: "", cat: "", who: "", period: "" }); scheduleRender(); };
ACT["ex-more"] = () => { S.ui.expLimit += 30; scheduleRender(); };
ACT["open-expense"] = (b) => openExpenseDetail(S.route.gid, b.dataset.id);

/** Fiche détaillée d'une dépense : répartition, note, ticket, modifier / supprimer. */
function openExpenseDetail(gid, eid) {
  const info = groupInfo(gid), e = info?.expenses.find((x) => x.id === eid);
  if (!e) return;
  const g = info.group, c = catById(e.category), mm = info.memberMap;
  const payers = Object.entries(e.payers || {}), split = Object.entries(e.split || {});
  const modeLabel = { equal: "Parts égales", shares: "Par parts", percent: "Pourcentages", exact: "Montants exacts" }[e.splitMode] || "";
  const canEdit=groupAdmin(g)||(e.createdBy===myUid() && e.approvalStatus!=='rejected');
  const approvalActions = e.approvalStatus==='rejected' ? `<div class="banner">${tr('Dépense refusée : elle n’entre pas dans les soldes.')}</div>` : '';
  const sh = openSheet({
    title: "Dépense",
    body: `<div class="col" style="gap:18px">${approvalActions}<div class="center">${catIcon(e.category, "lg").replace("cat-ico", "cat-ico\" style=\"margin:0 auto 8px;width:56px;height:56px;border-radius:18px;background:" + c.color + "1f;color:" + c.color + "")}<div class="h-sub">${esc(c.label)} · ${esc(fmtDate(e.date))}</div><h2 style="font-size:22px;font-weight:800;letter-spacing:-.02em;margin:2px 0">${esc(e.title)}</h2><div class="num" style="font-size:38px;font-weight:800;letter-spacing:-.04em">${money(e.amountCents, g.currency)}</div>${e.recurringNext ? `<div style="margin-top:6px"><span class="badge brand">${ico("repeat", "xs")} Récurrente : ${{ weekly: "chaque semaine", monthly: "chaque mois", yearly: "chaque année" }[e.recurring?.freq] || ""}</span></div>` : ""}</div>
      <div><div class="section-title" style="margin-top:0">Payé par</div><div class="card"><div class="list">${payers.map(([id, v]) => `<div class="item nosep">${avatar(mm[id], "sm")}<span class="grow t">${esc(mm[id]?.name || "Ancien participant")}</span><b class="num">${money(v, g.currency)}</b></div>`).join("")}</div></div></div>
      <div><div class="section-title" style="margin-top:0">${tr('Part de chacun')} · ${modeLabel}</div><div class="card"><div class="list">${split.map(([id, v]) => `<div class="item nosep">${avatar(mm[id], "sm")}<span class="grow t">${esc(mm[id]?.name || "Ancien participant")}</span><span class="num">${money(v, g.currency)}</span></div>`).join("")}</div></div></div>
      ${e.note ? `<div><div class="section-title" style="margin-top:0">Note</div><div class="card pad" style="white-space:pre-wrap">${esc(e.note)}</div></div>` : ""}
      ${e.receiptPath ? `<div><div class="section-title" style="margin-top:0">Ticket</div><div id="rc-box"><div class="skel" style="height:180px;border-radius:16px"></div></div></div>` : ""}
      <p class="hint center">Ajouté par ${esc(e.createdByName || "un participant")}${e.auto ? " (dépense récurrente automatique)" : ""}</p></div>`,
    footer: g.archived || !canEdit ? "" : `<button class="btn soft" data-act="exp-edit" data-id="${esc(e.id)}">${ico("edit", "sm")} Modifier</button><button class="btn danger" data-act="exp-del" data-id="${esc(e.id)}">${ico("trash", "sm")} Supprimer</button>`,
  });
  if (e.receiptPath) receiptUrl(e.receiptPath).then((u) => { const b = $("#rc-box", sh.el); if (b) b.innerHTML = `<a href="${esc(u)}" target="_blank" rel="noopener"><img class="receipt-img" src="${esc(u)}" alt="Photo du ticket"></a>`; }).catch(() => { const b = $("#rc-box", sh.el); if (b) b.innerHTML = `<div class="hint">Photo indisponible (hors-ligne ?).</div>`; });
}
ACT["exp-edit"] = (b) => { const gid = S.route.gid, e = groupInfo(gid).expenses.find((x) => x.id === b.dataset.id); if(!groupAdmin(groupInfo(gid).group)&&!(e.createdBy===myUid()&&e.approvalStatus!=='rejected'))return toast(tr('Action non autorisée.'),'err'); closeSheet(); setTimeout(() => openExpenseForm(gid, e), 280); };
ACT["exp-del"] = async (b) => {
  const gid = S.route.gid, e = groupInfo(gid).expenses.find((x) => x.id === b.dataset.id);
  if(!groupAdmin(groupInfo(gid).group)&&e.createdBy!==myUid())return toast(tr('Action non autorisée.'),'err');
  if (!(await confirmDialog({ title: "Supprimer cette dépense ?", message: `« ${e.title} » sera retirée des comptes pour tout le groupe.`, ok: "Supprimer", danger: true }))) return;
  closeAllSheets(); await deleteExpense(gid, e); toast("Dépense supprimée");
};

/* ---------- Onglet Soldes ---------- */
function balRows(info) {
  const { group: g, members, balances, me } = info, cur = g.currency;
  return members.map((m) => {
    const b = balances[m.id] || { paid: 0, owed: 0, net: 0 }, bl = b.net > 0 ? "pos" : b.net < 0 ? "neg" : "muted";
    return `<div class="item">${avatar(m)}<div class="grow"><div class="t ellipsis">${esc(m.name)}${me && m.id === me.id ? ` <span class="badge">${tr('toi')}</span>` : ""}${m.leftAt?` <span class="exit-debt-former">${tr("Ancien membre")}</span>`:""}</div><div class="s">${tr("A payé")} ${money(b.paid, cur)} · ${tr("Sa part")} ${money(b.owed, cur)}</div></div><div class="num ${bl}" style="font-weight:800">${b.net > 0 ? "+" : ""}${money(b.net, cur)}</div></div>`;
  }).join("");
}
function trRows(info) {
  const { group: g, memberMap, transfers, me } = info, cur = g.currency;
  return transfers.map((t) => `<div class="transfer">${avatar(memberMap[t.from], "sm")}<div class="grow" style="line-height:1.35"><b>${esc(memberMap[t.from]?.name)}</b> <span class="muted">${tr("doit")}</span> <b class="num">${money(t.amount, cur)}</b> <span class="muted">${tr("à")}</span> <b>${esc(memberMap[t.to]?.name)}</b></div><button class="btn sm ${me && t.from === me.id ? "brand" : "soft"}" data-act="settle" data-from="${esc(t.from)}" data-to="${esc(t.to)}" data-amt="${t.amount}" ${(!groupAdmin(g)&&me?.id!==t.from&&me?.id!==t.to)?'disabled':''}>${me && t.from === me.id ? tr('Rembourser') : tr('Demander la validation')}</button></div>`).join("");
}
/** Résumé des soldes affiché dans la colonne de droite de l'onglet Dépenses (grand écran uniquement). */
function deskBalances(info) {
  const n = info.transfers.length;
  return `<div class="section-title">${tr("Soldes")}</div><div class="card"><div class="list">${balRows(info)}</div></div>${n ? `<div class="section-title">Pour tout équilibrer · ${n} virement${n > 1 ? "s" : ""}</div><div class="card"><div class="list">${trRows(info)}</div></div>` : ""}`;
}
function tabBalances(info) {
  const { group: g, balances, transfers, me, settlements, memberMap } = info;
  const cur = g.currency;
  const myNet = me ? balances[me.id]?.net || 0 : 0;
  const hero = me ? `<div class="hero ${myNet > 0 ? "pos-hero" : myNet < 0 ? "neg-hero" : ""}" style="margin-top:6px"><div class="lbl">${myNet > 0 ? "On te doit" : myNet < 0 ? "Tu dois" : "Tout est réglé"}</div><div class="big num" style="margin-bottom:0">${money(Math.abs(myNet), cur)}</div></div>` : "";
  const hist = settlements.slice(0, 20).map((s) => `<div class="item nosep">${ico("check", "sm").replace('class="i', 'class="i pos')}<div class="grow"><div class="t" style="font-size:15px">${esc(memberMap[s.fromId]?.name || "?")} → ${esc(memberMap[s.toId]?.name || "?")}</div><div class="s">${esc(fmtDate(s.date))}</div></div><b class="num">${money(s.amountCents, cur)}</b>${(g.archived || !groupAdmin(g) || s.paymentRequestId || s.exitDebtId) ? "" : `<button class="icon-btn" style="width:34px;height:34px" data-act="del-settle" data-id="${esc(s.id)}" aria-label="Annuler ce remboursement">${ico("x", "xs")}</button>`}</div>`).join("");
  const exitClaims=(info.st.exitDebts||[]).filter(r=>r.status!=='confirmed');
  const exitHTML=exitClaims.length?`<div class="section-title">${tr('Dettes suivies après départ')} (${exitClaims.length})</div><div class="exit-debt-grid">${exitClaims.map(r=>exitDebtCard(r,true)).join('')}</div>`:'';
  const pending = (info.st.paymentRequests || []).filter(r=>['pending','marked_paid'].includes(r.status));
  const pendingHTML = pending.length ? `<div class="section-title">${tr('Paiements en attente')} (${pending.length})</div>${pending.map(r=>socialCardForRequest(r,'group',g.id,'settlement')).join('')}` : '';
  return `${hero}${exitHTML}${pendingHTML}<div class="dgrid keep"><div class="dmain"><div class="section-title">Participants</div><div class="card"><div class="list">${balRows(info)}</div></div></div>
    <div class="dside"><div class="section-title">Pour tout équilibrer${transfers.length ? ` · ${transfers.length} virement${transfers.length > 1 ? "s" : ""}` : ""}</div>
    ${transfers.length ? `<div class="card"><div class="list">${trRows(info)}</div></div>` : exitClaims.length ? `<p class="hint">${tr("Les remboursements encore dus sont suivis hors du groupe ci-dessus.")}</p>` : emptyState({ icon: "check", title: info.expenses.length ? "Tout est équilibré" : "Rien à rembourser", text: info.expenses.length ? "Plus personne ne doit rien à personne." : "Ajoute des dépenses pour voir qui doit quoi." })}
    ${settlements.length ? `<div class="section-title">Remboursements enregistrés</div><div class="card"><div class="list">${hist}</div></div>` : ""}</div></div>`;
}
ACT["del-settle"] = async (b) => {
  const gid = S.route.gid, s = groupInfo(gid).settlements.find((x) => x.id === b.dataset.id);
  if (await confirmDialog({ title: "Annuler ce remboursement ?", message: "Les soldes seront recalculés.", ok: "Annuler le remboursement", cancel: "Garder", danger: true })) { await deleteSettlement(gid, s); toast("Remboursement annulé"); }
};

/* ---------- Onglet Statistiques (SVG maison, aucune librairie) ---------- */
function tabStats(info) {
  const { group: g, members, memberMap } = info, cur = g.currency, P = S.ui.statsPeriod, t = todayISO();
  const since = P === "month" ? t.slice(0, 7) + "-01" : P === "3m" ? todayISO(new Date(Date.now() - 90 * 864e5)) : P === "year" ? t.slice(0, 4) + "-01-01" : "";
  const ex = info.expenses.filter((e) => e.approvalStatus!=='rejected' && (!since || e.date >= since));
  const sel = `<div class="segmented" style="margin:6px 0 0">${[["all", "Tout"], ["month", "Ce mois"], ["3m", "3 mois"], ["year", "Année"]].map(([v, l]) => `<button data-act="stats-period" data-v="${v}" class="${P === v ? "on" : ""}">${l}</button>`).join("")}</div>`;
  if (!ex.length) return sel + emptyState({ icon: "pie", title: "Pas encore de statistiques", text: "Les graphiques apparaissent dès que des dépenses sont ajoutées sur la période." });
  const total = ex.reduce((a, e) => a + e.amountCents, 0);
  const byCat = {}; ex.forEach((e) => { byCat[e.category] = (byCat[e.category] || 0) + e.amountCents; });
  const cats = Object.entries(byCat).sort((a, b) => b[1] - a[1]);
  const R = 54, C = 2 * Math.PI * R; let off = 0;
  const segs = cats.map(([id, v]) => { const len = (v / total) * C, s = `<circle cx="75" cy="75" r="${R}" fill="none" stroke="${catById(id).color}" stroke-width="22" stroke-dasharray="${Math.max(len - 1.5, 0.5)} ${C}" stroke-dashoffset="${-off}"/>`; off += len; return s; }).join("");
  const donut = `<div class="card pad"><div class="donut-wrap"><div style="position:relative;flex:none"><svg viewBox="0 0 150 150" role="img" aria-label="Répartition par catégorie"><circle cx="75" cy="75" r="${R}" fill="none" stroke="var(--surface2)" stroke-width="22"/>${segs}</svg><div style="position:absolute;inset:0;display:grid;place-items:center;text-align:center"><div><div class="muted" style="font-size:11.5px;font-weight:600">Total</div><div class="num" style="font-weight:800;font-size:15px">${money(total, cur)}</div></div></div></div>
    <div class="legend">${cats.slice(0, 7).map(([id, v]) => `<div class="li"><span class="dot" style="background:${catById(id).color}"></span><span class="grow ellipsis">${esc(catById(id).label)}</span><b class="num">${Math.round((v / total) * 100)}%</b></div>`).join("")}</div></div></div>`;
  const paid = {}, owed = {};
  ex.forEach((e) => { Object.entries(e.payers || {}).forEach(([i, v]) => { paid[i] = (paid[i] || 0) + v; }); Object.entries(e.split || {}).forEach(([i, v]) => { owed[i] = (owed[i] || 0) + v; }); });
  const maxV = Math.max(1, ...members.map((m) => Math.max(paid[m.id] || 0, owed[m.id] || 0)));
  const people = `<div class="card pad col" style="gap:16px">${members.map((m) => `<div><div class="row" style="margin-bottom:7px">${avatar(m, "xs")}<b class="grow ellipsis">${esc(m.name)}</b></div>
    <div class="row" style="gap:8px"><span class="hint" style="width:62px;padding:0">A payé</span><div class="bar-track grow"><div class="bar-fill" style="width:${((paid[m.id] || 0) / maxV) * 100}%;background:${m.color}"></div></div><b class="num" style="font-size:13px;min-width:74px;text-align:right">${money(paid[m.id] || 0, cur)}</b></div>
    <div class="row" style="gap:8px;margin-top:5px"><span class="hint" style="width:62px;padding:0">Sa part</span><div class="bar-track grow"><div class="bar-fill" style="width:${((owed[m.id] || 0) / maxV) * 100}%;background:${m.color};opacity:.45"></div></div><span class="num muted" style="font-size:13px;min-width:74px;text-align:right">${money(owed[m.id] || 0, cur)}</span></div></div>`).join("")}</div>`;
  const byMonth = {}; info.expenses.forEach((e) => { const k = e.date.slice(0, 7); byMonth[k] = (byMonth[k] || 0) + e.amountCents; });
  const months = []; { const d = new Date(); d.setDate(1); for (let i = 5; i >= 0; i--) { const x = new Date(d.getFullYear(), d.getMonth() - i, 1); months.push(`${x.getFullYear()}-${z2(x.getMonth() + 1)}`); } }
  const mx = Math.max(1, ...months.map((k) => byMonth[k] || 0));
  const evo = `<div class="card pad"><div class="chart-bars">${months.map((k) => `<div class="b"><b class="num" style="font-size:10.5px;color:var(--muted)">${byMonth[k] ? Math.round(byMonth[k] / 100) : ""}</b><i style="height:${((byMonth[k] || 0) / mx) * 100}%"></i><span>${new Intl.DateTimeFormat(locale(), { month: "short" }).format(new Date(+k.slice(0, 4), +k.slice(5) - 1, 1)).replace(".", "")}</span></div>`).join("")}</div><p class="hint center" style="margin-top:8px">Dépenses des 6 derniers mois (en ${esc(cur)})</p></div>`;
  return `${sel}<div class="stats-grid"><div class="sg-a"><div class="section-title">Par catégorie</div>${donut}</div><div class="sg-b"><div class="section-title">Par personne</div>${people}</div><div class="sg-c"><div class="section-title">Évolution mensuelle</div>${evo}</div></div>`;
}
ACT["stats-period"] = (b) => { S.ui.statsPeriod = b.dataset.v; scheduleRender(); };

/* ---------- Onglet Activité ---------- */
const ACT_ICON = { expense_add: ["plus", "pos"], expense_edit: ["edit", "brand"], expense_delete: ["trash", "neg"], settlement: ["check", "pos"], settlement_delete: ["x", "neg"], member_add: ["users", "brand"], member_remove: ["users", "neg"], group_create: ["home", "brand"], group_edit: ["edit", "brand"] };
function tabActivity() {
  const a = S.activity, items = [...a.live, ...a.older.filter((o) => !a.live.some((l) => l.id === o.id))];
  if (a.loading && !items.length) return skeletonList(5);
  if (!items.length) return emptyState({ icon: "activity", title: "Rien à signaler", text: "Chaque ajout, modification ou remboursement apparaîtra ici en direct." });
  return `<div class="section-title" style="margin-top:8px">Dernières actions</div><div class="card"><div class="list">${items.map((x) => {
    const [ic, tone] = ACT_ICON[x.type] || ["activity", "brand"];
    return `<div class="item"><div class="cat-ico" style="width:38px;height:38px;border-radius:12px;background:var(--${tone === "brand" ? "brand-soft" : tone + "-soft"});color:var(--${tone})">${ico(ic, "sm")}</div><div class="grow"><div style="font-size:15px">${esc(x.text)}</div><div class="s">${relTime(msOf(x.createdAt))}${x.source==='server'?` · ${tr('Vérifié par Kortiz')}`:` · ${tr('Information déclarative')}`}</div></div></div>`;
  }).join("")}</div></div>${a.hasMore ? `<div class="center" style="margin-top:16px"><button class="btn soft sm" data-act="act-more" ${a.loading ? "disabled" : ""}>Voir plus</button></div>` : ""}`;
}
ACT["act-more"] = () => loadMoreActivity();

/* ---------- Menu du groupe ---------- */
ACT["group-menu"] = () => {
  const gid = S.route.gid, info = groupInfo(gid), g = info.group, mine = g.createdBy === myUid();
  const it = (icn, label, act, cls = "") => `<button class="item ${cls}" data-act="${act}"><span style="color:${cls ? "inherit" : "var(--brand)"}">${ico(icn)}</span><span class="grow t">${label}</span>${ico("next", "sm")}</button>`;
  openSheet({
    title: g.name,
    body: `<div class="card"><div class="list">${it("share", "Inviter des amis", "invite-from-menu")}${it(groupMuted(gid)?'bell':'bell',tr(groupMuted(gid)?'Réactiver les notifications du groupe':'Mettre ce groupe en sourdine'),'group-mute')}${it("users", `Participants (${info.members.length})`, "members")}${mine?it("users","Administrateurs du groupe","social-admins"):''}${groupAdmin(g)?it("users",tr("Demandes de liaison"),"member-claims"):''}${groupAdmin(g)?it("edit", "Modifier le groupe", "edit-group"):''}</div></div>
    <div class="sp-16"></div><div class="card"><div class="list">${it("upload", "Importer un CSV bancaire", "csv-import")}${it("download", "Exporter en CSV", "export-group-csv")}${it("printer", "Exporter en PDF / imprimer", "export-group-pdf")}</div></div>
    <div class="sp-16"></div><div class="card"><div class="list">${groupAdmin(g)?it("archive", g.archived ? "Réactiver le groupe" : "Archiver le groupe", "archive-group"):''}${it("logout", "Quitter le groupe", "leave-group", "")}${mine ? `<button class="item" data-act="delete-group" style="color:var(--neg)">${ico("trash")}<span class="grow t">Supprimer le groupe</span></button>` : ""}</div></div>`,
  });
};
ACT["invite-from-menu"] = () => { closeSheet(); setTimeout(() => ACT.invite(), 280); };
ACT['member-claims']=async ()=>{
  const gid=S.route.gid;
  if(!groupAdmin(S.groups.find(g=>g.id===gid)))return;
  try {
    const snap=await getDocs(query(collection(db,'groups',gid,'memberClaims'),where('status','==','pending')));
    const pending=snap.docs.map(d=>({id:d.id,...d.data()}));
    openSheet({title:tr('Demandes de liaison'),body:pending.length?`<div class="col" style="gap:10px">${pending.map(c=>`<div class="card pad"><b>${esc(c.memberName||'—')}</b><p class="hint">${tr('Un utilisateur souhaite reprendre ce participant existant.')}</p><div class="row" style="flex-wrap:wrap;gap:8px"><button class="btn sm brand" data-act="claim-review" data-id="${esc(c.id)}" data-yes="1">${tr('Accepter')}</button><button class="btn sm soft" data-act="claim-review" data-id="${esc(c.id)}">${tr('Refuser')}</button></div></div>`).join('')}</div>`:`<p class="muted">${tr('Aucune demande en attente.')}</p>`});
  } catch(e){toast(errMsg(e),'err');}
};
ACT['claim-review']=async b=>{
  if(b.dataset.yes==='1' && !(await confirmDialog({title:tr('Confirmer cette identité ?'),message:tr('Cette personne héritera des dépenses associées au participant.') })))return;
  try {await withBusy(b,()=>call('joinGroup',{action:'reviewClaim',groupId:S.route.gid,claimantUid:b.dataset.id,approve:b.dataset.yes==='1'}));closeSheet();toast(tr('Demande traitée.'));}
  catch(e){toast(errMsg(e),'err');}
};
ACT["archive-group"] = async () => { const g = groupInfo(S.route.gid).group; if(!groupAdmin(g))return toast(tr('Action non autorisée.'),'err'); closeSheet(); await updateGroup(g.id, { archived: !g.archived }, `${myName()} a ${g.archived ? "réactivé" : "archivé"} le groupe`); toast(g.archived ? "Groupe réactivé" : "Groupe archivé"); if (!g.archived) go("/"); };
ACT["leave-group"] = async () => {
  const gid=S.route.gid,info=groupInfo(gid);
  if(!info)return;
  if(info.group.memberIds.length<=1)return toast(tr('Invite un autre membre avant de quitter le groupe : il faut quelqu’un pour assurer le suivi des remboursements.'),'err');
  const myNet=info.me?.id ? info.availableBalances?.[info.me.id]?.net||0 : 0;
  const detail=myNet<0
    ? tr('Ton remboursement estimé de {amount} restera visible après ton départ.').replace('{amount}',money(-myNet,info.group.currency))
    : myNet>0 ? tr('Les {amount} que tu dois recevoir resteront suivis après ton départ.').replace('{amount}',money(myNet,info.group.currency))
    : tr('Si tu as des demandes en cours, elles seront remplacées par un suivi hors groupe.');
  if(!(await confirmDialog({title:tr('Quitter ce groupe ?'),message:`${detail} ${tr('Les bénéficiaires et les administrateurs non débiteurs pourront confirmer les paiements déclarés. Tu n’auras plus accès aux messages du groupe.')}`,ok:tr('Quitter et conserver le suivi'),danger:true})))return;
  try{
    const result=await leaveGroup(gid);
    closeAllSheets();go('/debts');
    toast(result?.claimsCreated ? tr('Départ effectué. Tes remboursements sont maintenant suivis hors du groupe.') : tr('Tu as quitté le groupe sans dette restante.'));
  }catch(e){toast(errMsg(e),'err');}
};
ACT["delete-group"] = async () => {
  const gid = S.route.gid, g = groupInfo(gid).group;
  if (!(await confirmDialog({ title: `Supprimer « ${g.name} » ?`, message: "Toutes les dépenses, photos et remboursements seront supprimés pour tout le monde. Action irréversible.", ok: "Supprimer le groupe", danger: true }))) return;
  closeAllSheets(); await deleteGroupRemote(gid); go("/"); toast("Groupe supprimé");
};

/* ---------- Participants ---------- */
ACT.members = () => {
  const gid = S.route.gid, info = groupInfo(gid), mine = info.me;
  const sh = openSheet({
    title: "Participants",
    body: `<div class="card"><div class="list">${info.members.map((m) => `<button class="item" data-act="edit-member" data-id="${esc(m.id)}">${avatar(m)}<div class="grow"><div class="t">${esc(m.name)}${mine && m.id === mine.id ? ` <span class="badge">${tr('toi')}</span>` : ""}</div><div class="s">${m.uid ? "Compte connecté" : "Sans compte"}${m.iban ? " · IBAN renseigné" : ""}</div></div>${ico("next", "sm")}</button>`).join("")}</div></div>
    <div class="section-title">${tr('Inviter de nouveaux participants')}</div>
    <p class="hint" style="margin-top:10px">${tr('Chaque personne doit rejoindre avec son propre compte Kortiz. Invite un ami directement ou partage le code ou le lien du groupe.')}</p>
    <button class="btn brand" data-act="members-open-invite">${ico('users','sm')} ${tr('Inviter des amis')}</button>`,
  });
};
ACT['members-open-invite']=()=>{closeSheet();setTimeout(()=>ACT.invite(),280);};
ACT["edit-member"] = (b) => {
  const gid = S.route.gid, info = groupInfo(gid), m = info.memberMap[b.dataset.id]; let color = m.color;
  closeSheet();
  setTimeout(() => {
    const sh = openSheet({
      title: m.name,
      body: `<div class="col" style="gap:16px"><div class="field"><label for="em-name">Prénom</label><input id="em-name" class="input" maxlength="40" value="${esc(m.name)}" ${m.uid && m.uid !== myUid() ? 'disabled' : ''}></div>
        <div class="field"><label>Couleur</label><div class="swatches" id="em-sw">${AVATAR_COLORS.map((c) => `<button class="swatch ${c === color ? "on" : ""}" style="background:${c}" data-c="${c}" ${m.uid && m.uid !== myUid() ? 'disabled' : ''} aria-label="Couleur ${c}"></button>`).join("")}</div></div>
        <div class="field"><label for="em-iban">IBAN (facultatif — permet de générer son QR de remboursement)</label><input id="em-iban" class="input num" placeholder="BE68 5390 0754 7034" value="${esc(formatIban(m.iban || ""))}" ${m.uid ? "disabled" : ""}>${m.uid ? `<div class="hint">Cette personne gère elle-même son IBAN depuis ses réglages.</div>` : ""}<div id="em-err"></div></div>
        ${!m.uid && !memberIsUsed(gid, m.id) ? `<button class="btn danger" id="em-del">${ico("trash", "sm")} Retirer du groupe</button>` : !m.uid ? `<p class="hint">Ce participant apparaît dans des dépenses : il ne peut pas être retiré.</p>` : ""}</div>`,
      footer: `<button class="btn brand" id="em-save" ${m.uid && m.uid !== myUid() ? 'disabled' : ''}>Enregistrer</button>`,
    });
    $("#em-sw", sh.el).addEventListener("click", (e) => { const s = e.target.closest(".swatch"); if (!s) return; color = s.dataset.c; $$(".swatch", sh.el).forEach((x) => x.classList.toggle("on", x === s)); });
    $("#em-save", sh.el).addEventListener("click", async () => {
      const name = $("#em-name").value.trim(), iban = cleanIban($("#em-iban").value);
      if (!name) return toast("Le prénom est obligatoire.", "err");
      if (iban && !isValidIban(iban)) { $("#em-err").innerHTML = `<div class="err-msg">IBAN invalide.</div>`; return; }
      const patch = { name, color }; if (!m.uid) patch.iban = iban;
      await updateMember(gid, m.id, patch); closeSheet(); toast("Participant mis à jour");
    });
    $("#em-del", sh.el)?.addEventListener("click", async () => { if (await confirmDialog({ title: `Retirer ${m.name} ?`, ok: "Retirer", danger: true })) { await removeMember(gid, m.id); closeSheet(); toast("Participant retiré"); } });
  }, 300);
};

/* ---------- Invitation : lien + code + partage ---------- */
const inviteUrl = (g) => `${location.origin}/#/join/${g.inviteCode}`;
ACT.invite = () => {
  const info=groupInfo(S.route.gid);if(!info)return toast(tr('Chargement du groupe…'),'err');
  const g=info.group,url=inviteUrl(g);
  const friends=SOC.friends.map(f=>pairOther(f.members)).filter(uid=>uid&&uid!==myUid()&&!g.memberIds.includes(uid));
  openSheet({
    title:tr('Inviter des amis'),
    body:`<div class="col" style="gap:14px">
      <div class="center"><div class="tile group-icon-tile" style="width:64px;height:64px;margin:0 auto 8px;background:var(--brand-soft);border-radius:20px">${groupIcon(g.emoji)}</div>
      <p class="muted">${tr('Invite un ami de Kortiz : il recevra une invitation et n’aura qu’à appuyer sur Rejoindre.')}</p></div>
      <div class="field"><label>${tr('Inviter depuis mes amis')}</label>
        ${friends.length?`<div class="group-friend-invite-list">${friends.map(uid=>`<div class="group-friend-invite-item">${avatar({uid,name:profileName(uid)},'sm')}
          <span class="grow group-friend-invite-name"><strong>${esc(profileName(uid))}</strong><small>@${esc(socialProfile(uid)?.handle||'—')}</small></span>
          <button class="btn sm brand" data-act="invite-friend-to-group" data-uid="${esc(uid)}" data-gid="${esc(g.id)}">${tr('Inviter')}</button>
          </div>`).join('')}</div>`:`<p class="hint">${tr('Tu n’as pas encore d’ami disponible à inviter. Utilise le code ou le lien, ou ajoute des amis depuis la rubrique Amis et messages.')}</p>`}
      </div>
      <div class="invite-legacy-divider">${tr('Ou partager une invitation')}</div>
      <div class="field"><label>${tr('Code d’invitation')}</label><div class="copy-row"><code style="font-size:22px;letter-spacing:.14em;font-weight:800;text-align:center">${esc(prettyCode(g.inviteCode))}</code><button class="icon-btn" type="button" style="width:36px;height:36px" data-act="copy-code" aria-label="${tr('Copier le code')}">${ico('copy','sm')}</button></div></div>
      <div class="field"><label>${tr('Lien')}</label><div class="copy-row"><code>${esc(url)}</code><button class="icon-btn" type="button" style="width:36px;height:36px" data-act="copy-link" aria-label="${tr('Copier le lien')}">${ico('copy','sm')}</button></div></div>
      <p class="hint">${tr('Le code et le lien restent utilisables par une personne qui possède un compte Kortiz, même si elle n’est pas encore dans ta liste d’amis.')}</p>
      </div>`,
    footer:`<button class="btn brand" data-act="invite-share">${ico('share','sm')} ${tr('Partager')}</button><button class="btn soft" data-act="invite-wa" style="width:auto;flex:none">WhatsApp</button>`,
  });
};
ACT['invite-friend-to-group']=async b=>{
  try{const r=await withBusy(b,()=>call('joinGroup',{action:'inviteFriend',groupId:b.dataset.gid,friendUid:b.dataset.uid}));
    toast(tr(r.alreadyPending?'Invitation déjà envoyée.':'Invitation envoyée.'));
    b.textContent=tr('Envoyée');b.disabled=true;
  }catch(e){toast(errMsg(e),'err');}
};
ACT["copy-code"] = () => copyText(prettyCode(groupInfo(S.route.gid).group.inviteCode), "Code copié");
ACT["copy-link"] = () => copyText(inviteUrl(groupInfo(S.route.gid).group), "Lien copié");
const inviteMsg = () => { const g = groupInfo(S.route.gid).group; return `Rejoins « ${g.name} » sur ${APP_NAME} pour partager nos dépenses :\n${inviteUrl(g)}\nCode : ${prettyCode(g.inviteCode)}`; };
ACT["invite-share"] = () => shareText({ title: `${APP_NAME} — ${groupInfo(S.route.gid).group.name}`, text: inviteMsg() });
ACT["invite-wa"] = () => whatsapp(inviteMsg());

/* ==========================================================================
   SECTION 7 — FORMULAIRES : groupe, dépense, remboursement (QR SEPA), import CSV, exports
   ========================================================================== */

/* ---------- Création / modification d'un groupe ---------- */
const EMOJIS = ["🏠", "✈️", "🍻", "🏖️", "🎉", "🛒", "🍕", "⛷️", "🚗", "🎓", "🏕️", "🎮"];
const CURRENCIES = ["EUR", "USD", "GBP", "CHF", "CAD", "AUD", "BRL", "MXN", "ARS", "CLP", "COP", "PEN", "UYU", "PYG", "BOB", "MAD", "TND", "TRY", "PLN", "CZK", "SEK", "NOK", "DKK"];
const defaultCurrency = () => ({BR:'BRL',US:'USD',GB:'GBP',CA:'CAD',MX:'MXN',AR:'ARS',CL:'CLP',CO:'COP',PE:'PEN',UY:'UYU',PY:'PYG',BO:'BOB',CH:'CHF',AU:'AUD'})[locale().split('-')[1]?.toUpperCase()] || 'EUR';
function openGroupForm(g = null) {
  const edit = !!g, hasExp = edit;
  const f = { name: g?.name || "", emoji: g?.emoji || "🏠", type: g?.type || "kot", currency: g?.currency || defaultCurrency(), emojiTouched: edit };
  const canSetBudget = !edit || g.createdBy === myUid();
  const sh = openSheet({
    title: edit ? "Modifier le groupe" : "Nouveau groupe", full: !edit,
    body: `<div class="col" style="gap:18px">
      <div class="field"><label>Type</label><div class="segmented" id="gf-types">${GROUP_TYPES.map((t) => `<button data-t="${t.id}" class="${f.type === t.id ? "on" : ""}">${groupIcon(t.emoji)} <span>${t.label.split(" ")[0]}</span></button>`).join("")}</div></div>
      <div class="field"><label for="gf-name">Nom du groupe</label><input id="gf-name" class="input" maxlength="50" placeholder="Ex. Kot rue des Alouettes" value="${esc(f.name)}" autocomplete="off"></div>
      <div class="field"><label>${tr("Icône du groupe")}</label><div class="chips group-icon-picker" id="gf-emojis">${EMOJIS.map((e) => `<button type="button" class="chip group-icon-choice ${e === f.emoji ? "on" : ""}" data-e="${e}" aria-label="${esc(groupIconLabel(e))}" title="${esc(groupIconLabel(e))}" aria-pressed="${e === f.emoji}">${groupIcon(e)}</button>`).join("")}</div></div>
      <div class="field"><label for="gf-cur">Devise</label><select id="gf-cur" class="input" ${hasExp ? "disabled" : ""}>${CURRENCIES.map((c) => `<option ${c === f.currency ? "selected" : ""}>${c}</option>`).join("")}</select>${hasExp ? `<div class="hint">La devise est fixée dès la création du groupe.</div>` : ""}${f.currency !== "EUR" ? "" : ""}</div>
      ${canSetBudget ? `<div class="field"><label for="gf-budget">${tr('Budget maximum (facultatif)')}</label><div class="row"><input id="gf-budget" class="input grow" inputmode="decimal" placeholder="${tr('Aucun plafond')}" value="${g?.budgetCents ? esc(centsToInput(g.budgetCents)) : ''}"><span class="muted">${esc(f.currency)}</span></div><p class="hint">${tr('Le budget sert d’alerte : il ne bloque pas automatiquement les dépenses réelles.')}</p></div>` : ''}
      ${edit ? "" : `<div class="group-creation-invite-notice">${ico('users','sm')}<span>${tr('Tu seras le premier membre. Une fois le groupe créé, tu pourras inviter des amis de Kortiz ou partager son lien et son code. Chacun devra rejoindre avec son propre compte.')}</span></div>`}
      <div id="gf-err"></div></div>`,
    footer: `<button class="btn brand" id="gf-save">${edit ? "Enregistrer" : "Créer le groupe"}</button>`,
  });
  const root = sh.el;
  $("#gf-types", root).addEventListener("click", (e) => {
    const b = e.target.closest("[data-t]"); if (!b) return; f.type = b.dataset.t;
    $$("#gf-types button", root).forEach((x) => x.classList.toggle("on", x === b));
    if (!f.emojiTouched) { f.emoji = GROUP_TYPES.find((t) => t.id === f.type).emoji; $$("#gf-emojis .chip", root).forEach((x) => { const yes=x.dataset.e === f.emoji; x.classList.toggle("on", yes); x.setAttribute("aria-pressed", String(yes)); }); }
  });
  $("#gf-emojis", root).addEventListener("click", (e) => { const b = e.target.closest("[data-e]"); if (!b) return; f.emoji = b.dataset.e; f.emojiTouched = true; $$("#gf-emojis .chip", root).forEach((x) => { const yes=x === b; x.classList.toggle("on", yes); x.setAttribute("aria-pressed", String(yes)); }); });
  $("#gf-save", root).addEventListener("click", async () => {
    const name = $("#gf-name", root).value.trim(); f.currency = $("#gf-cur", root).value;
    const budgetText = canSetBudget ? ($('#gf-budget', root)?.value || '').trim() : '';
    const budgetCents = budgetText ? parseAmountInput(budgetText) : null;
    if (canSetBudget && budgetText && (!Number.isInteger(budgetCents) || budgetCents <= 0 || budgetCents > 1000000000)) return toast(tr('Budget invalide.'),'err');
    if (!name) { $("#gf-err", root).innerHTML = `<div class="err-msg">Donne un nom à ton groupe.</div>`; return; }
    if (edit) { try { await updateGroup(g.id, { name, emoji: f.emoji, type: f.type, currency: f.currency, ...(canSetBudget ? { budgetCents } : {}) }, `${myName()} a modifié le groupe`); closeSheet(); toast("Groupe mis à jour"); } catch(e){ toast(errMsg(e),'err'); } return; }
    try{
      const button=$("#gf-save",root);
      const gid=await withBusy(button,()=>createGroup({name,emoji:f.emoji,currency:f.currency,type:f.type,budgetCents}));
      closeSheet();toast(tr('Groupe créé'));go(`/g/${gid}`);
      const showInvite=(attempts=0)=>{
        if(S.route.name!=='group'||S.route.gid!==gid)return;
        if(groupInfo(gid))return ACT.invite();
        if(attempts<6)setTimeout(()=>showInvite(attempts+1),450);
      };
      setTimeout(()=>showInvite(),600);
    }catch(e){toast(errMsg(e),'err');}
  });
  if (!edit) setTimeout(() => $("#gf-name", root)?.focus(), 480);
}
ACT["edit-group"] = () => { const g = groupInfo(S.route.gid).group; if(!groupAdmin(g))return toast(tr('Action non autorisée.'),'err'); closeSheet(); setTimeout(() => openGroupForm(g), 280); };

/* ---------- Formulaire de dépense ---------- */
const parseNum = (s) => { const v = parseFloat(String(s ?? "").replace(",", ".")); return Number.isFinite(v) ? v : 0; };
function openExpenseForm(gid, ex = null, fromPlan = null) {
  const info = groupInfo(gid);
  if (!info || !info.ready) return toast("Chargement du groupe…", "err");
  if (info.group.archived) return toast("Ce groupe est archivé.", "err");
  const members = info.members.filter(m=>!m.leftAt), g = info.group, cur = g.currency, edit = !!ex;
  const draftExpenseId = ex?.id || doc(col(gid,'expenses')).id; // conserve l'id lors des tentatives
  if (members.length < 1) return toast("Ajoute d'abord un participant.", "err");
  const meId = info.me?.id || members[0].id;
  const f = {
    title: ex?.title || fromPlan?.title || "", amount: ex ? centsToInput(ex.amountCents) : fromPlan ? centsToInput(fromPlan.amountCents) : "", date: ex?.date || fromPlan?.date || todayISO(), category: ex?.category || fromPlan?.category || "courses", note: ex?.note || fromPlan?.note || "",
    multi: false, payerId: meId, payers: {}, mode: ex?.splitMode || "equal", included: new Set(members.map((m) => m.id)), values: {},
    recurring: ex?.recurring?.freq && ex.recurringNext ? ex.recurring.freq : "", receipt: { file: null, url: null, old: ex?.receiptPath || null, remove: false },
  };
  if (ex) {
    const pk = Object.keys(ex.payers || {});
    if (pk.length > 1) { f.multi = true; pk.forEach((id) => { f.payers[id] = centsToInput(ex.payers[id]); }); } else if (pk.length) f.payerId = pk[0];
    f.included = new Set(Object.keys(ex.split || {}));
    if (f.mode === "exact") Object.entries(ex.split).forEach(([id, v]) => { f.values[id] = centsToInput(v); });
    else if (f.mode !== "equal") Object.entries(ex.splitInput || {}).forEach(([id, v]) => { f.values[id] = String(v).replace(".", ","); });
  }
  const sh = openSheet({
    title: edit ? "Modifier la dépense" : "Nouvelle dépense", full: true,
    body: `<div class="col" style="gap:20px">
      <div><input id="xf-amount" class="input amount-input num" data-xi="amount" inputmode="decimal" placeholder="0,00" autocomplete="off" value="${esc(f.amount)}" aria-label="Montant"><div class="center muted" style="font-weight:700;margin-top:4px">${esc(cur)}</div></div>
      <div class="field"><label for="xf-title">Titre</label><input id="xf-title" class="input" data-xi="title" maxlength="100" placeholder="${esc(tr("Ex. Courses Delhaize"))}" value="${esc(f.title)}" autocomplete="off"></div>
      <div class="field"><label>Catégorie</label><div class="chips" id="xf-cats">${CATEGORIES.map((c) => `<button class="chip ${c.id === f.category ? "on" : ""}" data-x="cat" data-id="${c.id}">${ico(c.icon, "xs")} ${esc(tr(c.label))}</button>`).join("")}</div></div>
      <div class="field"><label for="xf-date">Date</label><input id="xf-date" class="input" type="date" data-xi="date" value="${esc(f.date)}"></div>
      <div class="field"><label>${tr('Qui a avancé l’argent ?')}</label><p class="hint expense-help">${tr('Sélectionne la personne qui a réellement payé la dépense.')}</p><div id="xf-payers"></div></div>
      <div class="field expense-debt-field"><label>${tr('Qui doit payer sa part ?')}</label><p class="hint expense-help">${tr('Sélectionne les personnes qui doivent supporter le coût. Celui qui a avancé ne doit être sélectionné que s’il participe aussi à la dépense.')}</p>
        <div class="expense-quick-actions"><button type="button" class="expense-quick-btn" data-x="all-debtors">${tr('Tout le monde partage')}</button><button type="button" class="expense-quick-btn" data-x="other-debtors">${tr('Faire payer les autres')}</button></div>
        <div class="expense-split-caption">${tr('Comment répartir le montant dû ?')}</div>
        <div class="segmented" id="xf-modes">${[["equal", "Égal"], ["shares", "Parts"], ["percent", "%"], ["exact", "Montants"]].map(([v, l]) => `<button type="button" data-x="mode" data-id="${v}" class="${f.mode === v ? "on" : ""}">${l}</button>`).join("")}</div>
        <div id="xf-split" class="card" style="margin-top:8px"></div><div id="xf-sum" class="hint"></div>
        <div id="xf-preview" class="expense-refund-preview" role="status" aria-live="polite"></div>
      </div>
      <div class="field"><label for="xf-note">Note (facultatif)</label><textarea id="xf-note" class="input" data-xi="note" maxlength="400" placeholder="${esc(tr("Détail, lien, rappel…"))}">${esc(f.note)}</textarea></div>
      <div class="field"><label for="xf-rec">Récurrence</label><select id="xf-rec" class="input" data-xi="rec"><option value="">Une seule fois</option><option value="monthly" ${f.recurring === "monthly" ? "selected" : ""}>Chaque mois (loyer, internet…)</option><option value="weekly" ${f.recurring === "weekly" ? "selected" : ""}>Chaque semaine</option><option value="yearly" ${f.recurring === "yearly" ? "selected" : ""}>Chaque année</option></select><div class="hint">La dépense est recréée automatiquement à chaque échéance, avec la même répartition.</div></div>
      <div class="field"><label>Photo du ticket (facultatif)</label><div id="xf-receipt"></div><input id="xf-file" type="file" accept="image/*" hidden></div>
      ${edit && info.settlements.length ? `<p class="hint">${tr('Une dépense liée à un remboursement confirmé ne peut plus être modifiée. Les autres restent modifiables.')}</p>` : ""}<div id="xf-err"></div></div>`,
    footer: `<button class="btn brand" id="xf-save">${tr(edit ? "Enregistrer" : "Ajouter la dépense")}</button>`,
  });
  const root = sh.el;

  /* -- calcul de la répartition à partir de l'état du formulaire -- */
  const total = () => parseAmountInput(f.amount) || 0;
  function formSplit() {
    const t = total();
    if (!t) return { ok: false, error: "Saisis le montant.", split: {} };
    let entries;
    if (f.mode === "equal") entries = members.filter((m) => f.included.has(m.id)).map((m) => ({ id: m.id }));
    else if (f.mode === "exact") entries = members.map((m) => ({ id: m.id, value: parseAmountInput(f.values[m.id] || "") || 0 })).filter((e) => e.value > 0);
    else entries = members.map((m) => ({ id: m.id, value: parseNum(f.values[m.id]) })).filter((e) => e.value > 0);
    return splitAmount(t, f.mode, entries);
  }
  /* -- « Payé par » -- */
  function drawPayers() {
    const box = $("#xf-payers", root);
    if (!f.multi) {
      box.innerHTML = `<div class="chips" style="flex-wrap:wrap;margin:0;padding:0">${members.map((m) => `<button class="chip ${m.id === f.payerId ? "on" : ""}" data-x="payer" data-id="${esc(m.id)}">${avatar(m, "xs")} ${esc(m.name)}</button>`).join("")}</div>${members.length > 1 ? `<button class="link-btn" style="margin-top:10px;font-size:14px" data-x="multi">Plusieurs payeurs</button>` : ""}`;
    } else {
      box.innerHTML = `<div class="card"><div class="list">${members.map((m) => `<div class="item nosep">${avatar(m, "sm")}<span class="grow t" style="font-size:15px">${esc(m.name)}</span><input class="input num" style="width:104px;min-height:42px;text-align:right" inputmode="decimal" placeholder="0,00" data-xi="payer-amt" data-id="${esc(m.id)}" value="${esc(f.payers[m.id] || "")}"></div>`).join("")}</div></div><div class="row" style="margin-top:8px"><span id="xf-psum" class="hint grow"></span><button class="link-btn" style="font-size:14px" data-x="single">Un seul payeur</button></div>`;
      paySum();
    }
    drawPreview();
  }
  function paySum() {
    const n = $("#xf-psum", root); if (!n) return;
    const sum = Object.values(f.payers).reduce((a, v) => a + (parseAmountInput(v) || 0), 0), diff = total() - sum;
    n.innerHTML = diff === 0 && total() ? `<span class="pos">✓ Total payé : ${money(sum, cur)}</span>` : `Total payé ${money(sum, cur)} · reste ${money(diff, cur)}`;
  }
  /* -- Répartition : liste adaptée au mode -- */
  function drawSplit() {
    const box = $("#xf-split", root), r = formSplit(), sp = r.ok ? r.split : {};
    const pv = (id) => `<span class="num muted" id="pv-${esc(id)}" style="min-width:76px;text-align:right;font-size:14px">${id in sp ? money(sp[id], cur) : "—"}</span>`;
    let rows;
    if (f.mode === "equal") rows = members.map((m) => `<button type="button" class="item nosep expense-debt-row" data-x="toggle" data-id="${esc(m.id)}" aria-pressed="${f.included.has(m.id)}">${avatar(m, "sm")}<span class="grow t" style="font-size:15px">${esc(m.name)}<small class="expense-row-status ${f.included.has(m.id) ? "included" : ""}">${tr(f.included.has(m.id) ? 'Doit sa part' : 'Ne doit rien')}</small></span>${pv(m.id)}<span class="check ${f.included.has(m.id) ? "on" : ""}">${ico("check")}</span></button>`).join("");
    else if (f.mode === "shares") rows = members.map((m) => { const v = parseNum(f.values[m.id]); return `<div class="item nosep">${avatar(m, "sm")}<span class="grow t" style="font-size:15px">${esc(m.name)}</span>${pv(m.id)}<div class="stepper"><button data-x="dec" data-id="${esc(m.id)}" aria-label="Moins">−</button><span id="sv-${esc(m.id)}">${v ? String(v).replace(".", ",") : 0}</span><button data-x="inc" data-id="${esc(m.id)}" aria-label="Plus">+</button></div></div>`; }).join("");
    else rows = members.map((m) => `<div class="item nosep">${avatar(m, "sm")}<span class="grow t" style="font-size:15px">${esc(m.name)}</span>${f.mode === "percent" ? pv(m.id) : ""}<div class="row" style="gap:4px"><input class="input num" style="width:92px;min-height:42px;text-align:right" inputmode="decimal" placeholder="0" data-xi="val" data-id="${esc(m.id)}" value="${esc(f.values[m.id] || "")}"><span class="muted" style="width:16px">${f.mode === "percent" ? "%" : cur === "EUR" ? "€" : ""}</span></div></div>`).join("");
    box.innerHTML = `<div class="list">${rows}</div>`;
    drawSum();
  }
  function drawPreview() {
    const box = $("#xf-preview", root);
    if (!box) return;
    const t = total(), r = formSplit();
    let description = '';
    if (!t) description = tr('Indique un montant pour voir qui devra rembourser qui.');
    else if (!r.ok) description = tr('Choisis les personnes et leur part pour voir les remboursements.');
    else {
      const payers = f.multi
        ? Object.fromEntries(Object.entries(f.payers).map(([id, v]) => [id, parseAmountInput(v) || 0]).filter(([, amt]) => amt > 0))
        : { [f.payerId]: t };
      const sum = Object.values(payers).reduce((a, b) => a + b, 0);
      if (sum !== t) description = tr('Le total avancé doit correspondre au montant de la dépense.');
      else {
        const transfers = previewExpenseTransfers(members.map(m => m.id), payers, r.split);
        if (!transfers.length) description = tr('Aucun remboursement à prévoir pour cette dépense.');
        else description = `<div class="expense-preview-transfers">${transfers.map(x => `<div class="expense-preview-line"><strong>${esc(members.find(m => m.id === x.from)?.name || '?')}</strong> <span>${tr('doit rembourser')}</span> <strong class="num">${money(x.amount, cur)}</strong> <span>${tr('à')}</span> <strong>${esc(members.find(m => m.id === x.to)?.name || '?')}</strong></div>`).join('')}</div>`;
      }
    }
    box.innerHTML = `<div class="expense-preview-title">${tr('Remboursement à prévoir')}</div><div class="expense-preview-body">${description}</div><div class="expense-preview-foot">${tr('Aperçu pour cette dépense uniquement. Aucun paiement n’est effectué par Kortiz.')}</div>`;
  }
  function drawSum() {
    const r = formSplit(), n = $("#xf-sum", root), t = total();
    let html = "";
    if (f.mode === "percent") { const s = members.reduce((a, m) => a + parseNum(f.values[m.id]), 0); html = Math.abs(s - 100) < 0.005 ? `<span class="pos">✓ 100 %</span>` : `Total ${String(Math.round(s * 100) / 100).replace(".", ",")} % — il doit faire 100 %`; html += ` · <button class="link-btn" style="font-size:13px" data-x="even">Répartir équitablement</button>`; }
    else if (f.mode === "exact") { const s = members.reduce((a, m) => a + (parseAmountInput(f.values[m.id] || "") || 0), 0), d = t - s; html = t ? (d === 0 ? `<span class="pos">✓ Tout est réparti</span>` : `Reste à répartir : <b class="${d < 0 ? "neg" : ""}">${money(d, cur)}</b>`) : "Saisis d'abord le montant."; }
    else if (f.mode === "shares") html = r.ok ? "Les centimes sont répartis au plus juste (la somme tombe toujours juste)." : "Donne au moins une part à quelqu'un.";
    else html = r.ok ? `Soit ${money(Math.max(...Object.values(r.split)), cur)} max par personne.` : "Sélectionne au moins une personne.";
    n.innerHTML = html;
    members.forEach((m) => { const e = $(`#pv-${CSS.escape(m.id)}`, root); if (e) e.textContent = r.ok && m.id in r.split ? money(r.split[m.id], cur) : "—"; });
    paySum();
    drawPreview();
  }
  /* -- Photo du ticket -- */
  function drawReceipt() {
    const box = $("#xf-receipt", root), R = f.receipt;
    if (R.url) box.innerHTML = `<img class="receipt-img" src="${esc(R.url)}" alt="Aperçu du ticket" style="max-height:220px"><div class="row" style="margin-top:8px"><button class="btn sm soft" data-x="file">${ico("camera", "sm")} Changer</button><button class="btn sm danger" data-x="rmfile">Retirer</button></div>`;
    else if (R.old && !R.remove) { box.innerHTML = `<div class="card pad row"><span style="color:var(--pos)">${ico("check")}</span><span class="grow">Ticket enregistré</span><button class="btn sm danger" data-x="rmfile">Retirer</button></div>`; }
    else box.innerHTML = `<button class="dropzone" style="width:100%" data-x="file">${ico("camera")}<div>Ajouter une photo</div><div class="hint">Compressée automatiquement avant l'envoi</div></button>`;
  }
  /* -- Événements -- */
  root.addEventListener("click", (e) => {
    const t = e.target.closest("[data-x]"); if (!t) return; const id = t.dataset.id; haptic(6);
    switch (t.dataset.x) {
      case "cat": f.category = id; $$("#xf-cats .chip", root).forEach((x) => x.classList.toggle("on", x.dataset.id === id)); break;
      case "payer": f.payerId = id; drawPayers(); break;
      case "multi": f.multi = true; if (!Object.keys(f.payers).length) f.payers[f.payerId] = f.amount; drawPayers(); break;
      case "single": f.multi = false; drawPayers(); break;
      case "toggle": f.included.has(id) ? f.included.delete(id) : f.included.add(id); drawSplit(); break;
      case "all-debtors": case "other-debtors": {
        const payerIds = f.multi
          ? new Set(Object.entries(f.payers).filter(([,v]) => (parseAmountInput(v) || 0) > 0).map(([id]) => id))
          : new Set([f.payerId]);
        const ids = t.dataset.x === 'all-debtors' ? members.map(m => m.id) : members.filter(m => !payerIds.has(m.id)).map(m => m.id);
        if (!ids.length) { toast(tr('Aucun autre participant : sélectionne manuellement les personnes concernées.'), 'err'); break; }
        f.mode = 'equal'; f.values = {}; f.included = new Set(ids);
        $$('#xf-modes button', root).forEach(x => x.classList.toggle('on', x.dataset.id === 'equal'));
        drawSplit(); break;
      }
      case "inc": case "dec": { const v = parseNum(f.values[id]) + (t.dataset.x === "inc" ? 1 : -1); f.values[id] = String(Math.max(0, v)); drawSplit(); break; }
      case "even": { const ids = members.filter((m) => m.id === m.id).map((m) => m.id), a = allocate(10000, ids.map(() => 1)); ids.forEach((i, k) => { f.values[i] = String(a[k] / 100).replace(".", ","); }); drawSplit(); break; }
      case "mode": {
        f.mode = id; $$("#xf-modes button", root).forEach((x) => x.classList.toggle("on", x.dataset.id === id));
        const inc = members.filter((m) => f.included.has(m.id)), ids = (inc.length ? inc : members).map((m) => m.id);
        f.values = {};
        if (id === "shares") ids.forEach((i) => { f.values[i] = "1"; });
        else if (id === "percent") { const a = allocate(10000, ids.map(() => 1)); ids.forEach((i, k) => { f.values[i] = String(a[k] / 100).replace(".", ","); }); }
        else if (id === "exact" && total()) { const r = splitAmount(total(), "equal", ids.map((i) => ({ id: i }))); if (r.ok) ids.forEach((i) => { f.values[i] = centsToInput(r.split[i]); }); }
        drawSplit(); break;
      }
      case "file": $("#xf-file", root).click(); break;
      case "rmfile": f.receipt.file = null; f.receipt.url = null; f.receipt.remove = true; drawReceipt(); break;
    }
  });
  root.addEventListener("input", (e) => {
    const t = e.target.closest("[data-xi]"); if (!t) return;
    switch (t.dataset.xi) {
      case "amount": f.amount = t.value; if (f.mode === "exact" && !Object.keys(f.values).length) { /* rien */ } drawSum(); break;
      case "title": f.title = t.value; break;
      case "date": f.date = t.value; break;
      case "note": f.note = t.value; break;
      case "rec": f.recurring = t.value; break;
      case "payer-amt": f.payers[t.dataset.id] = t.value; drawSum(); break;
      case "val": f.values[t.dataset.id] = t.value; drawSum(); break;
    }
  });
  $("#xf-file", root).addEventListener("change", (e) => {
    const file = e.target.files[0]; if (!file) return;
    if (!/^image\//.test(file.type)) return toast("Choisis une image.", "err");
    f.receipt = { file, url: URL.createObjectURL(file), old: f.receipt.old, remove: false }; drawReceipt();
  });
  $("#xf-save", root).addEventListener("click", async (e) => {
    const err = (m) => { $("#xf-err", root).innerHTML = `<div class="err-msg" role="alert">${esc(m)}</div>`; $("#xf-err", root).scrollIntoView({ behavior: "smooth", block: "center" }); haptic([20, 30, 20]); };
    $("#xf-err", root).innerHTML = "";
    const t = total();
    if (!t || t <= 0) return err("Saisis un montant valide (ex. 12,50).");
    if (t > 100000000) return err("Montant trop élevé.");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(f.date)) return err("Choisis une date.");
    const sp = formSplit(); if (!sp.ok) return err(sp.error);
    let payers = {};
    if (f.multi) {
      Object.entries(f.payers).forEach(([id, v]) => { const c = parseAmountInput(v) || 0; if (c > 0) payers[id] = c; });
      const sum = Object.values(payers).reduce((a, b) => a + b, 0);
      if (!Object.keys(payers).length) return err("Indique qui a payé.");
      if (sum !== t) return err(`Les montants payés (${money(sum, cur)}) doivent totaliser ${money(t, cur)}.`);
    } else payers = { [f.payerId]: t };
    const title = f.title.trim() || catById(f.category).label;
    const splitInput = {};
    if (f.mode === "exact") Object.assign(splitInput, sp.split);
    else if (f.mode !== "equal") Object.keys(sp.split).forEach((i) => { splitInput[i] = parseNum(f.values[i]); });
    let recurring = null, recurringNext = null;
    if (f.recurring) {
      recurring = { freq: f.recurring, dayOfMonth: +f.date.slice(8, 10) };
      const same = ex && ex.recurring?.freq === f.recurring && ex.date === f.date && ex.recurringNext;
      recurringNext = same ? ex.recurringNext : addPeriod(f.date, f.recurring, recurring.dayOfMonth);
    }
    const data = { title, amountCents: t, paidBy: Object.keys(payers)[0], payers, split: sp.split, splitMode: f.mode, splitInput, category: f.category, date: f.date, note: f.note.trim(), recurring, recurringNext };
    try {
      await withBusy(e.currentTarget, () => saveExpense(gid, draftExpenseId, data, { isNew: !ex, receiptFile: f.receipt.file, removeReceipt: f.receipt.remove && !f.receipt.file, oldPath: ex?.receiptPath || null }));
      closeSheet(); toast(edit ? "Dépense modifiée" : "Dépense ajoutée");
      if (fromPlan?.id) {
        // L'enregistrement réel est déjà réussi : ne jamais proposer de réessayer
        // la dépense si la mise à jour facultative de la prévision échoue.
        try { await updateDoc(doc(col(gid,'plannedExpenses'),fromPlan.id), {status:'done',updatedAt:serverTimestamp()}); }
        catch (planError) {console.warn('Prévision non archivée',planError);toast(tr('Dépense enregistrée. Marque la prévision comme réalisée pour éviter un double comptage.'),'err');}
      }
    } catch (error) {
      const message=errMsg(error);
      // Diagnostic utile quand Hosting a ete publie mais la callable d'ajout de
      // depense est encore l'ancienne version admin-only sur Cloud Run.
      if (/Confirmation réservée au créateur et aux administrateurs\./i.test(message)) {
        err(tr('La fonction Firebase des dépenses est encore sur son ancienne version. Un administrateur du projet doit déployer approveGroupExpense depuis le dernier ZIP.'));
      } else err(message);
    }
  });
  drawPayers(); drawSplit(); drawReceipt();
  I18N.translateDOM(root);
  if (!edit) setTimeout(() => $("#xf-amount", root)?.focus(), 520);
}

/* ---------- Remboursement : SEPA (QR EPC) ou Wero (coordonnée, paiement externe) ---------- */
ACT.settle = (b) => openSettleSheet(S.route.gid, b.dataset.from, b.dataset.to, +b.dataset.amt);
function openSettleSheet(gid, fromId, toId, amount) {
  const info = groupInfo(gid), g = info.group;
  const from = info.memberMap[fromId], to = info.memberMap[toId], cur = g.currency;
  if (!from || !to) return toast(tr('Participant introuvable.'), 'err');
  const iban = cleanIban(to.iban), canQr = cur === 'EUR' && iban && isValidIban(iban);
  // Le contact Wero est une donnée FACULTATIVE partagée volontairement dans la fiche membre.
  const weroContact = isValidWeroContact(to.weroContact) ? normalizeWeroContact(to.weroContact) : '';
  const canWero = cur === 'EUR' && !!weroContact;
  const comm = `${g.name} - remboursement ${from.name}`.slice(0, 140);
  let cents = amount;
  let method = canQr ? 'sepa' : canWero ? 'wero' : 'sepa';
  const summary = () => {
    const base = `${from.name} ${tr('doit')} ${money(cents, cur)} ${tr('à')} ${to.name} (${g.name}).`;
    if (method === 'wero' && canWero) return `${base}\nWero (${tr(weroContactType(weroContact))}) : ${weroContact}`;
    if (method === 'sepa' && canQr) return `${base}\nIBAN : ${formatIban(iban)}\n${tr('Communication')} : ${comm}`;
    return base;
  };
  const noQr = cur !== 'EUR' ? tr('Le QR SEPA ne fonctionne qu’en euros.')
    : to.uid ? tr('Le bénéficiaire doit ajouter son IBAN dans ses réglages pour activer le QR SEPA.')
    : tr('Renseigne l’IBAN du bénéficiaire pour afficher son QR SEPA.');
  const noWero = cur !== 'EUR' ? tr('Wero est destiné aux paiements en euros.')
    : tr('Le bénéficiaire doit activer le partage de son numéro ou e-mail Wero dans ses réglages.');
  const sh = openSheet({
    title: tr('Rembourser'), full: false,
    body: `<div class="col" style="gap:16px">
      <div class="row" style="justify-content:center;gap:14px">${avatar(from, 'lg')}<span style="color:var(--faint)">${ico('arrow', 'lg')}</span>${avatar(to, 'lg')}</div>
      <div class="center" style="font-size:17px"><b>${esc(from.name)}</b> <span class="muted">${tr('doit à')}</span> <b>${esc(to.name)}</b></div>
      <div><input id="st-amt" class="input amount-input num" inputmode="decimal" value="${esc(centsToInput(amount))}" aria-label="${tr('Montant remboursé')}"><div class="hint center" style="margin-top:4px">${tr('Tu peux modifier le montant pour un remboursement partiel.')}</div></div>
      <div class="payment-methods" role="group" aria-label="${tr('Moyen de remboursement')}">
        <button type="button" class="payment-method ${method==='sepa'?'active':''}" data-st="method" data-method="sepa" aria-pressed="${method==='sepa'}">${ico('wallet','sm')} ${tr('Virement SEPA')}</button>
        <button type="button" class="payment-method ${method==='wero'?'active':''}" data-st="method" data-method="wero" aria-pressed="${method==='wero'}">${ico('users','sm')} Wero</button>
      </div>
      <section class="payment-method-panel" id="st-sepa-panel" ${method!=='sepa'?'hidden':''}>
        ${canQr ? `<div id="st-qr" class="qr-box"></div>
          <p class="hint center">${tr('Scanne ce QR avec une application bancaire compatible SEPA : le virement en euros est prérempli.')}</p>
          <div class="copy-row"><span class="muted">IBAN</span><code>${esc(formatIban(iban))}</code><button class="icon-btn" type="button" data-st="iban" aria-label="${tr('Copier l’IBAN')}">${ico('copy', 'sm')}</button></div>
          <div class="copy-row"><span class="muted">${tr('Comm.')}</span><code>${esc(comm)}</code><button class="icon-btn" type="button" data-st="comm" aria-label="${tr('Copier la communication')}">${ico('copy', 'sm')}</button></div>`
          : `<div class="banner">${ico('wallet')}<div class="grow"><b>${tr('QR SEPA indisponible')}</b><div class="muted">${esc(noQr)}</div></div>${cur==='EUR'&&!to.uid?`<button class="btn sm soft" data-st="set-iban">IBAN</button>`:''}</div>`}
      </section>
      <section class="payment-method-panel" id="st-wero-panel" ${method!=='wero'?'hidden':''}>
        ${canWero ? `<div class="wero-payee"><div class="wero-payee-label">${tr('Destinataire Wero')} · ${tr(weroContactType(weroContact))}</div><div class="wero-payee-contact">${esc(weroContact)}</div><button type="button" class="btn soft sm" data-st="wero">${ico('copy','sm')} ${tr('Copier le contact')}</button></div>
          <ol class="wero-steps"><li>${tr('Ouvre Wero ou la rubrique Wero de ton application bancaire.')}</li><li>${tr('Sélectionne Envoyer, puis saisis ou colle le contact du bénéficiaire.')}</li><li>${tr('Saisis le montant affiché dans Kortiz, vérifie le nom et confirme dans ta banque.')}</li></ol>
          <p class="hint">${tr('Un QR Wero personnel peut être présenté depuis l’application bancaire du bénéficiaire : Kortiz ne le génère pas.')}</p>`
          : `<div class="banner">${ico('wallet')}<div class="grow"><b>${tr('Wero indisponible')}</b><div class="muted">${esc(noWero)}</div></div></div>`}
      </section>
      <div class="row payment-share-actions"><button class="btn soft" type="button" data-st="share">${ico('share','sm')} ${tr('Partager')}</button><button class="btn soft" type="button" data-st="wa">WhatsApp</button></div>
      <p class="hint center">${tr('Kortiz ne transfère pas d’argent. Vérifie le destinataire et confirme le paiement dans ta banque, puis déclare-le ici.')}</p>
    </div>`,
    footer: `<button class="btn brand" type="button" data-st="done">${ico('check','sm')} ${tr('Déclarer le paiement')}</button>`,
  });
  const root = sh.el;
  const drawQr = () => {
    const box = $('#st-qr',root); if (!box) return;
    try { box.innerHTML = cents > 0 ? qrToSvg(qrEncode(buildEpcPayload({ name: to.name, iban, amountCents: cents, remittance: comm }))) : ''; }
    catch (e) { box.textContent = tr('QR indisponible.'); }
  };
  drawQr();
  $('#st-amt',root).addEventListener('input',e=>{cents=parseAmountInput(e.target.value)||0;drawQr();});
  root.addEventListener('click', async e=>{
    const t=e.target.closest('[data-st]'); if(!t)return;
    switch(t.dataset.st) {
      case 'method':
        method=t.dataset.method==='wero'?'wero':'sepa';
        root.querySelectorAll('.payment-method').forEach(btn=>{
          const isCurrent=btn.dataset.method===method;
          btn.classList.toggle('active',isCurrent);
          btn.setAttribute('aria-pressed',String(isCurrent));
        });
        $('#st-sepa-panel',root).hidden=method!=='sepa';
        $('#st-wero-panel',root).hidden=method!=='wero';
        break;
      case 'iban': copyText(formatIban(iban),tr('IBAN copié')); break;
      case 'comm': copyText(comm,tr('Communication copiée')); break;
      case 'wero': if(canWero)copyText(weroContact,tr('Contact Wero copié')); break;
      case 'share': shareText({title:`${APP_NAME} — ${tr('remboursement')}`,text:summary()}); break;
      case 'wa': whatsapp(summary()); break;
      case 'set-iban': closeSheet();setTimeout(()=>ACT['edit-member']({dataset:{id:to.id}}),300);break;
      case 'done':
        if(!cents || cents<=0)return toast(tr('Saisis un montant valide.'),'err');
        if(cents>amount*3+100)return toast(tr('Ce montant dépasse largement la dette.'),'err');
        // Aucun virement n'est effectué ici : le bénéficiaire ou un admin non débiteur confirme.
        try {await addSettlement(gid,{fromId,toId,amountCents:cents});closeSheet();toast(tr('Paiement déclaré : en attente de confirmation du bénéficiaire.'));}
        catch(error){toast(errMsg(error),'err');}
        break;
    }
  });
}

/* ---------- Import CSV d'un export bancaire ---------- */
const CAT_GUESS = [
  [/delhaize|colruyt|carrefour|aldi|lidl|okay|spar|match|intermarche|albert heijn|proxy|cora|bio-planet|mercado|supermercado|continente|pingo doce|mercadona|dia\b|alcampo|hipermercado|atacad[aã]o|p[aã]o de a[cç][uú]car/, "courses"],
  [/resto|restaurant|restaurante|pizza|mcdonald|mc donald|burger|quick|kebab|sushi|brasserie|cafe|cafeteria|bar |friterie|starbucks|deliveroo|takeaway|uber eats|ifood|rappi|glovo/, "resto"],
  [/loyer|huur|rent/, "loyer"],
  [/stib|sncb|nmbs|de lijn|tec |uber|bolt|total|shell|q8|esso|parking|taxi|flixbus|ryanair|brussels airlines|essence/, "transport"],
  [/engie|luminus|proximus|telenet|orange|voo|edenred|eau |sibelga|vivaqua|electrabel|mobile vikings|base /, "factures"],
  [/cinema|kinepolis|netflix|spotify|ticketmaster|concert|steam|bowling|fnac|decathlon/, "loisirs"],
];
const guessCat = (d) => { const n = norm(d) + " "; for (const [re, c] of CAT_GUESS) if (re.test(n)) return c; return "autre"; };

ACT["csv-import"] = () => {
  const gid = S.route.gid, info = groupInfo(gid), members = info.members.filter(m=>!m.leftAt); closeSheet();
  setTimeout(() => {
    const st = { step: 1, layout: null, header: [], body: [], map: { date: -1, amount: -1, desc: -1 }, debitsOnly: true, payer: info.me?.id || members[0].id, parts: new Set(members.map((m) => m.id)), tx: [], err: "" };
    const sh = openSheet({ title: "Importer un CSV", full: true, body: "", footer: "" });
    const body = $(".body", sh.el), footEl = el("div", "foot"); sh.el.append(footEl);
    const existing = new Set(info.expenses.map((e) => `${e.date}|${e.amountCents}|${norm(e.title)}`));
    const colOpts = (k) => `<option value="-1">— choisir —</option>` + st.header.map((h, i) => `<option value="${i}" ${st.map[k] === i ? "selected" : ""}>${esc(h || "Colonne " + (i + 1))}</option>`).join("");
    function build() {
      const out = []; const seen = new Set();
      st.body.forEach((r) => {
        const d = parseBankDate(r[st.map.date]), a = parseLooseAmount(r[st.map.amount]);
        if (!d || a == null || a === 0) return;
        if (st.debitsOnly && a > 0) return;
        const desc = (r[st.map.desc] || "").replace(/\s+/g, " ").trim(), title = (desc || "Transaction").slice(0, 60), cents = Math.abs(a);
        const key = `${d}|${cents}|${norm(title)}`;
        out.push({ date: d, cents, title, desc, cat: guessCat(desc), dup: existing.has(key) || seen.has(key), sel: !(existing.has(key)) });
        seen.add(key);
      });
      st.tx = out.slice(0, 500);
    }
    function draw() {
      if (st.step === 1) {
        body.innerHTML = `<div class="col" style="gap:14px"><p class="muted">Exporte tes transactions depuis l'appli ou le site de ta banque (format CSV), puis charge le fichier ici. Les formats belges (séparateur « ; », virgule décimale) sont reconnus automatiquement.</p>
          <button class="dropzone" id="ci-pick" style="width:100%">${ico("upload", "lg")}<div style="margin-top:6px">Choisir un fichier CSV</div></button><input id="ci-file" type="file" accept=".csv,.txt,text/csv,text/plain" hidden>
          <div class="field"><label for="ci-paste">…ou colle le contenu</label><textarea id="ci-paste" class="input" style="min-height:110px;font-family:ui-monospace,monospace;font-size:12.5px" placeholder="Date;Montant;Description&#10;03/02/2025;-45,20;Delhaize"></textarea></div>
          ${st.err ? `<div class="err-msg">${esc(st.err)}</div>` : ""}</div>`;
        footEl.innerHTML = `<button class="btn brand" id="ci-next1">Continuer</button>`;
        $("#ci-pick", body).onclick = () => $("#ci-file", body).click();
        $("#ci-file", body).onchange = async (e) => { const f = e.target.files[0]; if (f) { $("#ci-paste", body).value = await f.text(); toast("Fichier chargé"); } };
        $("#ci-next1", footEl).onclick = () => {
          const txt = $("#ci-paste", body).value;
          if (txt.trim().length < 10) { st.err = "Charge un fichier ou colle son contenu."; return draw(); }
          const { rows } = parseCSV(txt); if (rows.length < 2) { st.err = "Impossible de lire ce fichier : au moins deux lignes sont nécessaires."; return draw(); }
          st.layout = detectCsvLayout(rows); st.header = st.layout.header; st.body = st.layout.body; st.map = { ...st.layout.map }; st.err = ""; st.step = 2; draw();
        };
      } else if (st.step === 2) {
        const sample = st.body.slice(0, 4);
        body.innerHTML = `<div class="col" style="gap:14px"><p class="muted">Vérifie que les colonnes ont été bien reconnues.</p>
          <div class="field"><label>Date</label><select class="input" data-m="date">${colOpts("date")}</select></div>
          <div class="field"><label>Montant</label><select class="input" data-m="amount">${colOpts("amount")}</select></div>
          <div class="field"><label>Description</label><select class="input" data-m="desc">${colOpts("desc")}</select></div>
          <button class="row" id="ci-deb" style="text-align:left"><span class="grow"><b>Débits uniquement</b><div class="hint" style="padding:0">Ignore les montants positifs (virements reçus). Désactive si ta banque exporte les dépenses en positif.</div></span><span class="switch ${st.debitsOnly ? "on" : ""}"></span></button>
          <div class="section-title" style="margin:6px 4px 0">Aperçu</div><div class="table-wrap"><table><thead><tr>${st.header.map((h) => `<th>${esc(h)}</th>`).join("")}</tr></thead><tbody>${sample.map((r) => `<tr>${st.header.map((_, i) => `<td>${esc((r[i] || "").slice(0, 28))}</td>`).join("")}</tr>`).join("")}</tbody></table></div>
          ${st.err ? `<div class="err-msg">${esc(st.err)}</div>` : ""}</div>`;
        footEl.innerHTML = `<button class="btn soft" id="ci-back" style="width:auto">Retour</button><button class="btn brand" id="ci-next2">Voir les transactions</button>`;
        $$("[data-m]", body).forEach((s) => (s.onchange = () => { st.map[s.dataset.m] = +s.value; }));
        $("#ci-deb", body).onclick = () => { st.debitsOnly = !st.debitsOnly; draw(); };
        $("#ci-back", footEl).onclick = () => { st.step = 1; draw(); };
        $("#ci-next2", footEl).onclick = () => {
          if (st.map.date < 0 || st.map.amount < 0) { st.err = "Choisis au minimum la colonne date et la colonne montant."; return draw(); }
          build(); if (!st.tx.length) { st.err = "Aucune transaction exploitable avec ce réglage."; return draw(); } st.err = ""; st.step = 3; draw();
        };
      } else {
        const n = st.tx.filter((t) => t.sel).length, sum = st.tx.filter((t) => t.sel).reduce((a, t) => a + t.cents, 0);
        body.innerHTML = `<div class="col" style="gap:14px">
          <div class="field"><label for="ci-payer">Qui a payé ces dépenses ?</label><select id="ci-payer" class="input">${members.map((m) => `<option value="${esc(m.id)}" ${m.id === st.payer ? "selected" : ""}>${esc(m.name)}</option>`).join("")}</select></div>
          <div class="field"><label>Partagées entre</label><div class="chips" style="flex-wrap:wrap;margin:0;padding:0">${members.map((m) => `<button class="chip ${st.parts.has(m.id) ? "on" : ""}" data-p="${esc(m.id)}">${esc(m.name)}</button>`).join("")}</div></div>
          <div class="row"><div class="grow"><b>${st.tx.length} transaction${st.tx.length > 1 ? "s" : ""}</b><div class="hint" style="padding:0">Touche pour (dé)sélectionner.</div></div><button class="link-btn" id="ci-all">Tout (dé)cocher</button></div>
          <div class="card"><div class="list">${st.tx.map((t, i) => `<button class="item" data-i="${i}">${catIcon(t.cat, "sm")}<div class="grow"><div class="t ellipsis" style="font-size:15px">${esc(t.title)}</div><div class="s">${esc(fmtDate(t.date))}${t.dup ? ' · <span style="color:var(--warn)">déjà importée ?</span>' : ""}</div></div><b class="num">${money(t.cents, g_cur())}</b><span class="check ${t.sel ? "on" : ""}">${ico("check")}</span></button>`).join("")}</div></div>
          ${st.err ? `<div class="err-msg">${esc(st.err)}</div>` : ""}</div>`;
        footEl.innerHTML = `<button class="btn soft" id="ci-back" style="width:auto">Retour</button><button class="btn brand" id="ci-go" ${n ? "" : "disabled"}>Importer ${n} dépense${n > 1 ? "s" : ""} (${money(sum, g_cur())})</button>`;
        $("#ci-payer", body).onchange = (e) => { st.payer = e.target.value; };
        $$("[data-p]", body).forEach((c) => (c.onclick = () => { const id = c.dataset.p; st.parts.has(id) ? st.parts.delete(id) : st.parts.add(id); draw(); }));
        $$("[data-i]", body).forEach((r) => (r.onclick = () => { const t = st.tx[+r.dataset.i]; t.sel = !t.sel; const y = body.scrollTop; draw(); body.scrollTop = y; }));
        $("#ci-all", body).onclick = () => { const all = st.tx.every((t) => t.sel); st.tx.forEach((t) => { t.sel = !all; }); draw(); };
        $("#ci-back", footEl).onclick = () => { st.step = 2; draw(); };
        $("#ci-go", footEl).onclick = async () => {
          if (!st.parts.size) { st.err = "Sélectionne au moins un participant."; return draw(); }
          if(!online()){st.err=tr('Connexion requise pour importer des dépenses.');return draw();}
          const sel = st.tx.filter((t) => t.sel), ids = [...st.parts];
          st.importBatchId ||= crypto.randomUUID();
          const button=$("#ci-go",footEl);
          try {
            await withBusy(button,async()=>{
              for (let k = 0; k < sel.length; k += 30) {
                const items=sel.slice(k,k+30).map(t=>{
                  const r=splitAmount(t.cents,'equal',ids.map(id=>({id})));
                  return {title:t.title,amountCents:t.cents,paidBy:st.payer,payers:{[st.payer]:t.cents},
                    split:r.split,splitMode:'equal',splitInput:{},category:t.cat,date:t.date,
                    note:'Importé depuis un CSV bancaire',recurring:null,recurringNext:null,receiptPath:null};
                });
                await call('approveGroupExpense',{operation:'import',groupId:gid,batchId:st.importBatchId,offset:k,items});
              }
            });
            closeSheet();toast(`${sel.length} dépense${sel.length > 1 ? 's' : ''} importée${sel.length > 1 ? 's' : ''}`);
          }catch(e){st.err=errMsg(e);draw();}
        };
      }
    }
    const g_cur = () => info.group.currency;
    draw();
  }, 300);
};

/* ---------- Exports du groupe : CSV et PDF imprimable ---------- */
ACT["export-group-csv"] = () => {
  const info = groupInfo(S.route.gid), g = info.group, mm = info.memberMap, fx = (c) => centsToInput(c);
  const rows = [[... ["Date", "Titre", "Catégorie", "Montant", "Devise", "Payé par", "Note"].map(tr), ...info.members.map((m) => tr('Part') + ' ' + m.name)]];
  [...info.expenses].sort((a, b) => a.date.localeCompare(b.date)).forEach((e) => rows.push([e.date, e.title, catById(e.category).label, fx(e.amountCents), g.currency, Object.keys(e.payers || {}).map((i) => mm[i]?.name || "?").join(" + "), e.note || "", ...info.members.map((m) => fx(e.split?.[m.id] || 0))]));
  rows.push([], [tr("Remboursements")], ["Date", "De", "À", "Montant"].map(tr));
  info.settlements.forEach((s) => rows.push([s.date, mm[s.fromId]?.name, mm[s.toId]?.name, fx(s.amountCents)]));
  rows.push([], [tr("Soldes")], ["Participant", "Payé", "Part", "Solde"].map(tr));
  info.members.forEach((m) => { const b = info.balances[m.id]; rows.push([m.name, fx(b.paid), fx(b.owed), fx(b.net)]); });
  downloadFile(`${slug(g.name)}-${todayISO()}.csv`, toCsv(rows), "text/csv"); closeSheet(); toast("CSV téléchargé");
};
ACT["export-group-pdf"] = () => {
  const info = groupInfo(S.route.gid), g = info.group, mm = info.memberMap, cur = g.currency, m$ = (c) => money(c, cur);
  $("#print-root").innerHTML = `<h1>${groupIcon(g.emoji, "print-group-icon")} ${esc(g.name)}</h1><div>Résumé du ${esc(fmtDate(todayISO()))} · ${info.members.length} participants · Total dépensé : <b>${m$(info.total)}</b></div>
    <h2>Soldes</h2><table><thead><tr><th>Participant</th><th class="r">Payé</th><th class="r">Part</th><th class="r">Solde</th></tr></thead><tbody>${info.members.map((m) => { const b = info.balances[m.id]; return `<tr><td>${esc(m.name)}</td><td class="r">${m$(b.paid)}</td><td class="r">${m$(b.owed)}</td><td class="r"><b>${m$(b.net)}</b></td></tr>`; }).join("")}</tbody></table>
    <h2>Pour tout équilibrer</h2>${info.transfers.length ? `<ul>${info.transfers.map((t) => `<li>${esc(mm[t.from]?.name)} doit <b>${m$(t.amount)}</b> à ${esc(mm[t.to]?.name)}</li>`).join("")}</ul>` : "<p>Tout est équilibré.</p>"}
    <h2>Dépenses (${info.expenses.length})</h2><table><thead><tr><th>Date</th><th>Titre</th><th>Catégorie</th><th>Payé par</th><th class="r">Montant</th></tr></thead><tbody>${[...info.expenses].sort((a, b) => a.date.localeCompare(b.date)).map((e) => `<tr><td>${esc(fmtDate(e.date))}</td><td>${esc(e.title)}</td><td>${esc(catById(e.category).label)}</td><td>${esc(Object.keys(e.payers || {}).map((i) => mm[i]?.name || "?").join(" + "))}</td><td class="r">${m$(e.amountCents)}</td></tr>`).join("")}</tbody></table>
    ${info.settlements.length ? `<h2>Remboursements enregistrés</h2><table><tbody>${info.settlements.map((s) => `<tr><td>${esc(fmtDate(s.date))}</td><td>${esc(mm[s.fromId]?.name)} → ${esc(mm[s.toId]?.name)}</td><td class="r">${m$(s.amountCents)}</td></tr>`).join("")}</tbody></table>` : ""}
    <p style="margin-top:20px;font-size:10px;color:#666">Généré par ${APP_NAME}</p>`;
  I18N.translateDOM($("#print-root"));
  closeSheet(); setTimeout(() => window.print(), 350);
};
window.addEventListener("afterprint", () => { $("#print-root").innerHTML = ""; });

/* ==========================================================================
   SECTION 8 — DÉMARRAGE : session, service worker, réseau
   ========================================================================== */
S.route = parseRoute();
// Entrées publiques pour les liens de /decouvrir.html : connexion/inscription/guide.
// Les routes de groupe et invitations restent intactes pour les utilisateurs connectés.
const publicEntry = new URLSearchParams(location.search).get('entry');
if (['login','signup','guide'].includes(publicEntry) && S.route.name !== 'join') {
  S.ui.publicScreen = publicEntry === 'guide' ? 'guide' : 'auth';
  S.ui.publicReturn = 'landing';
  S.ui.onboardStep = publicEntry === 'guide' ? 1 : 3;
  S.ui.reviewWelcome = publicEntry === 'guide';
  if (publicEntry === 'signup' || publicEntry === 'login') S.authMode = publicEntry;
}
if (S.route.name === "join") localStorage.setItem("pendingJoin", S.route.code);

if (!CONFIG_OK) {
  S.authReady = true; scheduleRender();
} else {
  // Aucun getRedirectResult : les anciennes redirections ne doivent pas
  // polluer les inscriptions par e-mail ni bloquer la page d'authentification.
  let authSessionVersion=0;
  onAuthStateChanged(auth, async (user) => {
    const version=++authSessionVersion;
    // Un changement de compte ne doit jamais hériter du profil précédent.
    stopAll();stopSocial();S.user=user;S.profileLoadError=null;S.authReady=false;
    if (user) {
      try { await ensureProfile(user); }
      catch(e) {
        if(version!==authSessionVersion)return;
        S.profile=null;S.profileLoadError=e?.code||'unknown';S.authReady=true;scheduleRender();return;
      }
      if(version!==authSessionVersion || auth.currentUser?.uid!==user.uid)return;
      startNotificationReads(user.uid);
      markWelcomeViewed();
      startGroupsListener(user.uid);
      startGroupInvites(user.uid);
      startExitDebtsListener(user.uid);
      startSocial().catch(e=>console.warn(e));
      S.authReady = true; scheduleRender();
      const pj = localStorage.getItem("pendingJoin");
      if (pj) { localStorage.removeItem("pendingJoin"); if (S.route.name !== "join") go("/join/" + pj); }
      if (notificationsOn()) pushSupported().then((ok) => ok && onMessage(getMessaging(app), (p) => toast(`${p.data?.title || APP_NAME} — ${p.data?.body || ""}`))).catch(() => {});
    } else {
      S.authReady = true; scheduleRender();
    }
  });
}

// Nouvelle lecture explicite après erreur réseau / permissions, sans écraser le profil.
ACT['profile-retry']=async(b)=>{
  if(!S.user)return;
  const user=S.user;
  S.profileLoadError=null;
  try {
    await withBusy(b,()=>ensureProfile(user));
    if(auth.currentUser?.uid!==user.uid||S.user?.uid!==user.uid)return;
    if(!S.profile)return;
    startNotificationReads(user.uid);
    startGroupsListener(user.uid);startGroupInvites(user.uid);startExitDebtsListener(user.uid);
    startSocial().catch(console.warn);
  } catch(e){if(S.user?.uid===user.uid){S.profile=null;S.profileLoadError=e?.code||'unknown';}}
  scheduleRender();
};

/* Service worker : PWA installable + notifications push (firebase-messaging-sw.js à la racine du site) */
if ("serviceWorker" in navigator) window.addEventListener("load", () => navigator.serviceWorker.register("/firebase-messaging-sw.js").catch((e) => console.warn("SW :", e)));
/* Bandeau hors-ligne : les écritures restent dans la file d'attente de Firestore (persistance locale) et partent au retour du réseau. */
const syncOffline = () => { $("#offline").hidden = navigator.onLine !== false; };
window.addEventListener("offline", syncOffline);
window.addEventListener("online", () => { syncOffline(); toast("De retour en ligne : synchronisation en cours"); });
syncOffline();
setTimeout(() => { if (!S.authReady) { S.authReady = true; scheduleRender(); } }, 6000); // filet de sécurité si Firebase tarde


/* ============================================================================
   KORTIZ SOCIAL UI — protected group/DM chat, friends, media, reimbursements.
   Financial actions are records only; Kortiz never moves money.
   ============================================================================ */
const SOC = {
  self: null, friends: [], requests: [], direct: [], profiles: new Map(), photos: new Map(),
  photoLoading: new Set(), photoFailed:new Set(), photoRequests:new Map(), chatKey: '', chatUnsubs: [], messages: [], money: [], payments: [], polls: [], pollsLoading:false, pollError:null,
  chatLoading: false, chatErrors: {}, profileLoadError:null,
  olderMessages: [], messageCursor: null, hasOlder: false, loadingOlder: false, pendingSend: null, preserveOlderScroll:false,
  hydratingRequests:new Set(), missingRequests:new Set(),
  recorder: null, recordingStream: null, chunks: [],
};
const pairOther = (members) => (members || []).find(x => x !== myUid());
function socialProfile(uid) {
  if (!uid) return null;
  if (!SOC.profiles.has(uid)) {
    SOC.profiles.set(uid, { displayName: tr('Utilisateur') });
    getDoc(doc(db,'socialProfiles',uid)).then(s => {
      if(s.exists()) { SOC.profiles.set(uid,s.data()); if(s.data().avatarPath) socialPhoto(uid, s.data().avatarPath); scheduleRender(); }
    }).catch(()=>{});
  }
  return SOC.profiles.get(uid);
}
function socialPhoto(uid,path,force=false){
  if(!uid||!path||(!force&&(SOC.photos.has(uid)||SOC.photoLoading.has(uid))))return;
  // Changer de photo invalide toute requête en cours, qui ne doit plus remplacer la nouvelle.
  const requestId=Symbol('avatar');
  SOC.photoRequests.set(uid,requestId);
  SOC.photoLoading.add(uid);
  if(force)SOC.photoFailed.delete(uid);
  getDownloadURL(sref(storage,path)).then(url=>new Promise(resolve=>{
    // Cache stable pour la lecture; URL versionnée uniquement après un vrai remplacement.
    const resolved=force?`${url}${url.includes('?')?'&':'?'}v=${Date.now()}`:url;
    const img=new Image();let settled=false;
    const done=ok=>{if(settled)return;settled=true;resolve(ok?resolved:null);};
    img.onload=()=>{if(img.decode)img.decode().catch(()=>{}).finally(()=>done(true));else done(true);};
    img.onerror=()=>done(false);img.src=resolved;
    if(img.complete&&img.naturalWidth)done(true);
  })).then(url=>{
    if(SOC.photoRequests.get(uid)!==requestId)return;
    if(url){SOC.photos.set(uid,url);SOC.photoFailed.delete(uid);}else SOC.photoFailed.add(uid);
    scheduleRender();
  }).catch(e=>{
    if(SOC.photoRequests.get(uid)!==requestId)return;
    SOC.photoFailed.add(uid);scheduleRender();console.warn('Avatar',e);
  }).finally(()=>{
    if(SOC.photoRequests.get(uid)!==requestId)return;
    SOC.photoLoading.delete(uid);SOC.photoRequests.delete(uid);
  });
}
function avatarPhoto(uid) {
  const p = socialProfile(uid); if (p?.avatarPath) socialPhoto(uid,p.avatarPath);
  return SOC.photos.get(uid) || '';
}
function stopSocialChat() {
  SOC.chatUnsubs.forEach(f=>f()); SOC.chatUnsubs=[]; SOC.chatKey=''; SOC.messages=[]; SOC.money=[]; SOC.payments=[];
  SOC.chatLoading=false; SOC.chatErrors={}; SOC.polls=[]; SOC.pollsLoading=false; SOC.pollError=null; SOC.olderMessages=[]; SOC.messageCursor=null; SOC.hasOlder=false; SOC.loadingOlder=false; SOC.pendingSend=null; SOC.preserveOlderScroll=false;
  SOC.hydratingRequests.clear();SOC.missingRequests.clear();
}
function startSocialChat(scope,id) {
  const key=`${scope}/${id}`;
  if(SOC.chatKey===key)return;
  stopSocialChat(); SOC.chatKey=key; SOC.chatLoading=true;
  const root = scope === 'group' ? doc(db,'groups',id) : doc(db,'directChats',id);
  const chat = (sub, dest, cap) => {
    const q=query(collection(root,sub),orderBy('createdAt','desc'),limit(cap));
    const unsub=onSnapshot(q,snap=> {
      if(SOC.chatKey!==key)return;
      if(sub==='messages') {
        if(!SOC.olderMessages.length) {
          SOC.messageCursor=snap.docs[snap.docs.length-1] || null;
          SOC.hasOlder=snap.docs.length>=cap;
        }
        const latest=snap.docs.map(x=>({id:x.id,...x.data()})).reverse();
        const known=new Set(latest.map(x=>x.id));
        SOC[dest]=[...SOC.olderMessages.filter(m=>!known.has(m.id)),...latest];
        SOC.chatLoading=false;
      } else SOC[dest]=snap.docs.map(x=>({id:x.id,...x.data()})).reverse();
      delete SOC.chatErrors[sub];scheduleRender();
    },err=>{
      if(SOC.chatKey!==key)return;
      console.error('Kortiz chat: Firestore listener',scope,sub,err);
      if(sub==='messages')SOC.chatLoading=false;
      SOC.chatErrors[sub]=err?.code||'unknown';
      scheduleRender();
    });
    SOC.chatUnsubs.push(unsub);
  };
  chat('messages','messages',80);chat('moneyRequests','money',60);
  if(scope==='group') chat('paymentRequests','payments',60);
  // Display polls in the same timeline as chat messages, for groups and DMs.
  // This is a separate subscription: a missing/deployed Firestore rule does not block the chat.
  SOC.pollsLoading=true;
  const unsubPolls=onSnapshot(query(collection(root,'polls'),orderBy('createdAt','desc'),limit(80)),snap=>{
    if(SOC.chatKey!==key)return;
    SOC.polls=snap.docs.map(d=>({id:d.id,...d.data()})).reverse();
    SOC.pollsLoading=false;SOC.pollError=null;scheduleRender();
  },err=>{
    if(SOC.chatKey!==key)return;
    SOC.pollsLoading=false;SOC.pollError=err?.code||'unknown';
    console.warn('Kortiz chat polls',scope,err);scheduleRender();
  });
  SOC.chatUnsubs.push(unsubPolls);
}
async function loadOlderChatMessages() {
  if (!SOC.chatKey || !SOC.messageCursor || SOC.loadingOlder) return;
  const [scope,id]=SOC.chatKey.split('/'),key=SOC.chatKey;
  SOC.loadingOlder=true; scheduleRender();
  try {
    const root=scope==='group'?doc(db,'groups',id):doc(db,'directChats',id);
    const snap=await getDocs(query(collection(root,'messages'),orderBy('createdAt','desc'),startAfter(SOC.messageCursor),limit(80)));
    if(SOC.chatKey!==key)return;
    if(snap.docs.length)SOC.messageCursor=snap.docs[snap.docs.length-1];
    SOC.hasOlder=snap.docs.length===80;
    const latestIds=new Set(SOC.messages.map(m=>m.id));
    const older=snap.docs.map(x=>({id:x.id,...x.data()})).reverse().filter(m=>!latestIds.has(m.id));
    SOC.olderMessages=[...older,...SOC.olderMessages];
    SOC.messages=[...older,...SOC.messages];
    SOC.preserveOlderScroll=true;
  } catch(e) {console.error('Kortiz: history',e); toast(errMsg(e),'err');}
  finally { if(SOC.chatKey===key){SOC.loadingOlder=false;scheduleRender();} }
}
ACT['chat-older']=()=>loadOlderChatMessages();
let unsubSocial=[];
function stopSocial() {stopSocialChat();unsubSocial.forEach(f=>f());unsubSocial=[];SOC.friends=[];SOC.direct=[];SOC.requests=[];SOC.self=null;SOC.activeUid=null;SOC.profileLoadError=null;SOC.profiles.clear();SOC.photos.clear();SOC.photoLoading.clear();SOC.photoFailed.clear();SOC.photoRequests.clear();}
async function startSocial() {
  const uid=myUid();if(!uid||SOC.activeUid===uid)return;
  if(SOC.activeUid&&SOC.activeUid!==uid)stopSocial();
  SOC.activeUid=uid;SOC.profileLoadError=null;
  try {
    const ref=doc(db,'socialProfiles',uid),found=await getDoc(ref);
    if(myUid()!==uid || SOC.activeUid!==uid)return;
    if(!found.exists())await call('saveSocialProfile',{displayName:myName()});
    const own=await getDoc(ref);
    if(myUid()!==uid || SOC.activeUid!==uid)return;
    SOC.self=own.data()||{displayName:myName()};SOC.profiles.set(uid,SOC.self);
    if(SOC.self.avatarPath)socialPhoto(uid,SOC.self.avatarPath);
    // Profils historiques : nom + pseudo déjà présents, ne pas demander de
    // ressaisir des données. Marquer la migration sans changer les champs.
    if(hasExistingIdentity() && S.profile.onboardingDone!==true) {
      saveProfile({onboardingDone:true}).catch(e=>console.warn('Migration de profil différée',e));
    }
    scheduleRender();
  }catch(e){SOC.profileLoadError=e?.code||'unknown';console.warn('Social profile',e);scheduleRender();}
  const watch=(q,k)=>unsubSocial.push(onSnapshot(q,s=>{SOC[k]=s.docs.map(d=>({id:d.id,...d.data()}));
    if(k==='friends')for(const friendship of SOC.friends){const other=pairOther(friendship.members);if(other)socialProfile(other);}
    if(k==='direct')syncNotificationSubscriptions();scheduleRender();},e=>console.warn(k,e)));
  watch(query(collection(db,'friendRequests'),where('toUid','==',uid)),'requests');
  watch(query(collection(db,'friendships'),where('members','array-contains',uid)),'friends');
  watch(query(collection(db,'directChats'),where('members','array-contains',uid)),'direct');
}
const profileName=(uid)=>socialProfile(uid)?.displayName||tr('Utilisateur');
const socialStatus=(s)=>({pending:'En attente',accepted:'Dette reconnue',declined:'Demande refusée',marked_paid:'Paiement déclaré',confirmed:'Confirmé',rejected:'Refusé',cancelled:'Annulé'})[s]||s;
const socialMoney=(r,groupCur)=>money(r.amountCents,r.currency||groupCur||'EUR');
function socialCardForRequest(r,scope,id,kind='money'){
  const status=r.status,me=myUid();
  const isGroup=kind==='settlement';
  const isDebtor = isGroup?r.fromUid===me:r.debtorUid===me;
  const isCreditor = isGroup?r.toUid===me:r.creditorUid===me;
  const groupMoneyAdmin = scope==='group'&&groupAdmin(S.groups.find(g=>g.id===id));
  const admin=isGroup && groupAdmin(S.groups.find(g=>g.id===id));
  const neutralAdmin=scope==='group' && (isGroup?admin:groupMoneyAdmin) && !isDebtor;
  const buttons=[];
  if(!isGroup && scope==='direct' && status==='pending' && isDebtor){
    buttons.push(['acknowledge','Reconnaître la dette']);
    buttons.push(['decline','Refuser la demande']);
  }
  if(['pending','accepted'].includes(status) && isDebtor)buttons.push(['mark_paid','J’ai payé']);
  if(!isDebtor && ((isCreditor && ['pending','accepted','marked_paid'].includes(status)) || (neutralAdmin && status==='marked_paid')))
    buttons.push(['confirm','Confirmer la réception']);
  if(status==='marked_paid' && !isDebtor && (isCreditor || neutralAdmin))buttons.push(['reject','Refuser']);
  if(!isGroup && ['pending','accepted'].includes(status) && isCreditor)buttons.push(['cancel','Annuler']);
  if(isGroup && status==='pending' && r.requestedBy===me)buttons.push(['cancel','Annuler']);
  if(!isGroup && scope==='group' && status==='confirmed' && groupMoneyAdmin && !r.accountedAt)buttons.push(['reconcile','Comptabiliser le remboursement']);
  const a=isGroup?'Réglage de groupe':'Demande de remboursement';
  const amount=socialMoney(r,isGroup?S.groups.find(g=>g.id===id)?.currency:undefined);
  return `<section class="request-card money-request ${isGroup?'settlement':''}" aria-label="${tr(a)}">
    <div class="request-card-head">
      <div>
        <div class="request-card-kicker">${tr(a)}</div>
        <div class="request-card-amount">${amount}</div>
      </div>
      <span class="request-status request-status-${esc(status)}">${tr(socialStatus(status))}</span>
    </div>
    ${r.note?`<p class="request-card-note">${esc(r.note)}</p>`:''}
    <div class="request-card-meta">${tr('Statut')} : ${tr(socialStatus(status))}</div>
    ${buttons.length?`<div class="request-card-actions">${buttons.map(([a,t])=>`<button class="btn sm ${a==='confirm'?'brand':'soft'}" data-act="social-request" data-scope="${scope}" data-kind="${kind}" data-id="${esc(id)}" data-rid="${esc(r.id)}" data-action="${a}">${tr(t)}</button>`).join('')}</div>`:''}
  </section>`;
}
function groupAdmin(group){return !!group && (group.createdBy===myUid()||(group.adminIds||[]).includes(myUid()));}
function hydrateChatRequest(scope,id,kind,rid) {
  if(!rid || !SOC.chatKey || SOC.chatKey!==`${scope}/${id}`)return;
  const key=`${kind}:${rid}`;
  if(SOC.hydratingRequests.has(key)||SOC.missingRequests.has(key))return;
  SOC.hydratingRequests.add(key);
  const colName=kind==='settlement'?'paymentRequests':'moneyRequests';
  const root=scope==='group'?doc(db,'groups',id):doc(db,'directChats',id);
  getDoc(doc(root,colName,rid)).then(snap=>{
    if(SOC.chatKey!==`${scope}/${id}`)return;
    if(!snap.exists){SOC.missingRequests.add(key);return;}
    const list=kind==='settlement'?SOC.payments:SOC.money;
    if(!list.some(x=>x.id===rid))list.push({id:rid,...snap.data()});
    scheduleRender();
  }).catch(e=>{console.warn('Request detail unavailable',e);SOC.missingRequests.add(key);})
    .finally(()=>SOC.hydratingRequests.delete(key));
}
function socialMessageMarkup(m,scope,id){
  const own=m.uid===myUid(),date=m.createdAt?.toMillis?.()||Date.now(),time=new Intl.DateTimeFormat(locale(),{hour:'2-digit',minute:'2-digit'}).format(date);
  if(m.type==='deleted')return `<div class="chat-row system"><article class="chat-bubble system"><small>${tr('Message supprimé')}</small></article></div>`;
  if(m.type==='request'){const r=SOC.money.find(x=>x.id===m.requestId);if(!r)hydrateChatRequest(scope,id,'request',m.requestId);return `<div class="chat-row ${own?'mine':'other'}">${r?socialCardForRequest(r,scope,id):`<div class="request-card money-request"><b>${tr('Demande de remboursement')}</b><p>${tr('Charge les demandes précédentes pour voir les détails.')}</p></div>`}</div>`;}
  if(m.type==='settlement'){const r=SOC.payments.find(x=>x.id===m.requestId);if(!r)hydrateChatRequest(scope,id,'settlement',m.requestId);return `<div class="chat-row ${own?'mine':'other'}">${r?socialCardForRequest(r,scope,id,'settlement'):`<div class="request-card money-request"><b>${tr('Réglage de groupe')}</b><p>${tr('Charge les demandes précédentes pour voir les détails.')}</p></div>`}</div>`;}
  let media='';
  if(m.mediaPath){
    const refPath=m.mediaPath;if(!SOC.photos.has(refPath)&&!SOC.photoLoading.has(refPath))socialPhoto(refPath,refPath);
    const url=SOC.photos.get(refPath), safe=url?esc(url):'';
    if(m.type==='image')media=safe?`<a href="${safe}" target="_blank" rel="noopener noreferrer"><img loading="lazy" src="${safe}" alt="${tr('Photo jointe')}" class="chat-image"></a>`:'…';
    if(m.type==='video')media=safe?`<video controls playsinline preload="metadata" src="${safe}" class="chat-image"></video>`:'…';
    if(m.type==='audio')media=safe?`<audio controls preload="none" src="${safe}"></audio>`:'…';
  }
  return `<div class="chat-row ${own?'mine':'other'}"><article class="chat-bubble ${own?'mine':'other'}"><div class="chat-meta">${!own?`<span class="chat-author">${esc(m.name||profileName(m.uid))}</span>`:''}<span class="chat-time">${time}</span></div>${media}${m.text?`<p>${esc(m.text)}</p>`:''}<div class="chat-actions">${own?`<button type="button" class="link-btn" data-act="chat-delete" data-scope="${scope}" data-id="${esc(id)}" data-mid="${esc(m.id)}">${tr('Supprimer')}</button>`:`<button type="button" class="link-btn" data-act="chat-report" data-scope="${scope}" data-id="${esc(id)}" data-mid="${esc(m.id)}">${tr('Signaler')}</button>`}</div></article></div>`;
}
// Polls appear between chat messages, not in a separate screen or group menu.
function chatPollMarkup(p,scope,id,readonly=false){
  const opts=Array.isArray(p.options)?p.options:[];
  const votes=p.votes||{},counts=opts.map((_,i)=>Object.values(votes).filter(v=>v===i).length);
  const total=Object.keys(votes).length,open=pollIsOpen(p),mine=votes[myUid()];
  const canClose=open && !readonly && (p.createdBy===myUid() || (scope==='group' && groupAdmin(groupInfo(id)?.group)));
  const time=new Intl.DateTimeFormat(locale(),{hour:'2-digit',minute:'2-digit'}).format(msOf(p.createdAt)||Date.now());
  const end=msOf(p.closesAt);
  return `<div class="chat-row chat-poll-row" data-poll-id="${esc(p.id)}"><article class="v28-poll-card chat-poll-card" aria-label="${tr('Sondage')}">
    <div class="chat-poll-overline">${ico('users','sm')} ${tr('Sondage')} · ${esc(time)}</div>
    <div class="v28-poll-title"><div><h2>${esc(p.question)}</h2><p>${tr(open?'Vote ouvert':'Vote terminé')} · ${total} ${tr('votes')}</p></div><span class="badge ${open?'brand':''}">${tr(open?'En cours':'Clôturé')}</span></div>
    <div class="v28-poll-answers">${opts.map((label,i)=>`<button type="button" data-act="poll-vote" data-scope="${scope}" data-chat="${esc(id)}" data-id="${esc(p.id)}" data-option="${i}" class="v28-poll-answer ${mine===i?'selected':''}" ${!open||readonly?'disabled':''}><span class="v28-poll-answer-top"><span>${esc(label)}</span><strong>${total?Math.round(counts[i]/total*100):0}%</strong></span><span class="v28-poll-track"><i style="width:${total?counts[i]/total*100:0}%"></i></span></button>`).join('')}</div>
    <div class="v28-poll-meta">${total} ${tr('participations')}${end?` · ${tr('Fin prévue')} : ${esc(new Date(end).toLocaleDateString(locale()))}`:''}${canClose?` <button type="button" class="btn soft sm" data-act="poll-close" data-scope="${scope}" data-chat="${esc(id)}" data-id="${esc(p.id)}">${tr('Clôturer')}</button>`:''}</div>
  </article></div>`;
}
function chatTimeline(scope,id,readonly){
  const messages=SOC.messages.map(m=>({kind:'message',t:msOf(m.createdAt),item:m}));
  const polls=SOC.polls.map(p=>({kind:'poll',t:msOf(p.createdAt),item:p}));
  return [...messages,...polls].sort((a,b)=>a.t-b.t || (a.kind==='poll'?1:-1))
    .map(x=>x.kind==='poll'?chatPollMarkup(x.item,scope,id,readonly):socialMessageMarkup(x.item,scope,id)).join('');
}
function socialChatUI(scope,id,cur='EUR') {
  startSocialChat(scope,id);
  const errorCode=SOC.chatErrors.messages;
  const warning=errorCode ? `<div class="chat-read-error" role="alert"><b>${tr('Impossible de charger les messages.')}</b><p>${tr('Erreur Firestore')} : <code>${esc(errorCode)}</code></p><button class="btn soft sm" type="button" data-act="chat-retry">${tr('Réessayer')}</button></div>` : '';
  const archived=scope==='direct'&&SOC.direct.some(c=>c.id===id&&c.members.length!==2);
  const readonly=archived||(scope==='group'&&!!groupInfo(id)?.group?.archived);
  const content=SOC.messages.length||SOC.polls.length?chatTimeline(scope,id,readonly)
    : SOC.chatLoading ? `<p class="hint" role="status">${tr('Chargement des messages…')}</p>`
    : errorCode ? '' : emptyState({icon:'mail',title:'Aucun message',text:'Commencez la conversation.'});
  const pollWarning=SOC.pollError?`<div class="chat-read-error" role="alert"><b>${tr('Impossible de charger les sondages.')}</b><p>${tr('Vérifie les autorisations Firestore de cette conversation.')} <code>${esc(SOC.pollError)}</code></p><button type="button" class="btn soft sm" data-act="chat-retry">${tr('Réessayer')}</button></div>`:'';
  return `<section class="chat-layout chat-layout-${scope}">${warning}${pollWarning}<div class="chat-thread-wrap"><div class="chat-thread" id="social-thread" aria-label="${tr('Messages')}">${SOC.hasOlder?`<button class="btn soft sm chat-load-older" data-act="chat-older" ${SOC.loadingOlder?'disabled':''}>${tr(SOC.loadingOlder?'Chargement…':'Charger les messages précédents')}</button>`:''}${content}</div></div>
  ${readonly?`<div class="chat-read-error" role="status">${tr('Conversation archivée : consultation uniquement.')}</div>`:`<div class="chat-toolbar"><button class="btn soft sm" type="button" data-act="poll-create" data-scope="${scope}" data-chat="${esc(id)}">${ico('users','sm')} ${tr('Créer un sondage')}</button><button class="btn soft sm" data-act="money-new" data-scope="${scope}" data-id="${esc(id)}" data-cur="${esc(cur)}">${ico('wallet','sm')} ${tr('Demander un remboursement')}</button></div>
  <form class="chat-composer" id="social-compose" data-scope="${scope}" data-id="${esc(id)}"><input id="chat-text" class="input" maxlength="2000" placeholder="${tr('Écrire un message…')}" autocomplete="off" aria-label="${tr('Message')}"><div class="chat-composer-actions"><button class="icon-btn" type="button" data-act="chat-upload-open" aria-label="${tr('Joindre un fichier')}">${ico('camera','sm')}</button><button class="icon-btn" type="button" data-act="chat-audio" aria-label="${tr('Enregistrer un vocal')}">${ico('mic','sm')}</button></div><button class="btn brand sm" type="submit">${tr('Envoyer')}</button><input type="file" id="social-file" data-ch="chat-file" accept="image/jpeg,image/png,image/webp,video/mp4,video/webm,video/quicktime,audio/webm,audio/ogg,audio/mp4,audio/mpeg" hidden></form><div id="chat-send-status" class="hint" role="status" aria-live="polite"></div>`}</section>`;
}
function renderFriends() {
  const mine=myUid();
  const received=SOC.requests.filter(r=>r.status==='pending');
  const people=SOC.friends.map(f=>pairOther(f.members)).filter(Boolean);
  const friendItem=uid=>`<div class="item">${avatar({uid,name:profileName(uid)},'sm')}<div class="grow"><b>${esc(profileName(uid))}</b><div class="muted">@${esc(socialProfile(uid)?.handle||'—')}</div></div><button class="btn sm brand" data-act="dm-open" data-uid="${esc(uid)}">${tr('Discuter')}</button><button class="icon-btn" data-act="friend-remove" data-uid="${esc(uid)}" title="${tr('Retirer des amis')}">${ico('trash','sm')}</button><button class="icon-btn" data-act="friend-block" data-uid="${esc(uid)}" title="${tr('Bloquer')}">${ico('lock','sm')}</button></div>`;
  paint({top:topBar({title:tr('Amis et conversations')}),nav:mainNav('friends'),body:`<div class="section-title">${tr('Mon pseudo')} : @${esc(SOC.self?.handle||'—')}</div><div class="card pad col"><p class="hint">${tr('Retrouve tes amis grâce à leur pseudo.')}</p><div class="row"><input class="input grow" id="friend-search" maxlength="24" placeholder="@pseudo"><button class="btn brand sm" data-act="friend-add">${tr('Ajouter')}</button></div></div>
    ${groupInvitationsUI()}
    ${received.length?`<div class="section-title">${tr('Demandes d’amitié')} ${notifBadge(received.length)}</div><div class="card"><div class="list">${received.map(r=>`<div class="item"><div class="grow">${esc(profileName(r.fromUid))}</div><button class="btn brand sm" data-act="friend-respond" data-id="${esc(r.id)}" data-yes="1">${tr('Accepter')}</button><button class="btn soft sm" data-act="friend-respond" data-id="${esc(r.id)}">${tr('Refuser')}</button></div>`).join('')}</div></div>`:''}
    <div class="section-title">${tr('Mes amis')} (${people.length})</div>${people.length?`<div class="card"><div class="list">${people.map(friendItem).join('')}</div></div>`:emptyState({icon:'users',title:'Aucun ami',text:'Ajoute un ami avec son pseudo.'})}
    <div class="section-title">${tr('Messages privés')} ${notifBadge(SOC.direct.reduce((n,c)=>n+notifDmCount(c.id),0))}</div>${SOC.direct.length?`<div class="card"><div class="list">${SOC.direct.map(c=>`<button class="item" data-act="nav" data-to="/dm/${esc(c.id)}">${avatar({uid:pairOther(c.members),name:profileName(pairOther(c.members))},'sm')}<span class="grow t">${esc(profileName(pairOther(c.members)))}</span>${notifBadge(notifDmCount(c.id))}${ico('arrow','sm')}</button>`).join('')}</div></div>`:emptyState({icon:'mail',title:'Aucune conversation',text:'Ouvre une conversation depuis ta liste d’amis.'})}`});
}
function renderDirectChat() {
  const id=S.route.cid,doc=SOC.direct.find(c=>c.id===id);
  if(!doc)return paint({top:topBar({back:'/friends',title:tr('Messages privés')}),body:emptyState({icon:'lock',title:'Conversation indisponible',text:'Vérifie que cette conversation est toujours accessible.'}),nav:mainNav('friends')});
  const archived=doc.members.length!==2,uid=pairOther(doc.members);
  paint({top:topBar({back:'/friends',title:archived?tr('Conversation archivée'):esc(profileName(uid))}),body:socialChatUI('direct',id),nav:mainNav('friends')});
}
function tabGroupChat(info){return socialChatUI('group',info.group.id,info.group.currency);}
ACT['friend-add']=async b=>{const handle=$('#friend-search')?.value.trim();if(!handle)return;await withBusy(b,()=>call('sendFriendRequest',{handle}));toast(tr('Demande envoyée'));};
ACT['friend-respond']=async b=>{await withBusy(b,()=>call('respondFriendRequest',{id:b.dataset.id,accept:b.dataset.yes==='1'}));toast(tr('Réponse enregistrée'));};
ACT['friend-remove']=async b=>{if(await confirmDialog({title:tr('Retirer des amis ?')})){await call('removeFriend',{uid:b.dataset.uid});toast(tr('Ami retiré'));}};
ACT['friend-block']=async b=>{if(await confirmDialog({title:tr('Bloquer cet utilisateur ?'),message:tr('Les messages privés et demandes seront bloqués.'),danger:true})){await call('blockUser',{uid:b.dataset.uid});toast(tr('Utilisateur bloqué'));}};
ACT['dm-open']=async b=>{const r=await withBusy(b,()=>call('openDirectChat',{uid:b.dataset.uid}));go(`/dm/${r.chatId}`);};
document.addEventListener('submit',async e=>{
  const form=e.target.closest('#social-compose');if(!form)return;
  e.preventDefault();const box=$('#chat-text',form),text=box?.value.trim();if(!text)return;
  const submit=form.querySelector('[type="submit"]');
  const existing=SOC.pendingSend;
  const clientRequestId=existing?.text===text && existing.scope===form.dataset.scope && existing.id===form.dataset.id
    ? existing.clientRequestId : crypto.randomUUID();
  SOC.pendingSend={text,scope:form.dataset.scope,id:form.dataset.id,clientRequestId};
  const status=$('#chat-send-status',form.parentElement);
  if(status)status.textContent=tr('Envoi en cours…');
  try {
    await withBusy(submit,()=>call('sendChatMessage',{scope:form.dataset.scope,id:form.dataset.id,text,type:'text',clientRequestId}));
    box.value=''; SOC.pendingSend=null; if(status)status.textContent='';
  }catch(err){if(status)status.textContent=tr('Échec de l’envoi. Réessaie sans changer le texte.');toast(errMsg(err),'err');}
});
ACT['chat-delete']=async b=>{
  if(!await confirmDialog({title:tr('Supprimer ce message'),danger:true}))return;
  await withBusy(b,()=>call('deleteChatMessage',{scope:b.dataset.scope,id:b.dataset.id,messageId:b.dataset.mid}));toast(tr('Message supprimé'));
};
ACT['chat-report']=async b=>{
  if(!await confirmDialog({title:tr('Signaler ce message ?'),message:tr('Un signalement sera transmis pour examen.'),danger:true}))return;
  await withBusy(b,()=>call('reportChatMessage',{scope:b.dataset.scope,id:b.dataset.id,messageId:b.dataset.mid,reason:'abuse'}));toast(tr('Signalement envoyé'));
};
ACT['chat-retry']=()=>{stopSocialChat();scheduleRender();};
ACT['chat-upload-open']=()=>$('#social-file')?.click();
async function socialUpload(file,scope,id,kindOverride){
  if(!file)return;
  let type=kindOverride||(file.type.startsWith('image/')?'image':file.type.startsWith('video/')?'video':file.type.startsWith('audio/')?'audio':'');
  if(!type)throw new Error(tr('Format non autorisé.'));
  const limit={image:8,video:25,audio:10}[type]*1024*1024;
  if(file.size>limit)throw new Error(tr('Fichier trop volumineux.'));
  let blob=file,ext=(file.name.split('.').pop()||'').toLowerCase();
  if(type==='image'){blob=await compressImage(file,1600,.78);ext='jpg';}
  const types={image:['jpg'],video:['mp4','webm','mov'],audio:['webm','ogg','m4a','mp3']}[type];
  if(!types.includes(ext))throw new Error(tr('Format non autorisé.'));
  const name=crypto.randomUUID().replaceAll('-','')+'.'+ext;
  const path=`chat/${scope}/${id}/${myUid()}/${name}`;
  await uploadBytes(sref(storage,path),blob,{contentType:blob.type||file.type});
  await call('sendChatMessage',{scope,id,type,file:name,text:''});
  toast(tr('Fichier envoyé'));
}
CHG['chat-file']=async b=>{
  const form=b.closest('#social-compose');if(!form)return;
  try{await socialUpload(b.files?.[0],form.dataset.scope,form.dataset.id);}catch(e){toast(errMsg(e),'err');}b.value='';
};
ACT['chat-audio']=async b=>{
  if(SOC.recorder?.state==='recording'){
    SOC.recorder.stop();b.classList.remove('recording');return;
  }
  if(!navigator.mediaDevices?.getUserMedia||!window.MediaRecorder)return toast(tr('Microphone non disponible.'),'err');
  try{
    const stream=await navigator.mediaDevices.getUserMedia({audio:true});
    const mime=['audio/webm;codecs=opus','audio/mp4','audio/ogg'].find(t=>MediaRecorder.isTypeSupported(t));
    if(!mime){stream.getTracks().forEach(t=>t.stop());return toast(tr('Enregistrement non pris en charge.'),'err');}
    const recorder=new MediaRecorder(stream,{mimeType:mime}),scope=S.route.name==='group'?'group':'direct',id=scope==='group'?S.route.gid:S.route.cid;
    SOC.recorder=recorder;SOC.recordingStream=stream;SOC.chunks=[];
    recorder.ondataavailable=e=>{if(e.data?.size)SOC.chunks.push(e.data);};
    recorder.onstop=async()=>{
      const ext=mime.includes('mp4')?'m4a':mime.includes('ogg')?'ogg':'webm';
      const blob=new Blob(SOC.chunks,{type:mime.split(';')[0]});stream.getTracks().forEach(t=>t.stop());SOC.recorder=null;
      try{if(blob.size>0)await socialUpload(new File([blob],`voice.${ext}`,{type:blob.type}),scope,id,'audio');}catch(e){toast(errMsg(e),'err');}
    };
    recorder.start();b.classList.add('recording');toast(tr('Enregistrement en cours — appuie à nouveau pour envoyer.'));
  }catch(e){toast(tr('Autorisation du microphone refusée.'),'err');}
};
ACT['money-new']=b=>{
  const scope=b.dataset.scope,id=b.dataset.id,cur=b.dataset.cur||'EUR';
  const members=scope==='group'?S.stores.get(id)?.members.filter(x=>x.uid&&x.uid!==myUid())||[]:[];
  const other=scope==='direct'?pairOther(SOC.direct.find(x=>x.id===id)?.members):null;
  const select=scope==='group'?`<div class="field"><label>${tr('À qui ?')}</label><select id="money-to" class="input">${members.map(m=>`<option value="${esc(m.uid)}">${esc(m.name)}</option>`).join('')}</select></div>`:`<p>${tr('Destinataire')} : ${esc(profileName(other))}</p>`;
  const clientRequestId=crypto.randomUUID();
  const sh=openSheet({title:tr('Demander un remboursement'),body:`<div class="col">${select}<div class="field"><label>${tr('Montant')} (${esc(cur)})</label><input class="input" id="money-amount" inputmode="decimal" placeholder="25,00" required></div><div class="field"><label>${tr('Motif (facultatif)')}</label><input class="input" id="money-note" maxlength="200"></div><p class="hint">${tr('Kortiz ne transfère pas d’argent. Le paiement s’effectue hors de l’application.')}</p>${scope==='group'?`<p class="hint">${tr('Dans un groupe, le montant demandé doit correspondre à une dette encore due dans Soldes. La personne qui reçoit l’argent peut confirmer le remboursement, même si le payeur est administrateur.')}</p>`:''}</div>`,footer:`<button class="btn brand" id="money-send">${tr('Envoyer la demande')}</button>`});
  $('#money-send',sh.el).onclick=async evt=>{
    const amountCents=parseAmountInput($('#money-amount',sh.el).value),debtorUid=scope==='group'?$('#money-to',sh.el)?.value:other;
    if(!amountCents||!debtorUid)return toast(tr('Montant ou destinataire invalide.'),'err');
    try{await withBusy(evt.currentTarget,()=>call('createMoneyRequest',{scope,id,debtorUid,amountCents,currency:cur,note:$('#money-note',sh.el).value,clientRequestId}));closeSheet();toast(tr('Demande envoyée'));}catch(e){toast(errMsg(e),'err');}
  };
};
ACT['social-request']=async b=>{
  const kind=b.dataset.kind,scope=b.dataset.scope,id=b.dataset.id,requestId=b.dataset.rid,action=b.dataset.action;
  const acknowledge=action==='acknowledge';
  const title=acknowledge?tr('Reconnaître cette dette privée ?'):action==='confirm'?tr('Confirmer la réception de l’argent ?'):action==='reject'?tr('Refuser la déclaration de paiement ?'):action==='reconcile'?tr('Comptabiliser ce remboursement déjà confirmé ?'):null;
  if(title&&!await confirmDialog({title,message:tr(acknowledge?'Après reconnaissance, ce remboursement doit être confirmé avant de pouvoir supprimer ton compte.':'Vérifie le paiement en dehors de Kortiz avant de confirmer.')}))return;
  await withBusy(b,()=>kind==='settlement'?call('respondGroupSettlement',{groupId:id,requestId,action}):call('updateMoneyRequest',{scope,id,requestId,action}));toast(tr('Statut mis à jour'));
};
ACT['social-admins']=()=>{
  const info=groupInfo(S.route.gid),g=info.group;
  const people=info.members.filter(m=>m.uid&&!m.leftAt&&m.uid!==g.createdBy);
  openSheet({title:tr('Administrateurs du groupe'),body:`<div class="col">${people.map(m=>`<div class="row card pad"><span class="grow">${esc(m.name)}</span><button class="btn sm soft" data-act="social-admin-change" data-uid="${esc(m.uid)}" data-on="${(g.adminIds||[]).includes(m.uid)?'0':'1'}">${tr((g.adminIds||[]).includes(m.uid)?'Retirer admin':'Nommer admin')}</button></div>`).join('')}</div>`});
};
ACT['social-admin-change']=async b=>{await withBusy(b,()=>call('setGroupAdmin',{groupId:S.route.gid,uid:b.dataset.uid,enabled:b.dataset.on==='1'}));closeSheet();toast(tr('Droits mis à jour'));};
ACT['avatar-select']=()=>$('#profile-file')?.click();
CHG['profile-photo']=async b=>{
  const file=b.files?.[0];if(!file)return;
  b.value='';
  if(!file.type.startsWith('image/')||file.size>12*1024*1024)return toast(tr('Photo invalide (12 Mo maximum).'),'err');
  try{
    const blob=await openAvatarCropper(file);
    if(!blob)return;
    const path=`avatars/${myUid()}/profile.jpg`;
    await uploadBytes(sref(storage,path),blob,{contentType:'image/jpeg'});
    await call('saveSocialProfile',{displayName:S.profile.displayName||myName(),avatarPath:path});
    SOC.photos.delete(myUid());SOC.photoFailed.delete(myUid());
    const cur=SOC.profiles.get(myUid())||{}; cur.avatarPath=path; SOC.profiles.set(myUid(),cur);
    SOC.self={...(SOC.self||{}),avatarPath:path};
    socialPhoto(myUid(),path,true);
    const wrap=$('#pf-avatar-preview-wrap'); if(wrap) wrap.innerHTML=avatar({uid:myUid(),name:S.profile.displayName||myName(),color:S.profile.avatarColor},'lg');
    toast(tr('Photo de profil modifiée'));
  }catch(e){toast(errMsg(e),'err');}
};

/* Transparent storage information: there are no optional advertising/analytics trackers
   in this build. Technical storage does not require a misleading opt-in. */
function privacyNotice() {
  if(localStorage.getItem('kortiz.privacyNotice.v1')==='ack')return;
  const txt={
    fr:['Confidentialité : Kortiz utilise uniquement le stockage technique nécessaire à la connexion, à la sécurité et au mode hors ligne. Aucun traceur publicitaire ni analytique facultatif n’est installé.','Compris','En savoir plus'],
    en:['Privacy: Kortiz uses essential storage for login, security and offline mode. No optional advertising or analytics trackers are installed.','Got it','Learn more'],
    pt:['Privacidade: o Kortiz utiliza armazenamento técnico essencial para acesso, segurança e funcionamento offline. Não há rastreadores opcionais de publicidade ou análise.','Entendi','Saiba mais'],
    es:['Privacidad: Kortiz solo utiliza almacenamiento técnico necesario para el acceso, la seguridad y el modo sin conexión. No hay rastreadores opcionales de publicidad o análisis.','Entendido','Más información'],
  }[I18N.language()]||[];
  const panel=document.createElement('aside');panel.className='privacy-banner';panel.setAttribute('role','region');panel.setAttribute('aria-label',tr('Confidentialité'));
  panel.innerHTML=`<div>${esc(txt[0])}</div><div class="row"><a href="/legal.html#cookies" target="_blank" rel="noopener">${esc(txt[2])}</a><span class="grow"></span><button class="btn brand sm" type="button">${esc(txt[1])}</button></div>`;
  panel.querySelector('button').addEventListener('click',()=>{localStorage.setItem('kortiz.privacyNotice.v1','ack');panel.remove();});
  document.body.append(panel);
}
/* v28: consent-v28.js remplace l’ancien bandeau non conforme. */
const userMark = (cls='name-mark-icon') => `<span class="${cls}" aria-hidden="true"></span>`;


