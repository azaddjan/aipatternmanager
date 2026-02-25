"""
Centralized Prompt Service
Loads prompts from YAML defaults, merges with Neo4j overrides.
All 4 AI services delegate to this single module.
"""
import copy
import json
import logging
import re
import time
import yaml
from datetime import datetime, timezone
from pathlib import Path

logger = logging.getLogger(__name__)

PROMPTS_FILE = Path("/app/prompts.yaml")

# YAML defaults — loaded once, never changes at runtime
_yaml_cache = None

# Neo4j overrides — refreshed every 60 seconds
_override_cache: dict = {}
_override_cache_timestamp: float = 0.0
_CACHE_TTL_SECONDS = 60

# Section labels for the frontend UI
SECTION_LABELS = {
    "authoring": "AI Authoring",
    "discovery": "Pattern Discovery",
    "advisor": "Pattern Advisor (GraphRAG)",
    "advisor_clarify": "Advisor Clarification",
    "field_assist": "Field Assist",
    "technology_suggest": "Technology Suggest",
    "technology_assist": "Technology Assist",
}


# ---------------------------------------------------------------------------
# Internal loaders
# ---------------------------------------------------------------------------

def _load_yaml_defaults() -> dict:
    """Load and cache the YAML file (immutable defaults)."""
    global _yaml_cache
    if _yaml_cache is None:
        _yaml_cache = yaml.safe_load(PROMPTS_FILE.read_text(encoding="utf-8"))
    return _yaml_cache


def _load_overrides() -> dict:
    """Load all prompt_override:* keys from Neo4j SystemConfig with TTL cache."""
    global _override_cache, _override_cache_timestamp

    if _override_cache and (time.time() - _override_cache_timestamp) < _CACHE_TTL_SECONDS:
        return _override_cache.copy()

    try:
        from main import db_service
        if not db_service or not db_service.verify_connectivity():
            return _override_cache.copy()
    except Exception:
        return _override_cache.copy()

    overrides = {}
    try:
        with db_service.session() as session:
            result = session.run(
                "MATCH (c:SystemConfig) WHERE c.key STARTS WITH 'prompt_override:' "
                "RETURN c.key AS key, c.value_json AS value_json"
            )
            for record in result:
                # key format: prompt_override:section.sub_prompt
                path = record["key"].replace("prompt_override:", "")
                try:
                    overrides[path] = json.loads(record["value_json"])
                except (json.JSONDecodeError, TypeError):
                    pass
    except Exception as e:
        logger.warning(f"Failed to load prompt overrides: {e}")
        return _override_cache.copy()

    _override_cache = overrides
    _override_cache_timestamp = time.time()
    return overrides.copy()


# ---------------------------------------------------------------------------
# Public API — used by services
# ---------------------------------------------------------------------------

def get_merged_prompts() -> dict:
    """Return the full prompts dict with Neo4j overrides merged on top of YAML defaults.

    Drop-in replacement for the old per-service ``_get_prompts()`` function.
    """
    defaults = _load_yaml_defaults()
    overrides = _load_overrides()

    if not overrides:
        return defaults  # no overrides → avoid deepcopy cost

    merged = copy.deepcopy(defaults)
    for path, value in overrides.items():
        parts = path.split(".", 1)
        if len(parts) == 2:
            section, sub = parts
            if section in merged and isinstance(merged[section], dict):
                merged[section][sub] = value
    return merged


def get_prompt(section: str, sub_prompt: str) -> str:
    """Get a single prompt text, override taking precedence over YAML."""
    overrides = _load_overrides()
    override_key = f"{section}.{sub_prompt}"
    if override_key in overrides:
        return overrides[override_key]

    defaults = _load_yaml_defaults()
    return defaults.get(section, {}).get(sub_prompt, "")


# ---------------------------------------------------------------------------
# Public API — used by admin endpoints
# ---------------------------------------------------------------------------

def get_all_prompts() -> list[dict]:
    """Return every prompt with metadata for the admin UI."""
    defaults = _load_yaml_defaults()
    overrides = _load_overrides()

    prompts = []
    for section, sub_prompts in defaults.items():
        if not isinstance(sub_prompts, dict):
            continue
        for sub_prompt, default_value in sub_prompts.items():
            override_key = f"{section}.{sub_prompt}"
            is_overridden = override_key in overrides
            current_value = overrides[override_key] if is_overridden else default_value

            prompts.append({
                "section": section,
                "section_label": SECTION_LABELS.get(section, section),
                "sub_prompt": sub_prompt,
                "default_value": default_value,
                "current_value": current_value,
                "is_overridden": is_overridden,
                "variables": extract_variables(current_value),
                "token_estimate": estimate_tokens(current_value),
            })

    return prompts


def save_override(section: str, sub_prompt: str, value: str) -> dict:
    """Save a prompt override to Neo4j SystemConfig."""
    defaults = _load_yaml_defaults()
    if section not in defaults or sub_prompt not in defaults.get(section, {}):
        raise ValueError(f"Unknown prompt: {section}.{sub_prompt}")

    from main import db_service

    key = f"prompt_override:{section}.{sub_prompt}"
    value_json = json.dumps(value)
    now = datetime.now(timezone.utc).isoformat()

    with db_service.session() as session:
        session.run(
            "MERGE (c:SystemConfig {key: $key}) "
            "SET c.value_json = $value_json, c.updated_at = $now",
            key=key, value_json=value_json, now=now,
        )

    invalidate_cache()

    return {
        "section": section,
        "sub_prompt": sub_prompt,
        "current_value": value,
        "is_overridden": True,
        "variables": extract_variables(value),
        "token_estimate": estimate_tokens(value),
    }


def delete_override(section: str, sub_prompt: str) -> dict:
    """Delete a prompt override (revert to YAML default)."""
    defaults = _load_yaml_defaults()
    if section not in defaults or sub_prompt not in defaults.get(section, {}):
        raise ValueError(f"Unknown prompt: {section}.{sub_prompt}")

    from main import db_service

    key = f"prompt_override:{section}.{sub_prompt}"
    with db_service.session() as session:
        session.run("MATCH (c:SystemConfig {key: $key}) DELETE c", key=key)

    invalidate_cache()

    default_value = defaults[section][sub_prompt]
    return {
        "section": section,
        "sub_prompt": sub_prompt,
        "current_value": default_value,
        "default_value": default_value,
        "is_overridden": False,
        "variables": extract_variables(default_value),
        "token_estimate": estimate_tokens(default_value),
    }


def invalidate_cache():
    """Force cache refresh on next read. Called after writes."""
    global _override_cache_timestamp
    _override_cache_timestamp = 0.0


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def extract_variables(text: str) -> list[str]:
    """Extract {variable_name} placeholders from prompt text.

    Ignores double-brace ``{{literal}}`` patterns used for JSON examples
    in prompts.yaml.
    """
    if not text:
        return []
    # Remove double braces first (literal JSON braces in prompts)
    cleaned = re.sub(r"\{\{.*?\}\}", "", text, flags=re.DOTALL)
    # Find single-brace variables
    return sorted(set(re.findall(r"\{(\w+)\}", cleaned)))


def estimate_tokens(text: str) -> int:
    """Rough token estimate: word_count * 1.3."""
    if not text:
        return 0
    return int(len(text.split()) * 1.3)
