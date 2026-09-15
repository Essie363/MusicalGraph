<#!
.SYNOPSIS
Read-only health check for Supabase email auth and the ratings RPC deployment.

.DESCRIPTION
Reads the public project URL and publishable key from web/supabase_config.js.
It never sends an email and never creates, edits, or deletes data.
#>

$ErrorActionPreference = 'Stop'
$configPath = Join-Path $PSScriptRoot 'web\supabase_config.js'

if (-not (Test-Path $configPath)) {
  throw "Cannot find $configPath"
}

$config = Get-Content -Raw $configPath
$urlMatch = [regex]::Match($config, 'url\s*:\s*["'']([^"'']+)["'']')
$keyMatch = [regex]::Match($config, 'anonKey\s*:\s*["'']([^"'']+)["'']')
if (-not $urlMatch.Success -or -not $keyMatch.Success) {
  throw 'web/supabase_config.js must contain url and anonKey.'
}

$url = $urlMatch.Groups[1].Value.TrimEnd('/')
$key = $keyMatch.Groups[1].Value
$headers = @{ apikey = $key; Authorization = "Bearer $key"; 'Content-Type' = 'application/json' }

function Invoke-SupabaseRead([string]$Method, [string]$Path, $Body = $null) {
  $params = @{ Uri = "$url$Path"; Method = $Method; Headers = $headers; UseBasicParsing = $true; TimeoutSec = 15; ErrorAction = 'Stop' }
  if ($null -ne $Body) { $params.Body = ($Body | ConvertTo-Json -Compress) }
  Invoke-RestMethod @params
}

Write-Host "Checking $url" -ForegroundColor Cyan
$settings = Invoke-SupabaseRead 'GET' '/auth/v1/settings'
if (-not $settings.external.email) { throw 'Email provider is disabled in Supabase Authentication settings.' }
if ($settings.disable_signup) { throw 'New-user signup is disabled. Enable it for OTP auto-registration.' }
Write-Host 'PASS Email provider is enabled and signup is allowed.' -ForegroundColor Green

try {
  $summary = Invoke-SupabaseRead 'POST' '/rest/v1/rpc/get_rating_summary' @{}
  $summaryText = $summary | ConvertTo-Json -Compress
  Write-Host "PASS ratings RPC is deployed: $summaryText" -ForegroundColor Green
} catch {
  $detail = "$($_.Exception.Message) $($_.ErrorDetails.Message)"
  if ($detail -match '404|PGRST202|function') {
    throw 'Ratings RPC is not deployed. Run docs/supabase_auth_ratings.sql in Supabase SQL Editor, then run this check again.'
  }
  throw
}

Write-Host 'PASS Read-only backend preflight completed. SMTP/template delivery still needs a real mailbox test.' -ForegroundColor Green
