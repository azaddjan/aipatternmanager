"""
Intelligent Pattern Advisor Service (GraphRAG)
Pipeline: Embed → Vector Search → Graph Expand → Context Build → LLM Reason → Parse
"""
import json
import logging
from typing import Optional

from services.llm import get_provider
from services.neo4j_service import Neo4jService
from services.embedding_service import EmbeddingService
from services.prompt_service import get_merged_prompts as _get_prompts

logger = logging.getLogger(__name__)


def _fetch_full_catalog(db: Neo4jService) -> dict:
    """Fetch the complete pattern catalog with all relationships for LLM context."""

    # 1. All PBCs with their composed ABBs
    with db.session() as session:
        pbcs_raw = session.run("""
            MATCH (pbc:PBC)
            OPTIONAL MATCH (pbc)-[:COMPOSES]->(abb:Pattern)
            RETURN pbc.id as id, pbc.name as name, pbc.description as description,
                   pbc.status as status,
                   collect(DISTINCT {id: abb.id, name: abb.name}) as composed_abbs
            ORDER BY pbc.id
        """)
        pbcs = [dict(r) for r in pbcs_raw]

    # 2. All ABBs with functionality, SBB implementations, relationships
    with db.session() as session:
        abbs_raw = session.run("""
            MATCH (abb:Pattern {type: 'ABB'})
            OPTIONAL MATCH (sbb:Pattern {type: 'SBB'})-[:IMPLEMENTS]->(abb)
            OPTIONAL MATCH (abb)-[:DEPENDS_ON]->(dep:Pattern)
            RETURN abb.id as id, abb.name as name, abb.category as category,
                   abb.status as status, abb.functionality as functionality,
                   abb.business_capabilities as business_capabilities,
                   abb.restrictions as restrictions,
                   abb.description as description,
                   abb.quality_attributes as quality_attributes,
                   abb.compliance_requirements as compliance_requirements,
                   abb.inbound_interfaces as inbound_interfaces,
                   abb.outbound_interfaces as outbound_interfaces,
                   abb.tags as tags,
                   abb.deprecation_note as deprecation_note,
                   collect(DISTINCT {id: sbb.id, name: sbb.name, status: sbb.status}) as sbbs,
                   collect(DISTINCT dep.id) as depends_on
            ORDER BY abb.category, abb.id
        """)
        abbs = []
        for r in abbs_raw:
            abbs.append({
                "id": r["id"], "name": r["name"], "category": r["category"],
                "status": r["status"],
                "functionality": r["functionality"],
                "business_capabilities": r["business_capabilities"] or [],
                "restrictions": r["restrictions"],
                "description": r["description"],
                "quality_attributes": r["quality_attributes"],
                "compliance_requirements": r["compliance_requirements"],
                "inbound_interfaces": r["inbound_interfaces"],
                "outbound_interfaces": r["outbound_interfaces"],
                "tags": r["tags"] or [],
                "deprecation_note": r["deprecation_note"],
                "sbbs": [s for s in r["sbbs"] if s.get("id")],
                "depends_on": [d for d in r["depends_on"] if d],
            })

    # 3. All SBBs with technology links
    with db.session() as session:
        sbbs_raw = session.run("""
            MATCH (sbb:Pattern {type: 'SBB'})
            OPTIONAL MATCH (sbb)-[:IMPLEMENTS]->(abb:Pattern)
            OPTIONAL MATCH (sbb)-[:USES]->(tech:Technology)
            OPTIONAL MATCH (sbb)-[:COMPATIBLE_WITH]->(compat:Technology)
            OPTIONAL MATCH (sbb)-[:DEPENDS_ON]->(dep:Pattern)
            RETURN sbb.id as id, sbb.name as name, sbb.category as category,
                   sbb.status as status,
                   sbb.specific_functionality as specific_functionality,
                   sbb.restrictions as restrictions,
                   sbb.description as description,
                   sbb.vendor as vendor,
                   sbb.deployment_model as deployment_model,
                   sbb.cost_tier as cost_tier,
                   sbb.licensing as licensing,
                   sbb.maturity as maturity,
                   sbb.inbound_interfaces as inbound_interfaces,
                   sbb.outbound_interfaces as outbound_interfaces,
                   sbb.sbb_mapping as sbb_mapping,
                   sbb.business_capabilities as business_capabilities,
                   sbb.tags as tags,
                   sbb.deprecation_note as deprecation_note,
                   collect(DISTINCT abb.id) as implements_abbs,
                   collect(DISTINCT {id: tech.id, name: tech.name, vendor: tech.vendor}) as uses_technologies,
                   collect(DISTINCT {id: compat.id, name: compat.name}) as compatible_technologies,
                   collect(DISTINCT dep.id) as depends_on
            ORDER BY sbb.category, sbb.id
        """)
        sbbs = []
        for r in sbbs_raw:
            sbbs.append({
                "id": r["id"], "name": r["name"], "category": r["category"],
                "status": r["status"],
                "specific_functionality": r["specific_functionality"],
                "restrictions": r["restrictions"],
                "description": r["description"],
                "vendor": r["vendor"],
                "deployment_model": r["deployment_model"],
                "cost_tier": r["cost_tier"],
                "licensing": r["licensing"],
                "maturity": r["maturity"],
                "inbound_interfaces": r["inbound_interfaces"],
                "outbound_interfaces": r["outbound_interfaces"],
                "sbb_mapping": r["sbb_mapping"],
                "business_capabilities": r["business_capabilities"] or [],
                "tags": r["tags"] or [],
                "deprecation_note": r["deprecation_note"],
                "implements_abbs": [a for a in r["implements_abbs"] if a],
                "uses_technologies": [t for t in r["uses_technologies"] if t.get("id")],
                "compatible_technologies": [t for t in r["compatible_technologies"] if t.get("id")],
                "depends_on": [d for d in r["depends_on"] if d],
            })

    # 4. All Technologies
    with db.session() as session:
        techs_raw = session.run("""
            MATCH (t:Technology)
            OPTIONAL MATCH (sbb:Pattern)-[:USES]->(t)
            RETURN t.id as id, t.name as name, t.vendor as vendor,
                   t.category as category, t.status as status,
                   t.description as description,
                   collect(DISTINCT sbb.id) as used_by_sbbs
            ORDER BY t.category, t.id
        """)
        technologies = [dict(r) for r in techs_raw]

    return {"pbcs": pbcs, "abbs": abbs, "sbbs": sbbs, "technologies": technologies}


def _build_graph_context(catalog: dict) -> str:
    """Serialize the full knowledge graph into structured text for LLM context."""
    sections = []

    # PBCs
    sections.append("## Packaged Business Capabilities (PBCs)")
    for pbc in catalog["pbcs"]:
        composed = ", ".join(a["id"] for a in pbc["composed_abbs"] if a.get("id")) or "none"
        desc = f"\n  Description: {pbc['description']}" if pbc.get("description") else ""
        sections.append(f"- {pbc['id']}: {pbc['name']} (status: {pbc['status']}){desc}")
        sections.append(f"  Composes ABBs: {composed}")

    # ABBs
    sections.append("\n## Architecture Building Blocks (ABBs)")
    for abb in catalog["abbs"]:
        sections.append(f"\n### {abb['id']}: {abb['name']} [{abb['category']}] ({abb['status']})")
        if abb.get("description"):
            sections.append(f"  Description: {abb['description'][:200]}")
        if abb.get("functionality"):
            sections.append(f"  Functionality: {abb['functionality'][:300]}")
        if abb.get("business_capabilities"):
            sections.append(f"  Business Capabilities: {', '.join(abb['business_capabilities'])}")
        if abb.get("quality_attributes"):
            sections.append(f"  Quality Attributes: {abb['quality_attributes'][:200]}")
        if abb.get("compliance_requirements"):
            sections.append(f"  Compliance Requirements: {abb['compliance_requirements'][:200]}")
        if abb.get("inbound_interfaces"):
            sections.append(f"  Inbound Interfaces: {abb['inbound_interfaces'][:200]}")
        if abb.get("outbound_interfaces"):
            sections.append(f"  Outbound Interfaces: {abb['outbound_interfaces'][:200]}")
        if abb.get("restrictions"):
            sections.append(f"  RESTRICTIONS: {abb['restrictions']}")
        if abb.get("tags"):
            sections.append(f"  Tags: {', '.join(abb['tags'])}")
        if abb.get("deprecation_note"):
            sections.append(f"  ⚠ DEPRECATED: {abb['deprecation_note']}")
        if abb["sbbs"]:
            sbb_list = ", ".join(f"{s['id']} ({s['name']})" for s in abb["sbbs"])
            sections.append(f"  SBB Implementations: {sbb_list}")
        else:
            sections.append("  SBB Implementations: NONE (gap)")
        if abb["depends_on"]:
            sections.append(f"  Depends On: {', '.join(abb['depends_on'])}")

    # SBBs
    sections.append("\n## Solution Building Blocks (SBBs)")
    for sbb in catalog["sbbs"]:
        sections.append(f"\n### {sbb['id']}: {sbb['name']} [{sbb['category']}] ({sbb['status']})")
        if sbb.get("description"):
            sections.append(f"  Description: {sbb['description'][:200]}")
        if sbb["implements_abbs"]:
            sections.append(f"  Implements: {', '.join(sbb['implements_abbs'])}")
        if sbb.get("specific_functionality"):
            sections.append(f"  Implementation: {sbb['specific_functionality'][:300]}")
        if sbb.get("vendor"):
            sections.append(f"  Vendor: {sbb['vendor']}")
        if sbb.get("deployment_model"):
            sections.append(f"  Deployment Model: {sbb['deployment_model']}")
        if sbb.get("cost_tier"):
            sections.append(f"  Cost Tier: {sbb['cost_tier']}")
        if sbb.get("licensing"):
            sections.append(f"  Licensing: {sbb['licensing']}")
        if sbb.get("maturity"):
            sections.append(f"  Maturity: {sbb['maturity']}")
        if sbb.get("inbound_interfaces"):
            sections.append(f"  Inbound Interfaces: {sbb['inbound_interfaces'][:200]}")
        if sbb.get("outbound_interfaces"):
            sections.append(f"  Outbound Interfaces: {sbb['outbound_interfaces'][:200]}")
        # sbb_mapping: list of {key, value} dicts
        mapping = sbb.get("sbb_mapping")
        if mapping:
            if isinstance(mapping, str):
                try:
                    import json as _json
                    mapping = _json.loads(mapping)
                except Exception:
                    mapping = []
            if isinstance(mapping, list):
                map_parts = [f"{m.get('key', '')}: {m.get('value', '')}" for m in mapping if isinstance(m, dict)]
                if map_parts:
                    sections.append(f"  Technology Stack: {' | '.join(map_parts)}")
        if sbb.get("business_capabilities"):
            sections.append(f"  Business Capabilities: {', '.join(sbb['business_capabilities'])}")
        if sbb.get("restrictions"):
            sections.append(f"  RESTRICTIONS: {sbb['restrictions']}")
        if sbb.get("tags"):
            sections.append(f"  Tags: {', '.join(sbb['tags'])}")
        if sbb.get("deprecation_note"):
            sections.append(f"  ⚠ DEPRECATED: {sbb['deprecation_note']}")
        if sbb["uses_technologies"]:
            tech_list = ", ".join(f"{t['id']} ({t['name']}, {t['vendor']})" for t in sbb["uses_technologies"])
            sections.append(f"  Uses Technologies: {tech_list}")
        if sbb["compatible_technologies"]:
            sections.append(f"  Compatible With: {', '.join(t['id'] for t in sbb['compatible_technologies'])}")
        if sbb["depends_on"]:
            sections.append(f"  Depends On: {', '.join(sbb['depends_on'])}")

    # Technologies
    sections.append("\n## Technology Registry")
    for tech in catalog["technologies"]:
        used_by = ", ".join(tech.get("used_by_sbbs", []) or []) or "none"
        desc = f" — {tech['description'][:200]}" if tech.get("description") else ""
        sections.append(f"- {tech['id']}: {tech['name']} ({tech['vendor']}, {tech['category']}, {tech['status']}){desc}")
        sections.append(f"  Used by SBBs: {used_by}")

    # Summary
    sections.append(f"\n## Summary: {len(catalog['pbcs'])} PBCs, {len(catalog['abbs'])} ABBs, {len(catalog['sbbs'])} SBBs, {len(catalog['technologies'])} Technologies")

    return "\n".join(sections)


def _format_vector_matches(pattern_matches: list, tech_matches: list, pbc_matches: list) -> str:
    """Format vector search results as text for the LLM prompt."""
    lines = []

    if pattern_matches:
        lines.append("### Most Relevant Patterns (by semantic similarity):")
        for m in pattern_matches:
            lines.append(f"- {m['id']}: {m['name']} ({m['type']}, {m['category']}) — similarity: {m['score']:.3f}")

    if tech_matches:
        lines.append("\n### Most Relevant Technologies:")
        for m in tech_matches:
            lines.append(f"- {m['id']}: {m['name']} ({m.get('vendor', '')}) — similarity: {m['score']:.3f}")

    if pbc_matches:
        lines.append("\n### Most Relevant PBCs:")
        for m in pbc_matches:
            lines.append(f"- {m['id']}: {m['name']} — similarity: {m['score']:.3f}")

    return "\n".join(lines) if lines else "No vector search results (embeddings may not be generated yet)."


async def clarify_problem(
    db: Neo4jService,
    embedding_svc: EmbeddingService,
    problem: str,
    category_focus: Optional[str] = None,
    technology_preferences: list[str] = None,
    provider_name: Optional[str] = None,
    model: Optional[str] = None,
) -> dict:
    """Pre-flight check: assess if the problem needs clarification before full analysis.

    Uses a lightweight LLM call with only vector match context (no full catalog).
    Returns {needs_clarification: bool, questions: [...], provider, model}.
    """
    prompts = _get_prompts()

    # Step 1: Get vector matches for lightweight context
    vector_matches_text = "No vector search results available."
    if embedding_svc.available:
        try:
            query_embedding = embedding_svc.generate_embedding(problem)
            pattern_matches = []
            tech_matches = []
            pbc_matches = []
            try:
                pattern_matches = db.vector_search_patterns(query_embedding, limit=5)
            except Exception as e:
                logger.warning(f"Clarify: pattern vector search failed: {e}")
            try:
                tech_matches = db.vector_search_technologies(query_embedding, limit=3)
            except Exception as e:
                logger.warning(f"Clarify: technology vector search failed: {e}")
            try:
                pbc_matches = db.vector_search_pbcs(query_embedding, limit=2)
            except Exception as e:
                logger.warning(f"Clarify: PBC vector search failed: {e}")
            vector_matches_text = _format_vector_matches(pattern_matches, tech_matches, pbc_matches)
        except Exception as e:
            logger.warning(f"Clarify: embedding generation failed: {e}")

    # Step 2: Build lightweight prompt (NO full catalog — keeps it fast and cheap)
    system_prompt = prompts["advisor_clarify"]["system"]
    user_prompt = prompts["advisor_clarify"]["user"].format(
        problem=problem,
        category_focus=category_focus or "none specified",
        tech_preferences=", ".join(technology_preferences) if technology_preferences else "none specified",
        vector_matches=vector_matches_text,
    )

    # Step 3: LLM call
    provider = get_provider(provider_name)
    result = await provider.generate(system_prompt, user_prompt, model)

    # Step 4: Parse response
    content = result.get("content", "")
    parsed = _parse_clarify_response(content)

    return {
        **parsed,
        "provider": result.get("provider", ""),
        "model": result.get("model", ""),
    }


def _parse_clarify_response(content: str) -> dict:
    """Parse the clarification LLM response into structured output."""
    try:
        start = content.find("{")
        end = content.rfind("}") + 1
        if start >= 0 and end > start:
            parsed = json.loads(content[start:end])
            if isinstance(parsed, dict):
                needs = parsed.get("needs_clarification", False)
                questions = []
                for q in parsed.get("questions", []):
                    questions.append({
                        "id": q.get("id", f"q{len(questions)+1}"),
                        "question": q.get("question", ""),
                        "context": q.get("context", ""),
                        "suggested_options": q.get("suggested_options", []),
                    })
                return {
                    "needs_clarification": bool(needs),
                    "questions": questions,
                }
    except (json.JSONDecodeError, ValueError) as e:
        logger.warning(f"Failed to parse clarification response: {e}")

    # Fallback: proceed without clarification (never block the user)
    return {"needs_clarification": False, "questions": []}


async def analyze_problem(
    db: Neo4jService,
    embedding_svc: EmbeddingService,
    problem: str,
    category_focus: Optional[str] = None,
    technology_preferences: list[str] = None,
    include_gap_analysis: bool = True,
    provider_name: Optional[str] = None,
    model: Optional[str] = None,
    clarifications: Optional[dict] = None,
) -> dict:
    """Main GraphRAG entry point: Embed → Vector Search → Graph Context → LLM Reason."""

    prompts = _get_prompts()

    # Step 1: EMBED the user's problem
    vector_matches_text = "Embedding service not available — using full catalog search."
    pattern_matches = []
    tech_matches = []
    pbc_matches = []

    if embedding_svc.available:
        try:
            query_embedding = embedding_svc.generate_embedding(problem)

            # Step 2: VECTOR RETRIEVE
            try:
                pattern_matches = db.vector_search_patterns(query_embedding, limit=10)
            except Exception as e:
                logger.warning(f"Pattern vector search failed (index may not exist): {e}")
            try:
                tech_matches = db.vector_search_technologies(query_embedding, limit=5)
            except Exception as e:
                logger.warning(f"Technology vector search failed: {e}")
            try:
                pbc_matches = db.vector_search_pbcs(query_embedding, limit=3)
            except Exception as e:
                logger.warning(f"PBC vector search failed: {e}")

            vector_matches_text = _format_vector_matches(pattern_matches, tech_matches, pbc_matches)
        except Exception as e:
            logger.warning(f"Embedding generation failed: {e}")

    # Step 3 & 4: Fetch full catalog and build context
    catalog = _fetch_full_catalog(db)
    graph_context = _build_graph_context(catalog)

    # Step 5: LLM REASON
    # Enrich the problem with clarification answers if provided
    enriched_problem = problem
    if clarifications:
        clarification_text = "\n\n## Additional Context from User Clarifications:\n"
        for qid, answer in clarifications.items():
            clarification_text += f"- {qid}: {answer}\n"
        enriched_problem = problem + clarification_text

    system_prompt = prompts["advisor"]["system"]
    user_prompt = prompts["advisor"]["user"].format(
        problem=enriched_problem,
        graph_context=graph_context,
        vector_matches=vector_matches_text,
        category_focus=category_focus or "none specified",
        tech_preferences=", ".join(technology_preferences) if technology_preferences else "none specified",
        include_gap_analysis="yes" if include_gap_analysis else "no",
    )

    provider = get_provider(provider_name)
    result = await provider.generate(system_prompt, user_prompt, model)

    # Step 6: PARSE
    content = result.get("content", "")
    analysis = _parse_advisor_response(content)

    return {
        "analysis": analysis,
        "vector_matches": {
            "patterns": pattern_matches[:5],  # Top 5 for display
            "technologies": tech_matches[:3],
            "pbcs": pbc_matches[:3],
        },
        "provider": result.get("provider", ""),
        "model": result.get("model", ""),
        "graph_stats": {
            "pbcs": len(catalog["pbcs"]),
            "abbs": len(catalog["abbs"]),
            "sbbs": len(catalog["sbbs"]),
            "technologies": len(catalog["technologies"]),
        },
    }


def _parse_advisor_response(content: str) -> dict:
    """Parse the LLM's JSON response into structured advisor output."""
    try:
        start = content.find("{")
        end = content.rfind("}") + 1
        if start >= 0 and end > start:
            json_str = content[start:end]
            parsed = json.loads(json_str)
            if isinstance(parsed, dict):
                return {
                    "summary": parsed.get("summary", ""),
                    "recommended_pbcs": parsed.get("recommended_pbcs", []),
                    "recommended_abbs": parsed.get("recommended_abbs", []),
                    "recommended_sbbs": parsed.get("recommended_sbbs", []),
                    "sbb_comparisons": parsed.get("sbb_comparisons", []),
                    "architecture_composition": parsed.get("architecture_composition", ""),
                    "data_flow": parsed.get("data_flow", ""),
                    "platform_gaps": parsed.get("platform_gaps", []),
                    "confidence": parsed.get("confidence", "MEDIUM"),
                    "reasoning": parsed.get("reasoning", ""),
                }
    except (json.JSONDecodeError, ValueError) as e:
        logger.warning(f"Failed to parse advisor response as JSON: {e}")

    # Fallback: return raw content
    return {
        "summary": content,
        "recommended_pbcs": [],
        "recommended_abbs": [],
        "recommended_sbbs": [],
        "sbb_comparisons": [],
        "architecture_composition": content,
        "data_flow": "",
        "platform_gaps": [],
        "confidence": "LOW",
        "reasoning": "Could not parse structured response from LLM.",
    }
