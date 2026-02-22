from fastapi import APIRouter, HTTPException

from models.schemas import CategoryCreate

router = APIRouter(prefix="/api/categories", tags=["Categories"])


def get_db():
    from main import db_service
    return db_service


@router.get("")
def list_categories():
    db = get_db()
    categories = db.list_categories()
    return {"categories": categories}


@router.post("", status_code=201)
def create_category(data: CategoryCreate):
    db = get_db()
    prefix = data.prefix or data.code.upper()
    cat = db.create_category(data.code, data.label, prefix)
    return cat


@router.get("/{code}/overview")
def get_category_overview(code: str):
    """Get an overview of a specific category — patterns grouped by type with counts."""
    db = get_db()

    # Get all patterns in this category
    patterns, total = db.list_patterns(category_filter=code, limit=500)

    ab_patterns = [p for p in patterns if p.get("type") == "AB"]
    abb_patterns = [p for p in patterns if p.get("type") == "ABB"]
    sbb_patterns = [p for p in patterns if p.get("type") == "SBB"]

    # For each ABB, get its implementing SBBs
    abb_details = []
    for abb in abb_patterns:
        abb_id = abb["id"]
        implementing_sbbs = []
        for sbb in sbb_patterns:
            full = db.get_pattern_with_relationships(sbb["id"])
            if full:
                for rel in full.get("relationships", []):
                    if rel["type"] == "IMPLEMENTS" and rel["target_id"] == abb_id:
                        implementing_sbbs.append({
                            "id": sbb["id"],
                            "name": sbb.get("name", ""),
                            "status": sbb.get("status", ""),
                        })
                        break
        abb_details.append({
            "id": abb["id"],
            "name": abb.get("name", ""),
            "status": abb.get("status", ""),
            "sbb_count": len(implementing_sbbs),
            "sbbs": implementing_sbbs,
        })

    # Category label from BUILTIN_CATEGORIES
    from services.neo4j_service import BUILTIN_CATEGORIES
    label = BUILTIN_CATEGORIES.get(code, code.title())

    return {
        "code": code,
        "label": label,
        "total_patterns": total,
        "ab_count": len(ab_patterns),
        "abb_count": len(abb_patterns),
        "sbb_count": len(sbb_patterns),
        "abbs": abb_details,
    }
