# DevSignal API

## Signal generation

Authenticated generation requests use:

```text
POST /api/v1/signals/:signalId/generations
GET /api/v1/signals/:signalId/generations
```

The Express API reads the owned Signal from MongoDB, sends only its persisted
content to the FastAPI service, validates the structured response, and stores
the three drafts in one Generation document. A unique owner/Signal index
prevents more than one saved Generation per Signal.

The in-memory in-flight guard prevents duplicate provider calls for the same
owner and Signal within one API process. It does not prevent duplicate provider
costs across multiple API processes; distributed coordination belongs to a
later deployment milestone.

`AI_SERVICE_TIMEOUT_MS` must accommodate the FastAPI/OpenAI request budget.
An Express timeout only stops waiting locally and does not prove that the
upstream provider stopped processing.

## Manual generation test

Start the API and use an authenticated `WebRequestSession`. Replace the
credentials with a test account and select a Signal ID from the authenticated
list response; do not paste or print JWT values.

```powershell
$session = New-Object Microsoft.PowerShell.Commands.WebRequestSession
$loginBody = @{
  email = "developer@example.com"
  password = "replace_with_test_password"
} | ConvertTo-Json

Invoke-WebRequest `
  "http://127.0.0.1:4000/api/v1/auth/login" `
  -Method Post `
  -WebSession $session `
  -ContentType "application/json" `
  -Body $loginBody | Out-Null

$signalsResponse = Invoke-RestMethod `
  "http://127.0.0.1:4000/api/v1/signals?page=1&limit=20" `
  -Method Get `
  -WebSession $session

$signalId = $signalsResponse.data.signals[0].id
if (-not $signalId) {
  throw "No Signal was returned for the authenticated account."
}

Invoke-RestMethod `
  "http://127.0.0.1:4000/api/v1/signals/$signalId/generations" `
  -Method Post `
  -WebSession $session `
  -ContentType "application/json" `
  -Body "{}"

Invoke-RestMethod `
  "http://127.0.0.1:4000/api/v1/signals/$signalId/generations" `
  -Method Get `
  -WebSession $session
```

## Local checks

```powershell
npm run typecheck --workspace=@devsignal/api
npm run build --workspace=@devsignal/api
npm test --workspace=@devsignal/api
```
