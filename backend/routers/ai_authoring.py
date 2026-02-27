import json
import logging
import re

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from typing import Optional

logger = logging.getLogger(__name__)

from models.schemas import AIGenerateRequest, AIAnalyzeContextRequest, AIFieldAssistRequest, AISmartActionRequest
from services import ai_service, ai_field_assist_service
from services.llm import get_available_providers, get_provider
from services.prompt_service import get_merged_prompts
from middleware.dependencies import get_current_user, get_current_user_or_anonymous

router = APIRouter(prefix="/api/ai", tags=["AI Authoring"])


def get_db():
    from main import db_service
    return db_service


@router.post("/generate")
async def generate_pattern(request: AIGenerateRequest, _user=Depends(get_current_user)):
    """Generate a new pattern draft using AI. Returns structured JSON fields."""
    db = get_db()
    result = await ai_service.generate_pattern(
        template_type=request.template_type.value,
        parent_abb_id=request.parent_abb_id,
        context_notes=request.context_notes,
        db=db,
        provider_name=request.provider.value if request.provider else None,
        model=request.model,
        enriched_context=request.enriched_context,
    )
    return result


@router.post("/analyze-context")
async def analyze_context(request: AIAnalyzeContextRequest, _user=Depends(get_current_user)):
    """Analyze user's pattern description: predict category, relationships, and generate follow-up questions."""
    db = get_db()
    try:
        result = await ai_service.analyze_context(
            template_type=request.template_type.value,
            context_notes=request.context_notes,
            db=db,
            provider_name=request.provider.value if request.provider else None,
            model=request.model,
        )
        return result
    except Exception as e:
        logger.error(f"AI analyze-context failed: {e}")
        raise HTTPException(status_code=502, detail=f"AI analysis error: {e}")


@router.get("/providers")
def list_providers(_user=Depends(get_current_user_or_anonymous)):
    """List available LLM providers and their status."""
    return {"providers": get_available_providers()}


@router.post("/field-assist")
async def field_assist(request: AIFieldAssistRequest, _user=Depends(get_current_user)):
    """Per-field AI assist: suggest, improve, or custom-modify a single field."""
    db = get_db()
    result = await ai_field_assist_service.field_assist(
        field_name=request.field_name,
        action=request.action.value,
        custom_prompt=request.custom_prompt,
        current_value=request.current_value,
        pattern_context=request.pattern_context,
        pattern_type=request.pattern_type.value,
        pattern_id=request.pattern_id,
        db=db,
        provider_name=request.provider.value if request.provider else None,
        model=request.model,
    )
    return result


@router.post("/smart-actions")
async def smart_action(request: AISmartActionRequest, _user=Depends(get_current_user)):
    """Pattern-level smart AI actions (tags, description, relationships, quality, auto-fill)."""
    db = get_db()
    result = await ai_field_assist_service.smart_action(
        action=request.action.value,
        pattern_context=request.pattern_context,
        pattern_type=request.pattern_type.value,
        pattern_id=request.pattern_id,
        db=db,
        custom_prompt=request.custom_prompt,
        provider_name=request.provider.value if request.provider else None,
        model=request.model,
    )
    return result


class AITechnologySuggestRequest(BaseModel):
    name: str
    partial_data: Optional[dict] = None
    provider: Optional[str] = None
    model: Optional[str] = None


VALID_CATEGORIES = {
    "cloud-compute", "cloud-ai", "cloud-data", "cloud-infra",
    "framework", "saas", "observability", "database",
}
VALID_COST_TIERS = {"FREE", "LOW", "MEDIUM", "HIGH"}


@router.post("/technology-suggest")
async def technology_suggest(request: AITechnologySuggestRequest, _user=Depends(get_current_user)):
    """AI-powered technology information lookup. Given a name, returns structured fields."""
    # Load prompts
    all_prompts = get_merged_prompts()
    tech_prompts = all_prompts.get("technology_suggest", {})

    system_prompt = tech_prompts.get("system", "You are a helpful technology analyst.")
    user_template = tech_prompts.get("user", "Technology name: {name}\n{partial_context}")

    # Build partial context from any pre-filled fields
    partial_lines = []
    if request.partial_data:
        for k, v in request.partial_data.items():
            if v:
                partial_lines.append(f"Existing {k}: {v}")
    partial_context = "Additional context:\n" + "\n".join(partial_lines) if partial_lines else ""

    user_prompt = user_template.format(
        name=request.name,
        partial_context=partial_context,
    )

    # Get LLM provider
    try:
        provider = get_provider(request.provider)
        model = request.model or None

        # Call LLM
        response = await provider.generate(system_prompt, user_prompt, model)
    except Exception as e:
        logger.error(f"AI technology suggest failed: {e}")
        raise HTTPException(status_code=502, detail=f"AI provider error: {e}")

    # Parse JSON from response (strip code fences if present)
    text = response.get("content", response.get("text", "")) if isinstance(response, dict) else str(response)
    # Remove markdown code fences
    text = re.sub(r'^```(?:json)?\s*', '', text.strip(), flags=re.MULTILINE)
    text = re.sub(r'```\s*$', '', text.strip(), flags=re.MULTILINE)

    # Extract JSON object
    match = re.search(r'\{[^{}]*(?:\{[^{}]*\}[^{}]*)*\}', text, re.DOTALL)
    if not match:
        raise HTTPException(status_code=502, detail="Could not parse JSON from AI response")

    try:
        suggestion = json.loads(match.group())
    except json.JSONDecodeError:
        raise HTTPException(status_code=502, detail="Invalid JSON in AI response")

    # Validate category and cost_tier
    if suggestion.get("category") not in VALID_CATEGORIES:
        suggestion["category"] = "framework"  # safe default
    if suggestion.get("cost_tier") not in VALID_COST_TIERS:
        suggestion["cost_tier"] = ""

    return {
        "suggestion": suggestion,
        "provider": response.get("provider", str(request.provider)) if isinstance(response, dict) else str(request.provider),
        "model": response.get("model", str(model)) if isinstance(response, dict) else str(model),
    }


class AITechnologyAssistRequest(BaseModel):
    action: str  # rewrite_description, suggest_notes, health_recommendations, custom
    tech_data: dict
    field: Optional[str] = None       # target field for result (description, notes, etc.)
    custom_prompt: Optional[str] = None  # user-provided instruction
    health_data: Optional[dict] = None
    provider: Optional[str] = None
    model: Optional[str] = None


@router.post("/technology-assist")
async def technology_assist(request: AITechnologyAssistRequest, _user=Depends(get_current_user)):
    """AI-powered technology field assistance: rewrite, suggest, improve, or custom."""
    all_prompts = get_merged_prompts()
    tech_prompts = all_prompts.get("technology_assist", {})

    system_prompt = tech_prompts.get("system", "You are a helpful enterprise technology analyst and documentation specialist.")

    # Build context from tech data (filter out large/internal fields)
    skip_keys = {"used_by_patterns", "embedding", "created_at", "updated_at"}
    tech_context = "\n".join(
        f"  {k}: {v}" for k, v in request.tech_data.items()
        if v and k not in skip_keys and str(v).strip()
    )

    # Append user instruction if provided
    user_instruction = ""
    if request.custom_prompt and request.custom_prompt.strip():
        user_instruction = f"\n\nUser instruction: {request.custom_prompt.strip()}"

    action = request.action
    if action == "rewrite_description":
        base = tech_prompts.get("rewrite_description",
            "Rewrite and improve the description for this technology. Make it clear, professional, and informative.\n\nTechnology:\n{tech_context}\n\nReturn ONLY the improved description text, nothing else."
        ).format(tech_context=tech_context)
        user_prompt = base + user_instruction
    elif action == "rewrite_notes":
        base = tech_prompts.get("rewrite_notes",
            "Rewrite and improve the existing notes for this technology. Keep the same topics but make them clearer, better organized, and more professional.\n\nTechnology:\n{tech_context}\n\nReturn ONLY the improved notes text, nothing else."
        ).format(tech_context=tech_context)
        user_prompt = base + user_instruction
    elif action == "suggest_notes":
        base = tech_prompts.get("suggest_notes",
            "Suggest useful technical notes, best practices, and considerations for this technology.\n\nTechnology:\n{tech_context}\n\nReturn ONLY the notes text with bullet points, nothing else."
        ).format(tech_context=tech_context)
        user_prompt = base + user_instruction
    elif action == "health_recommendations":
        health_context = ""
        if request.health_data:
            health_context = f"\nHealth Score: {request.health_data.get('health_score', 'N/A')}/100"
            missing = request.health_data.get("field_completeness", {}).get("missing_fields", [])
            if missing:
                health_context += f"\nMissing fields: {', '.join(missing)}"
            problems = request.health_data.get("problems", [])
            if problems:
                health_context += f"\nProblems: {', '.join(p.get('message', '') for p in problems)}"
        base = tech_prompts.get("health_recommendations",
            "Analyze this technology's health and provide specific, actionable recommendations to improve it.\n\nTechnology:\n{tech_context}\n{health_context}\n\nReturn a JSON object with: {{\"recommendations\": [{{\"title\": \"...\", \"description\": \"...\", \"priority\": \"high|medium|low\"}}]}}"
        ).format(tech_context=tech_context, health_context=health_context)
        user_prompt = base + user_instruction
    elif action == "custom":
        if not request.custom_prompt or not request.custom_prompt.strip():
            raise HTTPException(status_code=400, detail="custom_prompt is required for custom action")
        user_prompt = (
            f"Technology context (for reference only — DO NOT repeat this information):\n{tech_context}\n\n"
            f"Task: {request.custom_prompt.strip()}\n\n"
            "IMPORTANT: The user can already see the technology's name, vendor, category, description, status, "
            "and other basic fields on the page. Do NOT restate or summarize those fields. "
            "Focus exclusively on answering the user's specific question with NEW information, analysis, or insights. "
            "Use markdown formatting for readability."
        )
    else:
        raise HTTPException(status_code=400, detail=f"Unknown action: {action}")

    try:
        provider = get_provider(request.provider)
        model = request.model or None
        response = await provider.generate(system_prompt, user_prompt, model)
    except Exception as e:
        logger.error(f"AI technology assist failed: {e}")
        raise HTTPException(status_code=502, detail=f"AI provider error: {e}")

    text = response.get("content", response.get("text", "")) if isinstance(response, dict) else str(response)

    # For health_recommendations, parse JSON
    if action == "health_recommendations":
        clean = re.sub(r'^```(?:json)?\s*', '', text.strip(), flags=re.MULTILINE)
        clean = re.sub(r'```\s*$', '', clean.strip(), flags=re.MULTILINE)
        match = re.search(r'\{[^{}]*(?:\{[^{}]*\}[^{}]*)*\}', clean, re.DOTALL)
        if match:
            try:
                parsed = json.loads(match.group())
                return {"result": parsed, "action": action, "field": request.field}
            except json.JSONDecodeError:
                pass
        return {"result": {"recommendations": [{"title": "AI Analysis", "description": text.strip(), "priority": "medium"}]}, "action": action, "field": request.field}

    return {"result": text.strip(), "action": action, "field": request.field}


class AIPatternAssistRequest(BaseModel):
    action: str  # "custom" for now
    pattern_data: dict
    custom_prompt: Optional[str] = None
    extra_context: Optional[str] = None  # serialized impact/relationships/graph context
    provider: Optional[str] = None
    model: Optional[str] = None


@router.post("/pattern-assist")
async def pattern_assist(request: AIPatternAssistRequest, _user=Depends(get_current_user)):
    """AI-powered pattern assistant: context-aware Q&A about a pattern."""
    all_prompts = get_merged_prompts()
    pat_prompts = all_prompts.get("pattern_assist", {})

    system_prompt = pat_prompts.get("system",
        "You are a helpful enterprise architecture analyst specializing in TOGAF-aligned architecture patterns. "
        "ABBs are vendor-neutral abstract capabilities (the WHAT). "
        "SBBs are vendor-specific concrete implementations (the HOW) that IMPLEMENT ABBs and link to technologies via USES. "
        "ABBs NEVER have technology dependencies, USES, or COMPATIBLE_WITH relationships."
    )

    # Build context from pattern data (filter out large/internal fields)
    skip_keys = {"embedding", "created_at", "updated_at", "images", "diagrams"}
    pat_context = "\n".join(
        f"  {k}: {v}" for k, v in request.pattern_data.items()
        if v and k not in skip_keys and str(v).strip()
    )

    action = request.action
    if action == "custom":
        if not request.custom_prompt or not request.custom_prompt.strip():
            raise HTTPException(status_code=400, detail="custom_prompt is required for custom action")

        extra = ""
        if request.extra_context and request.extra_context.strip():
            extra = f"\n\n{request.extra_context.strip()}"

        user_prompt = (
            f"Pattern context (for reference only — DO NOT repeat this information):\n{pat_context}{extra}\n\n"
            f"Task: {request.custom_prompt.strip()}\n\n"
            "IMPORTANT: The user can already see the pattern's name, type, description, status, relationships, "
            "and other fields on the page. Do NOT restate or summarize those fields. "
            "Focus exclusively on answering the user's specific question with NEW information, analysis, or insights. "
            "Use markdown formatting for readability."
        )
    else:
        raise HTTPException(status_code=400, detail=f"Unknown action: {action}")

    try:
        provider = get_provider(request.provider)
        model = request.model or None
        response = await provider.generate(system_prompt, user_prompt, model)
    except Exception as e:
        logger.error(f"AI pattern assist failed: {e}")
        raise HTTPException(status_code=502, detail=f"AI provider error: {e}")

    text = response.get("content", response.get("text", "")) if isinstance(response, dict) else str(response)

    return {"result": text.strip(), "action": action}


class AIPBCAssistRequest(BaseModel):
    action: str  # "custom" for now
    pbc_data: dict
    custom_prompt: Optional[str] = None
    extra_context: Optional[str] = None  # serialized graph/ABB context
    provider: Optional[str] = None
    model: Optional[str] = None


@router.post("/pbc-assist")
async def pbc_assist(request: AIPBCAssistRequest, _user=Depends(get_current_user)):
    """AI-powered business capability assistant: context-aware Q&A about a PBC."""
    all_prompts = get_merged_prompts()
    pbc_prompts = all_prompts.get("pbc_assist", {})

    system_prompt = pbc_prompts.get("system",
        "You are a helpful enterprise architecture analyst specializing in business capabilities, "
        "platform building blocks (PBCs), and their relationships with architecture building blocks (ABBs) "
        "and solution building blocks (SBBs)."
    )

    # Build context from PBC data (filter out large/internal fields)
    skip_keys = {"embedding", "created_at", "updated_at"}
    pbc_context = "\n".join(
        f"  {k}: {v}" for k, v in request.pbc_data.items()
        if v and k not in skip_keys and str(v).strip()
    )

    action = request.action
    if action == "custom":
        if not request.custom_prompt or not request.custom_prompt.strip():
            raise HTTPException(status_code=400, detail="custom_prompt is required for custom action")

        extra = ""
        if request.extra_context and request.extra_context.strip():
            extra = f"\n\n{request.extra_context.strip()}"

        user_prompt = (
            f"Business Capability (PBC) context (for reference only — DO NOT repeat this information):\n{pbc_context}{extra}\n\n"
            f"Task: {request.custom_prompt.strip()}\n\n"
            "IMPORTANT: The user can already see the PBC's name, description, status, composed ABBs, "
            "and other fields on the page. Do NOT restate or summarize those fields. "
            "Focus exclusively on answering the user's specific question with NEW information, analysis, or insights. "
            "Use markdown formatting for readability."
        )
    else:
        raise HTTPException(status_code=400, detail=f"Unknown action: {action}")

    try:
        provider = get_provider(request.provider)
        model = request.model or None
        response = await provider.generate(system_prompt, user_prompt, model)
    except Exception as e:
        logger.error(f"AI PBC assist failed: {e}")
        raise HTTPException(status_code=502, detail=f"AI provider error: {e}")

    text = response.get("content", response.get("text", "")) if isinstance(response, dict) else str(response)

    return {"result": text.strip(), "action": action}
