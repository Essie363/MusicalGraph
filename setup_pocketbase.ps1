# CAST LIGHT - PocketBase install/setup script
# Usage:  powershell -ExecutionPolicy Bypass -File setup_pocketbase.ps1
# (optional) -Version "0.39.10" -AdminEmail "you@mail.com" -AdminPassword "secret"
param(
    [string]$Version = "0.39.10",
    [string]$AdminEmail = "",
    [string]$AdminPassword = ""
)
$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
$PbDir = Join-Path $Root "pb"
$Exe = Join-Path $PbDir "pocketbase.exe"
New-Item -ItemType Directory -Force -Path $PbDir | Out-Null

if (-not (Test-Path $Exe)) {
    $url = "https://github.com/pocketbase/pocketbase/releases/download/v$Version/pocketbase_${Version}_windows_amd64.zip"
    $zip = Join-Path $env:TEMP "pocketbase_${Version}_windows_amd64.zip"
    Write-Host "== Downloading PocketBase v$Version ..."
    $ProgressPreference = "SilentlyContinue"
    Invoke-WebRequest -Uri $url -OutFile $zip
    Expand-Archive -Path $zip -DestinationPath $PbDir -Force
    Remove-Item $zip
    Write-Host "== Extracted to $Exe"
} else {
    Write-Host "== Found existing $Exe, skip download."
}

if (-not $AdminEmail) { $AdminEmail = Read-Host "Admin email (for /_/ dashboard login)" }
if (-not $AdminPassword) {
    $sec = Read-Host -AsSecureString "Admin password"
    $ptr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($sec)
    $AdminPassword = [Runtime.InteropServices.Marshal]::PtrToStringAuto($ptr)
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr)
}

& $Exe superuser upsert $AdminEmail $AdminPassword --dir (Join-Path $PbDir "pb_data")

Write-Host ""
Write-Host "======================================================"
Write-Host " PocketBase installed. Next steps:"
Write-Host "   1. Double-click start_all.bat  (starts backend + website)"
Write-Host "   2. Open http://127.0.0.1:8090/_/  and login with the admin account"
Write-Host "   3. Run:  python import_pocketbase.py   (import existing data)"
Write-Host "======================================================"
