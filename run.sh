#!/usr/bin/env bash
# Start the extraction UI on http://localhost:8000 -- and, first, the Hindsight
# memory server the Evidence Agent uses, if it is not already running.
set -euo pipefail
cd "$(dirname "$0")"

# Agent memory (docs/agent-memory.md). Started in the background and left
# running when this script stops: the bank is shared by every run, and a
# restart of the UI -- which --reload does often -- should not take memory
# down with it. Skipped when it is already up, when it is not installed, or
# when HINDSIGHT_URL is set to empty (memory switched off).
if [ "${HINDSIGHT_URL-unset}" = "" ]; then
  echo "Hindsight: HINDSIGHT_URL is empty, memory is off -- not starting it."
elif curl -sf -m 2 http://127.0.0.1:8888/health >/dev/null 2>&1; then
  echo "Hindsight: already running on 127.0.0.1:8888."
elif [ -x ./hindsight-venv/bin/hindsight-api ] && [ -f ./hindsight.sh ]; then
  echo "Hindsight: starting in the background (log: hindsight.log)."
  nohup sh ./hindsight.sh >> hindsight.log 2>&1 &
  # It loads a local embedding model before it answers; the page re-checks
  # every 30 seconds, so there is no need to hold the UI back for it.
else
  echo "Hindsight: not installed (see docs/agent-memory.md) -- the agent runs without memory."
fi

# Neo4j, for Cypher over the knowledge graph (docs/neo4j.md). Optional: the app
# loads the graph into it once it answers, and runs without it when it does not.
if curl -sf -m 2 http://127.0.0.1:7474 >/dev/null 2>&1; then
  echo "Neo4j: already running on 127.0.0.1:7474."
elif ! grep -q '^NEO4J_PASSWORD=.' .env 2>/dev/null; then
  echo "Neo4j: NEO4J_PASSWORD is not set in .env -- Cypher is off (see docs/neo4j.md)."
elif command -v docker >/dev/null 2>&1 && docker compose -f compose.neo4j.yml up -d >/dev/null 2>&1; then
  echo "Neo4j: started (compose.neo4j.yml); the graph loads into it once it answers."
else
  echo "Neo4j: could not start the container (is Docker/Podman running?) -- Cypher is off."
fi

exec .venv/bin/uvicorn app:app --port "${PORT:-8000}" --reload
