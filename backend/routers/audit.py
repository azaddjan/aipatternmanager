"""Audit log router — admin-only access to change history."""
from fastapi import APIRouter, Query, Depends
from typing import Optional

from middleware.dependencies import get_current_user
from services import audit_service

router = APIRouter(prefix="/api/audit", tags=["Audit"])


@router.get("")
def list_audit_logs(
    entity_type: Optional[str] = Query(None, description="Filter: pattern, technology, pbc, category, user, team"),
    entity_id: Optional[str] = Query(None, description="Filter by entity ID"),
    user_id: Optional[str] = Query(None, description="Filter by user ID"),
    action: Optional[str] = Query(None, description="Filter: CREATE, UPDATE, DELETE, STATUS_CHANGE"),
    skip: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=200),
    current_user: dict = Depends(get_current_user),
):
    """List audit logs (admin sees all, others see their own)."""
    # Non-admins can only see their own activity
    if current_user.get("role") != "admin":
        user_id = current_user["id"]

    logs, total = audit_service.get_audit_logs(
        entity_type=entity_type,
        entity_id=entity_id,
        user_id=user_id,
        action=action,
        skip=skip,
        limit=limit,
    )
    return {"logs": logs, "total": total}


@router.get("/entity/{entity_type}/{entity_id}")
def get_entity_history(
    entity_type: str,
    entity_id: str,
    limit: int = Query(20, ge=1, le=100),
    current_user: dict = Depends(get_current_user),
):
    """Get the audit trail for a specific entity."""
    logs, total = audit_service.get_entity_history(entity_type, entity_id, limit=limit)
    return {"logs": logs, "total": total}
