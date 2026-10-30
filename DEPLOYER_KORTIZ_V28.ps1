# Kortiz v28 - deployment progressif pour le projet Firebase existant.
# Lancement depuis le dossier kortiz : .\DEPLOYER_KORTIZ_V28.ps1
# Ne déploie PAS tout le codebase fonctions en une seule fois (quota Cloud Run).
$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot
$Project = 'kortiz-de19f'

Write-Host 'Kortiz v28 - déploiement progressif (fonctions + règles + hosting)' -ForegroundColor Cyan
Write-Host 'Projet Firebase cible :' $Project
Write-Host 'À faire AVANT : sauvegarder votre version actuelle et vérifier les règles.' -ForegroundColor Yellow
$reply = Read-Host 'As-tu sauvegardé ta version existante ? Tape DEPLOYER pour continuer'
if ($reply -cne 'DEPLOYER') { Write-Host 'Déploiement annulé.'; exit 0 }

if (-not (Get-Command firebase -ErrorAction SilentlyContinue)) {
  throw 'Firebase CLI introuvable : installe firebase-tools ou ouvre un terminal avec Firebase CLI.'
}
if (-not (Test-Path 'functions\node_modules\firebase-admin')) {
  Write-Host 'Installation des dépendances Functions (npm ci)...' -ForegroundColor Cyan
  & npm --prefix functions ci
  if ($LASTEXITCODE -ne 0) { throw 'npm ci a échoué. Résous cette erreur avant tout déploiement.' }
}

# 10 fonctions EXISTANTES concernées. Les quotas du projet sont respectés en
# limitant le déploiement à une fonction par commande, sans introduire de service.
$functions = @(
  'joinGroup',
  'deleteAccount',
  'approveGroupExpense',
  'createMoneyRequest',
  'updateMoneyRequest',
  'requestGroupSettlement',
  'onExpenseWritten',
  'onSettlementCreated',
  'onGroupChatMessage',
  'onDirectChatMessage'
)
foreach ($name in $functions) {
  Write-Host "`n[Functions] Mise à jour : $name" -ForegroundColor Cyan
  & firebase deploy --only "functions:$name" --project $Project
  if ($LASTEXITCODE -ne 0) {
    Write-Host "ÉCHEC : $name. Ne poursuis pas vers les règles ou Hosting." -ForegroundColor Red
    Write-Host 'Une erreur HTTP 409 / quota ? Attends que la précédente opération soit terminée puis relance la commande ciblée.' -ForegroundColor Yellow
    exit $LASTEXITCODE
  }
}

Write-Host "`n[Firestore] Mise à jour des règles..." -ForegroundColor Cyan
& firebase deploy --only 'firestore:rules' --project $Project
if ($LASTEXITCODE -ne 0) { throw 'Échec règles Firestore. Hosting non déployé.' }

Write-Host "`n[Storage] Mise à jour des règles..." -ForegroundColor Cyan
& firebase deploy --only 'storage' --project $Project
if ($LASTEXITCODE -ne 0) { throw 'Échec règles Storage. Hosting non déployé.' }

Write-Host "`n[Hosting] Publication de l’interface..." -ForegroundColor Cyan
& firebase deploy --only 'hosting' --project $Project
if ($LASTEXITCODE -ne 0) { throw 'Échec déploiement Hosting.' }

Write-Host "`nTerminé. Tests manuels à réaliser : LIRE_AVANT_DEPLOIEMENT_V28.md" -ForegroundColor Green
