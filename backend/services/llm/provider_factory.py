import os
import logging

from services.llm.base_provider import BaseLLMProvider
from services.llm.anthropic_provider import AnthropicProvider
from services.llm.openai_provider import OpenAIProvider
from services.llm.ollama_provider import OllamaProvider
from services.llm.bedrock_provider import BedrockProvider

logger = logging.getLogger(__name__)

_providers: dict[str, BaseLLMProvider] = {}


def _init_providers():
    global _providers
    if not _providers:
        _providers = {
            "anthropic": AnthropicProvider(),
            "openai": OpenAIProvider(),
            "ollama": OllamaProvider(),
            "bedrock": BedrockProvider(),
        }


def get_provider(name: str | None = None) -> BaseLLMProvider:
    """Get an LLM provider by name. Falls back to DEFAULT_LLM_PROVIDER env var, then anthropic."""
    _init_providers()
    if name is None:
        name = os.getenv("DEFAULT_LLM_PROVIDER", "anthropic")
    provider = _providers.get(name)
    if not provider:
        raise ValueError(f"Unknown LLM provider: {name}. Available: {list(_providers.keys())}")
    return provider


def get_available_providers() -> list[dict]:
    """Return a list of all providers with their availability status."""
    _init_providers()
    default = os.getenv("DEFAULT_LLM_PROVIDER", "anthropic")
    result = []
    for name, provider in _providers.items():
        result.append({
            "name": name,
            "default_model": provider.default_model,
            "available": provider.is_available(),
            "is_default": name == default,
        })
    return result
