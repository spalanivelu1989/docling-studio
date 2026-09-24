#!/bin/sh
# Start the Hindsight memory server for this project.
#
# The model this picks is the one that reads every investigation note and turns
# it into facts, consolidates them into observations, and answers reflect(). It
# is the only model Hindsight uses, and it decides two things:
#
#   * COST. Every retain is an LLM call, and consolidation re-reads facts as the
#     bank grows. A full investigation note is around 3 KB.
#   * WHERE THE FINDINGS GO. The note holds what an investigation concluded
#     about Solvay programme documents. An `anthropic` or `openai` provider
#     sends that off this machine; `ollama` does not.
#
# There is no default worth relying on: the provider's own default is
# claude-haiku-4-5 for anthropic and gemma3:12b for ollama, and a model that is
# not there fails every write silently -- retain is asynchronous, so the API
# accepts it and the agent moves on. Always set the model.
set -e
cd "$(dirname "$0")"

# The key comes from .env, the same one the agents use. Never echoed.
if [ -f .env ]; then
  ANTHROPIC_API_KEY=$(sed -n 's/^ANTHROPIC_API_KEY=//p' .env | tr -d '"'"'"'"' | head -1)
  export ANTHROPIC_API_KEY
fi
if [ -z "$ANTHROPIC_API_KEY" ]; then
  echo "No ANTHROPIC_API_KEY in .env or the environment." >&2
  exit 1
fi

# Claude, reached through LiteLLM rather than through Hindsight's own
# `anthropic` provider or Anthropic's OpenAI-compatible endpoint. Both of those
# were tried first and both are dead ends:
#
#   anthropic provider -- builds an httpx.Timeout and hands it to a client that
#     has migrated to httpx2, which rejects it outright. The whole anthropic 1.x
#     line is on httpx2, so there is no version to pin back to.
#
#   openai provider against https://api.anthropic.com/v1/ -- chat works, but
#     fact extraction asks for response_format {"type": "json_object"} and that
#     endpoint answers 400: "response_format.type: Input should be
#     'json_schema'".
#
# LiteLLM speaks Anthropic's native API and translates the request Hindsight
# actually sends. The model name carries its provider.
export HINDSIGHT_API_LLM_PROVIDER=litellm
export HINDSIGHT_API_LLM_MODEL=${HINDSIGHT_MODEL:-anthropic/claude-opus-5}
export HINDSIGHT_API_LLM_API_KEY="$ANTHROPIC_API_KEY"

# Reflect gets its own, faster model. Not a cost decision -- a deadline one.
#
# Reflect is the one INTERACTIVE operation: a person is holding an HTTP request
# open, and it runs an agentic loop of several sequential LLM calls. Hindsight
# gives each of those calls 30 seconds, chosen against a healthy call answering
# in 1-4s and a retry ladder of three attempts. Opus does not answer in 1-4s.
# Every attempt hit the deadline, retried four times and failed:
#
#   LiteLLM tool call timed out after 30.0s on 4 attempts (scope=reflect_tool_call)
#   [REFLECT] LLM error on iteration 3: TimeoutError (127023ms)
#
# Raising the deadline instead would have made a working reflect take minutes,
# because the ladder multiplies it. The job is reading memories and answering a
# question about them, which Sonnet does well and quickly. Retain keeps Opus,
# where extraction quality decides what the bank believes forever.
export HINDSIGHT_API_REFLECT_LLM_MODEL=${HINDSIGHT_REFLECT_MODEL:-anthropic/claude-sonnet-5}
export HINDSIGHT_API_REFLECT_LLM_TIMEOUT=${HINDSIGHT_REFLECT_TIMEOUT:-60}

# In-process, on this machine, and nothing to do with the Ollama bge-m3 the
# corpus is indexed with.
export HINDSIGHT_API_EMBEDDINGS_PROVIDER=local

echo "Hindsight: $HINDSIGHT_API_LLM_PROVIDER / $HINDSIGHT_API_LLM_MODEL on 127.0.0.1:8888"
echo "           reflect on $HINDSIGHT_API_REFLECT_LLM_MODEL (${HINDSIGHT_API_REFLECT_LLM_TIMEOUT}s per call)"
exec ./hindsight-venv/bin/hindsight-api --host 127.0.0.1 --port 8888 --log-level info
