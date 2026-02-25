from fastapi import APIRouter, HTTPException, Query, Depends
from typing import Optional
import logging
import threading

from models.schemas import TechnologyCreate, TechnologyUpdate
from middleware.dependencies import get_current_user, get_current_user_or_anonymous

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/technologies", tags=["Technologies"])


def _auto_embed_technology(tech_id: str):
    """Fire-and-forget: embed a technology in a background thread."""
    def _run():
        try:
            from routers.advisor import _get_embedding_svc
            from main import db_service
            svc = _get_embedding_svc()
            if svc.available:
                svc.embed_technology(db_service, tech_id)
        except Exception:
            pass
    threading.Thread(target=_run, daemon=True).start()


def get_db():
    from main import db_service
    return db_service


@router.get("")
def list_technologies(
    vendor: Optional[str] = Query(None),
    status: Optional[str] = Query(None),
    category: Optional[str] = Query(None),
    skip: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=500),
    _user=Depends(get_current_user_or_anonymous),
):
    db = get_db()
    technologies, total = db.list_technologies(vendor, status, category, skip, limit)
    return {"technologies": technologies, "total": total}


@router.get("/{tech_id}")
def get_technology(tech_id: str, _user=Depends(get_current_user_or_anonymous)):
    db = get_db()
    tech = db.get_technology_with_patterns(tech_id)
    if not tech:
        raise HTTPException(status_code=404, detail=f"Technology {tech_id} not found")
    return tech


@router.post("", status_code=201)
def create_technology(data: TechnologyCreate, current_user: dict = Depends(get_current_user)):
    if current_user.get("role") == "viewer":
        raise HTTPException(status_code=403, detail="Viewers cannot create technologies")
    db = get_db()
    existing = db.get_technology(data.id)
    if existing:
        raise HTTPException(status_code=409, detail=f"Technology {data.id} already exists")
    tech = db.create_technology(data.model_dump())
    _auto_embed_technology(data.id)
    return tech


@router.put("/{tech_id}")
def update_technology(tech_id: str, data: TechnologyUpdate, current_user: dict = Depends(get_current_user)):
    if current_user.get("role") == "viewer":
        raise HTTPException(status_code=403, detail="Viewers cannot update technologies")
    db = get_db()
    update_data = data.model_dump(exclude_none=True)
    if not update_data:
        raise HTTPException(status_code=400, detail="No fields to update")

    # Check if deprecating
    is_deprecating = update_data.get("status") == "DEPRECATED"

    tech = db.update_technology(tech_id, update_data)
    if not tech:
        raise HTTPException(status_code=404, detail=f"Technology {tech_id} not found")

    # Cascade deprecation to SBBs that USES this technology
    deprecated_sbbs = []
    if is_deprecating:
        deprecated_sbbs = db.cascade_deprecate_technology(tech_id)
        if deprecated_sbbs:
            logger.info(f"Cascade-deprecated {len(deprecated_sbbs)} SBBs due to technology {tech_id} deprecation")

    _auto_embed_technology(tech_id)
    return {
        "technology": tech,
        "cascade_deprecated": deprecated_sbbs,
    }


@router.delete("/{tech_id}")
def delete_technology(tech_id: str, current_user: dict = Depends(get_current_user)):
    if current_user.get("role") == "viewer":
        raise HTTPException(status_code=403, detail="Viewers cannot delete technologies")
    db = get_db()
    if not db.delete_technology(tech_id):
        raise HTTPException(status_code=404, detail=f"Technology {tech_id} not found")
    return {"deleted": tech_id}


@router.get("/{tech_id}/impact")
def get_technology_impact(tech_id: str, _user=Depends(get_current_user_or_anonymous)):
    db = get_db()
    tech = db.get_technology(tech_id)
    if not tech:
        raise HTTPException(status_code=404, detail=f"Technology {tech_id} not found")
    patterns = db.get_technology_impact(tech_id)
    return {"technology": tech, "affected_patterns": patterns, "count": len(patterns)}
