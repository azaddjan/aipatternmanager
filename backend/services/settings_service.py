"""
Admin settings service — stores provider config and model defaults in Neo4j.
API keys are stored in env vars at runtime (never persisted to DB).
Uses an in-memory cache with TTL to avoid hitting Neo4j on every request.
"""
import os
import json
import time
import logging
from pathlib import Path

logger = logging.getLogger(__name__)

# ── Cache ──
_CACHE_TTL_SECONDS = 60
_cache: dict = {}
_cache_timestamp: float = 0.0

# Legacy file path (for one-time migration)
_LEGACY_SETTINGS_FILE = Path("/app/settings.json")

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
    "auth": {
        "allow_anonymous_read": False,
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
            "model": "us.anthropic.claude-sonnet-4-20250514-v1:0",
            "models": [
                "us.anthropic.claude-opus-4-20250514-v1:0",
                "us.anthropic.claude-sonnet-4-20250514-v1:0",
                "us.anthropic.claude-3-5-sonnet-20241022-v2:0",
                "amazon.titan-text-premier-v1:0",
                "meta.llama3-1-70b-instruct-v1:0",
            ],
            "region": "us-east-1",
            "key_set": False,
            "guardrail_id": "",
            "guardrail_version": "",
        },
        "litellm": {
            "enabled": True,
            "model": "bedrock/anthropic.claude-3-sonnet-20240229-v1:0",
            "models": [
                "bedrock/anthropic.claude-3-sonnet-20240229-v1:0",
                "bedrock/anthropic.claude-3-haiku-20240307-v1:0",
                "openai/gpt-4o",
                "openai/gpt-4o-mini",
            ],
            "gateway_url": "",
            "key_set": False,
        },
    },
}


# ── Internal helpers ──

def _get_db():
    """Lazy import to avoid circular dependency."""
    from main import db_service
    return db_service


def _load_from_db() -> dict:
    """Load all SystemConfig nodes and reconstruct settings dict with cache."""
    global _cache, _cache_timestamp

    # Check cache freshness
    if _cache and (time.time() - _cache_timestamp) < _CACHE_TTL_SECONDS:
        return _cache.copy()

    db = _get_db()
    if not db or not db.verify_connectivity():
        logger.warning("DB not available for settings, using defaults")
        return DEFAULT_SETTINGS.copy()

    settings = {}
    try:
        with db.session() as session:
            result = session.run(
                "MATCH (c:SystemConfig) RETURN c.key AS key, c.value_json AS value_json"
            )
            for record in result:
                key = record["key"]
                try:
                    settings[key] = json.loads(record["value_json"])
                except (json.JSONDecodeError, TypeError):
                    pass
    except Exception as e:
        logger.warning(f"Failed to load settings from DB: {e}")
        return DEFAULT_SETTINGS.copy()

    # Merge with defaults so new keys are added on upgrade
    merged = {**DEFAULT_SETTINGS, **settings}
    # Deep-merge providers: add new providers and merge new keys into existing ones
    merged_providers = {}
    for pname, pdefaults in DEFAULT_SETTINGS["providers"].items():
        db_prov = settings.get("providers", {}).get(pname, {})
        merged_providers[pname] = {**pdefaults, **db_prov}
    # Also keep any providers in DB that aren't in defaults (future-proof)
    for pname, pconfig in settings.get("providers", {}).items():
        if pname not in merged_providers:
            merged_providers[pname] = pconfig
    merged["providers"] = merged_providers
    merged["embedding"] = {**DEFAULT_SETTINGS["embedding"], **settings.get("embedding", {})}
    merged["report_retention"] = {**DEFAULT_SETTINGS["report_retention"], **settings.get("report_retention", {})}
    merged["auth"] = {**DEFAULT_SETTINGS["auth"], **settings.get("auth", {})}

    # Update cache
    _cache = merged
    _cache_timestamp = time.time()
    return merged.copy()


def _save_to_db(key: str, value):
    """Upsert a single SystemConfig node."""
    global _cache_timestamp

    db = _get_db()
    if not db:
        logger.error("Cannot save settings: DB not available")
        return

    from datetime import datetime, timezone
    now = datetime.now(timezone.utc).isoformat()
    value_json = json.dumps(value)

    with db.session() as session:
        session.run(
            """
            MERGE (c:SystemConfig {key: $key})
            SET c.value_json = $value_json, c.updated_at = $now
            """,
            key=key, value_json=value_json, now=now,
        )

    # Invalidate cache so next read picks up the change
    _cache_timestamp = 0.0


def invalidate_cache():
    """Force re-read from DB on next access."""
    global _cache_timestamp
    _cache_timestamp = 0.0


# ── Public API (same signatures as before) ──

def get_settings() -> dict:
    """Get current admin settings with masked API keys."""
    settings = _load_from_db()

    # Check which keys are actually set in env
    settings["providers"]["anthropic"]["key_set"] = bool(os.getenv("ANTHROPIC_API_KEY", ""))
    settings["providers"]["openai"]["key_set"] = bool(os.getenv("OPENAI_API_KEY", ""))
    settings["providers"]["bedrock"]["key_set"] = bool(
        (os.getenv("AWS_ACCESS_KEY_ID", "") and os.getenv("AWS_SECRET_ACCESS_KEY", ""))
        or os.getenv("AWS_PROFILE", "")
    )
    settings["providers"]["litellm"]["key_set"] = bool(os.getenv("LITELLM_API_KEY", ""))
    # LiteLLM gateway_url may be stored in settings or env var
    if not settings["providers"]["litellm"].get("gateway_url"):
        env_url = os.getenv("LITELLM_GATEWAY_URL", "")
        if env_url:
            settings["providers"]["litellm"]["gateway_url"] = env_url

    return settings


def update_settings(updates: dict) -> dict:
    """Update admin settings (provider config, models, etc.)."""
    settings = _load_from_db()

    if "default_provider" in updates:
        settings["default_provider"] = updates["default_provider"]
        os.environ["DEFAULT_LLM_PROVIDER"] = updates["default_provider"]
        _save_to_db("default_provider", updates["default_provider"])

    if "providers" in updates:
        for prov_name, prov_config in updates["providers"].items():
            if prov_name in settings["providers"]:
                for k, v in prov_config.items():
                    if k not in ("key_set",):  # don't overwrite computed fields
                        settings["providers"][prov_name][k] = v
        _save_to_db("providers", settings["providers"])
        # Sync bedrock region to env var and reinit if changed
        if "bedrock" in updates["providers"] and "region" in updates["providers"]["bedrock"]:
            region = updates["providers"]["bedrock"]["region"]
            if region:
                os.environ["AWS_DEFAULT_REGION"] = region
            _reinit_provider("bedrock")

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
        _save_to_db("embedding", settings["embedding"])
        # Reinitialize embedding service singleton when config changes
        _reinit_embedding_service()

    if "report_retention" in updates:
        for k, v in updates["report_retention"].items():
            settings["report_retention"][k] = v
        _save_to_db("report_retention", settings["report_retention"])

    if "auth" in updates:
        for k, v in updates["auth"].items():
            settings["auth"][k] = v
        _save_to_db("auth", settings["auth"])

    return get_settings()


def set_api_key(provider: str, key: str, secret: str = None, region: str = None) -> dict:
    """Set an API key at runtime. Updates the env var so providers pick it up."""
    if provider == "anthropic":
        os.environ["ANTHROPIC_API_KEY"] = key
        _reinit_provider("anthropic")

    elif provider == "openai":
        os.environ["OPENAI_API_KEY"] = key
        _reinit_provider("openai")

    elif provider == "bedrock":
        os.environ["AWS_ACCESS_KEY_ID"] = key
        if secret:
            os.environ["AWS_SECRET_ACCESS_KEY"] = secret
        if region:
            os.environ["AWS_DEFAULT_REGION"] = region
            update_settings({"providers": {"bedrock": {"region": region}}})
        _reinit_provider("bedrock")

    elif provider == "litellm":
        if key:
            os.environ["LITELLM_API_KEY"] = key
        if secret:
            # secret field is used for gateway URL
            os.environ["LITELLM_GATEWAY_URL"] = secret
            # Also persist gateway_url in settings
            update_settings({"providers": {"litellm": {"gateway_url": secret}}})
        _reinit_provider("litellm")

    else:
        raise ValueError(f"Unknown provider: {provider}")

    return get_settings()


def get_retention_settings() -> dict:
    """Get report retention configuration."""
    settings = _load_from_db()
    return settings.get("report_retention", DEFAULT_SETTINGS["report_retention"])


def get_embedding_settings() -> dict:
    """Get the current embedding configuration."""
    settings = _load_from_db()
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


def update_embedding_models(provider_name: str, models: list[dict]):
    """Update the model list for an embedding provider (bypasses the embedding_providers guard)."""
    settings = _load_from_db()
    emb = settings.get("embedding", DEFAULT_SETTINGS["embedding"].copy())
    emb_providers = emb.get("embedding_providers", DEFAULT_SETTINGS["embedding"]["embedding_providers"].copy())

    if provider_name not in emb_providers:
        emb_providers[provider_name] = {}

    emb_providers[provider_name]["models"] = models
    emb["embedding_providers"] = emb_providers

    # If the current model for the active provider is no longer in the new list, reset
    current_provider = emb.get("provider", "openai")
    current_model = emb.get("model", "")
    if current_provider == provider_name:
        model_ids = [m["id"] for m in models]
        if current_model not in model_ids and models:
            emb["model"] = models[0]["id"]

    _save_to_db("embedding", emb)
    invalidate_cache()


def get_auth_settings() -> dict:
    """Get the current authentication configuration."""
    settings = _load_from_db()
    return settings.get("auth", DEFAULT_SETTINGS["auth"])


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
    elif provider == "litellm":
        key = os.getenv("LITELLM_API_KEY", "")
        if not key:
            url = os.getenv("LITELLM_GATEWAY_URL", "")
            return f"url:{url[:30]}..." if url else ""
    else:
        return ""

    if not key or len(key) < 8:
        return ""
    return key[:4] + "***" + key[-4:]


# ── Seed & Migration ──

def seed_defaults():
    """On first boot, if no SystemConfig nodes exist, seed from DEFAULT_SETTINGS."""
    db = _get_db()
    if not db or not db.verify_connectivity():
        return

    with db.session() as session:
        count = session.run("MATCH (c:SystemConfig) RETURN count(c) AS cnt").single()["cnt"]

    if count > 0:
        logger.info(f"SystemConfig already seeded ({count} keys)")
        return

    logger.info("Seeding default config into Neo4j...")
    for key in ("default_provider", "providers", "embedding", "report_retention", "auth"):
        _save_to_db(key, DEFAULT_SETTINGS.get(key, {}))
    logger.info("Default config seeded successfully")


def migrate_json_to_db():
    """One-time migration: read existing settings.json, insert into Neo4j, rename file."""
    if not _LEGACY_SETTINGS_FILE.exists():
        return

    db = _get_db()
    if not db or not db.verify_connectivity():
        return

    # Only migrate if DB has no config yet
    with db.session() as session:
        count = session.run("MATCH (c:SystemConfig) RETURN count(c) AS cnt").single()["cnt"]
    if count > 0:
        # DB already has config, just rename the file
        try:
            _LEGACY_SETTINGS_FILE.rename(_LEGACY_SETTINGS_FILE.with_suffix(".json.migrated"))
            logger.info("Renamed settings.json to .migrated (DB already has config)")
        except Exception:
            pass
        return

    try:
        data = json.loads(_LEGACY_SETTINGS_FILE.read_text())
        for key in ("default_provider", "providers", "embedding", "report_retention"):
            if key in data:
                _save_to_db(key, data[key])
        # Add auth defaults (not in legacy file)
        _save_to_db("auth", DEFAULT_SETTINGS["auth"])
        _LEGACY_SETTINGS_FILE.rename(_LEGACY_SETTINGS_FILE.with_suffix(".json.migrated"))
        logger.info("Migrated settings.json to Neo4j SystemConfig")
    except Exception as e:
        logger.warning(f"Failed to migrate settings.json: {e}")


# ── Internal helpers for provider reinitialization ──

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
        elif name == "litellm":
            from services.llm.litellm_provider import LiteLLMProvider
            _providers["litellm"] = LiteLLMProvider()
    except Exception as e:
        logger.warning(f"Failed to reinit provider {name}: {e}")


def _reinit_embedding_service():
    """Force re-initialization of the embedding service singleton after config change."""
    try:
        from routers.advisor import _get_embedding_svc
        import routers.advisor as adv_mod
        adv_mod._embedding_svc = None  # reset so next call rebuilds
    except Exception as e:
        logger.warning(f"Failed to reinit embedding service: {e}")
