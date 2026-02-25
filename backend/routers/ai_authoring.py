import json
import logging
import re

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from typing import Optional

logger = logging.getLogger(__name__)

from models.schemas import AIGenerateRequest, AIFieldAssistRequest, AISmartActionRequest
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
    )
    return result


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
    text = response.get("text", "") if isinstance(response, dict) else str(response)
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
