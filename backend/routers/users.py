"""User management router (admin only)."""
from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel
from typing import Optional

from services import auth_service
from middleware.dependencies import require_admin

router = APIRouter(prefix="/api/users", tags=["Users"])


class UserCreate(BaseModel):
    email: str
    password: str
    name: str
    role: str  # "admin", "team_member", "viewer"
    team_id: Optional[str] = None


class UserUpdate(BaseModel):
    name: Optional[str] = None
    email: Optional[str] = None
    role: Optional[str] = None
    is_active: Optional[bool] = None
    team_id: Optional[str] = None   # handled separately
    password: Optional[str] = None  # handled separately


@router.get("")
def list_users(_admin: dict = Depends(require_admin)):
    return {"users": auth_service.list_users()}


@router.get("/{user_id}")
def get_user(user_id: str, _admin: dict = Depends(require_admin)):
    user = auth_service.get_user_by_id(user_id)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    return auth_service._sanitize_user(user)


@router.post("", status_code=201)
def create_user(data: UserCreate, _admin: dict = Depends(require_admin)):
    if data.role not in ("admin", "team_member", "viewer"):
        raise HTTPException(
            status_code=400, detail="Role must be admin, team_member, or viewer"
        )

    existing = auth_service.get_user_by_email(data.email)
    if existing:
        raise HTTPException(
            status_code=409, detail=f"User with email {data.email} already exists"
        )

    user = auth_service.create_user(
        email=data.email,
        password=data.password,
        name=data.name,
        role=data.role,
        team_id=data.team_id,
    )
    return user


@router.put("/{user_id}")
def update_user(user_id: str, data: UserUpdate, _admin: dict = Depends(require_admin)):
    updates = data.model_dump(exclude_none=True)

    # Handle password change separately
    if "password" in updates:
        auth_service.change_user_password(user_id, updates.pop("password"))

    # Handle team change separately
    if "team_id" in updates:
        auth_service.set_user_team(user_id, updates.pop("team_id"))

    if updates:
        user = auth_service.update_user(user_id, updates)
        if not user:
            raise HTTPException(status_code=404, detail="User not found")
        return user

    result = auth_service.get_user_by_id(user_id)
    if not result:
        raise HTTPException(status_code=404, detail="User not found")
    return auth_service._sanitize_user(result)


@router.delete("/{user_id}")
def delete_user(user_id: str, admin: dict = Depends(require_admin)):
    if user_id == admin["id"]:
        raise HTTPException(status_code=400, detail="Cannot delete yourself")
    if not auth_service.delete_user(user_id):
        raise HTTPException(status_code=404, detail="User not found")
    return {"deleted": user_id}
