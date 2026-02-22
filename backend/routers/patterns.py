from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import JSONResponse
from typing import Optional
import re
import threading

from models.schemas import (
    PatternCreate, PatternUpdate,
    RelationshipCreate,
)

router = APIRouter(prefix="/api/patterns", tags=["Patterns"])


def _auto_embed_pattern(pattern_id: str):
    """Fire-and-forget: embed a pattern in a background thread."""
    def _run():
        try:
            from routers.advisor import _get_embedding_svc
            from main import db_service
            svc = _get_embedding_svc()
            if svc.available:
                svc.embed_pattern(db_service, pattern_id)
        except Exception:
            pass
    threading.Thread(target=_run, daemon=True).start()


def _bump_version(current: str, bump: str = "patch") -> str:
    """Bump a MAJOR.MINOR.PATCH version string.

    bump can be 'major', 'minor', or 'patch'.
    """
    m = re.match(r"^(\d+)\.(\d+)\.(\d+)$", current or "1.0.0")
    if not m:
        return "1.0.0"
    major, minor, patch = int(m.group(1)), int(m.group(2)), int(m.group(3))
    if bump == "major":
        return f"{major + 1}.0.0"
    elif bump == "minor":
        return f"{major}.{minor + 1}.0"
    else:
        return f"{major}.{minor}.{patch + 1}"


def get_db():
    from main import db_service
    return db_service


@router.get("")
def list_patterns(
    type: Optional[str] = Query(None, description="Filter by type: AB, ABB, SBB"),
    category: Optional[str] = Query(None, description="Filter by category code"),
    status: Optional[str] = Query(None, description="Filter by status"),
    skip: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=500),
):
    db = get_db()
    patterns, total = db.list_patterns(type, category, status, skip, limit)
    return {"patterns": patterns, "total": total}


@router.get("/generate-id")
def generate_id(
    type: str = Query(..., description="Pattern type: AB, ABB, SBB"),
    category: str = Query(..., description="Category code"),
):
    """Preview the next auto-generated ID for a type+category combo."""
    db = get_db()
    generated_id = db.generate_pattern_id(type, category)
    return {"id": generated_id}


@router.get("/{pattern_id}")
def get_pattern(pattern_id: str):
    db = get_db()
    pattern = db.get_pattern_with_relationships(pattern_id)
    if not pattern:
        raise HTTPException(status_code=404, detail=f"Pattern {pattern_id} not found")
    return JSONResponse(
        content=pattern,
        headers={"Cache-Control": "no-store, no-cache, must-revalidate, max-age=0"},
    )


@router.post("", status_code=201)
def create_pattern(data: PatternCreate):
    db = get_db()
    # Auto-generate ID if not provided
    if data.id:
        pattern_id = data.id
    else:
        pattern_id = db.generate_pattern_id(data.type.value, data.category)

    if db.pattern_exists(pattern_id):
        raise HTTPException(status_code=409, detail=f"Pattern {pattern_id} already exists")

    # Extract relationship fields before creating the node
    implements_abb = data.implements_abb
    technology_ids = data.technology_ids or []
    compatible_tech_ids = data.compatible_tech_ids or []
    depends_on_ids = data.depends_on_ids or []

    pattern_data = data.model_dump(exclude={"implements_abb", "technology_ids", "compatible_tech_ids", "depends_on_ids"})
    pattern_data["id"] = pattern_id

    # Validate consumed_by_ids and works_with_ids reference existing patterns
    _validate_interop_ids(db, pattern_data.get("consumed_by_ids"), pattern_data.get("works_with_ids"))

    pattern = db.create_pattern(pattern_data)

    # Auto-create IMPLEMENTS relationship (SBB -> ABB)
    if implements_abb and db.pattern_exists(implements_abb):
        db.add_relationship(pattern_id, implements_abb, "IMPLEMENTS")

    # Auto-create USES relationships (Pattern -> Technology) — core dependencies
    for tech_id in technology_ids:
        if db.get_technology(tech_id):
            db.add_relationship(pattern_id, tech_id, "USES")

    # Auto-create COMPATIBLE_WITH relationships (Pattern -> Technology) — optional/compatible
    for tech_id in compatible_tech_ids:
        if db.get_technology(tech_id):
            db.add_relationship(pattern_id, tech_id, "COMPATIBLE_WITH")

    # Auto-create DEPENDS_ON relationships (Pattern -> Pattern)
    for dep_id in depends_on_ids:
        if db.pattern_exists(dep_id):
            db.add_relationship(pattern_id, dep_id, "DEPENDS_ON")

    _auto_embed_pattern(pattern_id)
    return pattern


@router.put("/{pattern_id}")
def update_pattern(
    pattern_id: str,
    data: PatternUpdate,
    version_bump: str = Query("patch", description="Version bump type: major, minor, patch, none"),
):
    db = get_db()

    # Extract relationship fields
    implements_abb = data.implements_abb
    technology_ids = data.technology_ids
    compatible_tech_ids = data.compatible_tech_ids
    depends_on_ids = data.depends_on_ids

    update_data = data.model_dump(exclude_none=True, exclude={"implements_abb", "technology_ids", "compatible_tech_ids", "depends_on_ids"})
    if not update_data and implements_abb is None and technology_ids is None and compatible_tech_ids is None and depends_on_ids is None:
        raise HTTPException(status_code=400, detail="No fields to update")

    # Validate consumed_by_ids and works_with_ids reference existing patterns
    _validate_interop_ids(db, update_data.get("consumed_by_ids"), update_data.get("works_with_ids"))

    # Auto-bump version if not explicitly set and bump is requested
    if update_data and version_bump != "none" and "version" not in update_data:
        current = db.get_pattern(pattern_id)
        if current:
            update_data["version"] = _bump_version(current.get("version", "1.0.0"), version_bump)

    pattern = None
    if update_data:
        pattern = db.update_pattern(pattern_id, update_data)
        if not pattern:
            raise HTTPException(status_code=404, detail=f"Pattern {pattern_id} not found")

    # Update IMPLEMENTS relationship if provided
    if implements_abb is not None:
        _replace_implements(db, pattern_id, implements_abb)

    # Update USES relationships if provided
    if technology_ids is not None:
        _replace_uses(db, pattern_id, technology_ids)

    # Update COMPATIBLE_WITH relationships if provided
    if compatible_tech_ids is not None:
        _replace_compatible_with(db, pattern_id, compatible_tech_ids)

    # Update DEPENDS_ON relationships if provided
    if depends_on_ids is not None:
        _replace_depends_on(db, pattern_id, depends_on_ids)

    # Return the final pattern state
    if not pattern:
        pattern = db.get_pattern(pattern_id)

    _auto_embed_pattern(pattern_id)
    return pattern


def _validate_interop_ids(db, consumed_by_ids, works_with_ids):
    """Validate that all consumed_by_ids and works_with_ids reference existing patterns."""
    invalid = []
    for pid in (consumed_by_ids or []):
        if not db.pattern_exists(pid):
            invalid.append(pid)
    for pid in (works_with_ids or []):
        if not db.pattern_exists(pid):
            invalid.append(pid)
    if invalid:
        raise HTTPException(
            status_code=400,
            detail=f"Referenced pattern(s) do not exist: {', '.join(invalid)}"
        )


def _replace_implements(db, pattern_id: str, abb_id: str):
    """Replace the IMPLEMENTS relationship for a pattern."""
    # Remove existing IMPLEMENTS rels
    with db.session() as session:
        session.run(
            "MATCH (p:Pattern {id: $pid})-[r:IMPLEMENTS]->() DELETE r",
            pid=pattern_id,
        )
    # Add new one if provided
    if abb_id and db.pattern_exists(abb_id):
        db.add_relationship(pattern_id, abb_id, "IMPLEMENTS")


def _replace_uses(db, pattern_id: str, tech_ids: list[str]):
    """Replace the USES relationships for a pattern."""
    # Remove existing USES rels to technologies
    with db.session() as session:
        session.run(
            "MATCH (p:Pattern {id: $pid})-[r:USES]->(t:Technology) DELETE r",
            pid=pattern_id,
        )
    # Add new ones
    for tid in tech_ids:
        if db.get_technology(tid):
            db.add_relationship(pattern_id, tid, "USES")


def _replace_compatible_with(db, pattern_id: str, tech_ids: list[str]):
    """Replace the COMPATIBLE_WITH relationships for a pattern."""
    with db.session() as session:
        session.run(
            "MATCH (p:Pattern {id: $pid})-[r:COMPATIBLE_WITH]->(t:Technology) DELETE r",
            pid=pattern_id,
        )
    for tid in tech_ids:
        if db.get_technology(tid):
            db.add_relationship(pattern_id, tid, "COMPATIBLE_WITH")


def _replace_depends_on(db, pattern_id: str, dep_ids: list[str]):
    """Replace the DEPENDS_ON relationships for a pattern."""
    # Remove existing outgoing DEPENDS_ON rels
    with db.session() as session:
        session.run(
            "MATCH (p:Pattern {id: $pid})-[r:DEPENDS_ON]->() DELETE r",
            pid=pattern_id,
        )
    # Add new ones
    for dep_id in dep_ids:
        if db.pattern_exists(dep_id):
            db.add_relationship(pattern_id, dep_id, "DEPENDS_ON")


@router.delete("/{pattern_id}")
def delete_pattern(pattern_id: str):
    db = get_db()
    if not db.delete_pattern(pattern_id):
        raise HTTPException(status_code=404, detail=f"Pattern {pattern_id} not found")
    return {"deleted": pattern_id}


@router.get("/{pattern_id}/graph")
def get_pattern_graph(pattern_id: str):
    db = get_db()
    if not db.pattern_exists(pattern_id):
        raise HTTPException(status_code=404, detail=f"Pattern {pattern_id} not found")
    return db.get_pattern_subgraph(pattern_id)


@router.post("/{pattern_id}/relationships", status_code=201)
def add_relationship(pattern_id: str, data: RelationshipCreate):
    db = get_db()
    if not db.pattern_exists(pattern_id):
        raise HTTPException(status_code=404, detail=f"Pattern {pattern_id} not found")
    success = db.add_relationship(pattern_id, data.target_id, data.type.value, data.properties)
    if not success:
        raise HTTPException(status_code=400, detail="Failed to create relationship")
    return {"source": pattern_id, "target": data.target_id, "type": data.type}


@router.delete("/{pattern_id}/relationships/{target_id}/{rel_type}")
def remove_relationship(pattern_id: str, target_id: str, rel_type: str):
    db = get_db()
    db.remove_relationship(pattern_id, target_id, rel_type)
    return {"deleted": True, "source": pattern_id, "target": target_id, "type": rel_type}
