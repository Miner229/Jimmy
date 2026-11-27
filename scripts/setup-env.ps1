# Creates .env.local for LOCAL TESTING with Stripe TEST mode and the Supabase TEST project.
# Usage (from the repo folder, in PowerShell):
#   powershell -ExecutionPolicy Bypass -File .\scripts\setup-env.ps1
# Nothing is uploaded anywhere. .env.local is listed in .gitignore, so it is never committed.

$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $PSScriptRoot
$envFile = Join-Path $root '.env.local'
$supabaseUrl = 'https://wcpfpawaudldyorinvli.supabase.co'

function Read-Secret([string]$prompt) {
  $secure = Read-Host -Prompt $prompt -AsSecureString
  $ptr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
  try { return ([Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr)).Trim() }
  finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr) }
}

if (Test-Path $envFile) {
  $answer = Read-Host '.env.local already exists. Replace it? (y/n)'
  if ($answer -ne 'y') { Write-Host 'Nothing changed.'; exit 0 }
}

Write-Host ''
Write-Host 'Paste each value, then press Enter. Secret values are hidden while you paste.' -ForegroundColor Cyan
Write-Host ''

# 1. Stripe TEST secret key
while ($true) {
  $stripeKey = Read-Secret '1/3  Stripe TEST secret key (starts with sk_test_)'
  if ($stripeKey -like 'sk_test_*') { break }
  if ($stripeKey -like 'sk_live_*' -or $stripeKey -like 'rk_live_*') {
    Write-Host '     That is a LIVE key. Only test keys are allowed. Switch the Stripe Dashboard to Test mode and copy again.' -ForegroundColor Red
  } else {
    Write-Host '     That does not start with sk_test_. Please copy the Secret key from Stripe test mode.' -ForegroundColor Yellow
  }
}

# 2. Supabase secret key (server only)
while ($true) {
  $secretKey = Read-Secret '2/3  Supabase SECRET key (starts with sb_secret_)'
  if ($secretKey -like 'sb_secret_*') { break }
  Write-Host '     Copy the Secret key from Supabase Project Settings > API Keys (Publishable and secret API keys tab).' -ForegroundColor Yellow
}

# 3. Supabase publishable key (public)
while ($true) {
  $publishableKey = (Read-Host '3/3  Supabase PUBLISHABLE key (starts with sb_publishable_)').Trim()
  if ($publishableKey -like 'sb_publishable_*') { break }
  Write-Host '     Copy the Publishable key from Project Settings > API Keys.' -ForegroundColor Yellow
}

# Random secret for the reconcile job endpoint
$bytes = New-Object byte[] 32
[Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
$cronSecret = -join ($bytes | ForEach-Object { $_.ToString('x2') })

# Webhook signing secret from the Stripe CLI, if it is installed and logged in
$webhookSecret = ''
try {
  $printed = (& stripe listen --print-secret 2>$null | Out-String).Trim()
  if ($printed -like 'whsec_*') { $webhookSecret = $printed }
} catch { }

$lines = @(
  '# Local test settings. Never commit this file. Test mode only.'
  "STRIPE_SECRET_KEY=$stripeKey"
  "STRIPE_CONNECT_WEBHOOK_SECRET=$webhookSecret"
  'PLATFORM_FEE_BPS=100'
  'APP_ORIGIN=http://localhost:3000'
  "SUPABASE_URL=$supabaseUrl"
  "SUPABASE_SECRET_KEY=$secretKey"
  "SUPABASE_PUBLISHABLE_KEY=$publishableKey"
  "VITE_SUPABASE_URL=$supabaseUrl"
  "VITE_SUPABASE_PUBLISHABLE_KEY=$publishableKey"
  "CRON_SECRET=$cronSecret"
)
[IO.File]::WriteAllLines($envFile, $lines, (New-Object Text.UTF8Encoding $false))

Write-Host ''
Write-Host "Done. Created $envFile" -ForegroundColor Green
if ($webhookSecret) {
  Write-Host 'Stripe webhook secret was filled in automatically from the Stripe CLI.' -ForegroundColor Green
} else {
  Write-Host 'Stripe webhook secret is empty: run "stripe login", then run this script again.' -ForegroundColor Yellow
}
