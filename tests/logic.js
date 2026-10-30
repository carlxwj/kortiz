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
  const s = String(str ?? '').replace(/[\s\u00a0€$£]/g, '').replace(',', '.');
  if (!/^\d*\.?\d{0,2}$/.test(s) || s === '' || s === '.') return null;
  const [i, d = ''] = s.split('.');
  return parseInt(i || '0', 10) * 100 + parseInt((d + '00').slice(0, 2), 10);
}
const centsToInput = (c) => (c / 100).toFixed(2).replace('.', ',');
function formatMoney(cents, cur = 'EUR') {
  try {
    return new Intl.NumberFormat('fr-BE', { style: 'currency', currency: cur }).format(cents / 100);
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

/* ---------- Import CSV (formats bancaires belges) ---------- */
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
  s = s.replace(/[\s\u00a0€$£]|EUR/gi, '');
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
  if ((m = s.match(/^(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{4})/))) return chk(m[3], m[2], m[1]);
  if ((m = s.match(/^(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{2})$/))) return chk('20' + m[3], m[2], m[1]);
  if ((m = s.match(/^(\d{4})(\d{2})(\d{2})$/))) return chk(m[1], m[2], m[3]);
  return null;
}

/** Détecte la ligne d'en-tête et les colonnes date / montant / description (mapping modifiable ensuite). */
function detectCsvLayout(rows) {
  const kw = /date|datum|montant|bedrag|amount|libell|description|omschrijving|communication|mededeling|nom|naam|valuta|devise/i;
  let h = 0;
  for (let i = 0; i < Math.min(rows.length, 15); i++) {
    const hits = rows[i].filter((c) => kw.test(c) && !/^[\d.,\-\s]+$/.test(c)).length;
    if (hits >= 2) { h = i; break; }
  }
  const header = rows[h] || [];
  const body = rows.slice(h + 1).filter((r) => r.length >= 2);
  const find = (...res) => { for (const re of res) { const i = header.findIndex((c) => re.test(c)); if (i >= 0) return i; } return -1; };
  const map = {
    date: find(/comptabilisation|boekingsdatum|ex[ée]cution|uitvoering/i, /^date$|^datum$/i, /date|datum/i),
    amount: find(/^montant$|^bedrag$|^amount$/i, /montant|bedrag|amount|somme/i),
    desc: find(/contrepartie|tegenpartij|^nom|^naam|libell|description|omschrijving/i, /communication|mededeling|details|message/i),
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
