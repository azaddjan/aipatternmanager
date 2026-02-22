"""Admin router — settings, API keys, exports, and import."""
import io
import json
from datetime import datetime

from fastapi import APIRouter, HTTPException, UploadFile, File
from fastapi.responses import StreamingResponse

from models.schemas import APIKeyUpdate
from services import settings_service
from services.html_export_service import HtmlExportService
from services.pptx_export_service import PptxExportService
from services.docx_export_service import DocxExportService
from services.import_service import ImportService

router = APIRouter(prefix="/api/admin", tags=["Admin"])


# --- Settings ---

@router.get("/settings")
def get_settings():
    """Get current admin settings (API keys masked)."""
    settings = settings_service.get_settings()
    # Add masked keys for display
    for prov_name in settings.get("providers", {}):
        masked = settings_service.get_masked_key(prov_name)
        settings["providers"][prov_name]["masked_key"] = masked
    return settings


@router.put("/settings")
def update_settings(updates: dict):
    """Update admin settings (default provider, models, etc.)."""
    return settings_service.update_settings(updates)


@router.post("/api-key")
def set_api_key(data: APIKeyUpdate):
    """Set an API key for a provider. Key is stored in env at runtime."""
    try:
        return settings_service.set_api_key(data.provider, data.key, data.secret)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


# --- Export ---

@router.get("/export/html")
def export_html():
    """Export all patterns, technologies, and PBCs as a self-contained HTML file."""
    from main import db_service
    exporter = HtmlExportService(db_service)
    html_content = exporter.generate_html()
    timestamp = datetime.now().strftime("%Y%m%d_%H%M")
    filename = f"AI_Architecture_Patterns_{timestamp}.html"
    return StreamingResponse(
        io.BytesIO(html_content.encode("utf-8")),
        media_type="text/html",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.get("/export/pptx")
def export_pptx():
    """Export all patterns as a PowerPoint presentation."""
    from main import db_service
    exporter = PptxExportService(db_service)
    pptx_bytes = exporter.generate_pptx()
    timestamp = datetime.now().strftime("%Y%m%d_%H%M")
    filename = f"AI_Architecture_Patterns_{timestamp}.pptx"
    return StreamingResponse(
        io.BytesIO(pptx_bytes),
        media_type="application/vnd.openxmlformats-officedocument.presentationml.presentation",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.get("/export/docx")
def export_docx():
    """Export all patterns as a Word document."""
    from main import db_service
    exporter = DocxExportService(db_service)
    docx_bytes = exporter.generate_docx()
    timestamp = datetime.now().strftime("%Y%m%d_%H%M")
    filename = f"AI_Architecture_Patterns_{timestamp}.docx"
    return StreamingResponse(
        io.BytesIO(docx_bytes),
        media_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.get("/export/json")
def export_json():
    """Export all data as a JSON backup file."""
    from main import db_service
    importer = ImportService(db_service)
    backup = importer.export_backup()
    json_bytes = json.dumps(backup, indent=2, default=str).encode("utf-8")
    timestamp = datetime.now().strftime("%Y%m%d_%H%M")
    filename = f"AI_Architecture_Patterns_Backup_{timestamp}.json"
    return StreamingResponse(
        io.BytesIO(json_bytes),
        media_type="application/json",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


# --- Import ---

@router.post("/import")
async def import_backup(file: UploadFile = File(...)):
    """Import patterns, technologies, and PBCs from a JSON backup file."""
    from main import db_service

    if not file.filename.endswith(".json"):
        raise HTTPException(status_code=400, detail="Only JSON files are supported")

    try:
        contents = await file.read()
        json_data = contents.decode("utf-8")
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Could not read file: {e}")

    try:
        importer = ImportService(db_service)
        result = importer.import_from_json(json_data)
        return {
            "status": "success",
            "message": (
                f"Imported {result['patterns_imported']} patterns, "
                f"{result['technologies_imported']} technologies, "
                f"{result['pbcs_imported']} PBCs, "
                f"{result['categories_imported']} categories, "
                f"{result['relationships_imported']} relationships"
            ),
            "details": result,
        }
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Import failed: {e}")
