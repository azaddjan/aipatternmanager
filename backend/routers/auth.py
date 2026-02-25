"""Authentication router: login, refresh, me."""
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


@router.post("/login")
def login(data: LoginRequest):
    user = auth_service.authenticate(data.email, data.password)
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
