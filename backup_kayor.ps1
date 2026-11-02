# ============================================================
# KAYOR — Sauvegarde hebdomadaire DU CODE
#
# ATTENTION, LISEZ CECI AVANT DE VOUS FIER A CE SCRIPT.
#
# Il compresse le DOSSIER DU PROJET et l'envoie par email. C'est une
# sauvegarde du CODE SOURCE. Elle ne contient AUCUNE DONNEE METIER :
# ni vente, ni cliente, ni compte epargne, ni caisse. Tout cela vit
# dans PostgreSQL chez Supabase, et ce script ne s'y connecte jamais.
#
# Constate le 2026-11-02. Le § 9 de CLAUDE.md soupconnait ce script
# d'echouer en silence a cause du mot de passe Gmail : c'est exact, et
# c'est accessoire. Meme en marchant parfaitement, il n'aurait jamais
# sauvegarde une seule ligne de la base.
#
# LA SAUVEGARDE DES DONNEES est ailleurs, depuis les migrations 035 et
# 036 : un instantane quotidien a 02h15, dans la table `sauvegardes`,
# consultable depuis la console operateur. Elle vit dans la base
# qu'elle protege : elle couvre l'erreur humaine, pas la perte du
# projet. Pour cela il faut le plan Pro de Supabase (§ 9).
#
# CE SCRIPT GARDE SON UTILITE : le projet n'est pas sous git — il n'y
# a pas de .git — donc cette archive est la seule copie du code en
# dehors du poste et du deploiement Vercel. Ne pas le supprimer sans
# avoir mis le code dans un depot.
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
