/* Kortiz — logique pure de planification.
 * Les prévisions sont distinctes des transactions : aucune dette ou remboursement
 * n'est calculé à partir d'une prévision.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.KortizPlanning = api;
})(typeof window !== 'undefined' ? window : null, function () {
  function compute(expenses = [], plans = [], budgetCents = null) {
    const spent = expenses.reduce((sum, e) => sum + (e.approvalStatus === 'rejected' ? 0 : (Number.isSafeInteger(e.amountCents) && e.amountCents > 0 ? e.amountCents : 0)), 0);
    const planned = plans.reduce((sum, p) => sum + (p.status === 'planned' && Number.isSafeInteger(p.amountCents) && p.amountCents > 0 ? p.amountCents : 0), 0);
    const projected = spent + planned;
    const budget = Number.isSafeInteger(budgetCents) && budgetCents > 0 ? budgetCents : null;
    return {
      spent, planned, projected, budget,
      remaining: budget === null ? null : budget - projected,
      ratio: budget === null ? null : projected / budget,
      exceeded: budget !== null && projected > budget,
      hasBudget: budget !== null,
    };
  }
  return { compute };
});
