from fastapi import APIRouter, HTTPException, Depends

from models.schemas import CategoryCreate, CategoryUpdate
from middleware.dependencies import get_current_user, get_current_user_or_anonymous
from services.audit_service import log_action

router = APIRouter(prefix="/api/categories", tags=["Categories"])


def get_db():
    from main import db_service
    return db_service


@router.get("")
def list_categories(_user=Depends(get_current_user_or_anonymous)):
    db = get_db()
    categories = db.list_categories()
    return {"categories": categories}


@router.post("", status_code=201)
def create_category(data: CategoryCreate, current_user: dict = Depends(get_current_user)):
    if current_user.get("role") == "viewer":
        raise HTTPException(status_code=403, detail="Viewers cannot create categories")
    db = get_db()
    prefix = data.prefix or data.code.upper()
    cat = db.create_category(data.code, data.label, prefix)
    try:
        log_action(
            user_id=current_user.get("id", ""),
            user_name=current_user.get("name") or current_user.get("email", ""),
            action="CREATE",
            entity_type="category",
            entity_id=data.code,
            entity_name=data.label,
        )
    except Exception:
        pass
    return cat


@router.put("/{code}")
def update_category(code: str, data: CategoryUpdate, current_user: dict = Depends(get_current_user)):
    if current_user.get("role") == "viewer":
        raise HTTPException(status_code=403, detail="Viewers cannot update categories")
    db = get_db()
    updates = data.model_dump(exclude_none=True)
    if not updates:
        raise HTTPException(status_code=400, detail="No fields to update")
    cat = db.update_category(code, updates)
    if not cat:
        raise HTTPException(status_code=404, detail=f"Category '{code}' not found")
    try:
        log_action(
            user_id=current_user.get("id", ""),
            user_name=current_user.get("name") or current_user.get("email", ""),
            action="UPDATE",
            entity_type="category",
            entity_id=code,
            entity_name=cat.get("label", ""),
            changes={"fields": list(updates.keys())},
        )
    except Exception:
        pass
    return cat


@router.delete("/{code}")
def delete_category(code: str, current_user: dict = Depends(get_current_user)):
    if current_user.get("role") == "viewer":
        raise HTTPException(status_code=403, detail="Viewers cannot delete categories")
    db = get_db()
    # Prevent deleting a category that has patterns
    count = db.count_patterns_in_category(code)
    if count > 0:
        raise HTTPException(
            status_code=409,
            detail=f"Cannot delete category '{code}': {count} pattern(s) still use it. Reassign or delete them first.",
        )
    if not db.delete_category(code):
        raise HTTPException(status_code=404, detail=f"Category '{code}' not found")
    try:
        log_action(
            user_id=current_user.get("id", ""),
            user_name=current_user.get("name") or current_user.get("email", ""),
            action="DELETE",
            entity_type="category",
            entity_id=code,
        )
    except Exception:
        pass
    return {"deleted": code}


@router.get("/{code}/overview")
def get_category_overview(code: str, _user=Depends(get_current_user_or_anonymous)):
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
