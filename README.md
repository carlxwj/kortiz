# Kortiz — dépenses partagées, sans transaction bancaire

**Application web collaborative · JavaScript · Firebase Authentication · Cloud Firestore · Cloud Functions · Firebase Hosting · 4 langues**

> **Résumé / English:** Kortiz is a shared-expense tracking application. It helps groups record who paid what, track balances, discuss expenses, and request/confirm reimbursements. **It never receives, transfers, stores or processes payment funds.**

## Le besoin

Les groupes d'amis, colocations ou proches souhaitent répartir leurs dépenses, suivre les remboursements et conserver une trace claire des décisions. Kortiz centralise ces informations dans une interface réactive, en privilégiant la séparation des droits, la cohérence des calculs et la confidentialité des conversations.

## Fonctionnalités du code présent

- Comptes utilisateurs, connexions, profils et relations entre amis.
- Groupes de dépenses, participants, soldes, historiques et répartitions.
- Demandes et confirmations de remboursement **hors application** (aucune interface de paiement intégrée).
- Messagerie de groupe et messages privés, sondages intégrés aux fils de discussion.
- Prévisions, budgets, dépenses récurrentes, calendrier de groupe.
- Tableau de bord multidevise, paramètres de notifications, interface responsive.
- Interface en **FR / EN / PT / ES**, pages d'information et mentions légales.
- Règles Firestore et Storage, fonctions serveur dédiées aux opérations sensibles.

> Les fonctions disponibles dans les fichiers et les tests ne prouvent pas, à elles seules, que tous les parcours sont validés en production. Les scénarios réels multi-comptes, la configuration Firebase et les autorisations doivent être testés avant publication ou ouverture au public.

## Structure du dépôt

```text
public/                 Interface HTML / CSS / JavaScript, i18n, service worker
functions/index.js      Fonctions Firebase côté serveur
functions/package.json  Dépendances et versions du backend
firestore.rules         Autorisations des données dans Firestore
storage.rules           Autorisations de stockage
firestore.indexes.json  Index Firestore
firebase.json           Cibles Firebase Hosting / Functions / Firestore
 tests/                 Tests Node.js (logique et régressions)
 scripts/scan-secrets.py Contrôle statique local des secrets évidents
 docs/                  Guides d'architecture, tests, sécurité et déploiement
```

## Démarrage rapide

**Prérequis :** Node.js récent, Firebase CLI, accès autorisé à un projet Firebase. Ne travaillez pas directement sur la production pour vos premiers essais.

```bash
node --test tests/*.test.js
python3 scripts/scan-secrets.py
cd functions && npm ci && cd ..
firebase login
firebase use --add
firebase emulators:start --only auth,firestore,functions,hosting
```

L'application front est servie depuis `public/` par Firebase Hosting ; il n'y a pas de build React. Les secrets des Functions doivent être configurés hors Git (voir guides). Le fichier `.firebaserc` est **volontairement absent**. Les tests statiques peuvent passer sans émulateurs ; ce ne sont pas des tests d'intégration sur une vraie base Firebase.

## Documentation

- [Architecture et flux](docs/ARCHITECTURE.md)
- [Installation et environnement](docs/INSTALLATION.md)
- [Sécurité et traitement des données](docs/SECURITE_DONNEES.md)
- [Stratégie de tests et limites](docs/TESTS_ET_QUALITE.md)
- [Procédure de déploiement](docs/DEPLOIEMENT.md)
- [Compétences démontrées / dossier universitaire](docs/COMPETENCES_ET_PARCOURS.md)
- [Politique de signalement](SECURITY.md)

## Vérification du dépôt préparé

- Tests Node.js exécutés sur la **copie nettoyée** : **257 réussites sur 257**, au 30/10/2026.
- Dépendances installées, caches Firebase, fichiers privés et anciens guides redondants retirés de l'archive destinée au versionnement.
- Les trois scripts PowerShell historiques conservés à la racine sont encore référencés par les tests ; **ne pas les lancer sans vérification des cibles et des règles de production**.
- Aucun audit exhaustif du cloud ou test réel avec deux comptes n'est revendiqué.

## Licence et publication

Projet personnel. **Tous droits réservés tant qu'aucune licence explicite n'est ajoutée.** Une mise en ligne du code n'autorise pas automatiquement sa réutilisation. Les informations publiques de contact présentes dans les pages sont destinées au site, pas à des usages commerciaux. Les éventuelles ressources tierces demeurent soumises à leurs propres conditions.
