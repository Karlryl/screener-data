@echo off
rem Ein-Klick-Starter: Codex im Masterplan-Modus (Regeln: AGENTS.md)
rem --sandbox workspace-write explizit, damit Codex im Repo schreiben darf
rem (Config allein reichte nicht: TUI-Session lief am 15.07. read-only an).
cd /d "%~dp0"
codex --sandbox workspace-write -a on-request masterplan
