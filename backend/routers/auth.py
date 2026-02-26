"""Authentication router: login, refresh, me, profile update, password change."""
from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel
from typing import Optional

from services import auth_service
from middleware.dependencies import get_current_user

router = APIRouter(prefix="/api/auth", tags=["Auth"])


class LoginRequest(BaseModel):
    email: str
    password: str


class RefreshRequest(BaseModel):
    refresh_token: str


class ProfileUpdateRequest(BaseModel):
    name: Optional[str] = None
    email: Optional[str] = None


class ChangePasswordRequest(BaseModel):
    current_password: str
    new_password: str


@router.post("/login")
def login(data: LoginRequest):
    try:
        user = auth_service.authenticate(data.email, data.password)
    except ValueError as e:
        # Account lockout
        raise HTTPException(status_code=429, detail=str(e))
    if not user:
        raise HTTPException(status_code=401, detail="Invalid email or password")

    access_token = auth_service.create_access_token(user["id"], user["email"], user["role"])
    refresh_token = auth_service.create_refresh_token(user["id"])

    return {
        "access_token": access_token,
        "refresh_token": refresh_token,
        "token_type": "bearer",
        "user": user,
    }


@router.post("/refresh")
def refresh(data: RefreshRequest):
    try:
        payload = auth_service.decode_token(data.refresh_token)
    except Exception:
        raise HTTPException(status_code=401, detail="Invalid or expired refresh token")

    if payload.get("type") != "refresh":
        raise HTTPException(status_code=401, detail="Invalid token type")

    user = auth_service.get_user_by_id(payload["sub"])
    if not user or not user.get("is_active"):
        raise HTTPException(status_code=401, detail="User not found or deactivated")

    user = auth_service._sanitize_user(user)
    access_token = auth_service.create_access_token(user["id"], user["email"], user["role"])
    refresh_token = auth_service.create_refresh_token(user["id"])

    return {
        "access_token": access_token,
        "refresh_token": refresh_token,
        "token_type": "bearer",
        "user": user,
    }


@router.get("/me")
def get_me(current_user: dict = Depends(get_current_user)):
    return current_user


@router.put("/me")
def update_profile(data: ProfileUpdateRequest, current_user: dict = Depends(get_current_user)):
    """Update current user's profile (name, email)."""
    updates = data.model_dump(exclude_none=True)
    if not updates:
        raise HTTPException(status_code=400, detail="No fields to update")

    # Check email uniqueness if changing email
    if "email" in updates and updates["email"].lower() != current_user.get("email", "").lower():
        existing = auth_service.get_user_by_email(updates["email"])
        if existing:
            raise HTTPException(status_code=409, detail="Email already in use")

    user = auth_service.update_user(current_user["id"], updates)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    return user


@router.put("/change-password")
def change_password(data: ChangePasswordRequest, current_user: dict = Depends(get_current_user)):
    """Change current user's password (requires current password)."""
    if len(data.new_password) < 6:
        raise HTTPException(status_code=400, detail="New password must be at least 6 characters")

    # Verify current password
    full_user = auth_service.get_user_by_email(current_user["email"])
    if not full_user:
        raise HTTPException(status_code=404, detail="User not found")

    if not auth_service.verify_password(data.current_password, full_user.get("password_hash", "")):
        raise HTTPException(status_code=401, detail="Current password is incorrect")

    success = auth_service.change_user_password(current_user["id"], data.new_password)
    if not success:
        raise HTTPException(status_code=500, detail="Failed to update password")

    return {"message": "Password changed successfully"}
