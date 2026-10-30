# Menaces, confidentialité et mesures de sécurité — Kortiz

## Modèle de menace

Principales surfaces : accès non autorisé à un groupe, usurpation de rôle, modification frauduleuse des montants ou remboursements, divulgation de messages privés, dépense de quota, abus des Cloud Functions, fuite de variables locales et mauvaises permissions Firebase.

## Mesures présentes dans les sources

- Règles Firestore/Storage versionnées et backend pour les opérations sensibles.
- Authentification Firebase et contrôles d'appartenance/role visibles dans les fonctions.
- Tests de non-régression pour les comptes, dépenses, paiements déclarés, groupes, messages et sondages.
- En-têtes HTTP de protection configurés dans `firebase.json`, notamment CSP, `X-Content-Type-Options` et anti-embedding.

Ce sont des **observations sur le code**, non la preuve d'un déploiement sûr. Vérifier la configuration réelle des permissions, App Check, quotas, Auth, API keys et Cloud Functions dans la console.

## Données à NE PAS pousser sur GitHub

`functions/.env`, `.firebaserc`, caches `.firebase/`, exports de Firestore, captures d'écran de la console, token de session, fichier de compte de service, clés privées, listes de comptes, coordonnées bancaires, exports des messages, journaux contenant identifiants et appels API. Le `.gitignore` couvre plusieurs cas, mais utiliser aussi le scanner avant chaque commit.

## Firebase : comprendre les clés

Une clé `apiKey` Firebase **web** et un identifiant de site reCAPTCHA public peuvent être présents dans du JS client. Ils **ne sont pas** des mots de passe. Ils ne dispensent pas de mettre en place les règles d'accès, les restrictions pertinentes et App Check. **Les secrets Cloud Functions, tokens OAuth privés et clés de service ne doivent jamais être dans le client.**

## Checklist avant publication

1. Restaurer le minimum d'accès nécessaires aux comptes de test ; vérifier les règles avec deux identités et des rôles différents.
2. Contrôler les règles de lecture des conversations privées, votes, profils et exports.
3. Tester les fonctions contre des IDs arbitraires, montants négatifs/excessifs, répétition de demandes et accès hors groupe.
4. Vérifier les paramètres de sauvegarde, suppression/anonymisation, consentement et journalisation.
5. Activer les protections GitHub disponibles ; analyser également **l'historique Git existant**.
6. Révoquer immédiatement toute clé serveur réellement exposée, **même si le fichier a été ensuite supprimé**.
7. Vérifier la conformité juridique et le traitement RGPD ; un audit de code ne vaut pas conformité réglementaire.

## Ce qui n'a pas été vérifié

Cloud Firebase de production, données réelles, droits d'administration, certificats/domaine, sécurité des appareils des utilisateurs, tests de pénétration, intégration de paiement (il n'en existe pas), audit exhaustif des dépendances ni suppression d'anciens commits GitHub.
