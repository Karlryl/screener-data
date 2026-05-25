$cred = "host=github.com`nprotocol=https`n" | git credential-manager get
$token = ($cred | Select-String -Pattern "password=(.+)").Matches.Groups[1].Value
$env:GH_TOKEN = $token
Set-Location "C:\Users\Karlr\OneDrive\Dokumente\GitHub\screener-data"
Write-Host "=== Status of both runs ==="
foreach ($id in @("26046510248", "26051705062")) {
  $info = gh api repos/Karlryl/screener-data/actions/runs/$id --jq "{id, status, conclusion, head_sha}" | ConvertFrom-Json
  $concl = $info.conclusion
  if (-not $concl) { $concl = "pending" }
  $sha = $info.head_sha.Substring(0, 9)
  Write-Host ("  $($info.id): status=$($info.status), conclusion=$concl, sha=$sha")
}
Write-Host ""
Write-Host "=== Current HEAD on main ==="
git rev-parse HEAD
