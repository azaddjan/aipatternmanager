"""
Intelligent Pattern Advisor Router (GraphRAG)
POST /api/advisor/analyze — Main advisor endpoint (auto-saves report)
POST /api/advisor/embed  — Generate/refresh embeddings
GET  /api/advisor/embed/status — Check embedding status
--- Report Management ---
GET    /api/advisor/reports             — List saved reports
GET    /api/advisor/reports/{id}        — Get full report
PATCH  /api/advisor/reports/{id}        — Update title/starred
DELETE /api/advisor/reports/{id}        — Delete single report
DELETE /api/advisor/reports             — Delete all non-starred
POST   /api/advisor/reports/cleanup     — Manual retention cleanup
GET    /api/advisor/reports/{id}/export/html — Download HTML report
GET    /api/advisor/reports/{id}/export/docx — Download DOCX report
"""
import io
import logging

from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import StreamingResponse

from models.schemas import AdvisorRequest, AdvisorReportUpdate
from services import advisor_service
from services.embedding_service import EmbeddingService

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/advisor", tags=["Advisor"])

# Singleton embedding service
_embedding_svc = None


def _get_embedding_svc() -> EmbeddingService:
    global _embedding_svc
    if _embedding_svc is None:
        _embedding_svc = EmbeddingService()
    return _embedding_svc


def get_db():
    from main import db_service
    return db_service


# --- Main Advisor Endpoint ---

@router.post("/analyze")
async def analyze_problem(request: AdvisorRequest):
    """Analyze a problem using the full pattern knowledge graph and AI reasoning."""
    db = get_db()
    embedding_svc = _get_embedding_svc()
    result = await advisor_service.analyze_problem(
        db=db,
        embedding_svc=embedding_svc,
        problem=request.problem,
        category_focus=request.category_focus,
        technology_preferences=request.technology_preferences,
        include_gap_analysis=request.include_gap_analysis,
        provider_name=request.provider.value if request.provider else None,
        model=request.model,
    )

    # Auto-save the report to Neo4j (never fail the response)
    saved_report = None
    try:
        save_data = {
            "problem": request.problem,
            "category_focus": request.category_focus,
            "technology_preferences": request.technology_preferences,
            "result_json": result,
            "summary": result.get("analysis", {}).get("summary", ""),
            "confidence": result.get("analysis", {}).get("confidence", "MEDIUM"),
            "provider": result.get("provider", ""),
            "model": result.get("model", ""),
        }
        saved_report = db.save_report(save_data)

        # Auto-cleanup if enabled
        try:
            from services.settings_service import get_retention_settings
            retention = get_retention_settings()
            if retention.get("auto_cleanup", True):
                db.cleanup_old_reports(
                    max_reports=retention.get("max_reports", 20),
                    retention_days=retention.get("retention_days", 30),
                )
        except Exception as e:
            logger.warning(f"Report cleanup failed: {e}")
    except Exception as e:
        logger.warning(f"Failed to save advisor report: {e}")

    result["saved_report_id"] = saved_report["id"] if saved_report else None
    return result


# --- Embedding Endpoints ---

@router.post("/embed")
def generate_embeddings():
    """Generate or refresh vector embeddings for all Pattern, Technology, and PBC nodes."""
    db = get_db()
    embedding_svc = _get_embedding_svc()
    if not embedding_svc.available:
        raise HTTPException(status_code=503, detail="Embedding service unavailable: OPENAI_API_KEY not set")
    try:
        stats = embedding_svc.embed_all_nodes(db)
        return {"status": "ok", "embedded": stats}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/embed/status")
def embedding_status():
    """Check how many nodes have embeddings."""
    db = get_db()
    embedding_svc = _get_embedding_svc()
    status = embedding_svc.get_embedding_status(db)
    return {
        "available": embedding_svc.available,
        "status": status,
    }


# --- Report CRUD Endpoints ---
# NOTE: Specific routes (/reports/cleanup) must come BEFORE parameterized routes (/reports/{id})

@router.post("/reports/cleanup")
def cleanup_reports():
    """Manually run retention cleanup on saved reports."""
    db = get_db()
    try:
        from services.settings_service import get_retention_settings
        retention = get_retention_settings()
        result = db.cleanup_old_reports(
            max_reports=retention.get("max_reports", 20),
            retention_days=retention.get("retention_days", 30),
        )
        return {"status": "ok", **result, "total_remaining": db.count_reports()}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/reports")
def list_reports(limit: int = Query(50, ge=1, le=200)):
    """List saved advisor reports (starred first, then newest)."""
    db = get_db()
    reports = db.list_reports(limit=limit)
    return {"reports": reports, "total": len(reports)}


@router.delete("/reports")
def delete_all_reports(confirm: bool = Query(False)):
    """Delete all non-starred reports. Requires ?confirm=true."""
    if not confirm:
        raise HTTPException(status_code=400, detail="Pass ?confirm=true to delete all non-starred reports")
    db = get_db()
    deleted = db.delete_all_reports(keep_starred=True)
    return {"deleted": deleted, "total_remaining": db.count_reports()}


@router.get("/reports/{report_id}")
def get_report(report_id: str):
    """Get a single saved advisor report with full result data."""
    db = get_db()
    report = db.get_report(report_id)
    if not report:
        raise HTTPException(status_code=404, detail=f"Report {report_id} not found")
    return report


@router.patch("/reports/{report_id}")
def update_report(report_id: str, data: AdvisorReportUpdate):
    """Update report title and/or starred status."""
    db = get_db()
    updated = db.update_report(report_id, data.model_dump(exclude_none=True))
    if not updated:
        raise HTTPException(status_code=404, detail=f"Report {report_id} not found")
    return updated


@router.delete("/reports/{report_id}")
def delete_report(report_id: str):
    """Delete a single saved advisor report."""
    db = get_db()
    deleted = db.delete_report(report_id)
    if not deleted:
        raise HTTPException(status_code=404, detail=f"Report {report_id} not found")
    return {"deleted": True, "id": report_id}


# --- Report Export Endpoints ---

@router.get("/reports/{report_id}/export/html")
def export_report_html(report_id: str):
    """Export a saved advisor report as a self-contained HTML file."""
    db = get_db()
    report = db.get_report(report_id)
    if not report:
        raise HTTPException(status_code=404, detail=f"Report {report_id} not found")

    from services.advisor_report_html_export_service import AdvisorReportHtmlExportService
    svc = AdvisorReportHtmlExportService()
    html_content = svc.generate_html(report)
    filename = f"Advisor_Report_{report_id}.html"
    return StreamingResponse(
        io.BytesIO(html_content.encode("utf-8")),
        media_type="text/html",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.get("/reports/{report_id}/export/docx")
def export_report_docx(report_id: str):
    """Export a saved advisor report as a Word document."""
    db = get_db()
    report = db.get_report(report_id)
    if not report:
        raise HTTPException(status_code=404, detail=f"Report {report_id} not found")

    from services.advisor_report_docx_export_service import AdvisorReportDocxExportService
    svc = AdvisorReportDocxExportService()
    docx_bytes = svc.generate_docx(report)
    filename = f"Advisor_Report_{report_id}.docx"
    return StreamingResponse(
        io.BytesIO(docx_bytes),
        media_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )
