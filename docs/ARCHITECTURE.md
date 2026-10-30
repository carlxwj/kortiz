# Architecture technique de Kortiz

## Vue d'ensemble

```text
Navigateur (public/index.html, public/app.js, i18n.js)
  ├─ Firebase Authentication → identité / session
  ├─ Firestore SDK → lecture et souscriptions en temps réel
  ├─ Firebase Cloud Functions → validations et mutations sensibles
  └─ Firebase Messaging / Service Worker → notifications si autorisées
                      │
            Firestore Rules / Storage Rules
                      │
     Groupes / dépenses / comptes / messages / votes / autres collections
```

**Attention :** un Firebase Web API key ou un identifiant de projet client ne constitue pas un secret serveur. La sécurité repose sur Firebase Authentication, des règles strictes et les validations backend. Ne transformez jamais les règles en `allow read, write: if true` pour débloquer un écran.

## Responsabilités

| Couche | Fichier(s) | Responsabilité |
| --- | --- | --- |
| UI et navigation | `public/app.js`, `public/index.html`, `public/styles.css` | Affichage des groupes, gestion des états et appels Firebase |
| Traductions | `public/i18n.js` | Chaînes et langues FR/EN/PT/ES |
| Règles métier auxiliaires | `public/currency-logic.js`, `public/planning-logic.js`, `public/notification-logic.js` | Devises, échéances et préférences |
| Backend | `functions/index.js`, utilitaires de `functions/` | Opérations autorisées, cohérence, nettoyage des données |
| Autorisation | `firestore.rules`, `storage.rules` | Privilèges et visibilité des documents/fichiers |
| Déploiement | `firebase.json`, `firestore.indexes.json` | Hébergement, Functions, indexes et entêtes HTTP |
| Qualité | `tests/*.test.js` | Régressions des calculs, workflows et textes |

## Invariants métier

1. Un utilisateur ne modifie que les données auxquelles son rôle et son appartenance au groupe donnent accès.
2. Les calculs de soldes et de répartition doivent être déterministes et cohérents, avec un contrôle des montants et des arrondis.
3. Les remboursements sont **déclaratifs** : une confirmation n'est pas un mouvement bancaire.
4. Les messages et sondages ne doivent pas modifier indirectement les calculs de dépenses.
5. La suppression de compte et le départ d'un groupe doivent traiter les références et les données soumises à conservation/anonymisation selon leur finalité.
6. Une requête cliente n'est jamais une preuve d'autorisation : contrôler l'utilisateur et les arguments côté backend.

## Limites et pistes de refonte

L'interface actuelle repose principalement sur du JavaScript navigateur plutôt que sur un framework à composants. Toute migration React/TypeScript doit préserver le schéma Firestore, les règles, les calculs financiers, l'ensemble des traductions, les opérations de remboursement et l'email de contact déjà fonctionnel. Éviter les migrations de données implicites.

La documentation présente le code fourni à la date de préparation, pas un cahier des charges garantissant un état cloud de production.
