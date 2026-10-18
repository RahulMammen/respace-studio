# ReSpace Studio - one-time local setup on Windows (PowerShell).
# Creates the Python virtual environment, installs dependencies, builds the frontend
# and creates backend/.env from the example if it does not exist yet.
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

Write-Host "Backend: creating virtual environment (Python 3.12)..."
if (-not (Test-Path "backend/.venv")) { py -3.12 -m venv backend/.venv }
& backend/.venv/Scripts/python.exe -m pip install --upgrade pip | Out-Null
& backend/.venv/Scripts/python.exe -m pip install -e "backend[dev]"

if (-not (Test-Path "backend/.env")) {
  Write-Host "Creating backend/.env from backend/.env.example (git-ignored)..."
  $secret = & backend/.venv/Scripts/python.exe -c "import secrets; print(secrets.token_urlsafe(48))"
  (Get-Content backend/.env.example) -replace '^SESSION_SECRET=$', "SESSION_SECRET=$secret" | Set-Content -Encoding utf8 backend/.env
}

Write-Host "Frontend: installing packages and building..."
Set-Location frontend
npm ci
npm run build
Set-Location $root

Write-Host ""
Write-Host "Setup complete."
Write-Host "Optional: add your Gemini key to backend/.env (GEMINI_API_KEY=...). Never commit that file."
Write-Host "Start the app:  powershell -ExecutionPolicy Bypass -File scripts/start.ps1"
