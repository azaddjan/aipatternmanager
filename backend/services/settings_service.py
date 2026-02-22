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
    "embedding": {
        "provider": "openai",
        "model": "text-embedding-3-small",
        "embedding_providers": {
            "openai": {
                "models": [
                    {"id": "text-embedding-3-small", "dimensions": 1536},
                    {"id": "text-embedding-3-large", "dimensions": 3072},
                    {"id": "text-embedding-ada-002", "dimensions": 1536},
                ],
            },
            "ollama": {
                "models": [
                    {"id": "nomic-embed-text", "dimensions": 768},
                    {"id": "mxbai-embed-large", "dimensions": 1024},
                    {"id": "all-minilm", "dimensions": 384},
                    {"id": "snowflake-arctic-embed", "dimensions": 1024},
                ],
            },
            "bedrock": {
                "models": [
                    {"id": "amazon.titan-embed-text-v2:0", "dimensions": 1024},
                    {"id": "amazon.titan-embed-text-v1", "dimensions": 1536},
                    {"id": "cohere.embed-english-v3", "dimensions": 1024},
                ],
            },
        },
    },
    "report_retention": {
        "max_reports": 20,
        "retention_days": 30,
        "auto_cleanup": True,
    },
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
            merged["embedding"] = {**DEFAULT_SETTINGS["embedding"], **data.get("embedding", {})}
            merged["report_retention"] = {**DEFAULT_SETTINGS["report_retention"], **data.get("report_retention", {})}
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
        (os.getenv("AWS_ACCESS_KEY_ID", "") and os.getenv("AWS_SECRET_ACCESS_KEY", ""))
        or os.getenv("AWS_PROFILE", "")
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

    if "embedding" in updates:
        for k, v in updates["embedding"].items():
            if k not in ("embedding_providers",):  # don't overwrite provider catalog
                settings["embedding"][k] = v
        # If provider changed but model not specified, set default model for new provider
        if "provider" in updates["embedding"] and "model" not in updates["embedding"]:
            new_prov = updates["embedding"]["provider"]
            emb_providers = settings["embedding"].get(
                "embedding_providers", DEFAULT_SETTINGS["embedding"]["embedding_providers"]
            )
            prov_models = emb_providers.get(new_prov, {}).get("models", [])
            if prov_models:
                settings["embedding"]["model"] = prov_models[0]["id"]
        # Reinitialize embedding service singleton when config changes
        _reinit_embedding_service()

    if "report_retention" in updates:
        for k, v in updates["report_retention"].items():
            settings["report_retention"][k] = v

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


def get_retention_settings() -> dict:
    """Get report retention configuration."""
    settings = _load_settings()
    return settings.get("report_retention", DEFAULT_SETTINGS["report_retention"])


def get_embedding_settings() -> dict:
    """Get the current embedding configuration."""
    settings = _load_settings()
    emb = settings.get("embedding", DEFAULT_SETTINGS["embedding"])
    provider = emb.get("provider", "openai")
    model = emb.get("model", "text-embedding-3-small")
    emb_providers = emb.get("embedding_providers", DEFAULT_SETTINGS["embedding"]["embedding_providers"])

    # Find dimensions for the current model
    dimensions = 1536  # fallback
    prov_config = emb_providers.get(provider, {})
    for m in prov_config.get("models", []):
        if m["id"] == model:
            dimensions = m["dimensions"]
            break

    # Determine if current provider has credentials
    if provider == "openai":
        key_set = bool(os.getenv("OPENAI_API_KEY", ""))
    elif provider == "ollama":
        key_set = True  # Ollama doesn't need API key
    elif provider == "bedrock":
        key_set = bool(
            (os.getenv("AWS_ACCESS_KEY_ID", "") and os.getenv("AWS_SECRET_ACCESS_KEY", ""))
            or os.getenv("AWS_PROFILE", "")
        )
    else:
        key_set = False

    return {
        "provider": provider,
        "model": model,
        "dimensions": dimensions,
        "key_set": key_set,
        "embedding_providers": emb_providers,
    }


def _reinit_embedding_service():
    """Force re-initialization of the embedding service singleton after config change."""
    try:
        from routers.advisor import _get_embedding_svc
        import routers.advisor as adv_mod
        adv_mod._embedding_svc = None  # reset so next call rebuilds
    except Exception as e:
        logger.warning(f"Failed to reinit embedding service: {e}")


def get_masked_key(provider: str) -> str:
    """Return a masked version of the API key for display."""
    if provider == "anthropic":
        key = os.getenv("ANTHROPIC_API_KEY", "")
    elif provider == "openai":
        key = os.getenv("OPENAI_API_KEY", "")
    elif provider == "bedrock":
        key = os.getenv("AWS_ACCESS_KEY_ID", "")
        if not key:
            profile = os.getenv("AWS_PROFILE", "")
            return f"profile:{profile}" if profile else ""
    else:
        return ""

    if not key or len(key) < 8:
        return ""
    return key[:4] + "***" + key[-4:]
