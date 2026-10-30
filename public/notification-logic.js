/* Kortiz — compteurs de nouveautés (aucune donnée privée exportée).
 * Garde une limite volontaire de 4+ et exclut les opérations de l'utilisateur.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.KortizNotifications = api;
})(typeof window !== 'undefined' ? window : null, function () {
  'use strict';
  function ms(t) {
    if (!t) return 0;
    if (typeof t.toMillis === 'function') return t.toMillis();
    if (typeof t === 'number') return t;
    if (typeof t.seconds === 'number') return t.seconds * 1000 + Math.floor((t.nanoseconds || 0) / 1000000);
    return 0;
  }
  function label(number) {
    if (!Number.isFinite(number) || number <= 0) return '';
    return number > 4 ? '4+' : '+' + String(Math.floor(number));
  }
  function unread(items, lastRead, userId, authorKey) {
    const cutoff = ms(lastRead);
    if (!lastRead || !cutoff || !Array.isArray(items)) return 0; // ignore pre-activation history
    return items.filter(item => item && item[authorKey] !== userId && ms(item.createdAt) > cutoff
      && item.type !== 'deleted' && item.approvalStatus !== 'rejected').length;
  }
  return Object.freeze({ ms, label, unread });
});
