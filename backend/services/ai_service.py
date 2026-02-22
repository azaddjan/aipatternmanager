"""
AI Pattern Generation Service.
Uses LLM to generate structured pattern data as JSON.
"""
import json
import logging
import yaml
from pathlib import Path
from typing import Optional

from services.llm import get_provider
from services.neo4j_service import Neo4jService

logger = logging.getLogger(__name__)

PROMPTS_FILE = Path("/app/prompts.yaml")

_prompts_cache = None


def _get_prompts() -> dict:
    global _prompts_cache
    if _prompts_cache is None:
        _prompts_cache = yaml.safe_load(PROMPTS_FILE.read_text(encoding="utf-8"))
    return _prompts_cache


def _build_context(db: Neo4jService, parent_abb_id: str | None = None) -> str:
    """Build context string with existing patterns for the AI to reference."""
    context_parts = []

    if parent_abb_id:
        parent = db.get_pattern_with_relationships(parent_abb_id)
        if parent:
            context_parts.append(f"## Parent ABB: {parent['id']} — {parent['name']}")
            if parent.get("functionality"):
                context_parts.append(f"Functionality: {parent['functionality']}")
            context_parts.append("")

            # Include sibling SBBs
            siblings_query = f"""
            MATCH (sbb:Pattern {{type: 'SBB'}})-[:IMPLEMENTS]->(abb:Pattern {{id: '{parent_abb_id}'}})
            RETURN sbb.id as id, sbb.name as name
            """
            with db.session() as session:
                records = session.run(siblings_query)
                siblings = [dict(r) for r in records]

            if siblings:
                context_parts.append("## Existing SBB implementations:")
                for s in siblings:
                    context_parts.append(f"- {s['id']}: {s['name']}")
                context_parts.append("")

    return "\n".join(context_parts)


async def generate_pattern(
    template_type: str,
    parent_abb_id: str | None,
    context_notes: str,
    db: Neo4jService,
    provider_name: str | None = None,
    model: str | None = None,
) -> dict:
    """Generate a new pattern draft using AI. Returns structured JSON."""
    prompts = _get_prompts()
    context = _build_context(db, parent_abb_id)

    context_block = f"Context from existing patterns:\n{context}" if context else ""
    notes_block = f"Additional notes:\n{context_notes}" if context_notes else ""

    user_prompt = prompts["authoring"]["generate"].format(
        template_type=template_type,
        context_block=context_block,
        notes_block=notes_block,
    )

    system_prompt = prompts["authoring"]["system"]
    provider = get_provider(provider_name)
    result = await provider.generate(system_prompt, user_prompt, model)

    # Parse the AI response as JSON
    raw_content = result.get("content", "")
    structured = _parse_json_response(raw_content, template_type)

    return {
        "content": structured,
        "provider": result.get("provider", ""),
        "model": result.get("model", ""),
    }


def _parse_json_response(content: str, template_type: str) -> dict:
    """Parse AI response to extract structured JSON fields."""
    # Try to find JSON object in the response
    try:
        start = content.find("{")
        end = content.rfind("}") + 1
        if start >= 0 and end > start:
            json_str = content[start:end]
            parsed = json.loads(json_str)
            if isinstance(parsed, dict):
                return parsed
    except (json.JSONDecodeError, ValueError) as e:
        logger.warning(f"Failed to parse AI response as JSON: {e}")

    # Fallback: return name + raw content as functionality/intent
    fallback = {"name": "AI-Generated Pattern"}
    if template_type == "AB":
        fallback["intent"] = content
    elif template_type == "ABB":
        fallback["functionality"] = content
    else:
        fallback["specific_functionality"] = content
    return fallback
