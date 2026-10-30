# Kortiz — déploiement progressif de Cloud Functions, sans changement de facturation.
# Depuis PowerShell à la racine du projet :
# .\DEPLOYER_SANS_COMPTE_COMPLET.ps1 -Preview
# .\DEPLOYER_SANS_COMPTE_COMPLET.ps1
# .\DEPLOYER_SANS_COMPTE_COMPLET.ps1 -OnlyFailed
param(
  [switch]$Preview,
  [switch]$OnlyFailed
)

$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot
$project = 'kortiz-de19f'
if (!(Test-Path 'firebase.json') -or !(Test-Path 'functions/index.js')) {
  throw 'Exécute ce script dans le dossier kortiz contenant firebase.json.'
}

# D'abord les fonctions déjà en ligne : les rendre plus légères libère du quota.
# On conserve leur nom et leur région : pas de migration de Firestore.
$deployed = @(
  'approveGroupExpense', 'blockUser', 'cancelConfirmedSettlement',
  'createMoneyRequest', 'deleteGroup', 'getInvite', 'joinGroup',
  'onDirectChatMessage', 'onExpenseWritten', 'onGroupChatMessage',
  'onSettlementCreated', 'openDirectChat', 'removeFriend',
  'reportChatMessage', 'requestGroupSettlement', 'respondFriendRequest',
  'respondGroupSettlement', 'saveSocialProfile', 'sendChatMessage',
  'updateMoneyRequest'
)
# Fonctions qui ont échoué dans tes captures ou n'avaient pas encore été créées.
$pending = @('deleteAccount', 'recurringExpenses', 'sendFriendRequest',
  'setGroupAdmin', 'deleteChatMessage')
$targets = if ($OnlyFailed) { $pending } else { $deployed + $pending }

Write-Host "Projet cible : $project" -ForegroundColor Cyan
Write-Host "Fonctions : $($targets.Count), deployees successivement (une a la fois)." -ForegroundColor Cyan
Write-Host 'Ce script ne supprime aucune fonction, ne deploie pas Hosting et ne change pas le plan de facturation.'
if ($Preview) {
  foreach ($fn in $targets) { Write-Host "firebase deploy --project $project --only functions:$fn" }
  return
}
if (!(Get-Command firebase -ErrorAction SilentlyContinue)) {
  throw 'Firebase CLI introuvable. Lance npm install -g firebase-tools puis firebase login.'
}
if (!(Test-Path 'functions/node_modules/firebase-functions/package.json')) {
  Write-Host 'Installation des dependances Firebase Functions...'
  & npm --prefix functions ci
  if ($LASTEXITCODE -ne 0) { throw "npm ci a echoue (code $LASTEXITCODE)." }
}
Write-Host 'Le premier deploiement peut encore echouer si la revision actuelle occupe tout le quota.' -ForegroundColor Yellow
$confirmation = Read-Host 'Pour commencer les deploiements sur ton projet reel, tape OUI'
if ($confirmation -cne 'OUI') { Write-Host 'Annule.'; return }

$ok = 0
foreach ($fn in $targets) {
  Write-Host "`n[$($ok + 1)/$($targets.Count)] Deploiement : $fn" -ForegroundColor Cyan
  & firebase deploy --project $project --only "functions:$fn" --non-interactive
  if ($LASTEXITCODE -ne 0) {
    Write-Host "`nARRET apres echec de $fn. Pas de relance automatique." -ForegroundColor Red
    Write-Host 'Voir firebase-debug.log, et le quota CPU Cloud Run europe-west1.'
    Write-Host "Les $ok deploiements precedents ont ete valides par Firebase CLI."
    exit 1
  }
  $ok++
}
Write-Host "`nDeploiement demande termine : $ok / $($targets.Count) fonctions." -ForegroundColor Green
Write-Host 'Teste ensuite les chats, remboursements, comptes et permissions avec plusieurs utilisateurs.'
