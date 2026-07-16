@echo off
rem Ein-Klick (optional): fuehrt eine von Claude VORBEREITETE Codex-Delegation aus
rem (pending-Lock + Brief liegen schon da), inkl. Waechter-Wrapper und token-freier
rem Versiegelung. Das inhaltliche Review macht Claude in der naechsten Session.
set REPO=C:\Users\Anwender\OneDrive\Dokumente\GitHub\screener-data
set LOCK=%USERPROFILE%\.codex\delegation-locks\screener-data.lock.json
if not exist "%LOCK%" (
  echo Kein vorbereiteter Auftrag vorhanden.
  echo Sag Claude: "codex: <aufgabe>" - er bereitet Brief und Lock vor.
  pause
  exit /b 1
)
echo Starte Codex-Delegation (Fenster offen lassen, Codex arbeitet)...
powershell -NoProfile -ExecutionPolicy Bypass -File "%USERPROFILE%\.claude\skills\codex-delegieren\codex-run.ps1" -Repo "%REPO%" -Lock "%LOCK%"
powershell -NoProfile -ExecutionPolicy Bypass -File "%USERPROFILE%\.claude\skills\codex-delegieren\gate-check.ps1" -Mode Seal -Repo "%REPO%"
echo.
echo Fertig und versiegelt. Claude reviewt beim naechsten Start automatisch.
pause
