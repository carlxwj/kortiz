# Tests, qualité et reproductibilité

## Commande vérifiée

```bash
node --test tests/*.test.js
```

**Résultat dans la copie nettoyée (30 octobre 2026) : 257 tests réussis / 257, 0 échec.** Le nombre de sous-tests peut évoluer avec le code.

## Vérifications automatiques du backend

Le workflow GitHub Actions lance aussi `npm ci --prefix functions` pour contrôler l'installation des dépendances déclarées et la cohérence du lockfile de Firebase Functions, puis `node --check functions/index.js` pour vérifier la syntaxe JavaScript du point d'entrée serveur. Ces contrôles ont été ajoutés après la publication initiale du projet.

Ils **ne constituent pas** un test d'intégration des Cloud Functions ni une validation des autorisations Firebase en production : ces points exigent des émulateurs ou un environnement de test séparé.

## Couverture observable

- Répartitions et soldes, remboursements déclaratifs et sortie d'un groupe.
- Règles de sécurité, droits d'accès, intégrité des dépenses et des opérations récurrentes.
- Parcours d'inscription, connexion, profils, invitations, messagerie, sondages.
- Prévisions, quotas et devise du tableau de bord.
- Responsive et cohérence de traductions vérifiés principalement par inspection/statique.
- Garde-fous de déploiement présents dans certains scripts PowerShell historiques.

## Ce que les tests ne prouvent pas

Les tests peuvent contrôler des extraits de code ou des signatures sans utiliser un vrai navigateur ni un vrai Firestore. Ils ne remplacent pas les tests d'intégration Firebase en émulateur, les essais multi-comptes, une vraie stratégie de monitoring, les audits des règles ni la vérification de production.

## Validation pré-déploiement recommandée

- Créer deux comptes distincts et un groupe de test.
- Vérifier invitations/refus, dépenses, répartitions, remboursements, sondages et permissions croisées.
- Vérifier toutes les langues et les écrans mobiles.
- Tester suppression de compte, données résiduelles, quotas et interruptions réseau.
- Conserver un relevé des résultats daté sans inclure de données personnelles.
