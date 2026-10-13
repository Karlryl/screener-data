@echo off
rem Ein-Klick-Starter: Codex im Masterplan-Modus (Regeln: AGENTS.md)
rem --sandbox workspace-write explizit, damit Codex im Repo schreiben darf
rem (Config allein reichte nicht: TUI-Session lief am 15.07. read-only an).
rem Lock-Praeambel (Zwei-Motoren-Betrieb 16.07.): laeuft eine Claude-Delegation,
rem darf hier kein zweiter Codex in denselben Working Tree fahren.
if exist "%USERPROFILE%\.codex\delegation-locks\screener-data.lock.json" (
  echo.
  echo  DELEGATION AKTIV - Masterplan-Start abgebrochen.
  echo  Sag Claude: "Delegations-Lock fuer screener-data aufloesen"
  echo  und starte danach diese Datei nochmal.
  echo.
  pause
  exit /b 1
)
cd /d "%~dp0"
codex --sandbox workspace-write -a on-request masterplan
