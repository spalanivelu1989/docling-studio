"""Read an image with a cloud vision model (ChatGPT or Claude) through Docling.

The local reader is vlm_ocr (Qwen3-VL on this machine). This module is the
alternative that sends the image to an API instead, using Docling's own VLM
pipeline: Docling renders the image, posts it to an OpenAI-compatible
`/v1/chat/completions` endpoint with a prompt, and parses the Markdown that
comes back into a document, which is exported again as Markdown.

* **openai** -- `https://api.openai.com/v1/chat/completions`, key from
  `OPENAI_API_KEY`, model from `OPENAI_VLM_MODEL` (default `gpt-5`).
* **claude** -- Anthropic's OpenAI-compatible endpoint
  `https://api.anthropic.com/v1/chat/completions`, key from
  `ANTHROPIC_API_KEY`, model from `CLAUDE_VLM_MODEL` (default
  `claude-opus-5`). Docling only speaks the OpenAI request format, so this is
  the one way it can reach Claude. Anthropic documents that endpoint as meant
  for evaluating models rather than long-term production use.

Unlike vlm_ocr, **the image leaves this machine.** Only table/screenshot reading
goes this way; flattened flowcharts are still traced locally (flow_cv, or
Qwen3-VL's read_flow).
"""

from __future__ import annotations

import logging
import os
import re
from dataclasses import dataclass
from pathlib import Path

from dotenv import load_dotenv

from vlm_ocr import DOC_PROMPT

# API keys and model overrides can live in the project's .env. A variable
# already set in the environment wins, so an exported key is never replaced.
load_dotenv(Path(__file__).with_name(".env"), override=False)

# Long edge sent to the API. Docling renders an image page at `scale` times its
# size; SAP screenshots are already legible at 1x, and an upscaled PNG only
# costs upload time and image tokens.
MAX_EDGE = 2000
# Room for a dense table, plus the reasoning tokens both default models spend
# before answering (they count against this limit).
MAX_OUTPUT_TOKENS = 16000
TIMEOUT_SECONDS = 300


@dataclass(frozen=True)
class Provider:
    label: str
    url: str
    key_env: str
    model_env: str
    default_model: str
    # OpenAI's reasoning models reject `max_tokens`; Anthropic's compatibility
    # layer takes it.
    token_param: str


PROVIDERS: dict[str, Provider] = {
    "openai": Provider(
        label="GPT (OpenAI API)",
        url="https://api.openai.com/v1/chat/completions",
        key_env="OPENAI_API_KEY",
        model_env="OPENAI_VLM_MODEL",
        default_model="gpt-5",
        token_param="max_completion_tokens",
    ),
    "claude": Provider(
        label="Claude (Anthropic API)",
        url="https://api.anthropic.com/v1/chat/completions",
        key_env="ANTHROPIC_API_KEY",
        model_env="CLAUDE_VLM_MODEL",
        default_model="claude-opus-5",
        token_param="max_tokens",
    ),
}


class VisionApiError(RuntimeError):
    """The API returned nothing usable; Docling logs the HTTP detail."""


def model_for(provider: str) -> str:
    p = PROVIDERS[provider]
    return os.environ.get(p.model_env) or p.default_model


def available(provider: str) -> bool:
    return provider in PROVIDERS and bool(os.environ.get(PROVIDERS[provider].key_env))


def label(provider: str) -> str:
    return f"{PROVIDERS[provider].label}, model {model_for(provider)}"


_converters: dict[str, object] = {}


def _converter(provider: str):
    """One Docling converter per provider, built on first use."""
    if provider in _converters:
        return _converters[provider]

    from docling.datamodel.base_models import InputFormat
    from docling.datamodel.pipeline_options import VlmConvertOptions, VlmPipelineOptions
    from docling.datamodel.pipeline_options_vlm_model import ResponseFormat
    from docling.datamodel.stage_model_specs import VlmModelSpec
    from docling.datamodel.vlm_engine_options import ApiVlmEngineOptions, VlmEngineType
    from docling.document_converter import DocumentConverter, ImageFormatOption
    from docling.pipeline.vlm_pipeline import VlmPipeline

    p = PROVIDERS[provider]
    key = os.environ.get(p.key_env)
    if not key:
        raise VisionApiError(f"{p.key_env} is not set")

    model = model_for(provider)
    options = VlmPipelineOptions(
        # Docling refuses to call an external service unless told it may.
        enable_remote_services=True,
        vlm_options=VlmConvertOptions(
            model_spec=VlmModelSpec(
                name=model,
                default_repo_id=model,
                prompt=DOC_PROMPT,
                response_format=ResponseFormat.MARKDOWN,
                max_new_tokens=MAX_OUTPUT_TOKENS,
            ),
            engine_options=ApiVlmEngineOptions(
                engine_type=VlmEngineType.API,
                url=p.url,
                headers={"Authorization": f"Bearer {key}"},
                params={
                    "model": model,
                    # Docling otherwise sends the model spec's temperature (0.0).
                    # Current models only take their default, and None goes out
                    # as JSON null, which Claude accepts as "not set".
                    "temperature": None,
                    p.token_param: MAX_OUTPUT_TOKENS,
                },
                timeout=TIMEOUT_SECONDS,
            ),
            scale=1.0,
            max_size=MAX_EDGE,
        ),
    )
    converter = DocumentConverter(
        format_options={
            InputFormat.IMAGE: ImageFormatOption(
                pipeline_cls=VlmPipeline, pipeline_options=options
            )
        }
    )
    _converters[provider] = converter
    return converter


def read(path: Path, provider: str) -> str:
    """Markdown for one image, read by the chosen cloud model."""
    # Docling logs a failed HTTP call and carries on with an empty page; keep
    # that visible rather than silently falling back to OCR.
    logging.getLogger("docling.utils.api_image_request").setLevel(logging.ERROR)
    result = _converter(provider).convert(path, raises_on_error=False)
    md = result.document.export_to_markdown() if result.document else ""
    md = md.replace("<!-- image -->", "").strip()
    if not md:
        detail = "; ".join(str(e.error_message) for e in result.errors) or "empty answer"
        raise VisionApiError(f"{PROVIDERS[provider].label} returned no text ({detail})")
    return re.sub(r"\n{3,}", "\n\n", md)
