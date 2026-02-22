from fastapi import APIRouter, HTTPException

router = APIRouter(prefix="/api/graph", tags=["Graph"])


def get_db():
    from main import db_service
    return db_service


@router.get("/full")
def get_full_graph():
    """Complete pattern graph for visualization."""
    db = get_db()
    return db.get_full_graph()


@router.get("/impact/{pattern_id}")
def get_impact_analysis(pattern_id: str):
    """Impact analysis: what depends on this pattern (what breaks if it changes)."""
    db = get_db()
    if not db.pattern_exists(pattern_id):
        raise HTTPException(status_code=404, detail=f"Pattern {pattern_id} not found")
    impacts = db.get_impact_analysis(pattern_id)
    return {"pattern_id": pattern_id, "impacts": impacts, "count": len(impacts)}


@router.get("/coverage")
def get_coverage_matrix():
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
