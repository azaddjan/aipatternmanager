"""Team management router (admin only)."""
from fastapi import APIRouter, HTTPException, Depends, Query
from pydantic import BaseModel
from typing import Optional

from services import auth_service
from middleware.dependencies import require_admin

router = APIRouter(prefix="/api/teams", tags=["Teams"])


class TeamCreate(BaseModel):
    name: str
    description: str = ""


class TeamUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None


@router.get("")
def list_teams(_admin: dict = Depends(require_admin)):
    return {"teams": auth_service.list_teams()}


@router.get("/{team_id}")
def get_team(team_id: str, _admin: dict = Depends(require_admin)):
    team = auth_service.get_team(team_id)
    if not team:
        raise HTTPException(status_code=404, detail="Team not found")
    return team


@router.post("", status_code=201)
def create_team(data: TeamCreate, _admin: dict = Depends(require_admin)):
    return auth_service.create_team(data.name, data.description)


@router.put("/{team_id}")
def update_team(team_id: str, data: TeamUpdate, _admin: dict = Depends(require_admin)):
    updates = data.model_dump(exclude_none=True)
    if not updates:
        raise HTTPException(status_code=400, detail="No fields to update")
    team = auth_service.update_team(team_id, updates)
    if not team:
        raise HTTPException(status_code=404, detail="Team not found")
    return team


@router.delete("/{team_id}")
def delete_team(team_id: str, _admin: dict = Depends(require_admin)):
    if not auth_service.delete_team(team_id):
        raise HTTPException(status_code=404, detail="Team not found")
    return {"deleted": team_id}


@router.post("/assign-patterns")
def assign_patterns_to_team(
    team_id: str = Query(..., description="Team ID to assign patterns to"),
    pattern_ids: list[str] = [],
    _admin: dict = Depends(require_admin),
):
    """Batch-assign unowned patterns to a team (admin only)."""
    assigned = 0
    for pid in pattern_ids:
        current_team = auth_service.get_pattern_team(pid)
        if current_team is None:
            auth_service.assign_pattern_to_team(pid, team_id)
            assigned += 1
    return {"assigned": assigned, "team_id": team_id}
