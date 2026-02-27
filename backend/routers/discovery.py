from fastapi import APIRouter, HTTPException, Query, Depends
from typing import Optional

from services.discovery_service import get_inventory, discover_patterns
from middleware.dependencies import get_current_user, get_current_user_or_anonymous

router = APIRouter(prefix="/api/discovery", tags=["Discovery"])


def get_db():
    from main import db_service
    if not db_service or not db_service.verify_connectivity():
        raise HTTPException(status_code=503, detail="Database not available")
    return db_service


@router.get("/inventory")
def inventory(_user=Depends(get_current_user_or_anonymous)):
    """Get the current pattern/technology inventory summary."""
    db = get_db()
    inv = get_inventory(db)
    return inv


@router.post("/suggest")
async def suggest_patterns(
    provider: Optional[str] = Query(None, description="LLM provider"),
    model: Optional[str] = Query(None, description="Model name"),
    focus: Optional[str] = Query(None, description="Focus area for suggestions"),
    _user=Depends(get_current_user),
):
    """Use AI to analyze inventory and suggest new patterns."""
    db = get_db()
    result = await discover_patterns(db, provider, model, focus)

    # Auto-save the discovery result to Neo4j
    suggestions = result.get("suggestions", [])
    saved_id = None
    if suggestions:
        try:
            save_data = {
                "suggestions": suggestions,
                "provider": result.get("provider", ""),
                "model": result.get("model", ""),
                "focus_area": focus or "",
                "suggestion_count": len(suggestions),
            }
            saved = db.save_discovery_analysis(save_data)
            saved_id = saved.get("id")
        except Exception:
            pass  # Non-critical — result still returned even if save fails

    result["saved_analysis_id"] = saved_id
    return result


# --- Discovery Analysis Persistence ---

@router.get("/analyses/latest")
def get_latest_discovery_analysis(user: dict = Depends(get_current_user)):
    """Get the most recent saved discovery analysis (full data)."""
    db = get_db()
    analyses = db.list_discovery_analyses(limit=1)
    if not analyses:
        raise HTTPException(status_code=404, detail="No discovery analyses saved yet")
    # Get full data with suggestions_json
    latest_id = analyses[0]["id"]
    result = db.get_discovery_analysis(latest_id)
    if not result:
        raise HTTPException(status_code=404, detail="No discovery analyses saved yet")
    return result


@router.get("/analyses/{analysis_id}")
def get_discovery_analysis(analysis_id: str, user: dict = Depends(get_current_user)):
    """Get a specific discovery analysis by ID."""
    db = get_db()
    result = db.get_discovery_analysis(analysis_id)
    if not result:
        raise HTTPException(status_code=404, detail=f"Discovery analysis '{analysis_id}' not found")
    return result


@router.get("/analyses")
def list_discovery_analyses(
    limit: int = Query(20, ge=1, le=100),
    user: dict = Depends(get_current_user),
):
    """List saved discovery analyses (newest first, without suggestions_json)."""
    db = get_db()
    analyses = db.list_discovery_analyses(limit)
    return {"analyses": analyses, "total": len(analyses)}


@router.delete("/analyses/{analysis_id}")
def delete_discovery_analysis(analysis_id: str, user: dict = Depends(get_current_user)):
    """Delete a specific discovery analysis."""
    if user.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Only admins can delete discovery analyses")
    db = get_db()
    deleted = db.delete_discovery_analysis(analysis_id)
    if not deleted:
        raise HTTPException(status_code=404, detail=f"Discovery analysis '{analysis_id}' not found")
    return {"status": "deleted", "id": analysis_id}
