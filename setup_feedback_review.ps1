$ErrorActionPreference = "Stop"

Set-Location $PSScriptRoot

$bytes = New-Object byte[] 32
$rng = [Security.Cryptography.RandomNumberGenerator]::Create()
try {
    $rng.GetBytes($bytes)
} finally {
    $rng.Dispose()
}
$token = ([BitConverter]::ToString($bytes)).Replace("-", "").ToLowerInvariant()
$workerUrl = "https://musicalgraph.freya3634.workers.dev"

Write-Host "Saving the review token to Cloudflare..."
$token | npx wrangler secret put FEEDBACK_REVIEW_TOKEN --config .\wrangler.toml
if ($LASTEXITCODE -ne 0) {
    throw "Cloudflare secret setup failed. The local .env was not changed."
}

$envPath = Join-Path $PSScriptRoot ".env"
$existing = if (Test-Path -LiteralPath $envPath) {
    Get-Content -LiteralPath $envPath -Raw -Encoding UTF8
} else {
    ""
}
$lines = $existing -split "`r?`n" | Where-Object {
    $_ -notmatch '^FEEDBACK_REVIEW_URL=' -and $_ -notmatch '^FEEDBACK_REVIEW_TOKEN='
}
$kept = ($lines -join "`r`n").TrimEnd()
$content = @(
    $kept
    "FEEDBACK_REVIEW_URL=$workerUrl"
    "FEEDBACK_REVIEW_TOKEN=$token"
) | Where-Object { $_ -ne "" }
Set-Content -LiteralPath $envPath -Value ($content -join "`r`n") -Encoding UTF8

Remove-Variable token
Write-Host "Setup complete. The token is stored only in Cloudflare and the local .env file."
