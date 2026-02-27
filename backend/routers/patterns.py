from fastapi import APIRouter, HTTPException, Query, UploadFile, File, Depends
from fastapi.responses import JSONResponse, StreamingResponse
from typing import Optional
import io
import os
import re
import threading
import uuid
import zipfile

from models.schemas import (
    PatternCreate, PatternUpdate,
    RelationshipCreate,
)
from middleware.dependencies import (
    get_current_user_or_anonymous,
    require_pattern_create_access,
    check_pattern_write_access,
)
from services import auth_service
from services.audit_service import log_action

router = APIRouter(prefix="/api/patterns", tags=["Patterns"])

UPLOAD_DIR = os.environ.get("UPLOAD_DIR", "/app/uploads")
ALLOWED_IMAGE_TYPES = {"image/jpeg", "image/png", "image/svg+xml"}
MAX_IMAGE_SIZE = 10 * 1024 * 1024  # 10 MB


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
    team_ids: Optional[str] = Query(None, description="Comma-separated team IDs to filter"),
    skip: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=500),
    _user=Depends(get_current_user_or_anonymous),
):
    db = get_db()
    team_id_list = [t.strip() for t in team_ids.split(",") if t.strip()] if team_ids else None
    patterns, total = db.list_patterns(type, category, status, skip, limit, team_ids=team_id_list)
    return {"patterns": patterns, "total": total}


@router.get("/generate-id")
def generate_id(
    type: str = Query(..., description="Pattern type: AB, ABB, SBB"),
    category: str = Query(..., description="Category code"),
    _user=Depends(get_current_user_or_anonymous),
):
    """Preview the next auto-generated ID for a type+category combo."""
    db = get_db()
    generated_id = db.generate_pattern_id(type, category)
    return {"id": generated_id}


@router.get("/{pattern_id}")
def get_pattern(pattern_id: str, _user=Depends(get_current_user_or_anonymous)):
    db = get_db()
    pattern = db.get_pattern_with_relationships(pattern_id)
    if not pattern:
        raise HTTPException(status_code=404, detail=f"Pattern {pattern_id} not found")
    return JSONResponse(
        content=pattern,
        headers={"Cache-Control": "no-store, no-cache, must-revalidate, max-age=0"},
    )


@router.post("", status_code=201)
def create_pattern(
    data: PatternCreate,
    team_id: Optional[str] = Query(None, description="Assign pattern to team (admin only)"),
    current_user: dict = Depends(require_pattern_create_access),
):
    db = get_db()
    # Auto-generate ID if not provided
    if data.id:
        pattern_id = data.id
    else:
        pattern_id = db.generate_pattern_id(data.type.value, data.category)

    if db.pattern_exists(pattern_id):
        raise HTTPException(status_code=409, detail=f"Pattern {pattern_id} already exists")

    # TOGAF enforcement: ABBs are vendor-neutral and NEVER have tech/dep relationships
    if data.type.value == "ABB":
        if data.technology_ids:
            raise HTTPException(status_code=400, detail="ABBs cannot have technology dependencies (USES). ABBs are vendor-neutral abstract capabilities.")
        if data.compatible_tech_ids:
            raise HTTPException(status_code=400, detail="ABBs cannot have compatible technologies (COMPATIBLE_WITH). ABBs are vendor-neutral.")
        if data.depends_on_ids:
            raise HTTPException(status_code=400, detail="ABBs cannot have DEPENDS_ON relationships. Use REFERENCES or CONSTRAINED_BY instead.")

    # Extract relationship fields before creating the node
    implements_abbs = data.implements_abbs or []
    technology_ids = data.technology_ids or []
    compatible_tech_ids = data.compatible_tech_ids or []
    depends_on_ids = data.depends_on_ids or []

    pattern_data = data.model_dump(exclude={"implements_abbs", "technology_ids", "compatible_tech_ids", "depends_on_ids"})
    pattern_data["id"] = pattern_id

    # Track who created the pattern
    pattern_data["created_by"] = current_user.get("name") or current_user.get("email", "")
    pattern_data["created_by_id"] = current_user.get("id", "")

    # Validate consumed_by_ids and works_with_ids reference existing patterns
    _validate_interop_ids(db, pattern_data.get("consumed_by_ids"), pattern_data.get("works_with_ids"))

    pattern = db.create_pattern(pattern_data)

    # Auto-create IMPLEMENTS relationships (SBB -> ABBs) — one SBB can realize multiple ABBs
    for abb_id in implements_abbs:
        if abb_id and db.pattern_exists(abb_id):
            db.add_relationship(pattern_id, abb_id, "IMPLEMENTS")

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

    # Assign pattern to team: admin can override, otherwise auto-assign to user's team
    assign_team = team_id if (team_id and current_user.get("role") == "admin") else current_user.get("team_id")
    if assign_team:
        auth_service.assign_pattern_to_team(pattern_id, assign_team)

    _auto_embed_pattern(pattern_id)

    # Audit log
    try:
        log_action(
            user_id=current_user.get("id", ""),
            user_name=current_user.get("name") or current_user.get("email", ""),
            action="CREATE",
            entity_type="pattern",
            entity_id=pattern_id,
            entity_name=data.name or "",
            details=f"Type: {data.type.value}, Category: {data.category}",
        )
    except Exception:
        pass

    return pattern


@router.put("/{pattern_id}")
def update_pattern(
    pattern_id: str,
    data: PatternUpdate,
    version_bump: str = Query("patch", description="Version bump type: major, minor, patch, none"),
    team_id: Optional[str] = Query(None, description="Reassign pattern to team (admin only)"),
    current_user: dict = Depends(require_pattern_create_access),
):
    check_pattern_write_access(current_user, pattern_id)
    db = get_db()

    # Extract relationship fields
    implements_abbs = data.implements_abbs
    technology_ids = data.technology_ids
    compatible_tech_ids = data.compatible_tech_ids
    depends_on_ids = data.depends_on_ids

    # TOGAF enforcement: check if this pattern is an ABB — reject tech/dep relationships
    existing = db.get_pattern(pattern_id)
    if existing and existing.get("type") == "ABB":
        if technology_ids and len(technology_ids) > 0:
            raise HTTPException(status_code=400, detail="ABBs cannot have technology dependencies (USES). ABBs are vendor-neutral abstract capabilities.")
        if compatible_tech_ids and len(compatible_tech_ids) > 0:
            raise HTTPException(status_code=400, detail="ABBs cannot have compatible technologies (COMPATIBLE_WITH). ABBs are vendor-neutral.")
        if depends_on_ids and len(depends_on_ids) > 0:
            raise HTTPException(status_code=400, detail="ABBs cannot have DEPENDS_ON relationships. Use REFERENCES or CONSTRAINED_BY instead.")

    update_data = data.model_dump(exclude_none=True, exclude={"implements_abbs", "technology_ids", "compatible_tech_ids", "depends_on_ids"})
    if not update_data and implements_abbs is None and technology_ids is None and compatible_tech_ids is None and depends_on_ids is None:
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

    # Update IMPLEMENTS relationships if provided
    if implements_abbs is not None:
        _replace_implements(db, pattern_id, implements_abbs)

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

    # Allow admin to reassign pattern team
    if team_id is not None and current_user.get("role") == "admin":
        if team_id:
            auth_service.assign_pattern_to_team(pattern_id, team_id)
        else:
            auth_service.remove_pattern_team(pattern_id)

    _auto_embed_pattern(pattern_id)

    # Audit log
    try:
        changed_fields = list(update_data.keys()) if update_data else []
        if implements_abbs is not None:
            changed_fields.append("implements_abbs")
        if technology_ids is not None:
            changed_fields.append("technology_ids")
        if compatible_tech_ids is not None:
            changed_fields.append("compatible_tech_ids")
        if depends_on_ids is not None:
            changed_fields.append("depends_on_ids")
        log_action(
            user_id=current_user.get("id", ""),
            user_name=current_user.get("name") or current_user.get("email", ""),
            action="UPDATE",
            entity_type="pattern",
            entity_id=pattern_id,
            entity_name=pattern.get("name", "") if pattern else "",
            changes={"fields": changed_fields},
        )
    except Exception:
        pass

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


def _replace_implements(db, pattern_id: str, abb_ids: list[str]):
    """Replace the IMPLEMENTS relationships for a pattern (SBB can realize multiple ABBs)."""
    # Remove existing IMPLEMENTS rels
    with db.session() as session:
        session.run(
            "MATCH (p:Pattern {id: $pid})-[r:IMPLEMENTS]->() DELETE r",
            pid=pattern_id,
        )
    # Add new ones
    for abb_id in abb_ids:
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
def delete_pattern(pattern_id: str, current_user: dict = Depends(require_pattern_create_access)):
    check_pattern_write_access(current_user, pattern_id)
    db = get_db()
    # Fetch pattern first to get image files for cleanup
    pattern = db.get_pattern(pattern_id)
    if not pattern:
        raise HTTPException(status_code=404, detail=f"Pattern {pattern_id} not found")

    if not db.delete_pattern(pattern_id):
        raise HTTPException(status_code=404, detail=f"Pattern {pattern_id} not found")

    # Clean up image files from filesystem
    for img in pattern.get("images", []):
        filepath = os.path.join(UPLOAD_DIR, img.get("filename", ""))
        if filepath and os.path.isfile(filepath):
            try:
                os.remove(filepath)
            except OSError:
                pass

    # Audit log
    try:
        log_action(
            user_id=current_user.get("id", ""),
            user_name=current_user.get("name") or current_user.get("email", ""),
            action="DELETE",
            entity_type="pattern",
            entity_id=pattern_id,
            entity_name=pattern.get("name", ""),
        )
    except Exception:
        pass

    return {"deleted": pattern_id}


# --- Image Upload / Delete ---

@router.post("/{pattern_id}/images", status_code=201)
async def upload_image(
    pattern_id: str,
    file: UploadFile = File(...),
    title: str = Query("", description="Optional title for the image"),
    current_user: dict = Depends(require_pattern_create_access),
):
    check_pattern_write_access(current_user, pattern_id)
    db = get_db()
    pattern = db.get_pattern(pattern_id)
    if not pattern:
        raise HTTPException(status_code=404, detail=f"Pattern {pattern_id} not found")

    if file.content_type not in ALLOWED_IMAGE_TYPES:
        raise HTTPException(status_code=400, detail=f"Unsupported file type: {file.content_type}. Allowed: jpeg, png, svg")

    contents = await file.read()
    if len(contents) > MAX_IMAGE_SIZE:
        raise HTTPException(status_code=400, detail="File too large (max 10 MB)")

    ext = file.filename.rsplit(".", 1)[-1].lower() if "." in (file.filename or "") else "png"
    image_id = str(uuid.uuid4())
    filename = f"{image_id}.{ext}"

    os.makedirs(UPLOAD_DIR, exist_ok=True)
    with open(os.path.join(UPLOAD_DIR, filename), "wb") as f:
        f.write(contents)

    image_meta = {
        "id": image_id,
        "title": title or file.filename or filename,
        "filename": filename,
        "content_type": file.content_type,
        "size": len(contents),
    }

    images = pattern.get("images", [])
    images.append(image_meta)
    db.update_pattern(pattern_id, {"images": images})

    return image_meta


@router.delete("/{pattern_id}/images/{image_id}")
def delete_image(pattern_id: str, image_id: str, current_user: dict = Depends(require_pattern_create_access)):
    check_pattern_write_access(current_user, pattern_id)
    db = get_db()
    pattern = db.get_pattern(pattern_id)
    if not pattern:
        raise HTTPException(status_code=404, detail=f"Pattern {pattern_id} not found")

    images = pattern.get("images", [])
    target = next((img for img in images if img.get("id") == image_id), None)
    if not target:
        raise HTTPException(status_code=404, detail=f"Image {image_id} not found on pattern {pattern_id}")

    # Delete file from filesystem
    filepath = os.path.join(UPLOAD_DIR, target.get("filename", ""))
    if filepath and os.path.isfile(filepath):
        try:
            os.remove(filepath)
        except OSError:
            pass

    # Update pattern images list
    images = [img for img in images if img.get("id") != image_id]
    db.update_pattern(pattern_id, {"images": images})

    return {"deleted": image_id}


# --- Artifact Export ---

@router.get("/{pattern_id}/artifacts")
def export_artifacts(pattern_id: str, _user=Depends(get_current_user_or_anonymous)):
    db = get_db()
    pattern = db.get_pattern(pattern_id)
    if not pattern:
        raise HTTPException(status_code=404, detail=f"Pattern {pattern_id} not found")

    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        # Add uploaded images
        for img in pattern.get("images", []):
            filepath = os.path.join(UPLOAD_DIR, img.get("filename", ""))
            if os.path.isfile(filepath):
                arc_name = f"images/{img.get('title', img['filename'])}_{img['filename']}"
                zf.write(filepath, arc_name)

        # Add mermaid diagrams as .mmd files
        for diag in pattern.get("diagrams", []):
            title = diag.get("title") or diag.get("id", "untitled")
            safe_title = re.sub(r'[^\w\-. ]', '_', title)
            zf.writestr(f"diagrams/{safe_title}.mmd", diag.get("content", ""))

    buf.seek(0)
    filename = f"{pattern_id}_artifacts.zip"
    return StreamingResponse(
        buf,
        media_type="application/zip",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.get("/{pattern_id}/graph")
def get_pattern_graph(pattern_id: str, _user=Depends(get_current_user_or_anonymous)):
    db = get_db()
    if not db.pattern_exists(pattern_id):
        raise HTTPException(status_code=404, detail=f"Pattern {pattern_id} not found")
    return db.get_pattern_subgraph(pattern_id)


@router.post("/{pattern_id}/relationships", status_code=201)
def add_relationship(pattern_id: str, data: RelationshipCreate, current_user: dict = Depends(require_pattern_create_access)):
    check_pattern_write_access(current_user, pattern_id)
    db = get_db()
    if not db.pattern_exists(pattern_id):
        raise HTTPException(status_code=404, detail=f"Pattern {pattern_id} not found")
    success = db.add_relationship(pattern_id, data.target_id, data.type.value, data.properties)
    if not success:
        raise HTTPException(status_code=400, detail="Failed to create relationship")
    return {"source": pattern_id, "target": data.target_id, "type": data.type}


@router.delete("/{pattern_id}/relationships/{target_id}/{rel_type}")
def remove_relationship(pattern_id: str, target_id: str, rel_type: str, current_user: dict = Depends(require_pattern_create_access)):
    check_pattern_write_access(current_user, pattern_id)
    db = get_db()
    db.remove_relationship(pattern_id, target_id, rel_type)
    return {"deleted": True, "source": pattern_id, "target": target_id, "type": rel_type}
