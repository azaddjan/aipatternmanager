from fastapi import APIRouter

from models.schemas import AIGenerateRequest
from services import ai_service
from services.llm import get_available_providers

router = APIRouter(prefix="/api/ai", tags=["AI Authoring"])


def get_db():
    from main import db_service
    return db_service


@router.post("/generate")
async def generate_pattern(request: AIGenerateRequest):
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
def list_providers():
    """List available LLM providers and their status."""
    return {"providers": get_available_providers()}
