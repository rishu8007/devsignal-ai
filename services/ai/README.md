# DevSignal AI Service

## Local setup

```powershell
py -3.14 -m venv services\ai\.venv
& services\ai\.venv\Scripts\Activate.ps1
python -m pip install --upgrade pip
python -m pip install -e "services\ai[dev]"
```

## Quality checks

```powershell
ruff check services\ai
ruff format --check services\ai
mypy services\ai\app
pytest services\ai\tests
```

## Run locally

```powershell
uvicorn app.main:app --app-dir services\ai --reload
Invoke-WebRequest http://127.0.0.1:8000/api/v1/health
```
