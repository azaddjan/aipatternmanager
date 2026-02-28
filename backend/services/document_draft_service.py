"""AI Document Drafter — auto-draft complete documents with quality gate + discuss."""
import json
import logging
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

    try:
        return json.loads(text)
    except json.JSONDecodeError:
        pass

    start = text.find("{")
    if start >= 0:
        depth = 0
        for i in range(start, len(text)):
            if text[i] == "{":
                depth += 1
            elif text[i] == "}":
                depth -= 1
                if depth == 0:
                    try:
                        return json.loads(text[start : i + 1])
                    except json.JSONDecodeError:
                        break

    logger.warning("Failed to parse JSON from LLM response, using default")
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
            judge_data = _parse_json_response(judge_result["content"], default={
                "scores": {},
                "overall": 0,
                "critiques": [],
                "pass": False,
            })
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
            corrected = _parse_json_response(critic_result["content"], default=current_draft)
            # Validate basic structure
            if corrected.get("title") and corrected.get("sections"):
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
    progress_cb: ProgressCallback = None,
    provider_name: Optional[str] = None,
    model: Optional[str] = None,
) -> dict:
    """Draft a complete document with quality gate.

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

    def _progress(stage, step, total, message):
        if progress_cb:
            progress_cb(stage, step, total, message)

    # Step 1: Build context
    _progress("context", 1, 4, "Loading catalog context...")
    catalog_context = _build_catalog_context(db)
    existing_docs = _build_existing_docs_context(db)

    # Step 2: Generate initial draft
    _progress("drafting", 2, 4, "AI is drafting your document...")
    draft_prompt = (
        draft_template
        .replace("{prompt}", prompt)
        .replace("{doc_type}", doc_type)
        .replace("{catalog_context}", catalog_context)
        .replace("{existing_docs}", existing_docs)
    )

    result = await provider.generate(system_prompt, draft_prompt, used_model)
    draft = _parse_json_response(result["content"], default={
        "title": "Untitled Document",
        "doc_type": doc_type,
        "summary": "",
        "tags": [],
        "sections": [{"title": "Introduction", "content": "Content generation failed."}],
    })

    # Ensure doc_type is set
    if not draft.get("doc_type"):
        draft["doc_type"] = doc_type

    # Step 3: Quality gate
    _progress("quality_gate", 3, 4, "Running quality review...")
    refined_draft, quality_scores = await _quality_gate(
        draft=draft,
        prompt=prompt,
        catalog_context=catalog_context,
        provider=provider,
        system_prompt=system_prompt,
        dd_prompts=dd_prompts,
        model=used_model,
        progress_cb=progress_cb,
    )

    _progress("complete", 4, 4, "Document draft complete!")

    return {
        **refined_draft,
        "quality_scores": quality_scores,
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
