# Rebuild the Roller Clone test site (production build behind the Tailscale Funnel link)
# and restart it. Local `yarn dev` on :3000 and other projects' test sites are unaffected.
# Usage: yarn test-site:update
$ErrorActionPreference = 'Stop'
$TaskName = 'Roller Clone test site'
$Port = 3200
$PublicUrl = 'https://desktop-lpr20u3.tail38d2bd.ts.net:8443'
$Log = Join-Path $env:LOCALAPPDATA 'roller-clone\test-site.log'

$ProjectDir = Split-Path $PSScriptRoot -Parent
Set-Location $ProjectDir

if (-not (Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue)) {
  throw "Scheduled task '$TaskName' is missing. Re-run the test-site setup."
}

Write-Host "==> Stopping test site on port $Port"
Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
# Only processes started for this project's `next start -p 3200` (never `next dev`, never port 3100).
$escapedDir = [regex]::Escape($ProjectDir)
# Windows may record the command line with quotes inside the path (ROLLER" APP "CLONE).
function Get-CleanCommandLine($proc) { ([string]$proc.CommandLine) -replace '"', '' }
function Stop-ProcessTree([int]$processId) {
  # Via cmd so taskkill's "not found" stderr can never become a terminating PowerShell error.
  cmd.exe /c "taskkill /PID $processId /T /F >nul 2>&1"
}
Get-CimInstance Win32_Process -Filter "Name='conhost.exe' OR Name='cmd.exe' OR Name='node.exe'" |
  Where-Object {
    $cmd = Get-CleanCommandLine $_
    $cmd -match "next\S* start -p $Port\b" -and $cmd -match $escapedDir
  } |
  ForEach-Object { Stop-ProcessTree $_.ProcessId }
Start-Sleep -Seconds 2
Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue |
  ForEach-Object {
    $proc = Get-CimInstance Win32_Process -Filter "ProcessId=$($_.OwningProcess)"
    if (-not $proc) { return }
    if ((Get-CleanCommandLine $proc) -match $escapedDir) { Stop-ProcessTree $proc.ProcessId }
    else { throw "Port $Port is used by another program: $($proc.CommandLine)" }
  }
Start-Sleep -Seconds 2
if (Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue) {
  throw "Port $Port is still in use after stopping the old test site."
}

Write-Host '==> Building (this takes a few minutes; the client link is offline meanwhile)'
yarn build
if ($LASTEXITCODE -ne 0) {
  throw 'Build failed. The test site was NOT restarted. Fix the errors above and run yarn test-site:update again.'
}

Write-Host '==> Starting test site'
$startedAfter = Get-Date
Start-ScheduledTask -TaskName $TaskName
for ($i = 0; $i -lt 60; $i++) {
  $responded = $false
  try {
    Invoke-WebRequest "http://localhost:$Port/home" -UseBasicParsing -TimeoutSec 15 | Out-Null
    $responded = $true
  } catch {
    Start-Sleep -Seconds 3
  }
  if ($responded) {
    $listener = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
    $serverProc = if ($listener) { Get-Process -Id $listener.OwningProcess -ErrorAction SilentlyContinue }
    if ($serverProc -and $serverProc.StartTime -lt $startedAfter) {
      throw "An old test-site process (PID $($serverProc.Id)) is still serving port $Port - the new build is not live."
    }
    Write-Host "==> Test site is up: $PublicUrl"
    exit 0
  }
}
throw "Test site did not respond on port $Port. Check the log: $Log"
