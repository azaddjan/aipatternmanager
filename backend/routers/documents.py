from fastapi import APIRouter, HTTPException, Query, Depends
from typing import Optional

from models.schemas import (
    DocumentCreate,
    DocumentUpdate,
    DocumentSectionCreate,
    DocumentSectionUpdate,
    DocumentSectionReorder,
    DocumentLinkCreate,
)
from middleware.dependencies import get_current_user_or_anonymous

router = APIRouter(prefix="/api/documents", tags=["Documents"])


def get_db():
    from main import db_service
    return db_service


# --- Document CRUD ---

@router.get("")
def list_documents(
    status: Optional[str] = Query(None),
    doc_type: Optional[str] = Query(None),
    search: Optional[str] = Query(None),
    team_id: Optional[str] = Query(None),
    skip: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=200),
    _user=Depends(get_current_user_or_anonymous),
):
    db = get_db()
    docs, total = db.list_documents(status=status, doc_type=doc_type, search=search, team_id=team_id, skip=skip, limit=limit)
    return {"documents": docs, "total": total}


@router.get("/{doc_id}")
def get_document(doc_id: str, _user=Depends(get_current_user_or_anonymous)):
    db = get_db()
    doc = db.get_document(doc_id)
    if not doc:
        raise HTTPException(status_code=404, detail=f"Document {doc_id} not found")
    return doc


@router.post("", status_code=201)
def create_document(
    body: DocumentCreate,
    _user=Depends(get_current_user_or_anonymous),
):
    db = get_db()
    data = body.model_dump()
    if _user:
        data["created_by"] = _user.get("email", "")
    doc = db.create_document(data)
    return doc


@router.put("/{doc_id}")
def update_document(
    doc_id: str,
    body: DocumentUpdate,
    _user=Depends(get_current_user_or_anonymous),
):
    db = get_db()
    if not db.document_exists(doc_id):
        raise HTTPException(status_code=404, detail=f"Document {doc_id} not found")
    data = body.model_dump(exclude_none=True)
    doc = db.update_document(doc_id, data)
    return doc


@router.delete("/{doc_id}")
def delete_document(doc_id: str, _user=Depends(get_current_user_or_anonymous)):
    db = get_db()
    if not db.delete_document(doc_id):
        raise HTTPException(status_code=404, detail=f"Document {doc_id} not found")
    return {"deleted": True}


# --- Sections ---

@router.post("/{doc_id}/sections", status_code=201)
def add_section(
    doc_id: str,
    body: DocumentSectionCreate,
    _user=Depends(get_current_user_or_anonymous),
):
    db = get_db()
    if not db.document_exists(doc_id):
        raise HTTPException(status_code=404, detail=f"Document {doc_id} not found")
    section = db.add_document_section(doc_id, body.model_dump())
    if not section:
        raise HTTPException(status_code=500, detail="Failed to create section")
    return section


@router.put("/{doc_id}/sections/{section_id}")
def update_section(
    doc_id: str,
    section_id: str,
    body: DocumentSectionUpdate,
    _user=Depends(get_current_user_or_anonymous),
):
    db = get_db()
    data = body.model_dump(exclude_none=True)
    section = db.update_document_section(section_id, data)
    if not section:
        raise HTTPException(status_code=404, detail=f"Section {section_id} not found")
    return section


@router.delete("/{doc_id}/sections/{section_id}")
def delete_section(
    doc_id: str,
    section_id: str,
    _user=Depends(get_current_user_or_anonymous),
):
    db = get_db()
    if not db.delete_document_section(section_id):
        raise HTTPException(status_code=404, detail=f"Section {section_id} not found")
    return {"deleted": True}


@router.put("/{doc_id}/sections/reorder")
def reorder_sections(
    doc_id: str,
    body: DocumentSectionReorder,
    _user=Depends(get_current_user_or_anonymous),
):
    db = get_db()
    if not db.document_exists(doc_id):
        raise HTTPException(status_code=404, detail=f"Document {doc_id} not found")
    db.reorder_document_sections(doc_id, body.section_ids)
    return {"reordered": True}


# --- Entity Links ---

@router.post("/{doc_id}/links", status_code=201)
def link_entity(
    doc_id: str,
    body: DocumentLinkCreate,
    _user=Depends(get_current_user_or_anonymous),
):
    db = get_db()
    if not db.document_exists(doc_id):
        raise HTTPException(status_code=404, detail=f"Document {doc_id} not found")
    db.link_document_to_entity(doc_id, body.entity_id, body.entity_label)
    return {"linked": True}


@router.delete("/{doc_id}/links/{entity_id}")
def unlink_entity(
    doc_id: str,
    entity_id: str,
    _user=Depends(get_current_user_or_anonymous),
):
    db = get_db()
    db.unlink_document_from_entity(doc_id, entity_id)
    return {"unlinked": True}
