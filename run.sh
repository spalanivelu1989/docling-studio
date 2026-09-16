#!/usr/bin/env bash
# Start the extraction UI on http://localhost:8000
set -euo pipefail
cd "$(dirname "$0")"
exec .venv/bin/uvicorn app:app --port "${PORT:-8000}" --reload
