# =============================================
# SAMARTH AI — Backend Dockerfile
# Multi-stage build for FastAPI + Uvicorn
# =============================================

FROM python:3.12-slim AS base

# Prevent Python from writing .pyc files and enable unbuffered output
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PYTHONIOENCODING=utf-8

WORKDIR /app

# Install system dependencies
RUN apt-get update && \
    apt-get install -y --no-install-recommends \
        curl \
        build-essential && \
    rm -rf /var/lib/apt/lists/*

# ── Dependencies stage ───────────────────────────────────────
FROM base AS dependencies

COPY requirements.txt .
RUN pip install --no-cache-dir --upgrade pip && \
    pip install --no-cache-dir -r requirements.txt

# ── Application stage ────────────────────────────────────────
FROM dependencies AS app

COPY . .

# Create non-root user
RUN groupadd -r samarth && \
    useradd -r -g samarth -d /app -s /sbin/nologin samarth && \
    chown -R samarth:samarth /app

USER samarth

EXPOSE 8000

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=15s --retries=3 \
    CMD curl -f http://localhost:8000/health || exit 1

# Default: run the FastAPI server
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
