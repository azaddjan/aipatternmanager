"""
Pattern Discovery Service
Analyzes existing technologies, ABBs, and SBBs to suggest new patterns.
Uses AI to identify gaps and recommend new architecture patterns.
"""
import json
import logging
from typing import Optional

from services.llm import get_provider
from services.neo4j_service import Neo4jService
from services.prompt_service import get_merged_prompts as _get_prompts

logger = logging.getLogger(__name__)


def get_inventory(db: Neo4jService) -> dict:
    """Get a complete inventory of technologies, patterns, and their relationships."""

    # 1. All technologies
    with db.session() as session:
        techs = session.run("""
            MATCH (t:Technology)
            RETURN t.id as id, t.name as name, t.vendor as vendor,
                   t.category as category, t.status as status,
                   t.description as description
            ORDER BY t.category, t.id
        """)
        technologies = [dict(r) for r in techs]

    # 2. All ABBs with their SBB implementations
    with db.session() as session:
        abbs = session.run("""
            MATCH (abb:Pattern {type: 'ABB'})
            OPTIONAL MATCH (sbb:Pattern {type: 'SBB'})-[:IMPLEMENTS]->(abb)
            OPTIONAL MATCH (sbb)-[:USES]->(tech:Technology)
            RETURN abb.id as abb_id, abb.name as abb_name,
                   abb.category as abb_category, abb.status as abb_status,
                   collect(DISTINCT {id: sbb.id, name: sbb.name, status: sbb.status}) as sbbs,
                   collect(DISTINCT tech.id) as tech_ids
            ORDER BY abb.category, abb.id
        """)
        abb_list = []
        for r in abbs:
            sbbs = [s for s in r["sbbs"] if s.get("id")]
            abb_list.append({
                "id": r["abb_id"],
                "name": r["abb_name"],
                "category": r["abb_category"],
                "status": r["abb_status"],
                "sbbs": sbbs,
                "tech_ids": [t for t in r["tech_ids"] if t],
            })

    # 3. Technologies NOT referenced by any SBB
    with db.session() as session:
        unused = session.run("""
            MATCH (t:Technology)
            WHERE NOT EXISTS {
                MATCH (p:Pattern)-[:USES]->(t)
            }
            AND t.status <> 'DEPRECATED'
            RETURN t.id as id, t.name as name, t.vendor as vendor,
                   t.category as category, t.description as description
        """)
        unused_techs = [dict(r) for r in unused]

    # 4. ABBs with no SBB implementations
    with db.session() as session:
        uncovered = session.run("""
            MATCH (abb:Pattern {type: 'ABB'})
            WHERE NOT EXISTS {
                MATCH (sbb:Pattern {type: 'SBB'})-[:IMPLEMENTS]->(abb)
            }
            AND abb.status <> 'DEPRECATED'
            RETURN abb.id as id, abb.name as name, abb.category as category
        """)
        uncovered_abbs = [dict(r) for r in uncovered]

    # 5. Technology combinations (techs used together in SBBs)
    with db.session() as session:
        combos = session.run("""
            MATCH (sbb:Pattern {type: 'SBB'})-[:USES]->(t1:Technology)
            MATCH (sbb)-[:USES]->(t2:Technology)
            WHERE t1.id < t2.id
            RETURN t1.id as tech1, t2.id as tech2,
                   collect(sbb.id) as sbb_ids,
                   count(sbb) as combo_count
            ORDER BY combo_count DESC
            LIMIT 20
        """)
        tech_combos = [dict(r) for r in combos]

    # 6. ALL existing SBBs (full list for deduplication)
    with db.session() as session:
        all_sbbs = session.run("""
            MATCH (sbb:Pattern {type: 'SBB'})
            OPTIONAL MATCH (sbb)-[:USES]->(tech:Technology)
            OPTIONAL MATCH (sbb)-[:IMPLEMENTS]->(abb:Pattern)
            RETURN sbb.id as id, sbb.name as name, sbb.category as category,
                   sbb.status as status,
                   collect(DISTINCT tech.id) as tech_ids,
                   collect(DISTINCT abb.id) as abb_ids
            ORDER BY sbb.id
        """)
        existing_sbbs = []
        for r in all_sbbs:
            existing_sbbs.append({
                "id": r["id"],
                "name": r["name"],
                "category": r["category"],
                "status": r["status"],
                "tech_ids": [t for t in r["tech_ids"] if t],
                "abb_ids": [a for a in r["abb_ids"] if a],
            })

    # 7. Categories summary
    with db.session() as session:
        cat_summary = session.run("""
            MATCH (p:Pattern)
            RETURN p.category as category, p.type as type, count(p) as count
            ORDER BY p.category, p.type
        """)
        categories = {}
        for r in cat_summary:
            cat = r["category"]
            if cat not in categories:
                categories[cat] = {"AB": 0, "ABB": 0, "SBB": 0}
            categories[cat][r["type"]] = r["count"]

    return {
        "technologies": technologies,
        "abbs": abb_list,
        "existing_sbbs": existing_sbbs,
        "unused_technologies": unused_techs,
        "uncovered_abbs": uncovered_abbs,
        "tech_combinations": tech_combos,
        "categories": categories,
        "summary": {
            "total_technologies": len(technologies),
            "total_abbs": len(abb_list),
            "total_sbbs": len(existing_sbbs),
            "unused_tech_count": len(unused_techs),
            "uncovered_abb_count": len(uncovered_abbs),
        },
    }


async def discover_patterns(
    db: Neo4jService,
    provider_name: Optional[str] = None,
    model: Optional[str] = None,
    focus: Optional[str] = None,
) -> dict:
    """Use AI to analyze the inventory and suggest new patterns."""

    prompts = _get_prompts()
    inventory = get_inventory(db)

    # Build summary sections from live data
    tech_summary = "\n".join([
        f"- {t['id']}: {t['name']} ({t['vendor']}, {t['category']})"
        + (f" — {t['description']}" if t.get('description') else "")
        for t in inventory["technologies"]
    ])

    abb_summary = "\n".join([
        f"- {a['id']}: {a['name']} (category: {a['category']}, SBBs: {len(a['sbbs'])})"
        + (f"\n  SBBs: {', '.join(s['id'] for s in a['sbbs'])}" if a['sbbs'] else " [NO SBB IMPLEMENTATIONS]")
        for a in inventory["abbs"]
    ])

    unused_tech_summary = "\n".join([
        f"- {t['id']}: {t['name']} ({t['vendor']}, {t['category']})"
        + (f" — {t['description']}" if t.get('description') else "")
        for t in inventory["unused_technologies"]
    ]) or "None — all technologies are covered."

    combo_summary = "\n".join([
        f"- {c['tech1']} + {c['tech2']} (used together in {c['combo_count']} SBB(s): {', '.join(c['sbb_ids'])})"
        for c in inventory["tech_combinations"]
    ]) or "No combinations found yet."

    cat_summary = "\n".join([
        f"- {cat}: AB={counts.get('AB', 0)}, ABB={counts.get('ABB', 0)}, SBB={counts.get('SBB', 0)}"
        for cat, counts in inventory["categories"].items()
    ])

    existing_sbb_summary = "\n".join([
        f"- {s['id']}: {s['name']} (category: {s['category']}, techs: {', '.join(s['tech_ids']) if s['tech_ids'] else 'none'}, implements: {', '.join(s['abb_ids']) if s['abb_ids'] else 'none'})"
        for s in inventory["existing_sbbs"]
    ]) or "No SBBs exist yet."

    focus_block = f"## Focus Area: {focus}" if focus else ""

    user_prompt = prompts["discovery"]["user"].format(
        tech_count=len(inventory["technologies"]),
        tech_summary=tech_summary,
        abb_count=len(inventory["abbs"]),
        abb_summary=abb_summary,
        sbb_count=len(inventory["existing_sbbs"]),
        existing_sbb_summary=existing_sbb_summary,
        unused_count=len(inventory["unused_technologies"]),
        unused_tech_summary=unused_tech_summary,
        combo_summary=combo_summary,
        cat_summary=cat_summary,
        focus_block=focus_block,
    )

    system_prompt = prompts["discovery"]["system"]
    provider = get_provider(provider_name)
    result = await provider.generate(system_prompt, user_prompt, model)

    # Parse AI response to extract suggestions
    content = result.get("content", "")
    suggestions = _parse_suggestions(content)

    # Post-process: deduplicate against existing patterns
    existing_names = {s["name"].lower().strip() for s in inventory["existing_sbbs"]}
    existing_names.update(a["name"].lower().strip() for a in inventory["abbs"])
    filtered = []
    for s in suggestions:
        name_lower = s["name"].lower().strip()
        # Skip if the name closely matches an existing pattern
        if name_lower in existing_names:
            logger.info(f"Filtered duplicate suggestion: {s['name']}")
            continue
        # Also check for partial matches (>80% word overlap)
        name_words = set(name_lower.split())
        is_dup = False
        for existing in existing_names:
            existing_words = set(existing.split())
            if not name_words or not existing_words:
                continue
            overlap = len(name_words & existing_words) / max(len(name_words), len(existing_words))
            if overlap >= 0.8:
                logger.info(f"Filtered similar suggestion: '{s['name']}' ~ '{existing}'")
                is_dup = True
                break
        if not is_dup:
            filtered.append(s)

    return {
        "suggestions": filtered,
        "inventory_summary": inventory["summary"],
        "provider": result.get("provider", ""),
        "model": result.get("model", ""),
    }


def _parse_suggestions(content: str) -> list[dict]:
    """Parse AI response to extract pattern suggestions."""
    # Try to find JSON array in the content
    try:
        # Look for JSON array in the response
        start = content.find("[")
        end = content.rfind("]") + 1
        if start >= 0 and end > start:
            json_str = content[start:end]
            suggestions = json.loads(json_str)
            if isinstance(suggestions, list):
                # Validate and clean each suggestion
                cleaned = []
                for s in suggestions:
                    cleaned.append({
                        "type": s.get("type", "SBB"),
                        "name": s.get("name", "Unnamed Pattern"),
                        "category": s.get("category", "core"),
                        "implements_abb": s.get("implements_abb"),
                        "technologies": s.get("technologies", []),
                        "rationale": s.get("rationale", ""),
                        "description": s.get("description", ""),
                        "priority": s.get("priority", "MEDIUM"),
                        "synergies": s.get("synergies", ""),
                    })
                return cleaned
    except (json.JSONDecodeError, ValueError) as e:
        logger.warning(f"Failed to parse AI suggestions as JSON: {e}")

    # Fallback: return the raw content as a single suggestion
    return [{
        "type": "SBB",
        "name": "AI Suggestions (see details)",
        "category": "core",
        "implements_abb": None,
        "technologies": [],
        "rationale": content,
        "description": "Could not parse structured suggestions. See rationale for AI output.",
        "priority": "MEDIUM",
        "synergies": "",
    }]
