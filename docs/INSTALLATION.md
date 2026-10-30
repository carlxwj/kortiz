# Installation locale — Kortiz

## 1. Prérequis

- Node.js 22 ou version compatible et npm.
- Compte Firebase autorisé, Firebase CLI installée (`npm install -g firebase-tools`).
- Navigateur moderne. Pour les notifications web, utiliser `localhost` ou HTTPS et configurer Messaging.
- Projet Firebase **de développement distinct de la production** conseillé.

## 2. Préparer l'environnement

```bash
cd kortiz
node --test tests/*.test.js
cd functions
npm ci
cd ..
firebase login
firebase use --add
```

`firebase use --add` crée un fichier `.firebaserc` **local et ignoré par Git**. Vérifier le projet actuellement sélectionné (`firebase use`) avant toute écriture, surtout si vous gérez plusieurs environnements.

Le code navigateur actuel contient des identifiants de configuration Firebase destinés au SDK client et potentiellement un identifiant App Check public. **Ils ne sont pas des credentials serveur.** Pour isoler un nouvel environnement, adaptez ces identifiants clients et la configuration Messaging ; ne remplacez pas les règles d'accès par des règles ouvertes.

La configuration non secrète est décrite dans `functions/.env.example` : copiez ce modèle dans `functions/.env` (fichier ignoré par Git) et vérifiez `ENFORCE_APP_CHECK` selon votre environnement. Les valeurs de `functions/.env` sont **exclues du dépôt**. Reconstituez les variables strictement nécessaires au backend à partir de votre gestionnaire de secrets Firebase / Google Cloud, sans copier de véritables secrets dans la documentation. Examinez `functions/index.js` et les variables utilisées avant de lancer des fonctions connectées à un projet réel.

## 3. Tester sans écrire dans le cloud

```bash
node --test tests/*.test.js
python3 scripts/scan-secrets.py
firebase emulators:start --only auth,firestore,functions,hosting
```

Lancer un compte de test isolé, vérifier les permissions entre deux identités et enregistrer les résultats. Les tests de ce dépôt sont majoritairement statiques ou unitaires : le fait qu'ils passent n'implique pas une émulation complète ni une validation du déploiement.

## 4. Particularités

- Le site public est en HTML/CSS/JS : pas de `npm run build` front par défaut.
- Les Cloud Functions ont leur propre `package-lock.json` ; `npm ci` doit être lancé dans `functions/`.
- Le formulaire de contact existant et ses fichiers ne doivent pas être remplacés automatiquement.
- Conserver `.firebaserc`, `.env*`, journaux et caches seulement en local.
- Éviter de lancer les scripts `DEPLOYER_*.ps1` historiquement conservés sans revoir leurs noms de fonction, cibles et effets.
