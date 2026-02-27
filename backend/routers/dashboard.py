"""Dashboard-specific endpoints for team comparison statistics."""

from typing import Optional

from fastapi import APIRouter, Depends, Query

from middleware.dependencies import get_current_user_or_anonymous

router = APIRouter(prefix="/api/dashboard", tags=["Dashboard"])


def _get_db():
    from main import db_service
    return db_service


@router.get("/team-stats")
def get_team_stats(_user=Depends(get_current_user_or_anonymous)):
    """Per-team aggregated statistics for the Dashboard comparison table."""
    db = _get_db()
    return db.get_team_stats()
