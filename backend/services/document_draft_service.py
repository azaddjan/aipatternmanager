"""AI Document Drafter — auto-draft complete documents with quality gate + discuss."""
import asyncio
import json
import logging
import re
from typing import AsyncIterator, Callable, Optional

logger = logging.getLogger(__name__)

ProgressCallback = Optional[Callable[[str, int, int, str], None]]


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _parse_json_response(text: str, default: dict) -> dict:
    """Parse JSON from LLM response, handling code fences and extra text."""
    text = text.strip()
    if text.startswith("```json"):
        text = text[7:]
    elif text.startswith("```"):
        text = text[3:]
    if text.endswith("```"):
        text = text[:-3]
    text = text.strip()

    # Attempt 1: Direct parse
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        pass

    # Attempt 2: Find outermost { ... } with string-aware brace matching
    start = text.find("{")
    if start >= 0:
        depth = 0
        in_string = False
        escape = False
        for i in range(start, len(text)):
            c = text[i]
            if escape:
                escape = False
                continue
            if c == '\\' and in_string:
                escape = True
                continue
            if c == '"' and not escape:
                in_string = not in_string
                continue
            if in_string:
                continue
            if c == '{':
                depth += 1
            elif c == '}':
                depth -= 1
                if depth == 0:
                    try:
                        return json.loads(text[start : i + 1])
                    except json.JSONDecodeError:
                        break

    # Attempt 3: Find last } and try from first { to last }
    if start >= 0:
        last_brace = text.rfind("}")
        if last_brace > start:
            try:
                return json.loads(text[start : last_brace + 1])
            except json.JSONDecodeError:
                pass

    logger.warning("Failed to parse JSON from LLM response, using default")
    logger.warning(f"Response length: {len(text)}, first 200: {text[:200]}, last 200: {text[-200:]}")
    return default


def _build_catalog_context(db) -> str:
    """Build catalog summary for LLM context (patterns, technologies, PBCs, categories)."""
    lines = []

    # Categories
    try:
        categories = db.list_categories()
        if categories:
            lines.append("## Existing Categories")
            for c in categories:
                lines.append(f"- {c['code']}: {c.get('label', c['code'])}")
            lines.append("")
    except Exception:
        pass

    # Patterns — list ALL by type so AI can reference exact IDs
    try:
        patterns, total = db.list_patterns(limit=500)
        if patterns:
            lines.append(f"## Existing Patterns ({total} total)")
            for ptype in ["AB", "ABB", "SBB", "PBC"]:
                typed = [p for p in patterns if p.get("type") == ptype][:100]
                if typed:
                    lines.append(f"### {ptype} ({len(typed)})")
                    for p in typed:
                        lines.append(f"- {p['id']}: {p['name']}")
                    lines.append("")
            # Other types
            other = [p for p in patterns if p.get("type") not in ("AB", "ABB", "SBB", "PBC")][:20]
            if other:
                lines.append(f"### Other ({len(other)})")
                for p in other:
                    lines.append(f"- {p['id']}: {p['name']} [{p.get('type', '?')}]")
                lines.append("")
    except Exception:
        pass

    # Technologies — list ALL so AI can reference exact IDs
    try:
        techs, total = db.list_technologies(limit=500)
        if techs:
            lines.append(f"## Existing Technologies ({total} total)")
            for t in techs[:100]:
                lines.append(f"- {t['id']}: {t['name']} ({t.get('vendor', '')}) [{t.get('category', '')}]")
            if total > 100:
                lines.append(f"... and {total - 100} more")
            lines.append("")
    except Exception:
        pass

    # PBCs
    try:
        pbcs = db.list_pbcs()
        if pbcs:
            lines.append(f"## Existing Business Capabilities ({len(pbcs)} total)")
            for p in pbcs[:50]:
                lines.append(f"- {p['id']}: {p['name']}")
            lines.append("")
    except Exception:
        pass

    return "\n".join(lines)


def _build_existing_docs_context(db) -> str:
    """List existing document titles so AI avoids duplication."""
    try:
        docs, total = db.list_documents(limit=50)
        if not docs:
            return "(no existing documents)"
        lines = [f"## Existing Documents ({total} total)"]
        for d in docs:
            lines.append(f"- [{d.get('doc_type', '?')}] {d.get('title', 'Untitled')}")
        return "\n".join(lines)
    except Exception:
        return "(unable to load existing documents)"


def _extract_entity_ids(draft: dict, outline: dict = None) -> list[str]:
    """Extract all entity IDs referenced in draft and/or outline."""
    ids = set()
    # From draft linked_entities
    for e in draft.get("linked_entities", []):
        if e.get("id"):
            ids.add(e["id"])
    # From outline target_entities and per-section catalog_refs
    if outline:
        for eid in outline.get("target_entities", []):
            ids.add(eid)
        for sec in outline.get("sections", []):
            for ref in sec.get("catalog_refs", []):
                ids.add(ref)
    return list(ids)


def _build_filtered_catalog_context(db, ref_ids: list[str]) -> str:
    """Build catalog context containing only specified entity IDs.

    Falls back to full catalog if ref_ids is empty or filtering fails.
    """
    if not ref_ids:
        return _build_catalog_context(db)

    ref_set = {r.lower() for r in ref_ids}
    parts = [f"## Relevant Catalog Items ({len(ref_ids)} referenced)"]

    try:
        # Matching patterns
        patterns, _ = db.list_patterns(limit=500)
        matched_patterns = [p for p in patterns if p["id"].lower() in ref_set]
        if matched_patterns:
            for ptype in ["AB", "ABB", "SBB"]:
                typed = [p for p in matched_patterns if p.get("type") == ptype]
                if typed:
                    parts.append(f"\n### {ptype}s ({len(typed)})")
                    for p in typed:
                        desc_preview = (p.get("description", "") or "")[:150]
                        parts.append(f"- {p['id']}: {p.get('name', '')} — {desc_preview}")

        # Matching technologies
        techs, _ = db.list_technologies(limit=500)
        matched_techs = [t for t in techs if t["id"].lower() in ref_set]
        if matched_techs:
            parts.append(f"\n### Technologies ({len(matched_techs)})")
            for t in matched_techs:
                parts.append(f"- {t['id']}: {t.get('name', '')} ({t.get('vendor', '')}) [{t.get('category', '')}]")

        # Matching PBCs
        pbcs = db.list_pbcs()
        matched_pbcs = [p for p in pbcs if p["id"].lower() in ref_set]
        if matched_pbcs:
            parts.append(f"\n### Business Capabilities ({len(matched_pbcs)})")
            for p in matched_pbcs:
                parts.append(f"- {p['id']}: {p.get('name', '')}")

        # Always include categories (small, needed for context)
        cats = db.list_categories()
        if cats:
            parts.append("\n### Categories")
            for c in cats:
                parts.append(f"- {c['code']}: {c.get('label', c['code'])}")
    except Exception as e:
        logger.warning(f"Catalog filtering failed, falling back to full context: {e}")
        return _build_catalog_context(db)

    filtered = "\n".join(parts)
    logger.info(f"Filtered catalog: {len(ref_ids)} refs → {len(filtered)} chars "
                f"(matched: {len(matched_patterns)} patterns, {len(matched_techs)} techs, {len(matched_pbcs)} PBCs)")
    return filtered


def _should_enrich_section(section: dict, doc_type: str = "guide") -> tuple[bool, str]:
    """Fast, LLM-free heuristic check if a section needs enrichment.

    Returns:
        (should_enrich, reason)
    """
    content = section.get("content", "")
    word_count = len(content.split())

    # Doc-type-aware minimum word thresholds
    min_words = {"adr": 80, "overview": 150}.get(doc_type, 250)

    # Too short
    if word_count < min_words:
        return True, f"short ({word_count} words, min {min_words} for {doc_type})"

    # No catalog references (pattern/tech IDs like ABB-CORE-001, SBB-INTG-002, etc.)
    id_pattern = r'\b(?:AB|ABB|SBB|PBC|TECH)[-_][A-Z]+-?\d*'
    catalog_refs = re.findall(id_pattern, content)
    if not catalog_refs:
        return True, "no catalog references"

    # Too much vague language
    vague_words = len(re.findall(
        r'\b(?:consider|could|might|may|possibly|perhaps|potentially)\b',
        content, re.IGNORECASE
    ))
    if word_count > 0 and vague_words / word_count > 0.02:
        return True, f"vague language ({vague_words} instances in {word_count} words)"

    # No diagrams, tables, or callouts
    has_diagram = "```mermaid" in content
    has_table = "|" in content and "---" in content
    has_callout = "> **" in content
    if not has_diagram and not has_table and not has_callout:
        return True, "no diagrams, tables, or callouts"

    # Section looks complete
    return False, "passes heuristic checks"


# ---------------------------------------------------------------------------
# Clarification Pre-flight — Assess if prompt needs clarification
# ---------------------------------------------------------------------------


def _build_catalog_summary(db) -> str:
    """Build a lightweight catalog summary (names + IDs only) for the clarify prompt."""
    lines = []
    try:
        patterns, _ = db.list_patterns(limit=200)
        if patterns:
            names = [f"{p['id']}: {p['name']}" for p in patterns[:60]]
            lines.append(f"Patterns ({len(patterns)}): " + "; ".join(names))
    except Exception:
        pass
    try:
        techs, _ = db.list_technologies(limit=200)
        if techs:
            names = [f"{t['id']}: {t['name']}" for t in techs[:40]]
            lines.append(f"Technologies ({len(techs)}): " + "; ".join(names))
    except Exception:
        pass
    return "\n".join(lines) if lines else "(empty catalog)"


async def clarify_document_prompt(
    prompt: str,
    doc_type: str,
    target_audience: str,
    db,
    provider_name: Optional[str] = None,
    model: Optional[str] = None,
) -> dict:
    """Pre-flight check: assess if the document prompt needs clarification.

    Returns {needs_clarification: bool, questions: [...], provider, model}.
    Graceful fallback: on any error → proceed without clarification.
    """
    from services.prompt_service import get_merged_prompts
    from services.llm.provider_factory import get_provider

    try:
        prompts = get_merged_prompts()
        dd_prompts = prompts.get("document_drafter", {})
        clarify_template = dd_prompts.get("clarify", "")
        if not clarify_template:
            return {"needs_clarification": False, "questions": []}

        system_prompt = dd_prompts.get("system", "")
        catalog_summary = _build_catalog_summary(db)

        user_prompt = (
            clarify_template
            .replace("{prompt}", prompt)
            .replace("{doc_type}", doc_type)
            .replace("{target_audience}", target_audience)
            .replace("{catalog_summary}", catalog_summary)
        )

        provider = get_provider(provider_name)
        used_model = model or provider.default_model
        result = await provider.generate(system_prompt, user_prompt, used_model)

        parsed = _parse_json_response(result.get("content", ""), default={
            "needs_clarification": False,
            "questions": [],
        })

        # Normalize question structure
        questions = []
        for q in parsed.get("questions", []):
            questions.append({
                "id": q.get("id", f"q{len(questions) + 1}"),
                "question": q.get("question", ""),
                "context": q.get("context", ""),
                "suggested_options": q.get("suggested_options", []),
            })

        return {
            "needs_clarification": bool(parsed.get("needs_clarification", False)),
            "questions": questions,
            "provider": result.get("provider", ""),
            "model": result.get("model", ""),
        }
    except Exception as e:
        logger.warning(f"Document clarification check failed, proceeding without: {e}")
        return {"needs_clarification": False, "questions": []}


# ---------------------------------------------------------------------------
# Planning Phase — Generate document outline
# ---------------------------------------------------------------------------

async def _plan_document(
    prompt: str,
    doc_type: str,
    target_audience: str,
    catalog_context: str,
    existing_docs: str,
    provider,
    system_prompt: str,
    plan_template: str,
    model: str,
) -> dict:
    """Generate a document outline/plan to guide drafting.

    Returns:
        dict with {title, sections, diagrams, target_entities}
    """
    plan_prompt = (
        plan_template
        .replace("{prompt}", prompt)
        .replace("{doc_type}", doc_type)
        .replace("{target_audience}", target_audience)
        .replace("{catalog_context}", catalog_context)
        .replace("{existing_docs}", existing_docs)
    )

    result = await provider.generate(system_prompt, plan_prompt, model)
    logger.info(f"Plan raw response (first 500 chars): {result['content'][:500]}")
    plan = _parse_json_response(result["content"], default={
        "title": "Untitled Document",
        "sections": [
            {"title": "Introduction", "key_points": ["Overview of the topic"], "catalog_refs": []}
        ],
        "diagrams": [],
        "target_entities": [],
    })

    logger.info(f"Plan: {len(plan.get('sections', []))} sections, "
                f"{len(plan.get('diagrams', []))} diagrams, "
                f"{len(plan.get('target_entities', []))} target entities")
    return plan


# ---------------------------------------------------------------------------
# Parallel Section Enrichment
# ---------------------------------------------------------------------------

async def _enrich_single_section(
    section: dict,
    outline_section: dict | None,
    doc_title: str,
    doc_type: str,
    all_section_titles: str,
    target_audience: str,
    catalog_context: str,
    provider,
    system_prompt: str,
    enrich_template: str,
    model: str,
) -> dict:
    """Enrich a single section with deeper detail. Returns updated section dict."""
    key_points = ""
    if outline_section and outline_section.get("key_points"):
        key_points = "\n".join(f"- {kp}" for kp in outline_section["key_points"])
    else:
        key_points = "(no specific key points from outline)"

    enrich_prompt = (
        enrich_template
        .replace("{doc_type}", doc_type)
        .replace("{section_title}", section.get("title", ""))
        .replace("{section_content}", section.get("content", ""))
        .replace("{key_points}", key_points)
        .replace("{target_audience}", target_audience)
        .replace("{doc_title}", doc_title)
        .replace("{all_section_titles}", all_section_titles)
        .replace("{catalog_context}", catalog_context)
    )

    try:
        result = await provider.generate(system_prompt, enrich_prompt, model)
        enriched_content = result["content"].strip()

        # If response looks like JSON (edge case), try to extract content
        if enriched_content.startswith("{"):
            parsed = _parse_json_response(enriched_content, default=None)
            if parsed and parsed.get("content"):
                enriched_content = parsed["content"]

        # Validate enrichment actually added content
        if len(enriched_content) > len(section.get("content", "")) * 0.5:
            return {**section, "content": enriched_content}
        else:
            logger.warning(f"Enrichment for '{section.get('title')}' too short, keeping original")
            return section
    except Exception as e:
        logger.error(f"Failed to enrich section '{section.get('title')}': {e}")
        return section


async def _enrich_sections_parallel(
    draft: dict,
    outline: dict,
    doc_type: str,
    target_audience: str,
    catalog_context: str,
    provider,
    system_prompt: str,
    enrich_template: str,
    model: str,
    sections_to_enrich: set[str] | None = None,
) -> dict:
    """Enrich sections in parallel using asyncio.gather.

    Args:
        sections_to_enrich: If provided, only enrich sections whose titles are in this set.
            If None, enrich all sections (backward compatible).

    Returns:
        Updated draft with enriched sections (preserving original order).
    """
    sections = draft.get("sections", [])
    if not sections:
        return draft

    outline_sections = outline.get("sections", [])
    doc_title = draft.get("title", "Untitled")
    all_section_titles = ", ".join(s.get("title", "?") for s in sections)

    # Build outline lookup by title (case-insensitive)
    outline_lookup = {}
    for os_item in outline_sections:
        outline_lookup[os_item.get("title", "").lower().strip()] = os_item

    # Create enrichment tasks only for filtered sections
    tasks = []
    task_indices = []  # track which indices need enrichment
    for idx, section in enumerate(sections):
        title = section.get("title", "")
        if sections_to_enrich is not None and title not in sections_to_enrich:
            continue  # skip — section passes heuristics
        section_title_lower = title.lower().strip()
        outline_section = outline_lookup.get(section_title_lower)
        tasks.append(
            _enrich_single_section(
                section=section,
                outline_section=outline_section,
                doc_title=doc_title,
                doc_type=doc_type,
                all_section_titles=all_section_titles,
                target_audience=target_audience,
                catalog_context=catalog_context,
                provider=provider,
                system_prompt=system_prompt,
                enrich_template=enrich_template,
                model=model,
            )
        )
        task_indices.append(idx)

    if not tasks:
        return draft

    # Run enrichments in parallel
    enriched_results = await asyncio.gather(*tasks)

    # Merge enriched sections back into original order
    final_sections = list(sections)
    for i, enriched in zip(task_indices, enriched_results):
        final_sections[i] = enriched

    return {**draft, "sections": final_sections}


# ---------------------------------------------------------------------------
# Quality Gate — Judge / Critic loop
# ---------------------------------------------------------------------------

async def _quality_gate(
    draft: dict,
    prompt: str,
    catalog_context: str,
    provider,
    system_prompt: str,
    dd_prompts: dict,
    model: str,
    progress_cb: ProgressCallback = None,
) -> tuple:
    """Run judge → critic loop to improve document quality.

    Returns:
        (refined_draft, quality_scores)
    """
    MAX_ITERATIONS = 3
    PASS_THRESHOLD = 7

    def _progress(stage, step, total, message):
        if progress_cb:
            progress_cb(stage, step, total, message)

    judge_template = dd_prompts.get("judge", "")
    critic_template = dd_prompts.get("critic", "")

    if not judge_template or not critic_template:
        logger.warning("Judge or critic prompt not configured — skipping quality gate")
        return draft, {"skipped": True, "reason": "prompts_not_configured"}

    current_draft = draft
    quality_scores = {
        "iterations": 0,
        "passed": False,
        "scores": {},
        "critique_history": [],
    }

    for iteration in range(1, MAX_ITERATIONS + 1):
        quality_scores["iterations"] = iteration
        _progress("quality_gate", iteration, MAX_ITERATIONS, f"Quality review iteration {iteration}/{MAX_ITERATIONS}...")

        # --- Judge ---
        judge_prompt = (
            judge_template
            .replace("{prompt}", prompt)
            .replace("{draft_json}", json.dumps(current_draft, indent=2))
            .replace("{catalog_context}", catalog_context)
        )

        try:
            judge_result = await provider.generate(system_prompt, judge_prompt, model)
            logger.info(f"Judge raw response (first 500 chars): {judge_result['content'][:500]}")
            judge_data = _parse_json_response(judge_result["content"], default={
                "scores": {},
                "overall": 0,
                "critiques": [],
                "pass": False,
            })
            logger.info(f"Judge parsed critiques: {judge_data.get('critiques', [])}")
        except Exception as e:
            logger.error(f"Quality gate judge failed (iteration {iteration}): {e}")
            quality_scores["error"] = str(e)
            break

        scores = judge_data.get("scores", {})
        overall = judge_data.get("overall", 0)
        passed = judge_data.get("pass", False)
        critiques = judge_data.get("critiques", [])

        quality_scores["scores"] = scores
        quality_scores["overall"] = overall
        quality_scores["critique_history"].append({
            "iteration": iteration,
            "scores": scores,
            "overall": overall,
            "passed": passed,
            "critique_count": len(critiques),
        })

        logger.info(
            f"Doc quality gate iteration {iteration}: overall={overall}, "
            f"scores={scores}, pass={passed}, critiques={len(critiques)}"
        )

        if passed:
            quality_scores["passed"] = True
            _progress("quality_gate", iteration, MAX_ITERATIONS, f"Quality gate passed (score: {overall:.1f}/10)")
            break

        # Filter to failing dimensions
        failing_critiques = [c for c in critiques if c.get("score", 10) < PASS_THRESHOLD]
        if not failing_critiques:
            failing_critiques = critiques
        if not failing_critiques:
            quality_scores["passed"] = False
            _progress("quality_gate", iteration, MAX_ITERATIONS, f"No actionable critiques (score: {overall:.1f}/10)")
            break

        failing_dims = list(set(c.get("dimension", "?") for c in failing_critiques))
        _progress("quality_gate", iteration, MAX_ITERATIONS, f"Improving {', '.join(failing_dims)}...")

        # --- Critic ---
        critic_prompt = (
            critic_template
            .replace("{prompt}", prompt)
            .replace("{draft_json}", json.dumps(current_draft, indent=2))
            .replace("{catalog_context}", catalog_context)
            .replace("{critiques_json}", json.dumps(failing_critiques, indent=2))
        )

        try:
            critic_result = await provider.generate(system_prompt, critic_prompt, model)
            logger.info(f"Critic raw response (first 500 chars): {critic_result['content'][:500]}")
            corrected = _parse_json_response(critic_result["content"], default=current_draft)
            # Validate basic structure
            if corrected.get("title") and corrected.get("sections"):
                # Preserve linked_entities and suggested_patterns if critic dropped them
                if "linked_entities" not in corrected and "linked_entities" in current_draft:
                    corrected["linked_entities"] = current_draft["linked_entities"]
                if "suggested_patterns" not in corrected and "suggested_patterns" in current_draft:
                    corrected["suggested_patterns"] = current_draft["suggested_patterns"]
                current_draft = corrected
            else:
                logger.warning("Critic returned invalid structure — keeping previous draft")
        except Exception as e:
            logger.error(f"Quality gate critic failed (iteration {iteration}): {e}")
            quality_scores["error"] = str(e)
            break
    else:
        _progress(
            "quality_gate", MAX_ITERATIONS, MAX_ITERATIONS,
            f"Quality gate: {MAX_ITERATIONS} iterations used (final score: {quality_scores.get('overall', 0):.1f}/10)"
        )

    return current_draft, quality_scores


# ---------------------------------------------------------------------------
# Main Pipeline — Draft Document
# ---------------------------------------------------------------------------

async def draft_document(
    prompt: str,
    doc_type: str,
    db,
    target_audience: str = "Software Engineers and Architects",
    progress_cb: ProgressCallback = None,
    provider_name: Optional[str] = None,
    model: Optional[str] = None,
    clarifications: Optional[dict] = None,
) -> dict:
    """Draft a complete document with planning, enrichment, and quality gate.

    Pipeline: context → plan → draft → enrich → quality gate → complete (6 steps)

    Returns:
        {title, doc_type, summary, tags, sections, quality_scores, provider, model}
    """
    from services.llm import get_provider
    from services.prompt_service import get_merged_prompts

    prompts = get_merged_prompts()
    dd_prompts = prompts.get("document_drafter", {})
    if not dd_prompts:
        raise ValueError("Document drafter prompts not configured in prompts.yaml")

    provider = get_provider(provider_name)
    used_model = model or provider.default_model
    system_prompt = dd_prompts.get("system", "")
    draft_template = dd_prompts.get("draft", "")

    TOTAL_STEPS = 6

    def _progress(stage, step, total, message):
        if progress_cb:
            progress_cb(stage, step, total, message)

    # Enrich prompt with clarification answers if provided
    if clarifications:
        clarification_text = "\n\n## Additional Context from User Clarifications:\n"
        for qid, answer in clarifications.items():
            clarification_text += f"- {qid}: {answer}\n"
        prompt = prompt + clarification_text

    # Step 1: Build context
    _progress("context", 1, TOTAL_STEPS, "Loading catalog context...")
    catalog_context = _build_catalog_context(db)
    existing_docs = _build_existing_docs_context(db)

    # Count catalog items for rich progress
    cat_lines = catalog_context.split("\n")
    pattern_count = sum(1 for l in cat_lines if l.startswith("- ") and ":" in l)
    _progress("context", 1, TOTAL_STEPS, f"Loaded {pattern_count} catalog items")

    # Step 2: Plan document structure
    plan_template = dd_prompts.get("plan", "")
    outline = {}
    if plan_template:
        _progress("planning", 2, TOTAL_STEPS, "Planning document structure...")
        outline = await _plan_document(
            prompt=prompt,
            doc_type=doc_type,
            target_audience=target_audience,
            catalog_context=catalog_context,
            existing_docs=existing_docs,
            provider=provider,
            system_prompt=system_prompt,
            plan_template=plan_template,
            model=used_model,
        )
        # Rich progress: show planned sections
        plan_sections = outline.get("sections", [])
        plan_diagrams = outline.get("diagrams", [])
        section_names = [s.get("title", "?") for s in plan_sections[:6]]
        plan_summary = ", ".join(section_names)
        if len(plan_sections) > 6:
            plan_summary += f" +{len(plan_sections) - 6} more"
        _progress("planning", 2, TOTAL_STEPS,
                  f"Planned {len(plan_sections)} sections · {len(plan_diagrams)} diagrams: {plan_summary}")
    else:
        _progress("planning", 2, TOTAL_STEPS, "Planning step skipped")
        logger.warning("No plan prompt configured — skipping planning phase")

    # Step 3: Generate initial draft using FILTERED catalog (plan identified relevant items)
    _progress("drafting", 3, TOTAL_STEPS, "AI is drafting your document...")
    outline_text = json.dumps(outline, indent=2) if outline else "(no outline available)"

    # Filter catalog to items the plan identified as relevant
    target_ids = _extract_entity_ids({}, outline)
    draft_catalog = _build_filtered_catalog_context(db, target_ids) if target_ids else catalog_context
    logger.info(f"Draft using {'filtered' if target_ids else 'full'} catalog "
                f"({len(target_ids)} target entities, {len(draft_catalog)} chars)")

    draft_prompt = (
        draft_template
        .replace("{prompt}", prompt)
        .replace("{doc_type}", doc_type)
        .replace("{target_audience}", target_audience)
        .replace("{outline}", outline_text)
        .replace("{catalog_context}", draft_catalog)
        .replace("{existing_docs}", existing_docs)
    )

    result = await provider.generate(system_prompt, draft_prompt, used_model)
    logger.info(f"Draft raw response (first 1000 chars): {result['content'][:1000]}")
    logger.info(f"Draft raw response (last 500 chars): {result['content'][-500:]}")
    draft = _parse_json_response(result["content"], default={
        "title": "Untitled Document",
        "doc_type": doc_type,
        "summary": "",
        "tags": [],
        "sections": [{"title": "Introduction", "content": "Content generation failed."}],
        "linked_entities": [],
        "suggested_patterns": [],
    })

    # Ensure doc_type is set
    if not draft.get("doc_type"):
        draft["doc_type"] = doc_type

    # Rich progress: show draft stats
    draft_sections = draft.get("sections", [])
    total_words = sum(len(s.get("content", "").split()) for s in draft_sections)
    entity_count = len(draft.get("linked_entities", []))
    _progress("drafting", 3, TOTAL_STEPS,
              f"Generated {len(draft_sections)} sections · ~{total_words:,} words · {entity_count} entities linked")

    # Step 4: Conditional section enrichment (only enrich sections that need it)
    enrich_template = dd_prompts.get("enrich_section", "")
    if enrich_template and draft_sections:
        # Run heuristic checks to decide which sections actually need enrichment
        sections_to_enrich = set()
        for section in draft_sections:
            should_enrich, reason = _should_enrich_section(section, doc_type=doc_type)
            title = section.get("title", "Untitled")
            if should_enrich:
                sections_to_enrich.add(title)
                logger.info(f"Section '{title}' flagged for enrichment: {reason}")
            else:
                logger.info(f"Section '{title}' skipped enrichment: {reason}")

        if sections_to_enrich:
            _progress("enriching", 4, TOTAL_STEPS,
                      f"Enriching {len(sections_to_enrich)} of {len(draft_sections)} sections...")

            # Build filtered catalog for enrichment using draft + outline entity IDs
            enrich_ids = _extract_entity_ids(draft, outline)
            enrich_catalog = _build_filtered_catalog_context(db, enrich_ids) if enrich_ids else catalog_context

            draft = await _enrich_sections_parallel(
                draft=draft,
                outline=outline,
                doc_type=doc_type,
                target_audience=target_audience,
                catalog_context=enrich_catalog,
                provider=provider,
                system_prompt=system_prompt,
                enrich_template=enrich_template,
                model=used_model,
                sections_to_enrich=sections_to_enrich,
            )
            # Rich progress: show enrichment stats
            enriched_sections = draft.get("sections", [])
            enriched_words = sum(len(s.get("content", "").split()) for s in enriched_sections)
            word_increase = enriched_words - total_words
            _progress("enriching", 4, TOTAL_STEPS,
                      f"Enriched {len(sections_to_enrich)}/{len(enriched_sections)} sections · "
                      f"~{enriched_words:,} words (+{word_increase:,})")
        else:
            _progress("enriching", 4, TOTAL_STEPS,
                      "All sections comprehensive — skipping enrichment")
            logger.info("No sections need enrichment — all passed heuristic checks")
    else:
        _progress("enriching", 4, TOTAL_STEPS, "Enrichment step skipped")
        if not enrich_template:
            logger.warning("No enrich_section prompt configured — skipping enrichment phase")

    # Step 5: Quality gate (using filtered catalog)
    _progress("quality_gate", 5, TOTAL_STEPS, "Running quality review...")
    qg_ids = _extract_entity_ids(draft, outline)
    qg_catalog = _build_filtered_catalog_context(db, qg_ids) if qg_ids else catalog_context
    refined_draft, quality_scores = await _quality_gate(
        draft=draft,
        prompt=prompt,
        catalog_context=qg_catalog,
        provider=provider,
        system_prompt=system_prompt,
        dd_prompts=dd_prompts,
        model=used_model,
        progress_cb=progress_cb,
    )

    _progress("complete", 6, TOTAL_STEPS, "Document draft complete!")

    return {
        **refined_draft,
        "quality_scores": quality_scores,
        "outline": outline,
        "provider": provider.name,
        "model": used_model,
    }


# ---------------------------------------------------------------------------
# Discuss — conversational refinement
# ---------------------------------------------------------------------------

async def discuss_draft_stream(
    message: str,
    current_draft: dict,
    conversation_history: list,
    db,
    provider_name: Optional[str] = None,
    model: Optional[str] = None,
) -> AsyncIterator[str]:
    """Stream discuss tokens. Caller should collect full text and parse for updates."""
    from services.llm import get_provider
    from services.prompt_service import get_merged_prompts

    prompts = get_merged_prompts()
    dd_prompts = prompts.get("document_drafter", {})
    provider = get_provider(provider_name)
    used_model = model or provider.default_model

    system_prompt = dd_prompts.get("system", "")
    discuss_template = dd_prompts.get("discuss", "")

    catalog_context = _build_catalog_context(db)

    # Build conversation history text
    history_text = ""
    for msg in conversation_history:
        role = msg.get("role", "user")
        content = msg.get("content", "")
        history_text += f"\n**{role.title()}**: {content}\n"
    if not history_text:
        history_text = "No previous messages."

    discuss_prompt = (
        discuss_template
        .replace("{draft_json}", json.dumps(current_draft, indent=2))
        .replace("{catalog_context}", catalog_context)
        .replace("{conversation_history}", history_text)
        .replace("{message}", message)
    )

    async for chunk in provider.generate_stream(system_prompt, discuss_prompt, used_model):
        yield chunk


def parse_discuss_response(full_text: str) -> tuple:
    """Parse a discuss response for conversational text and optional draft update.

    Returns:
        (response_text, updated_draft_or_None)
    """
    if "---DRAFT_UPDATE---" in full_text:
        parts = full_text.split("---DRAFT_UPDATE---", 1)
        response_text = parts[0].strip()
        update_block = parts[1].strip()
        updated_draft = _parse_json_response(update_block, default=None)
        if updated_draft and updated_draft.get("title") and updated_draft.get("sections"):
            return response_text, updated_draft
        else:
            logger.warning("Failed to parse draft update from discuss response")
            return response_text, None
    return full_text.strip(), None
