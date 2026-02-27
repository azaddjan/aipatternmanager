"""
AI Field Assist Service — per-field editing support and pattern-level smart actions.

Provides:
- field_assist(): suggest / improve / custom for a single field
- smart_action(): pattern-level actions (tags, description, relationships, quality, auto-fill)
"""
import json
import logging
from typing import Optional

from services.llm import get_provider
from services.neo4j_service import Neo4jService
from services.prompt_service import get_merged_prompts as _get_prompts

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Field metadata — maps field_name → label + applicable types + guidance
# ---------------------------------------------------------------------------

FIELD_METADATA = {
    # AB (Architecture Blueprint)
    "intent": {
        "label": "Intent",
        "types": ["AB"],
        "guidance": "One-paragraph purpose statement explaining what this blueprint frames and its architectural significance.",
    },
    "problem": {
        "label": "Problem",
        "types": ["AB"],
        "guidance": "The architectural challenge this blueprint addresses. Describe the pain points and complexity.",
    },
    "solution": {
        "label": "Solution",
        "types": ["AB"],
        "guidance": "High-level resolution description. Explain the approach without implementation details.",
    },
    "structural_elements": {
        "label": "Structural Elements",
        "types": ["AB"],
        "guidance": "Description of partitions, planes, and layers. Define the structural boundaries.",
    },
    "invariants": {
        "label": "Invariants",
        "types": ["AB"],
        "guidance": "Non-negotiable architectural rules that must hold across all implementations.",
    },
    "inter_element_contracts": {
        "label": "Inter-Element Contracts",
        "types": ["AB"],
        "guidance": "How the structural elements interact with each other. Define protocols and agreements.",
    },
    "related_patterns_text": {
        "label": "Related Patterns",
        "types": ["AB"],
        "guidance": "References to related architecture patterns. Explain the nature of each relationship.",
    },
    "related_adrs": {
        "label": "Related ADRs",
        "types": ["AB"],
        "guidance": "Related Architecture Decision Records. List key decisions that shape this blueprint.",
    },
    "building_blocks_note": {
        "label": "Building Blocks Note",
        "types": ["AB"],
        "guidance": "How ABBs and SBBs relate to this blueprint. Explain the mapping from abstract to concrete.",
    },
    # ABB (Architecture Building Block)
    "functionality": {
        "label": "Functionality",
        "types": ["ABB"],
        "guidance": "Detailed vendor-neutral description of what this building block does. 3-5 paragraphs. "
                   "Do NOT reference specific products or vendors — describe capabilities abstractly.",
    },
    "quality_attributes": {
        "label": "Quality Attributes",
        "types": ["ABB"],
        "guidance": "Non-functional requirements: latency targets, availability SLAs, throughput expectations, scalability characteristics.",
    },
    "compliance_requirements": {
        "label": "Compliance Requirements",
        "types": ["ABB"],
        "guidance": "Regulatory and compliance frameworks: GDPR, SOC2, ISO 27001, HIPAA, etc. Describe obligations.",
    },
    # SBB (Solution Building Block)
    "specific_functionality": {
        "label": "Specific Functionality",
        "types": ["SBB"],
        "guidance": "Detailed vendor-specific description of how this solution is implemented. 3-5 paragraphs. "
                   "Reference specific products, services, APIs, and configurations.",
    },
    # Shared ABB/SBB
    "inbound_interfaces": {
        "label": "Inbound Interfaces",
        "types": ["ABB", "SBB"],
        "guidance": "APIs, events, protocols, and data formats consumed by this block. Include REST endpoints, message queues, etc.",
    },
    "outbound_interfaces": {
        "label": "Outbound Interfaces",
        "types": ["ABB", "SBB"],
        "guidance": "APIs, events, protocols, and data formats produced by this block. Include downstream integrations.",
    },
    # Shared all-type
    "description": {
        "label": "Description",
        "types": ["AB", "ABB", "SBB"],
        "guidance": "Short 2-3 sentence summary of the pattern. Should capture the key purpose and value.",
    },
    "restrictions": {
        "label": "Restrictions",
        "types": ["AB", "ABB", "SBB"],
        "guidance": "Usage restrictions, platform constraints, licensing limitations. What users must be aware of before adopting.",
    },
    "deprecation_note": {
        "label": "Deprecation Note",
        "types": ["AB", "ABB", "SBB"],
        "guidance": "Reason for deprecation and migration guidance. Only relevant for deprecated patterns.",
    },
}


# ---------------------------------------------------------------------------
# Context builders
# ---------------------------------------------------------------------------

def _build_pattern_summary(pattern_context: dict, pattern_type: str) -> str:
    """Serialize all current form values into readable text for the AI."""
    lines = [f"Pattern Type: {pattern_type}"]

    if pattern_context.get("name"):
        lines.append(f"Name: {pattern_context['name']}")
    if pattern_context.get("category"):
        lines.append(f"Category: {pattern_context['category']}")
    if pattern_context.get("status"):
        lines.append(f"Status: {pattern_context['status']}")
    if pattern_context.get("version"):
        lines.append(f"Version: {pattern_context['version']}")

    # Include all filled text fields
    text_fields = [
        "intent", "problem", "solution", "structural_elements", "invariants",
        "inter_element_contracts", "related_patterns_text", "related_adrs",
        "building_blocks_note", "functionality", "specific_functionality",
        "inbound_interfaces", "outbound_interfaces", "description",
        "restrictions", "quality_attributes", "compliance_requirements",
        "deprecation_note", "vendor", "deployment_model", "cost_tier",
        "licensing", "maturity",
    ]
    for field in text_fields:
        val = pattern_context.get(field)
        if val and str(val).strip():
            meta = FIELD_METADATA.get(field, {})
            label = meta.get("label", field.replace("_", " ").title())
            lines.append(f"\n### {label}\n{val}")

    # Lists
    if pattern_context.get("tags"):
        lines.append(f"\nTags: {', '.join(pattern_context['tags'])}")
    if pattern_context.get("business_capabilities"):
        lines.append(f"\nBusiness Capabilities: {', '.join(pattern_context['business_capabilities'])}")
    if pattern_context.get("sbb_mapping"):
        lines.append("\nSBB Mapping:")
        for m in pattern_context["sbb_mapping"]:
            lines.append(f"  - {m.get('key', '?')}: {m.get('value', '?')}")

    return "\n".join(lines)


def _build_relationship_context(db: Neo4jService, pattern_id: Optional[str]) -> str:
    """Fetch direct relationships for an existing pattern. Returns formatted text."""
    if not pattern_id:
        return "New pattern — no existing relationships."

    pattern = db.get_pattern_with_relationships(pattern_id)
    if not pattern:
        return "Pattern not found in database."

    rels = pattern.get("relationships", [])
    if not rels:
        return "No relationships defined yet."

    lines = []
    # Group by type
    grouped: dict[str, list] = {}
    for r in rels:
        grouped.setdefault(r["type"], []).append(r)

    for rel_type, items in grouped.items():
        lines.append(f"\n{rel_type}:")
        for item in items:
            lines.append(f"  - {item['target_id']}: {item.get('target_name', '')} ({item.get('target_label', '')})")

    return "\n".join(lines)


def _get_empty_fields(pattern_context: dict, pattern_type: str) -> str:
    """List fields that are empty and should be filled for the given pattern type."""
    empty = []
    for field_name, meta in FIELD_METADATA.items():
        if pattern_type not in meta["types"]:
            continue
        val = pattern_context.get(field_name)
        if not val or not str(val).strip():
            empty.append(f"- {field_name} ({meta['label']}): {meta['guidance']}")

    return "\n".join(empty) if empty else "All fields are already filled."


# ---------------------------------------------------------------------------
# Main entry points
# ---------------------------------------------------------------------------

async def field_assist(
    field_name: str,
    action: str,
    custom_prompt: Optional[str],
    current_value: str,
    pattern_context: dict,
    pattern_type: str,
    pattern_id: Optional[str],
    db: Neo4jService,
    provider_name: Optional[str] = None,
    model: Optional[str] = None,
) -> dict:
    """Per-field AI assist: suggest, improve, or custom modify a single field."""

    prompts = _get_prompts()
    fa_prompts = prompts["field_assist"]

    meta = FIELD_METADATA.get(field_name, {
        "label": field_name.replace("_", " ").title(),
        "guidance": "Provide appropriate content for this field.",
    })

    pattern_summary = _build_pattern_summary(pattern_context, pattern_type)
    relationship_context = _build_relationship_context(db, pattern_id)

    # Select prompt template based on action
    if action == "suggest":
        user_prompt = fa_prompts["suggest"].format(
            field_label=meta["label"],
            pattern_type=pattern_type,
            pattern_summary=pattern_summary,
            relationship_context=relationship_context,
            field_guidance=meta.get("guidance", ""),
        )
    elif action == "improve":
        user_prompt = fa_prompts["improve"].format(
            field_label=meta["label"],
            pattern_type=pattern_type,
            current_value=current_value,
            pattern_summary=pattern_summary,
            relationship_context=relationship_context,
            field_guidance=meta.get("guidance", ""),
        )
    elif action == "custom":
        user_prompt = fa_prompts["custom"].format(
            field_label=meta["label"],
            pattern_type=pattern_type,
            custom_prompt=custom_prompt or "Improve this content",
            current_value=current_value or "(empty)",
            pattern_summary=pattern_summary,
            relationship_context=relationship_context,
        )
    else:
        raise ValueError(f"Unknown action: {action}")

    system_prompt = fa_prompts["system"]
    provider = get_provider(provider_name)
    result = await provider.generate(system_prompt, user_prompt, model)

    content = result.get("content", "").strip()
    # Strip any accidental markdown code fences
    if content.startswith("```"):
        lines = content.split("\n")
        # Remove first and last lines if they are fences
        if lines[0].startswith("```"):
            lines = lines[1:]
        if lines and lines[-1].strip() == "```":
            lines = lines[:-1]
        content = "\n".join(lines)

    return {
        "content": content,
        "provider": result.get("provider", ""),
        "model": result.get("model", ""),
    }


async def smart_action(
    action: str,
    pattern_context: dict,
    pattern_type: str,
    pattern_id: Optional[str],
    db: Neo4jService,
    custom_prompt: Optional[str] = None,
    provider_name: Optional[str] = None,
    model: Optional[str] = None,
) -> dict:
    """Pattern-level smart AI actions: tags, description, relationships, quality, auto-fill."""

    prompts = _get_prompts()
    fa_prompts = prompts["field_assist"]
    system_prompt = fa_prompts["system"]

    pattern_summary = _build_pattern_summary(pattern_context, pattern_type)
    relationship_context = _build_relationship_context(db, pattern_id)

    # Actions that need full catalog
    needs_catalog = action in ("suggest_relationships", "quality_check")

    catalog_context = ""
    if needs_catalog:
        from services.advisor_service import _fetch_full_catalog, _build_graph_context
        catalog = _fetch_full_catalog(db)
        catalog_context = _build_graph_context(catalog)

    # Build the appropriate prompt
    if action == "auto_tags":
        existing_tags = ", ".join(pattern_context.get("tags", [])) or "none"
        user_prompt = fa_prompts["auto_tags"].format(
            pattern_type=pattern_type,
            pattern_summary=pattern_summary,
            existing_tags=existing_tags,
        )

    elif action == "generate_description":
        user_prompt = fa_prompts["generate_description"].format(
            pattern_type=pattern_type,
            pattern_summary=pattern_summary,
        )

    elif action == "suggest_relationships":
        user_prompt = fa_prompts["suggest_relationships"].format(
            pattern_type=pattern_type,
            pattern_summary=pattern_summary,
            relationship_context=relationship_context,
            catalog_context=catalog_context,
        )

    elif action == "quality_check":
        user_prompt = fa_prompts["quality_check"].format(
            pattern_type=pattern_type,
            pattern_summary=pattern_summary,
            relationship_context=relationship_context,
            catalog_context=catalog_context,
        )

    elif action == "auto_fill_empty":
        empty_fields = _get_empty_fields(pattern_context, pattern_type)
        user_prompt = fa_prompts["auto_fill_empty"].format(
            pattern_type=pattern_type,
            pattern_summary=pattern_summary,
            empty_fields=empty_fields,
            relationship_context=relationship_context,
        )

    elif action == "custom":
        if not custom_prompt:
            raise ValueError("custom_prompt is required for the custom action")
        user_prompt = (
            f"You are an expert TOGAF architecture assistant. "
            f"The user is working on a {pattern_type} pattern.\n\n"
            f"## Current Pattern Context\n{pattern_summary}\n\n"
            f"{relationship_context}\n\n"
            f"## User Question\n{custom_prompt}\n\n"
            f"Provide a helpful, detailed answer in Markdown format. "
            f"Reference specific fields, relationships, and TOGAF best practices where relevant."
        )

    else:
        raise ValueError(f"Unknown smart action: {action}")

    provider = get_provider(provider_name)
    result = await provider.generate(system_prompt, user_prompt, model)

    raw_content = result.get("content", "").strip()

    # Parse response based on action type
    if action == "custom":
        # Return markdown text directly
        parsed = {"text": raw_content}
    elif action == "generate_description":
        # Plain text response
        content = raw_content
        # Strip markdown fences
        if content.startswith("```"):
            lines = content.split("\n")
            if lines[0].startswith("```"):
                lines = lines[1:]
            if lines and lines[-1].strip() == "```":
                lines = lines[:-1]
            content = "\n".join(lines)
        parsed = {"description": content.strip()}
    else:
        # JSON response for all other actions
        parsed = _parse_json_response(raw_content, action)

    return {
        "result": parsed,
        "provider": result.get("provider", ""),
        "model": result.get("model", ""),
    }


def _parse_json_response(content: str, action: str) -> dict | list:
    """Parse AI response to extract JSON (object or array)."""
    # Strip markdown code fences
    clean = content.strip()
    if clean.startswith("```"):
        lines = clean.split("\n")
        if lines[0].startswith("```"):
            lines = lines[1:]
        if lines and lines[-1].strip() == "```":
            lines = lines[:-1]
        clean = "\n".join(lines)

    try:
        # Try array first (auto_tags)
        if action == "auto_tags":
            start = clean.find("[")
            end = clean.rfind("]") + 1
            if start >= 0 and end > start:
                return json.loads(clean[start:end])

        # Try object
        start = clean.find("{")
        end = clean.rfind("}") + 1
        if start >= 0 and end > start:
            return json.loads(clean[start:end])
    except (json.JSONDecodeError, ValueError) as e:
        logger.warning(f"Failed to parse AI field assist response for {action}: {e}")

    # Fallback per action
    if action == "auto_tags":
        return []
    elif action == "quality_check":
        return {"score": 0, "grade": "?", "issues": [], "suggestions": ["Could not parse AI response"], "strengths": []}
    elif action == "suggest_relationships":
        return {"depends_on": [], "references": [], "reasoning": "Could not parse AI response"}
    elif action == "auto_fill_empty":
        return {}
    return {}
