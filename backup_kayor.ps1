# ============================================================
# KAYOR — Sauvegarde automatique hebdomadaire
# Compresse le dossier projet et envoie par email Gmail
# ============================================================

$ConfigFile = Join-Path $PSScriptRoot "config_backup.json"

if (-not (Test-Path $ConfigFile)) {
    Write-Host "ERREUR : config_backup.json introuvable dans $PSScriptRoot"
    exit 1
}

$Config = Get-Content $ConfigFile -Raw | ConvertFrom-Json

$EmailFrom         = $Config.emailFrom
$EmailTo           = $Config.emailTo
$AppPassword       = $Config.appPassword
$DossierProjet     = $Config.dossierProjet
$DossierSauvegardes = $Config.dossierSauvegardes
$NbGarder          = if ($Config.garderNbSauvegardes) { $Config.garderNbSauvegardes } else { 4 }

# Créer le dossier de sauvegardes s'il n'existe pas
if (-not (Test-Path $DossierSauvegardes)) {
    New-Item -ItemType Directory -Path $DossierSauvegardes -Force | Out-Null
}

# Nom du fichier ZIP avec la date
$DateStr   = Get-Date -Format "yyyy-MM-dd_HH-mm"
$NomZip    = "KAYOR_Backup_$DateStr.zip"
$CheminZip = Join-Path $DossierSauvegardes $NomZip

Write-Host "Compression en cours : $CheminZip"

try {
    Compress-Archive -Path $DossierProjet -DestinationPath $CheminZip -Force
    Write-Host "Compression réussie."
} catch {
    Write-Host "ERREUR compression : $_"
    exit 1
}

# Envoi par email via Gmail SMTP
Write-Host "Envoi email vers $EmailTo..."

try {
    $Credential = New-Object System.Management.Automation.PSCredential(
        $EmailFrom,
        (ConvertTo-SecureString $AppPassword -AsPlainText -Force)
    )

    $TailleKo = [math]::Round((Get-Item $CheminZip).Length / 1KB, 0)

    Send-MailMessage `
        -From    $EmailFrom `
        -To      $EmailTo `
        -Subject "KAYOR Sauvegarde — $DateStr" `
        -Body    "Sauvegarde automatique KAYOR du $DateStr.`n`nFichier : $NomZip`nTaille  : $TailleKo Ko`n`nCe message a été envoyé automatiquement." `
        -Attachments $CheminZip `
        -SmtpServer "smtp.gmail.com" `
        -Port       587 `
        -UseSsl `
        -Credential $Credential

    Write-Host "Email envoyé avec succès."
} catch {
    Write-Host "ERREUR envoi email : $_"
}

# Nettoyage : garder seulement les N dernières sauvegardes
$Fichiers = Get-ChildItem -Path $DossierSauvegardes -Filter "KAYOR_Backup_*.zip" |
            Sort-Object LastWriteTime -Descending

if ($Fichiers.Count -gt $NbGarder) {
    $ASupprimer = $Fichiers | Select-Object -Skip $NbGarder
    foreach ($f in $ASupprimer) {
        Remove-Item $f.FullName -Force
        Write-Host "Supprimé : $($f.Name)"
    }
}

Write-Host "Sauvegarde terminée."
