# Removes DATABASE_URL from Windows environment so .env.local is the only source.
# Run once:  powershell -ExecutionPolicy Bypass -File scripts/remove-shell-database-url.ps1

$removed = @()

if ([Environment]::GetEnvironmentVariable('DATABASE_URL', 'User')) {
  [Environment]::SetEnvironmentVariable('DATABASE_URL', $null, 'User')
  $removed += 'User'
}

if ([Environment]::GetEnvironmentVariable('DATABASE_URL', 'Machine')) {
  $needsAdmin = -not ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
  if ($needsAdmin) {
    Write-Host "Machine-level DATABASE_URL found - re-run this script as Administrator to remove it."
  } else {
    [Environment]::SetEnvironmentVariable('DATABASE_URL', $null, 'Machine')
    $removed += 'Machine'
  }
}

Remove-Item Env:DATABASE_URL -ErrorAction SilentlyContinue

if ($removed.Count -gt 0) {
  Write-Host "Removed DATABASE_URL from: $($removed -join ', '). Restart terminals and yarn dev."
} else {
  Write-Host "No persistent DATABASE_URL found in User or Machine environment."
}

Write-Host "Current session DATABASE_URL: $(if ($env:DATABASE_URL) { 'still set - close and reopen terminal' } else { 'cleared' })"
