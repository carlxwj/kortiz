# Politique de sécurité

- Ne publiez **jamais** d'identifiants, de jetons, de mots de passe, de fichiers `.env*` réels, de comptes de service ni de journaux contenant des informations personnelles.
- Signalez toute vulnérabilité **en privé** au propriétaire du dépôt via les canaux de contact GitHub disponibles. N'ouvrez pas d'issue publique contenant un secret exploitable.
- Avant chaque `git push`, exécutez `npm run`/les tests applicables et `python3 scripts/scan-secrets.py`.
- Activez sur GitHub : **Secret scanning**, **push protection**, **Dependabot alerts**, authentification à deux facteurs et restrictions de permissions des Actions si ces options sont disponibles.
- Les fichiers `.gitignore` n'effacent pas les secrets déjà envoyés dans l'historique Git. Après une exposition : révoquez/renouvelez les accès, puis traitez l'historique compromis.
- Aucune garantie de sécurité absolue n'est donnée : l'audit local ne remplace pas un pentest, une revue des règles cloud, ni un scan de l'historique Git.
