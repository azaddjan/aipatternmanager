"""Legacy Document Import router — admin-only AI-assisted pattern migration."""

import asyncio
import json
import logging
import os
import queue
import threading
import uuid
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Query
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from middleware.dependencies import require_admin, get_current_user
from services import legacy_import_service

logger = logging.getLogger(__name__)

router = APIRouter(
    prefix="/api/admin/legacy-import",
    tags=["Legacy Import"],
    dependencies=[Depends(require_admin)],
)


def _get_db():
    from main import db_service
    return db_service


UPLOAD_DIR = os.environ.get("UPLOAD_DIR", os.path.join(os.path.dirname(__file__), "..", "uploads"))
LEGACY_DIR = os.path.join(UPLOAD_DIR, "legacy")
MAX_FILE_SIZE = legacy_import_service.MAX_FILE_SIZE


# --- Upload & Analyze (SSE) ---

@router.post("/upload-and-analyze")
async def upload_and_analyze(
    file: UploadFile = File(...),
    user=Depends(get_current_user),
):
    """Upload a legacy document and run AI analysis with SSE progress streaming.

    Accepts PDF (.pdf) or Word (.docx) files, max 50 MB.
    Returns Server-Sent Events with analysis progress and final report.
    """
    # Validate file extension
    if not file.filename:
        raise HTTPException(400, "No filename provided")
    ext = os.path.splitext(file.filename)[1].lower()
    if ext not in legacy_import_service.ALLOWED_EXTENSIONS:
        raise HTTPException(
            400,
            f"Unsupported file type '{ext}'. Allowed: {', '.join(legacy_import_service.ALLOWED_EXTENSIONS)}",
        )

    # Read file content
    content = await file.read()
    if len(content) > MAX_FILE_SIZE:
        raise HTTPException(400, f"File too large. Maximum: {MAX_FILE_SIZE // (1024 * 1024)} MB")

    # Save to legacy upload directory
    os.makedirs(LEGACY_DIR, exist_ok=True)
    file_id = str(uuid.uuid4())[:8]
    safe_filename = f"{file_id}_{file.filename}"
    file_path = os.path.join(LEGACY_DIR, safe_filename)

    with open(file_path, "wb") as f:
        f.write(content)

    db = _get_db()
    user_email = user.get("email", "") if isinstance(user, dict) else getattr(user, "email", "")
    progress_queue = queue.Queue()

    def progress_cb(stage, step, total, message):
        progress_queue.put({
            "type": "progress",
            "stage": stage,
            "step": step,
            "total": total,
            "message": message,
        })

    def run_analysis():
        """Run the async analysis pipeline in a background thread."""
        try:
            loop = asyncio.new_event_loop()
            asyncio.set_event_loop(loop)
            result = loop.run_until_complete(
                legacy_import_service.run_analysis_pipeline(
                    file_path=file_path,
                    filename=file.filename,
                    user_email=user_email,
                    db=db,
                    progress=progress_cb,
                )
            )
            loop.close()
            progress_queue.put({"type": "complete", "result": result})
        except Exception as e:
            logger.error(f"Legacy import analysis failed: {e}", exc_info=True)
            progress_queue.put({"type": "error", "message": str(e)})
        finally:
            # Clean up uploaded file after analysis
            try:
                if os.path.exists(file_path):
                    os.remove(file_path)
            except Exception:
                pass

    # Start analysis in background thread
    thread = threading.Thread(target=run_analysis, daemon=True)
    thread.start()

    def event_generator():
        while True:
            try:
                event = progress_queue.get(timeout=180)  # 3 min timeout for large docs
                yield f"data: {json.dumps(event, default=str)}\n\n"
                if event["type"] in ("complete", "error"):
                    break
            except queue.Empty:
                # Heartbeat to keep connection alive
                yield f"data: {json.dumps({'type': 'heartbeat'})}\n\n"

    return StreamingResponse(event_generator(), media_type="text/event-stream")


# --- Analysis Report CRUD ---

@router.get("/analyses")
def list_analyses(
    limit: int = Query(50, ge=1, le=200),
    _user=Depends(get_current_user),
):
    """List saved legacy import analyses, newest first."""
    db = _get_db()
    return db.list_legacy_analyses(limit=limit)


@router.get("/analyses/{analysis_id}")
def get_analysis(analysis_id: str, _user=Depends(get_current_user)):
    """Get a full legacy import analysis by ID."""
    db = _get_db()
    analysis = db.get_legacy_analysis(analysis_id)
    if not analysis:
        raise HTTPException(404, f"Analysis '{analysis_id}' not found")
    return analysis


@router.delete("/analyses/{analysis_id}")
def delete_analysis(analysis_id: str, _user=Depends(get_current_user)):
    """Delete a legacy import analysis."""
    db = _get_db()
    deleted = db.delete_legacy_analysis(analysis_id)
    if not deleted:
        raise HTTPException(404, f"Analysis '{analysis_id}' not found")
    return {"deleted": True, "id": analysis_id}


# --- Chat Refinement ---

class ChatMessage(BaseModel):
    message: str


@router.post("/analyses/{analysis_id}/chat")
async def chat_with_analysis(
    analysis_id: str,
    body: ChatMessage,
    _user=Depends(get_current_user),
):
    """Send a chat message to refine a legacy import analysis."""
    db = _get_db()
    analysis = db.get_legacy_analysis(analysis_id)
    if not analysis:
        raise HTTPException(404, f"Analysis '{analysis_id}' not found")

    result = await legacy_import_service.chat_with_analysis(
        analysis=analysis,
        message=body.message,
        db=db,
    )
    return result


@router.post("/analyses/{analysis_id}/chat-stream")
async def chat_with_analysis_stream(
    analysis_id: str,
    body: ChatMessage,
    _user=Depends(get_current_user),
):
    """Stream a chat response via SSE for a legacy import analysis."""
    db = _get_db()
    analysis = db.get_legacy_analysis(analysis_id)
    if not analysis:
        raise HTTPException(404, f"Analysis '{analysis_id}' not found")

    async def event_generator():
        full_text = ""
        try:
            async for chunk in legacy_import_service.chat_stream_tokens(
                analysis=analysis,
                message=body.message,
            ):
                full_text += chunk
                yield f"data: {json.dumps({'type': 'token', 'content': chunk})}\n\n"
        except Exception as e:
            logger.error(f"Chat stream error: {e}", exc_info=True)
            yield f"data: {json.dumps({'type': 'error', 'message': str(e)})}\n\n"
            return

        # Persist chat history and apply entity updates
        try:
            legacy_import_service.finalize_chat_stream(
                analysis=analysis,
                message=body.message,
                full_response=full_text,
                db=db,
            )
        except Exception as e:
            logger.error(f"Chat finalize error: {e}", exc_info=True)

        yield f"data: {json.dumps({'type': 'done'})}\n\n"

    return StreamingResponse(event_generator(), media_type="text/event-stream")
