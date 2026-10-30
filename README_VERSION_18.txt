KORTIZ V18 — DETTES SUIVIES APRÈS DÉPART

1) Ouvre LIRE_AVANT_DEPLOIEMENT_V18.md.
2) Sauvegarde le projet et les données avant tout déploiement.
3) Teste sur un projet Firebase de test avec deux comptes.
4) Pour le projet kortiz-de19f, lance UNIQUEMENT :

   .\DEPLOYER_DETTES_HORS_GROUPE.ps1

Ce script déploie 10 fonctions EXISTANTES, puis les règles Firestore, puis Hosting.
Ne lance pas un ancien DEPLOYER_*.ps1 de l'archive pour cette fonctionnalité.
Aucun virement bancaire n'est exécuté par Kortiz. Toutes les confirmations
restent déclaratives et les dettes n'ont pas de valeur de titre exécutoire.
