from fastapi import APIRouter, Query
from typing import Optional

from services.discovery_service import get_inventory, discover_patterns

router = APIRouter(prefix="/api/discovery", tags=["Discovery"])


def get_db():
    from main import db_service
    return db_service


@router.get("/inventory")
def inventory():
    """Get the current pattern/technology inventory summary."""
    db = get_db()
    inv = get_inventory(db)
    return inv


@router.post("/suggest")
async def suggest_patterns(
    provider: Optional[str] = Query(None, description="LLM provider"),
    model: Optional[str] = Query(None, description="Model name"),
    focus: Optional[str] = Query(None, description="Focus area for suggestions"),
):
    """Use AI to analyze inventory and suggest new patterns."""
    db = get_db()
    result = await discover_patterns(db, provider, model, focus)
    return result
