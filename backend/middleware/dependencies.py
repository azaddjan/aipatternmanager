"""
FastAPI dependencies for authentication and authorization.
Used via Depends() in router endpoint signatures.
"""
import logging
from typing import Optional

from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials

from services import auth_service, settings_service

logger = logging.getLogger(__name__)

# HTTP Bearer token extraction (auto_error=False so we can handle anonymous)
_bearer_scheme = HTTPBearer(auto_error=False)


async def get_current_user(
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(_bearer_scheme),
) -> dict:
    """
    Require a valid JWT. Returns the full user dict.
    Raises 401 if token is missing/invalid/expired.
    """
    if not credentials:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Authentication required",
            headers={"WWW-Authenticate": "Bearer"},
        )

    try:
        payload = auth_service.decode_token(credentials.credentials)
    except Exception:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired token",
            headers={"WWW-Authenticate": "Bearer"},
        )

    if payload.get("type") != "access":
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid token type",
        )

    user = auth_service.get_user_by_id(payload["sub"])
    if not user or not user.get("is_active", True):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="User not found or deactivated",
        )

    return auth_service._sanitize_user(user)


async def get_current_user_or_anonymous(
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(_bearer_scheme),
) -> Optional[dict]:
    """
    Returns user dict if authenticated, None if anonymous.
    If anonymous access is disabled in SystemConfig, raises 401 for unauthenticated requests.
    If a token IS provided but invalid, always raises 401.
    """
    if credentials:
        # A token was provided — it must be valid
        try:
            payload = auth_service.decode_token(credentials.credentials)
        except Exception:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Invalid or expired token",
                headers={"WWW-Authenticate": "Bearer"},
            )

        if payload.get("type") != "access":
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Invalid token type",
            )

        user = auth_service.get_user_by_id(payload["sub"])
        if not user or not user.get("is_active"):
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="User not found or deactivated",
            )
        return auth_service._sanitize_user(user)

    # No token provided — check if anonymous access is allowed
    auth_config = settings_service.get_auth_settings()
    if auth_config.get("allow_anonymous_read", False):
        return None  # anonymous access allowed

    raise HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Authentication required",
        headers={"WWW-Authenticate": "Bearer"},
    )


def require_role(*roles: str):
    """
    Factory that returns a dependency requiring the current user to have one of the given roles.
    Usage: Depends(require_role("admin"))
    """
    async def _check(current_user: dict = Depends(get_current_user)) -> dict:
        if current_user.get("role") not in roles:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Insufficient permissions. Required role: {', '.join(roles)}",
            )
        return current_user
    return _check


require_admin = require_role("admin")


async def require_pattern_create_access(
    current_user: dict = Depends(get_current_user),
) -> dict:
    """
    Check that the current user can create patterns.
    Admin and team_member can create. Viewer cannot.
    Team member must be assigned to a team.
    """
    role = current_user.get("role")

    if role == "viewer":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Viewers cannot create patterns",
        )

    if role == "team_member" and not current_user.get("team_id"):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You must be assigned to a team to create patterns",
        )

    return current_user


def check_pattern_write_access(current_user: dict, pattern_id: str):
    """
    Inline helper (not a FastAPI dependency) to check pattern write access.
    Admin can write anything. Team member can only write patterns owned by their team.
    Viewer cannot write anything. Unassigned patterns are admin-only.
    Raises HTTPException on failure.
    """
    role = current_user.get("role")

    if role == "admin":
        return

    if role == "viewer":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Viewers cannot modify patterns",
        )

    # team_member — check ownership
    user_team_id = current_user.get("team_id")
    if not user_team_id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You are not assigned to any team",
        )

    pattern_team_id = auth_service.get_pattern_team(pattern_id)
    if pattern_team_id is None:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="This pattern is unassigned and can only be modified by an admin",
        )
    if pattern_team_id != user_team_id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You can only modify patterns owned by your team",
        )
