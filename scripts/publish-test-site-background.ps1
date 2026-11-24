# Rebuild the production test site in the background while the Tailscale link
# temporarily serves `yarn dev` (port 3000); switch the link back to :3200 when done.
#   powershell -ExecutionPolicy Bypass -File scripts/publish-test-site-background.ps1
$ErrorActionPreference = 'Continue'
$ProjectDir = Split-Path $PSScriptRoot -Parent
Set-Location $ProjectDir
$log = Join-Path $env:LOCALAPPDATA 'roller-clone\publish-background.log'
New-Item -ItemType Directory -Force -Path (Split-Path $log) | Out-Null
function Log($m) { Add-Content -Path $log -Value "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') $m" }

Log 'Rebuild started (link is serving yarn dev on :3000 meanwhile)'
& powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot 'test-site-update.ps1') *>> $log
if ($LASTEXITCODE -eq 0) {
  & tailscale funnel --bg --https=8443 http://127.0.0.1:3200 *>> $log
  Log 'DONE - link switched back to the production build on :3200'
} else {
  Log "FAILED (exit $LASTEXITCODE) - link still serves yarn dev on :3000. See messages above."
}
