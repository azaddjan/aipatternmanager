"""
AI Pattern Generation Service.
Uses LLM to generate structured pattern data as JSON.
"""
import json
import logging
from typing import Optional

from services.llm import get_provider
from services.neo4j_service import Neo4jService
from services.prompt_service import get_merged_prompts as _get_prompts

logger = logging.getLogger(__name__)


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


async def analyze_context(
    template_type: str,
    context_notes: str,
    db: Neo4jService,
    provider_name: str | None = None,
    model: str | None = None,
) -> dict:
    """Analyze user's pattern description: predict category, relationships, and generate follow-up questions."""

    # 1. Gather system data from Neo4j
    categories = db.list_categories()
    cat_list = ", ".join(f"{c['code']} ({c['label']})" for c in categories)

    # Always load ABBs — needed for both SBB (implements) and ABB (see existing landscape)
    query = "MATCH (p:Pattern {type: 'ABB'}) RETURN p.id AS id, p.name AS name, p.category AS category ORDER BY p.id"
    with db.session() as session:
        records = session.run(query)
        all_abbs = [dict(r) for r in records]
    abbs_context = ""
    if all_abbs:
        abbs_context = "\n\nExisting ABBs in the system:\n" + "\n".join(
            f"- {a['id']}: {a['name']} (category: {a['category']})" for a in all_abbs
        )

    # Always load SBBs — for both SBB (see siblings) and ABB (understand concrete landscape)
    query = "MATCH (p:Pattern {type: 'SBB'}) RETURN p.id AS id, p.name AS name, p.category AS category ORDER BY p.id"
    with db.session() as session:
        records = session.run(query)
        all_sbbs = [dict(r) for r in records]
    sbbs_context = ""
    if all_sbbs:
        sbbs_context = "\n\nExisting SBBs in the system:\n" + "\n".join(
            f"- {s['id']}: {s['name']} (category: {s['category']})" for s in all_sbbs
        )

    # PBCs — needed for ABB type
    pbcs_context = ""
    if template_type == "ABB":
        pbcs = db.list_pbcs()
        if pbcs:
            pbcs_context = "\n\nExisting Business Capabilities (PBCs) in the system:\n" + "\n".join(
                f"- {p['id']}: {p['name']} (composes: {', '.join(p.get('abb_ids', []))})" for p in pbcs
            )

    # Category overviews — pattern counts per category
    cat_counts = []
    for c in categories:
        query = """
        MATCH (p:Pattern) WHERE p.category = $cat
        RETURN p.type AS type, count(p) AS cnt
        """
        with db.session() as session:
            records = session.run(query, cat=c["code"])
            counts = {r["type"]: r["cnt"] for r in records}
        abb_cnt = counts.get("ABB", 0)
        sbb_cnt = counts.get("SBB", 0)
        if abb_cnt > 0 or sbb_cnt > 0:
            cat_counts.append(f"- {c['code']} ({c['label']}): {abb_cnt} ABBs, {sbb_cnt} SBBs")
    cat_overview = "\n\nCategory overview:\n" + "\n".join(cat_counts) if cat_counts else ""

    # 2. Build the analysis prompt
    type_labels = {
        "AB": "Architecture Blueprint",
        "ABB": "Architecture Building Block (abstract functional component)",
        "SBB": "Solution Building Block (concrete implementation)",
    }
    type_label = type_labels.get(template_type, template_type)

    relationship_instruction = ""
    if template_type == "SBB":
        relationship_instruction = (
            '"predicted_abbs": ["ABB-XX-NNN", ...],  // Which existing ABBs does this SBB implement? Pick from the list above. Return IDs only.\n'
            '    "abb_reasoning": "Brief explanation of why these ABBs were chosen",\n'
        )
    elif template_type == "ABB":
        relationship_instruction = (
            '"predicted_pbcs": ["PBC-NNN", ...],  // Which existing PBCs should compose this ABB? Pick from the list above. Return IDs only.\n'
            '    "pbc_reasoning": "Brief explanation of why these PBCs were chosen",\n'
        )

    system_prompt = (
        "You are an expert enterprise architecture analyst helping users create architecture patterns.\n\n"
        "CRITICAL RULES about pattern types:\n"
        "- ABB (Architecture Building Block) = VENDOR-NEUTRAL abstract capability. NEVER reference specific products, "
        "vendors, or cloud services in an ABB. Example: 'Document Intelligence' (not 'AWS Textract'), "
        "'Text Understanding & NLP' (not 'AWS Comprehend'), 'Vector Search Engine' (not 'Pinecone').\n"
        "- SBB (Solution Building Block) = VENDOR-SPECIFIC concrete implementation. Always references specific products. "
        "Example: 'AWS Textract OCR Service', 'Pinecone Vector Database', 'Azure OpenAI GPT-4'.\n"
        "- AB (Architecture Blueprint) = High-level pattern defining overall system structure.\n\n"
        "If a user selects ABB but describes a vendor-specific service (like AWS Textract, Azure Cognitive Services, "
        "Google Cloud Vision, etc.), you MUST:\n"
        "1. Set type_guidance to explain the mismatch\n"
        "2. Suggest the correct vendor-neutral ABB name (e.g., 'Document Intelligence' instead of 'AWS Textract')\n"
        "3. Explain that the vendor-specific service should be created as an SBB implementing this ABB\n"
        "4. List other vendor alternatives as potential SBBs (e.g., AWS Textract, Azure Document Intelligence, Google Document AI)\n\n"
        "If a user selects SBB but describes something abstract/vendor-neutral, similarly guide them.\n\n"
        "You analyze descriptions, suggest categories, predict relationships, and ask follow-up questions."
    )

    user_prompt = f"""Analyze this pattern description and return a structured analysis.

Pattern type the user selected: {template_type} ({type_label})
User's description: {context_notes}

Available categories: {cat_list}
{cat_overview}
{abbs_context}
{sbbs_context}
{pbcs_context}

Return ONLY a JSON object with this structure:
{{
    "suggested_category": "category_code",  // One of the available category codes above
    "category_reasoning": "Brief explanation of why this category fits best",
    "type_guidance": null or "If the user's description doesn't match the selected type (e.g. vendor-specific description for ABB, or abstract description for SBB), explain what they SHOULD create instead. Include: (1) what the correct vendor-neutral ABB name should be, (2) which vendor-specific SBBs would implement it, (3) whether a matching ABB already exists. Set to null if the type is correct.",
    "suggested_name": "A good vendor-neutral name for ABB, or vendor-specific name for SBB",
    {relationship_instruction}"follow_up_questions": [
        {{"question": "A clarifying question", "hint": "Example or hint for the answer"}},
        {{"question": "Another question", "hint": "Example or hint"}}
    ],
    "context_summary": "Brief summary of what you found in the system that's relevant (existing patterns, technologies, gaps)"
}}

Rules:
- Suggest 2-4 follow-up questions that would help generate a better pattern draft
- Questions should ask about technologies, deployment, constraints, specific requirements, use cases
- For the category, choose the BEST match from the available categories based on the description
- For predicted relationships, only include IDs that exist in the system data above
- The context_summary should mention relevant existing patterns, counts, and technologies found
- CRITICAL: If user selected ABB but described a vendor-specific service, set type_guidance to explain the mismatch and suggest the correct vendor-neutral ABB name + vendor-specific SBBs. Check if a matching ABB already exists in the system.
- CRITICAL: If user selected SBB but described something abstract/vendor-neutral, set type_guidance accordingly.
- suggested_name should always be appropriate for the pattern type (vendor-neutral for ABB, vendor-specific for SBB)
- Return ONLY valid JSON, no markdown fences or extra text"""

    # 3. Call LLM
    provider = get_provider(provider_name)
    result = await provider.generate(system_prompt, user_prompt, model)

    # 4. Parse JSON response
    raw_content = result.get("content", "")
    try:
        start = raw_content.find("{")
        end = raw_content.rfind("}") + 1
        if start >= 0 and end > start:
            parsed = json.loads(raw_content[start:end])
        else:
            raise ValueError("No JSON object found")
    except (json.JSONDecodeError, ValueError) as e:
        logger.warning(f"Failed to parse analyze_context response: {e}")
        # Fallback
        parsed = {
            "suggested_category": categories[0]["code"] if categories else "core",
            "category_reasoning": "Could not analyze — using default category",
            "follow_up_questions": [
                {"question": "What is the main purpose of this pattern?", "hint": "Describe the core functionality"},
                {"question": "What technologies should it use?", "hint": "e.g., specific frameworks, cloud services"},
            ],
            "context_summary": "Analysis failed — please provide more detail and try again.",
        }

    # 5. Validate: ensure suggested_category is valid
    valid_codes = {c["code"] for c in categories}
    if parsed.get("suggested_category") not in valid_codes:
        # Try to find closest match or default
        parsed["suggested_category"] = categories[0]["code"] if categories else "core"

    # Validate predicted ABBs exist
    if template_type == "SBB" and parsed.get("predicted_abbs"):
        query = "MATCH (p:Pattern {type: 'ABB'}) RETURN p.id AS id"
        with db.session() as session:
            records = session.run(query)
            valid_abbs = {r["id"] for r in records}
        parsed["predicted_abbs"] = [a for a in parsed["predicted_abbs"] if a in valid_abbs]

    # Validate predicted PBCs exist
    if template_type == "ABB" and parsed.get("predicted_pbcs"):
        pbcs_all = db.list_pbcs()
        valid_pbc_ids = {p["id"] for p in pbcs_all}
        parsed["predicted_pbcs"] = [p for p in parsed["predicted_pbcs"] if p in valid_pbc_ids]

    return parsed


async def generate_pattern(
    template_type: str,
    parent_abb_id: str | None,
    context_notes: str,
    db: Neo4jService,
    provider_name: str | None = None,
    model: str | None = None,
    enriched_context: str | None = None,
) -> dict:
    """Generate a new pattern draft using AI. Returns structured JSON."""
    prompts = _get_prompts()
    context = _build_context(db, parent_abb_id)

    context_block = f"Context from existing patterns:\n{context}" if context else ""
    notes_block = f"Additional notes:\n{context_notes}" if context_notes else ""
    enriched_block = f"\nEnriched context from analysis:\n{enriched_context}" if enriched_context else ""

    user_prompt = prompts["authoring"]["generate"].format(
        template_type=template_type,
        context_block=context_block,
        notes_block=notes_block + enriched_block,
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
