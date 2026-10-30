# Kortiz — règle métier corrigée : dépenses et remboursements

## Comportement souhaité

1. **Chaque membre** d’un groupe non archivé peut créer et enregistrer une dépense (y compris via import CSV). Le serveur valide la somme des parts, des payeurs, les identifiants et le justificatif **avant** la création de la dépense.
2. Une dépense correcte est **immédiatement comptabilisée** dans les soldes, sans approbation d’un administrateur. Le créateur peut corriger/supprimer sa propre dépense ; les administrateurs peuvent administrer toutes les dépenses.
3. Un débiteur peut déclarer « J’ai payé ». Cette déclaration ne change **pas** les soldes et ne constitue pas une preuve de transfert bancaire.
4. **Un administrateur seulement** peut confirmer ou refuser ce paiement déclaré. C’est la confirmation qui crée l’écriture de remboursement et met à jour les soldes. Kortiz ne déplace jamais de fonds.
5. Les **anciennes dépenses `pending`** (créées par la version précédente) sont également prises en compte immédiatement, sans modifier leurs documents en base. Les anciennes dépenses `rejected` restent exclues.
6. Les dépenses récurrentes et les imports sont comptabilisés dès leur création.
7. Pour corriger une dépense rejetée dans la version antérieure, faire intervenir un administrateur ou créer une nouvelle dépense correcte.

## Modifications techniques

- `functions/index.js` : callable historique `approveGroupExpense` (nom conservé pour ne pas créer une 26e fonction) accepte `save`, `delete`, `import`, sans étape d’approbation. `requestGroupSettlement` / `respondGroupSettlement` calculent la dette depuis toutes les dépenses non rejetées. `recurringExpenses` crée des dépenses déjà prises en compte ; `onExpenseWritten` journalise l’ajout et les corrections.
- `public/app.js` : soldes et statistiques prennent en compte les dépenses non rejetées. La mention « À valider » et le bouton « Confirmer la dépense » sont retirés ; les boutons de confirmation de **remboursement** restent réservés aux administrateurs.
- `firestore.rules` : protections de l’archive d’audit conservées ; aucune autorisation d’écriture directe de nouvelles dépenses via le navigateur (hors groupe de démonstration). Les écritures ordinaires restent validées par la Cloud Function.
- `public/firebase-messaging-sw.js` : cache actualisé.

## Déploiement

**Ne pas déployer Hosting seul :** l’ancienne Cloud Function écrirait encore des dépenses `pending`.

1. Préparer une sauvegarde et tester avec 2 ou 3 comptes sur un projet Firebase de test.
2. Installer les dépendances si nécessaire : `npm --prefix functions ci`.
3. **Si la version renforcée de l’audit précédent est déjà installée** : lancer `./DEPLOYER_POLITIQUE_DEPENSES.ps1` dans PowerShell. Il met à jour les **5 fonctions affectées**, une par une, et s’arrête au premier échec.
4. **Si cette version de sécurité n’a pas encore été installée** : suivre d’abord `MISE_A_JOUR_SECURITE.md` et son script `DEPLOYER_CORRECTIFS_SECURITE.ps1` (qui inclut la nouvelle fonction `approveGroupExpense` et les protections) ; puis lancer `DEPLOYER_POLITIQUE_DEPENSES.ps1` pour compléter les fonctions affectées. Ne déployer les règles qu’après confirmation des fonctions.
5. Publier Hosting une fois les fonctions déployées : `firebase deploy --only hosting --project kortiz-de19f`.
6. Si les règles de sécurité de l’audit précédent n’ont pas été publiées, les publier **après les fonctions** : `firebase deploy --only firestore:rules,storage --project kortiz-de19f`.
7. Actualiser les PWA iOS/Android (fermer/rouvrir ou recharger l’application) pour charger le nouveau code.

Le quota régional CPU Cloud Run peut empêcher la mise à jour des fonctions. Dans ce cas, **ne pas publier le nouveau Hosting**, conserver la version actuelle et résoudre l’erreur de quota d’abord. Aucun compte payant ni ajout de nouvelle Cloud Function n'est nécessaire par la conception de cette correction, mais une mise à jour reste soumise aux quotas en vigueur.

## Scénarios à vérifier en Firebase avec comptes distincts

- Membre ordinaire : créer une dépense de 20 €, vérifier sa présence immédiate dans les soldes de tous les comptes.
- Membre ordinaire : modifier sa dépense, vérifier qu’une autre personne ne peut pas la modifier ou la supprimer.
- Importer un CSV et tester une dépense récurrente : nouvelles dépenses comptabilisées immédiatement.
- Tester une ancienne dépense `pending` et une `rejected` : la première compte, la seconde non.
- Débiteur : déclarer le paiement sans réduire la dette.
- Autre membre : essayer de confirmer le remboursement → accès refusé.
- Administrateur : confirmer le remboursement → écriture de règlement et mise à jour des soldes.

**Attention à l’historique** : autoriser le créateur à corriger une dépense déjà prise en compte peut recalculer les soldes même après un remboursement. Les corrections sont désormais journalisées, mais une future amélioration doit prévoir le verrouillage ou la réconciliation des écritures liées à des paiements déjà confirmés. Les tests statiques locaux ne remplacent pas les tests d’intégration multi-utilisateurs Firebase.
