# Déploiement prudent — Kortiz

> **À ne pas exécuter automatiquement depuis un dépôt importé.** La configuration Firebase contient des règles d'accès et des fonctions manipulant des données financières déclaratives.

1. Faire une sauvegarde des règles et de la configuration **actuellement déployées**. Contrôler leur différence avec `firestore.rules` et `storage.rules` ; ne jamais écraser une règle de production simplement parce que ce dépôt contient une version différente.
2. Vérifier `firebase use` et confirmer que les secrets backend requis sont provisionnés **hors Git**.
3. Exécuter `node --test tests/*.test.js` et `python3 scripts/scan-secrets.py`.
4. Tester les changements sur un projet Firebase de développement / émulateurs avec **deux comptes**.
5. En production, déployer uniquement les éléments autorisés, dans le bon ordre de dépendances. Pour l'évolution v28 liée aux règles et à la suppression des comptes : règles Firestore, Cloud Function `deleteAccount`, puis Hosting, après vérification de compatibilité.
6. Surveiller logs d'erreur, authentification et quotas, **sans** enregistrer de données privées dans GitHub.

Exemples indicatifs à adapter après validation :

```bash
firebase use
firebase deploy --only firestore:rules
firebase deploy --only functions:deleteAccount
firebase deploy --only hosting
```

Attention : les scripts PowerShell hérités existent pour permettre les contrôles de régression, mais peuvent se référer à des versions ou fonctionnalités anciennes. Ils ne doivent pas remplacer une revue humaine des changements. En cas de doute, ne déployez pas.
