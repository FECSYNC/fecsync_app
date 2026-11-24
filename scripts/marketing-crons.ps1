# Guest marketing cron runner for this Windows machine (the Tailscale test site).
#
#   yarn marketing:crons             run newsletter campaigns + lifecycle automations once
#   yarn marketing:crons:register    install Windows scheduled tasks
#                                    (newsletters every 15 min, automations daily at 10:00)
#
# Reads CRON_SECRET from .env.local; the secret is never printed.
param(
  [switch]$Register,
  [ValidateSet('all', 'campaigns', 'automations')]
  [string]$Job = 'all',
  [string]$BaseUrl = 'http://localhost:3200'
)
$ErrorActionPreference = 'Stop'
$ProjectDir = Split-Path $PSScriptRoot -Parent
$ScriptPath = Join-Path $PSScriptRoot 'marketing-crons.ps1'

if ($Register) {
  $ps = (Get-Command powershell.exe).Source
  # conhost --headless: Windows Terminal ignores -WindowStyle Hidden and would pop up a blank window.
  $host_ = Join-Path $env:SystemRoot 'System32\conhost.exe'
  $common = "--headless `"$ps`" -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$ScriptPath`" -BaseUrl $BaseUrl"
  $settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -MultipleInstances IgnoreNew `
    -ExecutionTimeLimit (New-TimeSpan -Minutes 10)

  $campaignAction = New-ScheduledTaskAction -Execute $host_ -Argument "$common -Job campaigns" -WorkingDirectory $ProjectDir
  $campaignTrigger = New-ScheduledTaskTrigger -Once -At (Get-Date).Date `
    -RepetitionInterval (New-TimeSpan -Minutes 15) -RepetitionDuration (New-TimeSpan -Days 3650)
  Register-ScheduledTask -TaskName 'Roller Clone marketing newsletters' -Action $campaignAction `
    -Trigger $campaignTrigger -Settings $settings -Force | Out-Null

  $autoAction = New-ScheduledTaskAction -Execute $host_ -Argument "$common -Job automations" -WorkingDirectory $ProjectDir
  $autoTrigger = New-ScheduledTaskTrigger -Daily -At '10:00'
  Register-ScheduledTask -TaskName 'Roller Clone marketing automations' -Action $autoAction `
    -Trigger $autoTrigger -Settings $settings -Force | Out-Null

  Write-Host "==> Registered 'Roller Clone marketing newsletters' (every 15 min) and 'Roller Clone marketing automations' (daily 10:00) against $BaseUrl"
  exit 0
}

$envFile = Join-Path $ProjectDir '.env.local'
if (-not (Test-Path $envFile)) { throw ".env.local not found in $ProjectDir" }
$line = Get-Content $envFile | Where-Object { $_ -match '^\s*CRON_SECRET\s*=' } | Select-Object -First 1
if (-not $line) {
  throw 'CRON_SECRET is missing from .env.local. Add CRON_SECRET=<long random string>, then rebuild/restart the site (yarn test-site:update).'
}
$secret = ($line -split '=', 2)[1].Trim().Trim('"').Trim("'")
$headers = @{ Authorization = "Bearer $secret" }

$logDir = Join-Path $env:LOCALAPPDATA 'roller-clone'
New-Item -ItemType Directory -Force -Path $logDir | Out-Null
$log = Join-Path $logDir 'marketing-crons.log'

$paths = switch ($Job) {
  'campaigns' { @('/api/cron/marketing-campaigns') }
  'automations' { @('/api/cron/marketing-automations') }
  default { @('/api/cron/marketing-campaigns', '/api/cron/marketing-automations') }
}

$failed = $false
foreach ($path in $paths) {
  $stamp = Get-Date -Format 'yyyy-MM-dd HH:mm:ss'
  try {
    $res = Invoke-WebRequest -Uri "$BaseUrl$path" -Headers $headers -Method Get -UseBasicParsing -TimeoutSec 180
    $msg = "$stamp OK  $path $($res.Content)"
  } catch {
    $failed = $true
    $msg = "$stamp ERR $path $($_.Exception.Message)"
  }
  Add-Content -Path $log -Value $msg
  Write-Host $msg
}
if ($failed) { exit 1 }
