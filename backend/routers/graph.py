from typing import Optional

from fastapi import APIRouter, HTTPException, Query, Depends

from middleware.dependencies import get_current_user_or_anonymous

router = APIRouter(prefix="/api/graph", tags=["Graph"])


def get_db():
    from main import db_service
    return db_service


@router.get("/full")
def get_full_graph(
    team_id: Optional[str] = Query(None, description="Team ID to scope graph, 'all' for global, or omit for all"),
    _user=Depends(get_current_user_or_anonymous),
):
    """Complete pattern graph for visualization. Optionally scoped to a team."""
    db = get_db()
    effective_team = None if (not team_id or team_id == "all") else team_id
    return db.get_full_graph(team_id=effective_team)


@router.get("/impact/{pattern_id}")
def get_impact_analysis(pattern_id: str, _user=Depends(get_current_user_or_anonymous)):
    """Impact analysis: what depends on this pattern (what breaks if it changes)."""
    db = get_db()
    if not db.pattern_exists(pattern_id):
        raise HTTPException(status_code=404, detail=f"Pattern {pattern_id} not found")
    impacts = db.get_impact_analysis(pattern_id)
    return {"pattern_id": pattern_id, "impacts": impacts, "count": len(impacts)}


@router.get("/coverage")
def get_coverage_matrix(_user=Depends(get_current_user_or_anonymous)):
    """ABB coverage matrix: which ABBs have SBB implementations."""
    db = get_db()
    coverage = db.get_coverage_matrix()
    total_abbs = len(coverage)
    covered = sum(1 for c in coverage if c["sbb_count"] > 0)
    return {
        "coverage": coverage,
        "total_abbs": total_abbs,
        "covered_abbs": covered,
        "coverage_pct": round(covered / total_abbs * 100, 1) if total_abbs else 0,
    }
