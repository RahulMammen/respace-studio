# ReSpace Studio - start the production build.
#   powershell -ExecutionPolicy Bypass -File scripts/start.ps1          # this computer only
#   powershell -ExecutionPolicy Bypass -File scripts/start.ps1 -Lan     # also same-network testers
# LAN mode listens on all interfaces over plain HTTP. It never changes firewall settings:
# if Windows asks whether to allow Python on private networks, that choice is yours.
param([switch]$Lan, [int]$Port = 8000, [switch]$Rebuild)
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
if ($Rebuild -or -not (Test-Path "$root/frontend/dist/index.html")) {
  Push-Location "$root/frontend"; npm run build; Pop-Location
}
Set-Location "$root/backend"
$pyArgs = @("-m", "app.serve", "--port", "$Port")
if ($Lan) { $pyArgs += "--lan" }
& .venv/Scripts/python.exe @pyArgs
