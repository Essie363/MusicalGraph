# CAST LIGHT - PocketBase database backup script
# Usage: powershell -ExecutionPolicy Bypass -File backup_pocketbase.ps1
# Note: for a fully consistent snapshot, stop PocketBase first (or accept the
#       small risk of copying while the service is running).
$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
$DataDb = Join-Path $Root "pb\pb_data\data.db"
if (-not (Test-Path $DataDb)) {
    Write-Host "Not found: $DataDb  (start PocketBase once first)."
    exit 1
}
$BackupDir = Join-Path $Root "data\backups"
New-Item -ItemType Directory -Force -Path $BackupDir | Out-Null
$stamp = Get-Date -Format "yyyyMMdd_HHmmss"
$dest = Join-Path $BackupDir "pb_$stamp.db"
Copy-Item -LiteralPath $DataDb -Destination $dest -Force
foreach ($ext in "db-wal", "db-shm") {
    $w = "$DataDb-$ext"
    if (Test-Path $w) { Copy-Item -LiteralPath $w -Destination "$dest-$ext" -Force }
}
# keep latest 30 backups
Get-ChildItem -Path $BackupDir -Filter "pb_*.db" | Sort-Object LastWriteTime -Descending | Select-Object -Skip 30 | Remove-Item -Force
Write-Host "Backup saved: $dest (keep latest 30)"
