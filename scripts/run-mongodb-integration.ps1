$ErrorActionPreference = "Stop"
Set-Location (Join-Path $PSScriptRoot "..")
$project = "devsignal-mongodb-integration"
$compose = "docker-compose.integration.yml"
$uri = "mongodb://integration_root:integration_only_password@127.0.0.1:27018/devsignal_integration?authSource=admin"

docker compose -p $project -f $compose up -d --wait mongo
try {
  $env:MONGODB_INTEGRATION_URI = $uri
  npm run test --workspace services/api -- test/mongodb.integration.test.ts
}
finally {
  docker compose -p $project -f $compose down -v
}
