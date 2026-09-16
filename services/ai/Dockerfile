FROM python:3.11-slim

ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1
ENV PYTHONPATH=/app
WORKDIR /app

COPY services/ai/pyproject.toml services/ai/pyproject.toml
COPY services/ai/app services/ai/app
RUN python -m pip install --no-cache-dir ./services/ai

RUN useradd --create-home --uid 10001 appuser
USER appuser
EXPOSE 8000
HEALTHCHECK --interval=10s --timeout=5s --start-period=15s --retries=5 \
  CMD python -c "import urllib.request; response = urllib.request.urlopen('http://127.0.0.1:8000/api/v1/health', timeout=3); raise SystemExit(0 if response.status == 200 else 1)"
CMD ["python", "-m", "uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
