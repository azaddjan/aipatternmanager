"""Admin router — settings, API keys, exports, import, and backup management."""
import io
import json
from datetime import datetime
from typing import Optional

from fastapi import APIRouter, HTTPException, UploadFile, File, Query
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from models.schemas import APIKeyUpdate
from services import settings_service
from services.llm import get_provider
from services.html_export_service import HtmlExportService
from services.pptx_export_service import PptxExportService
from services.docx_export_service import DocxExportService
from services.import_service import ImportService
from services.backup_service import BackupService

router = APIRouter(prefix="/api/admin", tags=["Admin"])


class CreateBackupRequest(BaseModel):
    name: str = ""


# --- System Status ---

@router.get("/system-status")
def system_status():
    """Get comprehensive system status: graph stats, embedding status, index health."""
    from main import db_service
    from services.embedding_service import EmbeddingService

    if not db_service or not db_service.verify_connectivity():
        return {
            "neo4j": "disconnected",
            "stats": None,
            "embedding_available": False,
        }

    try:
        stats = db_service.get_system_stats()
    except Exception as e:
        stats = {"error": str(e)}

    # Check embedding service availability and config
    try:
        svc = EmbeddingService()
        embedding_available = svc.available
        embedding_provider = svc.provider
        embedding_model = svc.model
        embedding_dimensions = svc.dimensions
    except Exception:
        embedding_available = False
        embedding_provider = "openai"
        embedding_model = "text-embedding-3-small"
        embedding_dimensions = 1536

    return {
        "neo4j": "connected",
        "stats": stats,
        "embedding_available": embedding_available,
        "embedding_provider": embedding_provider,
        "embedding_model": embedding_model,
        "embedding_dimensions": embedding_dimensions,
    }


@router.post("/embed-missing")
def embed_missing_nodes():
    """Embed only nodes that are missing embeddings (incremental)."""
    from main import db_service
    from services.embedding_service import EmbeddingService

    svc = EmbeddingService()
    if not svc.available:
        raise HTTPException(status_code=503, detail="Embedding service unavailable: OPENAI_API_KEY not set")
    try:
        result = svc.embed_missing_nodes(db_service)
        return {"status": "ok", "embedded": result}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/embed-all")
def embed_all_nodes():
    """Re-generate embeddings for ALL nodes (full refresh).
    Also recreates vector indexes if dimensions changed."""
    from main import db_service
    from services.embedding_service import EmbeddingService

    svc = EmbeddingService()
    if not svc.available:
        raise HTTPException(
            status_code=503,
            detail=f"Embedding service unavailable ({svc.provider}): credentials not configured",
        )
    try:
        # Recreate vector indexes with current dimensions (drops old + clears stale embeddings)
        db_service.recreate_vector_indexes(svc.dimensions)
        result = svc.embed_all_nodes(db_service)
        return {
            "status": "ok",
            "embedded": result,
            "provider": svc.provider,
            "model": svc.model,
            "dimensions": svc.dimensions,
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


class ImportRequest(BaseModel):
    include: list[str] = ["patterns", "technologies", "pbcs", "categories"]


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


@router.post("/test-provider/{provider_name}")
async def test_provider(provider_name: str):
    """Test connectivity for an LLM provider by making a minimal API call."""
    import time

    try:
        provider = get_provider(provider_name)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    if not provider.is_available():
        return {
            "status": "error",
            "provider": provider_name,
            "message": f"Provider '{provider_name}' is not available — API key not configured",
        }

    start = time.time()
    try:
        result = await provider.generate(
            system_prompt="Reply with exactly one word: OK",
            user_prompt="Test",
            model=None,  # use default model
        )
        elapsed = round((time.time() - start) * 1000)
        return {
            "status": "ok",
            "provider": provider_name,
            "model": result.get("model", ""),
            "response": result.get("content", "")[:100],
            "latency_ms": elapsed,
            "message": f"Connection successful ({elapsed}ms)",
        }
    except Exception as e:
        elapsed = round((time.time() - start) * 1000)
        error_msg = str(e)
        # Clean up common error messages
        if "401" in error_msg or "Unauthorized" in error_msg or "invalid_api_key" in error_msg:
            error_msg = "Invalid API key — authentication failed"
        elif "connect" in error_msg.lower() or "connection" in error_msg.lower():
            error_msg = f"Connection failed — cannot reach {provider_name} service"
        elif "404" in error_msg or "not_found" in error_msg:
            error_msg = "Model not found — check model name"
        elif "429" in error_msg or "rate" in error_msg.lower():
            error_msg = "Rate limited — too many requests (but key is valid)"

        return {
            "status": "error",
            "provider": provider_name,
            "latency_ms": elapsed,
            "message": error_msg,
            "raw_error": str(e)[:200],
        }


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

@router.post("/import/preview")
async def import_preview(file: UploadFile = File(...)):
    """Preview what an import would do (dry run). No data is modified."""
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
        preview = importer.preview_import(json_data)
        return preview
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Preview failed: {e}")


@router.post("/import")
async def import_backup(
    file: UploadFile = File(...),
    include: Optional[str] = Query(None, description="Comma-separated list of types to import: patterns,technologies,pbcs,categories"),
):
    """Import patterns, technologies, and PBCs from a JSON backup file.
    Automatically creates a server-side backup before importing."""
    from main import db_service

    if not file.filename.endswith(".json"):
        raise HTTPException(status_code=400, detail="Only JSON files are supported")

    try:
        contents = await file.read()
        json_data = contents.decode("utf-8")
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Could not read file: {e}")

    try:
        # Auto-backup before import
        backup_svc = BackupService(db_service)
        auto_backup = backup_svc.create_auto_backup(reason="pre_import")

        # Parse include filter
        include_list = None
        if include:
            include_list = [s.strip() for s in include.split(",") if s.strip()]

        importer = ImportService(db_service)
        result = importer.import_from_json(json_data, include=include_list)
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
            "auto_backup": auto_backup["filename"],
        }
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Import failed: {e}")


# --- Backups ---

@router.post("/backups")
def create_backup(body: CreateBackupRequest = CreateBackupRequest()):
    """Create a named server-side backup."""
    from main import db_service
    backup_svc = BackupService(db_service)
    try:
        result = backup_svc.create_backup(name=body.name)
        return result
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Backup creation failed: {e}")


@router.get("/backups")
def list_backups():
    """List all server-side backups."""
    from main import db_service
    backup_svc = BackupService(db_service)
    return backup_svc.list_backups()


@router.get("/backups/{filename}")
def download_backup(filename: str):
    """Download a specific backup file."""
    from main import db_service
    backup_svc = BackupService(db_service)
    try:
        data = backup_svc.get_backup(filename)
        return StreamingResponse(
            io.BytesIO(data),
            media_type="application/json",
            headers={"Content-Disposition": f'attachment; filename="{filename}"'},
        )
    except FileNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e))


@router.delete("/backups/{filename}")
def delete_backup(filename: str):
    """Delete a backup file."""
    from main import db_service
    backup_svc = BackupService(db_service)
    try:
        backup_svc.delete_backup(filename)
        return {"status": "deleted", "filename": filename}
    except FileNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e))


# --- Pattern Health ---

@router.get("/pattern-health")
def pattern_health():
    """Static analysis of the pattern library: completeness, relationships, problems."""
    from main import db_service

    if not db_service or not db_service.verify_connectivity():
        raise HTTPException(status_code=503, detail="Database not available")

    try:
        return db_service.get_pattern_health()
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Health analysis failed: {e}")


class PatternHealthAnalyzeRequest(BaseModel):
    provider: str = ""
    model: str = ""


@router.post("/pattern-health/analyze")
async def pattern_health_ai_analysis(body: PatternHealthAnalyzeRequest = PatternHealthAnalyzeRequest()):
    """LLM-powered deep analysis of the pattern library."""
    from main import db_service
    from services.llm import get_provider

    if not db_service or not db_service.verify_connectivity():
        raise HTTPException(status_code=503, detail="Database not available")

    # Get the library summary text for the LLM
    try:
        library_summary = db_service.get_pattern_library_summary()
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to build library summary: {e}")

    if not library_summary.strip():
        return {"analysis": "No patterns found in the library. Add some patterns first."}

    # Select provider
    provider_name = body.provider or None
    try:
        if provider_name:
            provider = get_provider(provider_name)
        else:
            provider = get_provider()  # default
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    if not provider.is_available():
        raise HTTPException(
            status_code=503,
            detail=f"LLM provider '{provider.name}' is not available — API key not configured",
        )

    system_prompt = """You are an expert enterprise architecture consultant specializing in TOGAF-aligned AI/ML architecture pattern libraries.

## Context
The library uses a three-tier TOGAF pattern hierarchy:
- **AB (Architecture Blueprints)**: Independent enterprise-level topologies that define high-level structural approaches. They contain structural_elements, invariants, and inter_element_contracts.
- **ABB (Architecture Building Blocks)**: Abstract functional components with defined interfaces and business capabilities. Each ABB should be implemented by one or more SBBs.
- **SBB (Solution Building Blocks)**: Concrete technology implementations that realize ABBs. They have specific_functionality, sbb_mapping, and technology bindings.
- **PBC (Packaged Business Capabilities)**: Composite units grouping patterns into business capabilities.

Patterns are connected via relationships: IMPLEMENTS (SBB→ABB), DEPENDS_ON, REFERENCES, COMPATIBLE_WITH, USES, COMPOSES.

## Your Analysis — 9 Areas

Analyze the provided library data and produce a structured assessment covering these areas:

### 1. Architecture Coherence
Do AB structural elements, invariants, and contracts logically align with the ABBs and SBBs that exist in the library? Are there ABs whose structural blueprint has no corresponding building blocks, or building blocks that don't trace back to any AB vision?

### 2. ABB–SBB Alignment
For each ABB, do its implementing SBBs adequately cover the ABB's stated functionality? Flag ABBs with zero SBB implementations. Flag SBBs whose specific_functionality doesn't clearly map to their parent ABB's functionality.

### 3. Interface Consistency
Examine inbound_interfaces and outbound_interfaces across connected ABBs and SBBs. Do outbound interfaces of one pattern match the inbound interfaces of patterns it connects to? Identify mismatches, undocumented interfaces, or interface gaps in the chain.

### 4. Business Capability Gaps
Review the business_capabilities declared across ABBs and SBBs. Are there capabilities referenced but not covered? Are there patterns claiming capabilities they don't functionally support? Identify missing business capability coverage for AI/ML systems.

### 5. Vendor & Technology Risk
Analyze SBB sbb_mapping and technology references. Identify single-vendor dependencies, technology concentration risks, and patterns locked to specific platforms. Suggest where alternative SBBs would improve resilience.

### 6. Content Quality
Assess whether pattern descriptions, functionality fields, and structural elements are precise, consistent in detail level, and sufficient for an architect to act on. Flag patterns with vague or boilerplate content vs. those that are exemplary.

### 7. Cross-Pattern Overlap
Identify SBBs or ABBs that appear to serve the same functional purpose. Flag redundant patterns that could be consolidated. Look at naming similarity AND functional similarity.

### 8. PBC Composition
Are PBCs logically composed? Do they group related patterns cohesively? Are there patterns that belong in a PBC but aren't included, or PBCs that mix unrelated concerns?

### 9. Maturity & Actionable Roadmap
Provide a per-area maturity rating and a prioritized action plan. Rank the top improvements by impact and effort.

## Output Format
Return ONLY valid JSON (no markdown fences) with this exact structure:
{
  "executive_summary": "2-3 sentence high-level assessment of library health and readiness",
  "architecture_coherence": {
    "rating": "STRONG|ADEQUATE|WEAK",
    "findings": ["specific finding referencing pattern IDs/names..."],
    "unmapped_ab_elements": ["AB structural element with no corresponding ABB/SBB..."],
    "recommendations": ["..."]
  },
  "abb_sbb_alignment": {
    "rating": "STRONG|ADEQUATE|WEAK",
    "unimplemented_abbs": [{"abb_id": "...", "abb_name": "...", "missing_coverage": "what SBB functionality is needed"}],
    "misaligned_sbbs": [{"sbb_id": "...", "sbb_name": "...", "issue": "..."}],
    "recommendations": ["..."]
  },
  "interface_consistency": {
    "rating": "STRONG|ADEQUATE|WEAK",
    "mismatches": [{"pattern_a": "...", "pattern_b": "...", "issue": "outbound X doesn't match inbound Y"}],
    "undocumented": ["pattern ID/name missing interface definitions"],
    "recommendations": ["..."]
  },
  "business_capability_gaps": {
    "rating": "STRONG|ADEQUATE|WEAK",
    "uncovered_capabilities": ["capability mentioned but not implemented..."],
    "overclaimed_capabilities": [{"pattern_id": "...", "capability": "...", "issue": "..."}],
    "recommendations": ["..."]
  },
  "vendor_technology_risk": {
    "rating": "LOW_RISK|MODERATE_RISK|HIGH_RISK",
    "concentration_risks": [{"technology": "...", "dependent_patterns": ["..."], "risk": "..."}],
    "single_vendor_locks": [{"vendor": "...", "patterns": ["..."], "mitigation": "..."}],
    "recommendations": ["..."]
  },
  "content_quality": {
    "rating": "STRONG|ADEQUATE|WEAK",
    "exemplary_patterns": ["pattern IDs with excellent documentation..."],
    "weak_patterns": [{"pattern_id": "...", "issue": "vague functionality / missing fields / boilerplate"}],
    "recommendations": ["..."]
  },
  "cross_pattern_overlap": {
    "rating": "CLEAN|SOME_OVERLAP|SIGNIFICANT_OVERLAP",
    "overlapping_groups": [{"patterns": ["ID1", "ID2"], "overlap_description": "..."}],
    "consolidation_suggestions": ["..."]
  },
  "pbc_composition": {
    "rating": "STRONG|ADEQUATE|WEAK",
    "issues": [{"pbc": "...", "issue": "..."}],
    "orphaned_patterns": ["patterns that should be in a PBC but aren't"],
    "recommendations": ["..."]
  },
  "maturity_roadmap": {
    "overall_maturity": "INITIAL|DEVELOPING|DEFINED|MANAGED|OPTIMIZING",
    "area_maturity": {"architecture_coherence": "...", "abb_sbb_alignment": "...", "interface_consistency": "...", "business_capabilities": "...", "vendor_risk": "...", "content_quality": "...", "overlap": "...", "pbc_composition": "..."},
    "prioritized_actions": [{"priority": 1, "action": "...", "impact": "HIGH|MEDIUM|LOW", "effort": "LOW|MEDIUM|HIGH", "affected_patterns": ["..."]}]
  }
}

Be specific and actionable. ALWAYS reference actual pattern IDs and names. Do not make up patterns that don't exist in the data."""

    user_prompt = f"""Here is the complete pattern library data to analyze. It includes per-pattern content (functionality, interfaces, structural elements, mappings), relationships, PBC compositions, technology usage, and current health metrics.

{library_summary}

Analyze this library across all 9 areas and return your structured JSON assessment."""

    model = body.model or None
    try:
        result = await provider.generate(system_prompt, user_prompt, model=model)
        content = result.get("content", "")

        # Try to parse as JSON
        analysis = None
        try:
            # Handle markdown code blocks
            if "```json" in content:
                content = content.split("```json")[1].split("```")[0].strip()
            elif "```" in content:
                content = content.split("```")[1].split("```")[0].strip()
            analysis = json.loads(content)
        except (json.JSONDecodeError, IndexError):
            analysis = {"raw_text": result.get("content", "")}

        # Auto-save the analysis to Neo4j
        saved_id = None
        try:
            health_data = db_service.get_pattern_health()
            save_data = {
                "analysis_json": analysis,
                "health_score": health_data.get("health_score", 0),
                "score_breakdown_json": health_data.get("score_breakdown", {}),
                "provider": result.get("provider", provider.name),
                "model": result.get("model", ""),
                "pattern_count": health_data.get("counts", {}).get("total", 0),
            }
            saved = db_service.save_health_analysis(save_data)
            saved_id = saved.get("id")
        except Exception:
            pass  # Non-critical — analysis still returned even if save fails

        return {
            "analysis": analysis,
            "provider": result.get("provider", provider.name),
            "model": result.get("model", ""),
            "saved_analysis_id": saved_id,
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"AI analysis failed: {e}")


# --- Health Analysis Persistence ---

@router.get("/pattern-health/analyses/latest")
def get_latest_health_analysis():
    """Get the most recent saved health analysis (full data)."""
    from main import db_service
    result = db_service.get_latest_health_analysis()
    if not result:
        raise HTTPException(status_code=404, detail="No health analyses saved yet")
    return result


@router.get("/pattern-health/analyses/{analysis_id}")
def get_health_analysis(analysis_id: str):
    """Get a specific health analysis by ID."""
    from main import db_service
    result = db_service.get_health_analysis(analysis_id)
    if not result:
        raise HTTPException(status_code=404, detail=f"Health analysis '{analysis_id}' not found")
    return result


@router.get("/pattern-health/analyses")
def list_health_analyses(limit: int = Query(20, ge=1, le=100)):
    """List saved health analyses (newest first, without full analysis_json)."""
    from main import db_service
    analyses = db_service.list_health_analyses(limit)
    return {"analyses": analyses, "total": len(analyses)}


@router.delete("/pattern-health/analyses/{analysis_id}")
def delete_health_analysis(analysis_id: str):
    """Delete a specific health analysis."""
    from main import db_service
    deleted = db_service.delete_health_analysis(analysis_id)
    if not deleted:
        raise HTTPException(status_code=404, detail=f"Health analysis '{analysis_id}' not found")
    return {"status": "deleted", "id": analysis_id}


@router.delete("/pattern-health/analyses")
def delete_all_health_analyses(confirm: bool = Query(False)):
    """Delete all health analyses. Requires ?confirm=true."""
    if not confirm:
        raise HTTPException(status_code=400, detail="Pass ?confirm=true to delete all health analyses")
    from main import db_service
    count = db_service.delete_all_health_analyses()
    return {"status": "deleted", "count": count}


@router.get("/pattern-health/analyses/{analysis_id}/export/html")
def export_health_analysis_html(analysis_id: str):
    """Export a health analysis as a self-contained HTML file."""
    from main import db_service
    from services.health_analysis_html_export_service import HealthAnalysisHtmlExportService

    analysis = db_service.get_health_analysis(analysis_id)
    if not analysis:
        raise HTTPException(status_code=404, detail=f"Health analysis '{analysis_id}' not found")

    exporter = HealthAnalysisHtmlExportService()
    html_content = exporter.generate_html(analysis)
    timestamp = datetime.now().strftime("%Y%m%d_%H%M")
    filename = f"Health_Analysis_{analysis_id}_{timestamp}.html"
    return StreamingResponse(
        io.BytesIO(html_content.encode("utf-8")),
        media_type="text/html",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.get("/pattern-health/analyses/{analysis_id}/export/docx")
def export_health_analysis_docx(analysis_id: str):
    """Export a health analysis as a Word document."""
    from main import db_service
    from services.health_analysis_docx_export_service import HealthAnalysisDocxExportService

    analysis = db_service.get_health_analysis(analysis_id)
    if not analysis:
        raise HTTPException(status_code=404, detail=f"Health analysis '{analysis_id}' not found")

    exporter = HealthAnalysisDocxExportService()
    docx_bytes = exporter.generate_docx(analysis)
    timestamp = datetime.now().strftime("%Y%m%d_%H%M")
    filename = f"Health_Analysis_{analysis_id}_{timestamp}.docx"
    return StreamingResponse(
        io.BytesIO(docx_bytes),
        media_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.post("/backups/{filename}/restore")
def restore_backup(filename: str):
    """Restore data from a backup. Auto-creates a backup of current state first."""
    from main import db_service
    backup_svc = BackupService(db_service)
    try:
        result = backup_svc.restore_backup(filename)
        return {
            "status": "restored",
            "message": (
                f"Restored {result['patterns_imported']} patterns, "
                f"{result['technologies_imported']} technologies, "
                f"{result['pbcs_imported']} PBCs"
            ),
            "details": result,
        }
    except FileNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Restore failed: {e}")
