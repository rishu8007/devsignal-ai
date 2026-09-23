$ErrorActionPreference = "Stop"
Set-Location (Join-Path $PSScriptRoot "..")

$project = "devsignal-browser-integration"
$compose = "docker-compose.integration.yml"
$mongoUri = "mongodb://integration_root:integration_only_password@127.0.0.1:27018/devsignal_integration?authSource=admin"
$apiPid = $null
$aiPid = $null

docker compose -p $project -f $compose up -d --wait mongo
try {
  $env:API_TEST_PORT = "4100"
  $env:WEB_TEST_PORT = "3200"
  $env:NEXT_PUBLIC_API_BASE_URL = "http://127.0.0.1:4100/api/v1"
  npm run build --workspace apps/web

  $env:NODE_ENV = "test"
  $env:PORT = "4100"
  $env:WEB_ORIGIN = "http://127.0.0.1:3200"
  $env:MONGODB_URI = $mongoUri
  $env:JWT_ACCESS_SECRET = "browser-integration-secret-012345678901"
  $env:AI_SERVICE_URL = "http://127.0.0.1:8100"
  $env:AI_INTERNAL_API_KEY = "browser-integration-internal-key-012345"
  $env:LINKEDIN_ENABLED = "false"
  $env:LINKEDIN_PUBLISHING_ENABLED = "false"
  $env:LINKEDIN_SCHEDULER_ENABLED = "false"
  $env:BROWSER_AI_PORT = "8100"
  $aiProcess = Start-Process -FilePath "node" -ArgumentList "scripts/browser-integration-ai.mjs" -PassThru -NoNewWindow
  $aiPid = $aiProcess.Id
  $apiProcess = Start-Process -FilePath "npm.cmd" -ArgumentList "run", "start", "--workspace", "services/api" -PassThru -NoNewWindow
  $apiPid = $apiProcess.Id

  $ready = $false
  for ($attempt = 0; $attempt -lt 60; $attempt++) {
    try {
      $health = Invoke-WebRequest -UseBasicParsing -Uri "http://127.0.0.1:4100/api/v1/health" -TimeoutSec 2
      if ($health.StatusCode -eq 200) { $ready = $true; break }
    } catch {}
    Start-Sleep -Seconds 1
  }
  if (-not $ready) { throw "API did not become healthy on port 4100." }

  npx playwright test --config apps/web/playwright.integration.config.ts
}
finally {
  if ($apiPid) { Stop-Process -Id $apiPid -Force -ErrorAction SilentlyContinue }
  if ($aiPid) { Stop-Process -Id $aiPid -Force -ErrorAction SilentlyContinue }
  docker compose -p $project -f $compose down -v
}
