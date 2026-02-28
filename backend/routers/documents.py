import asyncio
import io
import json
import logging
import queue
import re
import threading
from datetime import datetime

from fastapi import APIRouter, HTTPException, Query, Depends
from fastapi.responses import StreamingResponse
from typing import Optional

from models.schemas import (
    DocumentCreate,
    DocumentUpdate,
    DocumentSectionCreate,
    DocumentSectionUpdate,
    DocumentSectionReorder,
    DocumentLinkCreate,
    DocumentSectionAssistRequest,
    DocumentDraftClarifyRequest,
    DocumentDraftRequest,
    DocumentDraftDiscussRequest,
)
from middleware.dependencies import get_current_user_or_anonymous

logger = logging.getLogger(__name__)

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
    target_audience: Optional[str] = Query(None),
    skip: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=200),
    _user=Depends(get_current_user_or_anonymous),
):
    db = get_db()
    docs, total = db.list_documents(status=status, doc_type=doc_type, search=search, team_id=team_id, target_audience=target_audience, skip=skip, limit=limit)
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
    if _user:
        data["updated_by"] = _user.get("email", "")
    doc = db.update_document(doc_id, data)
    return doc


@router.delete("/{doc_id}")
def delete_document(doc_id: str, _user=Depends(get_current_user_or_anonymous)):
    db = get_db()
    if not db.delete_document(doc_id):
        raise HTTPException(status_code=404, detail=f"Document {doc_id} not found")
    return {"deleted": True}


@router.get("/{doc_id}/export/docx")
def export_document_docx(doc_id: str, _user=Depends(get_current_user_or_anonymous)):
    """Export a document as a Word (.docx) file."""
    db = get_db()
    doc = db.get_document(doc_id)
    if not doc:
        raise HTTPException(status_code=404, detail=f"Document {doc_id} not found")

    from services.document_docx_export_service import DocumentDocxExportService
    exporter = DocumentDocxExportService()
    docx_bytes = exporter.generate_docx(doc)

    # Sanitize title for filename
    safe_title = re.sub(r'[^\w\s-]', '', doc.get("title", "Document")).strip().replace(' ', '_')[:50]
    timestamp = datetime.now().strftime("%Y%m%d_%H%M")
    filename = f"{safe_title}_{timestamp}.docx"

    return StreamingResponse(
        io.BytesIO(docx_bytes),
        media_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


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


# --- AI Section Assist ---

@router.post("/section-assist")
async def section_assist(
    body: DocumentSectionAssistRequest,
    _user=Depends(get_current_user_or_anonymous),
):
    """AI assist for document sections: suggest, improve, or custom."""
    from services.llm import get_provider
    from services.prompt_service import get_merged_prompts

    prompts = get_merged_prompts()
    da_prompts = prompts.get("document_assist", {})
    if not da_prompts:
        raise HTTPException(status_code=500, detail="Document assist prompts not configured")

    # Build other sections summary
    other_sections_text = ""
    for s in (body.other_sections or []):
        preview = (s.get("content_preview") or "")[:200]
        other_sections_text += f"- {s.get('title', 'Untitled')}: {preview}\n"
    if not other_sections_text:
        other_sections_text = "(no other sections)"

    action = body.action.value
    if action == "suggest":
        user_prompt = da_prompts["suggest"].format(
            section_title=body.section_title or "Untitled",
            doc_type=body.doc_type,
            doc_title=body.doc_title,
            doc_summary=body.doc_summary or "(no summary)",
            other_sections=other_sections_text,
        )
    elif action == "improve":
        user_prompt = da_prompts["improve"].format(
            section_title=body.section_title or "Untitled",
            doc_type=body.doc_type,
            doc_title=body.doc_title,
            doc_summary=body.doc_summary or "(no summary)",
            other_sections=other_sections_text,
            current_value=body.current_value or "(empty)",
        )
    elif action == "custom":
        user_prompt = da_prompts["custom"].format(
            section_title=body.section_title or "Untitled",
            doc_type=body.doc_type,
            doc_title=body.doc_title,
            doc_summary=body.doc_summary or "(no summary)",
            other_sections=other_sections_text,
            current_value=body.current_value or "(empty)",
            custom_prompt=body.custom_prompt or "Improve this content",
        )
    else:
        raise HTTPException(status_code=400, detail=f"Unknown action: {action}")

    system_prompt = da_prompts["system"]
    provider = get_provider(body.provider.value if body.provider else None)
    result = await provider.generate(system_prompt, user_prompt, body.model)

    content = result.get("content", "").strip()
    # Strip accidental markdown code fences wrapping the whole response
    if content.startswith("```") and content.endswith("```"):
        lines = content.split("\n")
        if lines[0].startswith("```"):
            lines = lines[1:]
        if lines and lines[-1].strip() == "```":
            lines = lines[:-1]
        content = "\n".join(lines)

    return {
        "content": content,
        "provider": result.get("provider", ""),
        "model": result.get("model", ""),
    }


# --- AI Document Drafter ---

@router.post("/draft-clarify")
async def draft_clarify(
    body: DocumentDraftClarifyRequest,
    _user=Depends(get_current_user_or_anonymous),
):
    """Pre-flight: assess if document prompt needs clarification before drafting."""
    from services import document_draft_service

    db = get_db()
    result = await document_draft_service.clarify_document_prompt(
        prompt=body.prompt,
        doc_type=body.doc_type,
        target_audience=body.target_audience,
        db=db,
        provider_name=body.provider.value if body.provider else None,
        model=body.model,
    )
    return result


@router.post("/draft-stream")
def draft_document_stream(
    body: DocumentDraftRequest,
    _user=Depends(get_current_user_or_anonymous),
):
    """SSE streaming auto-draft with progress events and quality gate."""
    from services import document_draft_service

    db = get_db()
    progress_queue: queue.Queue = queue.Queue()

    def progress_cb(stage, step, total, message):
        progress_queue.put({
            "type": "progress",
            "stage": stage,
            "step": step,
            "total": total,
            "message": message,
        })

    def run_draft():
        try:
            loop = asyncio.new_event_loop()
            asyncio.set_event_loop(loop)
            result = loop.run_until_complete(
                document_draft_service.draft_document(
                    prompt=body.prompt,
                    doc_type=body.doc_type,
                    target_audience=body.target_audience,
                    db=db,
                    progress_cb=progress_cb,
                    provider_name=body.provider.value if body.provider else None,
                    model=body.model,
                    clarifications=body.clarifications,
                )
            )
            loop.close()
            progress_queue.put({"type": "complete", "result": result})
        except Exception as e:
            logger.error(f"Document draft failed: {e}", exc_info=True)
            progress_queue.put({"type": "error", "message": str(e)})

    thread = threading.Thread(target=run_draft, daemon=True)
    thread.start()

    def event_generator():
        while True:
            try:
                event = progress_queue.get(timeout=180)
                yield f"data: {json.dumps(event, default=str)}\n\n"
                if event["type"] in ("complete", "error"):
                    break
            except queue.Empty:
                yield f"data: {json.dumps({'type': 'heartbeat'})}\n\n"

    return StreamingResponse(event_generator(), media_type="text/event-stream")


@router.post("/draft-discuss-stream")
async def draft_discuss_stream(
    body: DocumentDraftDiscussRequest,
    _user=Depends(get_current_user_or_anonymous),
):
    """SSE streaming discuss with token events."""
    from services import document_draft_service

    db = get_db()

    async def event_generator():
        full_text = ""
        try:
            async for chunk in document_draft_service.discuss_draft_stream(
                message=body.message,
                current_draft=body.current_draft,
                conversation_history=body.conversation_history,
                db=db,
                provider_name=body.provider.value if body.provider else None,
                model=body.model,
            ):
                full_text += chunk
                yield f"data: {json.dumps({'type': 'token', 'content': chunk})}\n\n"
        except Exception as e:
            logger.error(f"Document discuss stream error: {e}", exc_info=True)
            yield f"data: {json.dumps({'type': 'error', 'message': str(e)})}\n\n"
            return

        # Parse response for draft updates
        response_text, updated_draft = document_draft_service.parse_discuss_response(full_text)
        yield f"data: {json.dumps({'type': 'done', 'updated_draft': updated_draft}, default=str)}\n\n"

    return StreamingResponse(event_generator(), media_type="text/event-stream")
