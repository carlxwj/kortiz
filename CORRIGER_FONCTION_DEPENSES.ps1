# Kortiz : corrige l'erreur « Confirmation reservee au createur et aux administrateurs »
# Executer depuis le dossier kortiz du DERNIER ZIP, dans PowerShell.
# Met a jour UNE SEULE fonction Cloud Run : approveGroupExpense.
$ErrorActionPreference = 'Stop'
$project = 'kortiz-de19f'
Set-Location $PSScriptRoot

if (-not (Test-Path './functions/index.js')) {
  Write-Host 'Dossier functions/index.js introuvable. Verifie le ZIP.' -ForegroundColor Red
  exit 1
}
if (-not (Get-Command firebase -ErrorAction SilentlyContinue)) {
  Write-Host 'Firebase CLI indisponible. Installe : npm install -g firebase-tools' -ForegroundColor Red
  exit 1
}
$source = Get-Content './functions/index.js' -Raw
if ($source -notmatch "operation=req.data\?\.operation") {
  Write-Host 'Le code du dossier n est pas la nouvelle version. Utilise le ZIP complet fourni.' -ForegroundColor Red
  exit 1
}
Write-Host 'Projet : kortiz-de19f' -ForegroundColor Cyan
Write-Host 'Fonction mise a jour : approveGroupExpense (europe-west1)' -ForegroundColor Cyan
Write-Host 'Les remboursements restent confirmes uniquement par un administrateur.'
Write-Host 'IMPORTANT : ton site doit deja utiliser la version actuelle de Kortiz.' -ForegroundColor Yellow
$answer = Read-Host 'Tape DEPLOYER pour continuer'
if ($answer -cne 'DEPLOYER') { Write-Host 'Annule.'; exit 1 }

Write-Host 'Installation des dependances...' -ForegroundColor Cyan
& npm --prefix functions ci
if ($LASTEXITCODE -ne 0) { Write-Host 'npm ci a echoue.' -ForegroundColor Red; exit $LASTEXITCODE }
Write-Host 'Publication de approveGroupExpense uniquement...' -ForegroundColor Cyan
& firebase deploy --only 'functions:approveGroupExpense' --project $project
if ($LASTEXITCODE -ne 0) {
  Write-Host 'La mise a jour de la Cloud Function a echoue. Copie le message rouge complet.' -ForegroundColor Red
  Write-Host 'Ne redeploie pas Hosting ou les regles pour contourner cette erreur.' -ForegroundColor Yellow
  exit $LASTEXITCODE
}
Write-Host 'Fonction publiee. Recharge Kortiz puis reteste avec un membre non admin.' -ForegroundColor Green
