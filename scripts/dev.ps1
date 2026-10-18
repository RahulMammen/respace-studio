# ReSpace Studio - development mode with hot reload.
# Opens the API (port 8000) in a new window and the Vite dev server (port 5173) here.
# Browse to http://localhost:5173 ; Vite proxies /api to the backend.
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
Start-Process powershell -ArgumentList "-NoExit", "-Command", "Set-Location '$root/backend'; .venv/Scripts/python.exe -m uvicorn app.main:create_app --factory --reload --port 8000"
Set-Location "$root/frontend"
npm run dev
