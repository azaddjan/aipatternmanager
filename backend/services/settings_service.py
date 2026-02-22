"""
Admin settings service — stores API keys, provider config, and model defaults.
Settings are persisted as a JSON file inside the container volume.
API keys are stored in env vars at runtime and the file only holds masked references.
"""
import os
import json
import logging
from pathlib import Path

logger = logging.getLogger(__name__)

SETTINGS_FILE = Path("/app/settings.json")

DEFAULT_SETTINGS = {
    "default_provider": "anthropic",
    "providers": {
        "anthropic": {
            "enabled": True,
            "model": "claude-opus-4-20250514",
            "models": [
                "claude-opus-4-20250514",
                "claude-sonnet-4-20250514",
                "claude-3-5-sonnet-20241022",
            ],
            "key_set": False,
        },
        "openai": {
            "enabled": True,
            "model": "gpt-4o",
            "models": ["gpt-4o", "gpt-4o-mini", "gpt-4-turbo", "o1-preview"],
            "key_set": False,
        },
        "ollama": {
            "enabled": True,
            "model": "llama3.1",
            "models": ["llama3.1", "llama3.2", "mistral", "codellama", "mixtral"],
            "base_url": "http://localhost:11434",
        },
        "bedrock": {
            "enabled": True,
            "model": "anthropic.claude-sonnet-4-20250514-v1:0",
            "models": [
                "anthropic.claude-opus-4-20250514-v1:0",
                "anthropic.claude-sonnet-4-20250514-v1:0",
                "anthropic.claude-3-5-sonnet-20241022-v2:0",
                "amazon.titan-text-premier-v1:0",
                "meta.llama3-1-70b-instruct-v1:0",
            ],
            "region": "us-east-1",
            "key_set": False,
        },
    },
}


def _load_settings() -> dict:
    """Load settings from JSON file, falling back to defaults."""
    if SETTINGS_FILE.exists():
        try:
            data = json.loads(SETTINGS_FILE.read_text())
            # Merge with defaults so new keys are added on upgrade
            merged = {**DEFAULT_SETTINGS, **data}
            merged["providers"] = {**DEFAULT_SETTINGS["providers"], **data.get("providers", {})}
            return merged
        except Exception as e:
            logger.warning(f"Failed to load settings: {e}, using defaults")
    return DEFAULT_SETTINGS.copy()


def _save_settings(settings: dict):
    """Persist settings to JSON file."""
    try:
        SETTINGS_FILE.write_text(json.dumps(settings, indent=2))
    except Exception as e:
        logger.error(f"Failed to save settings: {e}")


def get_settings() -> dict:
    """Get current admin settings with masked API keys."""
    settings = _load_settings()

    # Check which keys are actually set in env
    settings["providers"]["anthropic"]["key_set"] = bool(os.getenv("ANTHROPIC_API_KEY", ""))
    settings["providers"]["openai"]["key_set"] = bool(os.getenv("OPENAI_API_KEY", ""))
    settings["providers"]["bedrock"]["key_set"] = bool(
        os.getenv("AWS_ACCESS_KEY_ID", "") and os.getenv("AWS_SECRET_ACCESS_KEY", "")
    )

    return settings


def update_settings(updates: dict) -> dict:
    """Update admin settings (provider config, models, etc.)."""
    settings = _load_settings()

    if "default_provider" in updates:
        settings["default_provider"] = updates["default_provider"]
        os.environ["DEFAULT_LLM_PROVIDER"] = updates["default_provider"]

    if "providers" in updates:
        for prov_name, prov_config in updates["providers"].items():
            if prov_name in settings["providers"]:
                # Update model, enabled, etc. but NOT key info
                for k, v in prov_config.items():
                    if k not in ("key_set",):  # don't overwrite computed fields
                        settings["providers"][prov_name][k] = v

    _save_settings(settings)
    return get_settings()


def set_api_key(provider: str, key: str, secret: str = None) -> dict:
    """Set an API key at runtime. Updates the env var so providers pick it up."""
    settings = _load_settings()

    if provider == "anthropic":
        os.environ["ANTHROPIC_API_KEY"] = key
        settings["providers"]["anthropic"]["key_set"] = True
        # Reinitialize the Anthropic provider client
        _reinit_provider("anthropic")

    elif provider == "openai":
        os.environ["OPENAI_API_KEY"] = key
        settings["providers"]["openai"]["key_set"] = True
        _reinit_provider("openai")

    elif provider == "bedrock":
        os.environ["AWS_ACCESS_KEY_ID"] = key
        if secret:
            os.environ["AWS_SECRET_ACCESS_KEY"] = secret
        settings["providers"]["bedrock"]["key_set"] = True
        _reinit_provider("bedrock")

    else:
        raise ValueError(f"Unknown provider: {provider}")

    _save_settings(settings)
    return get_settings()


def _reinit_provider(name: str):
    """Force re-initialization of a specific provider after key change."""
    try:
        from services.llm.provider_factory import _providers, _init_providers
        _init_providers()
        if name == "anthropic":
            from services.llm.anthropic_provider import AnthropicProvider
            _providers["anthropic"] = AnthropicProvider()
        elif name == "openai":
            from services.llm.openai_provider import OpenAIProvider
            _providers["openai"] = OpenAIProvider()
        elif name == "bedrock":
            from services.llm.bedrock_provider import BedrockProvider
            _providers["bedrock"] = BedrockProvider()
    except Exception as e:
        logger.warning(f"Failed to reinit provider {name}: {e}")


def get_masked_key(provider: str) -> str:
    """Return a masked version of the API key for display."""
    if provider == "anthropic":
        key = os.getenv("ANTHROPIC_API_KEY", "")
    elif provider == "openai":
        key = os.getenv("OPENAI_API_KEY", "")
    elif provider == "bedrock":
        key = os.getenv("AWS_ACCESS_KEY_ID", "")
    else:
        return ""

    if not key or len(key) < 8:
        return ""
    return key[:4] + "***" + key[-4:]
