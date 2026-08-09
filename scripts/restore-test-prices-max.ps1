# restore-test-prices-max.ps1
# Restore-Test fuer das prices-max-Backup (Masterplan-Befund d, Karl waehlte OneDrive).
# Prueft Count und Bytes vollstaendig sowie den Inhalt einer 20-Dateien-Stichprobe.
# READ-ONLY gegenueber dem Original bis zum bewussten Move; NICHTS wird geloescht.
#
# Aufruf:  powershell -File scripts/restore-test-prices-max.ps1 -BackupDir <pfad-zur-kopie>
# Beispiel (nachdem OneDrive den Ordner in die Cloud gespiegelt hat und du eine
# lokale Zweitkopie ziehen willst): erst robocopy prices-max <BackupDir> /MIR, dann dieses Skript.

param(
  [Parameter(Mandatory = $true)][string]$BackupDir,
  [string]$Original = "$PSScriptRoot\..\prices-max"
)
$ErrorActionPreference = 'Stop'
$Original = (Resolve-Path $Original).Path

function Stat($dir) {
  $files = Get-ChildItem $dir -Recurse -File
  [pscustomobject]@{
    Count = $files.Count
    Bytes = ($files | Measure-Object Length -Sum).Sum
    # Stichproben-Hash ueber 20 gleichmaessig verteilte Dateien (deterministisch)
    Sample = ($files | Sort-Object Name | Where-Object { $_ } |
      Select-Object -Index (0..19 | ForEach-Object { [int]($_ * [Math]::Max(1,[Math]::Floor($files.Count/20))) } | Where-Object { $_ -lt $files.Count }) |
      ForEach-Object { (Get-FileHash $_.FullName -Algorithm SHA256).Hash }) -join ''
  }
}

Write-Host "== Restore-Test prices-max ==" -ForegroundColor Cyan
if (-not (Test-Path $BackupDir)) { Write-Error "BackupDir existiert nicht: $BackupDir"; exit 1 }

$o = Stat $Original
$b = Stat $BackupDir
Write-Host ("Original: {0} Dateien, {1:N0} Bytes" -f $o.Count, $o.Bytes)
Write-Host ("Backup:   {0} Dateien, {1:N0} Bytes" -f $b.Count, $b.Bytes)

$ok = ($o.Count -eq $b.Count) -and ($o.Bytes -eq $b.Bytes) -and ($o.Sample -eq $b.Sample)
if ($ok) {
  Write-Host ("GRUEN: Count+Bytes vollstaendig identisch; Inhalt: Stichprobe {0}/{1} Dateien identisch - KEIN Vollbeweis." -f ([Math]::Min(20, $o.Count)), $o.Count) -ForegroundColor Green
  exit 0
} else {
  Write-Host "ROT: Backup weicht ab (Count/Bytes/Sample) - NICHT vertrauen." -ForegroundColor Red
  if ($o.Count -ne $b.Count) { Write-Host "  Count-Diff: $($o.Count) vs $($b.Count)" }
  if ($o.Bytes -ne $b.Bytes) { Write-Host "  Bytes-Diff: $($o.Bytes) vs $($b.Bytes)" }
  if ($o.Sample -ne $b.Sample) { Write-Host "  Stichproben-Hash weicht ab" }
  exit 1
}
