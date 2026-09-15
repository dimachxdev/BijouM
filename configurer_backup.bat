@echo off
:: ============================================================
:: KAYOR — Installation de la tâche planifiée Windows
:: Lance la sauvegarde automatique chaque Lundi à 08h00
:: EXÉCUTER EN TANT QU'ADMINISTRATEUR
:: ============================================================

echo =============================================
echo  KAYOR - Configuration Sauvegarde Auto
echo =============================================
echo.

:: Vérifier les droits admin
net session >nul 2>&1
if %errorLevel% neq 0 (
    echo ERREUR : Ce script doit etre execute en tant qu'Administrateur.
    echo Clic droit sur le fichier > "Executer en tant qu'administrateur"
    pause
    exit /b 1
)

set "SCRIPT_DIR=%~dp0"
set "PS_SCRIPT=%SCRIPT_DIR%backup_kayor.ps1"
set "TASK_NAME=KAYOR_Sauvegarde_Hebdomadaire"

:: Supprimer l'ancienne tâche si elle existe
schtasks /delete /tn "%TASK_NAME%" /f >nul 2>&1

:: Créer la nouvelle tâche — chaque Lundi à 08:00
schtasks /create ^
    /tn "%TASK_NAME%" ^
    /tr "powershell.exe -ExecutionPolicy Bypass -WindowStyle Hidden -File \"%PS_SCRIPT%\"" ^
    /sc WEEKLY ^
    /d MON ^
    /st 08:00 ^
    /ru SYSTEM ^
    /f

if %errorLevel% equ 0 (
    echo.
    echo [OK] Tâche planifiee creee avec succes !
    echo      Nom   : %TASK_NAME%
    echo      Quand : Chaque Lundi a 08h00
    echo      Script: %PS_SCRIPT%
) else (
    echo [ERREUR] Impossible de creer la tâche planifiee.
    pause
    exit /b 1
)

echo.
echo =============================================
echo  Voulez-vous tester la sauvegarde maintenant ?
echo  (Appuyez sur O puis Entree pour tester)
echo =============================================
set /p TESTER=Tester maintenant ? (O/N) :

if /i "%TESTER%"=="O" (
    echo.
    echo Lancement du test...
    powershell.exe -ExecutionPolicy Bypass -File "%PS_SCRIPT%"
    echo.
    echo Test termine. Verifiez le dossier Sauvegardes Kayor.
)

echo.
echo Configuration terminee !
echo N'oubliez pas de remplir config_backup.json avec votre email et mot de passe d'application Gmail.
pause
