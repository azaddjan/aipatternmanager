"""Pattern Health router — accessible to all authenticated users with team-scoped filtering.

- Admin: can scan ALL patterns or filter by any team
- Team member: can scan their own team's patterns (default) or ALL
- Viewer: can scan their own team's patterns (default) or ALL
"""
import io
import json
from datetime import datetime
from typing import Optional

from fastapi import APIRouter, HTTPException, Query, Depends
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from middleware.dependencies import get_current_user

router = APIRouter(prefix="/api/pattern-health", tags=["Pattern Health"])


# --- Helpers ---

def _resolve_team_id(user: dict, requested_team_id: Optional[str]) -> Optional[str]:
    """Resolve the effective team_id for health scanning.

    Rules:
        - Admin may pass any team_id or None (all patterns).
        - Team member / viewer: if no team_id requested, defaults to own team.
          They may also pass 'all' to see the full library health.
    """
    role = user.get("role")

    if role == "admin":
        if requested_team_id == "all" or requested_team_id is None:
            return None  # global scope
        return requested_team_id

    # Non-admin users
    user_team = user.get("team_id")
    if requested_team_id == "all" or requested_team_id is None:
        # Allow non-admins to view all patterns health (read-only, no security concern)
        if requested_team_id == "all":
            return None
        # Default: own team (if assigned)
        return user_team
    # Specific team requested — allow it (health is read-only)
    return requested_team_id


def _get_db():
    from main import db_service
    if not db_service or not db_service.verify_connectivity():
        raise HTTPException(status_code=503, detail="Database not available")
    return db_service


# --- Schemas ---

class PatternHealthAnalyzeRequest(BaseModel):
    provider: str = ""
    model: str = ""
    team_id: Optional[str] = None


# --- Endpoints ---

@router.get("")
def pattern_health(
    team_id: Optional[str] = Query(None, description="Team ID to scope, 'all' for global, or omit for own team"),
    user: dict = Depends(get_current_user),
):
    """Static analysis of the pattern library: completeness, relationships, problems."""
    db = _get_db()
    effective_team = _resolve_team_id(user, team_id)
    try:
        return db.get_pattern_health(team_id=effective_team)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Health analysis failed: {e}")


@router.post("/analyze")
async def pattern_health_ai_analysis(
    body: PatternHealthAnalyzeRequest = PatternHealthAnalyzeRequest(),
    user: dict = Depends(get_current_user),
):
    """LLM-powered deep analysis of the pattern library (team-scoped)."""
    from services.llm import get_provider as _get_provider

    db = _get_db()
    effective_team = _resolve_team_id(user, body.team_id)

    # Get the library summary text for the LLM
    try:
        library_summary = db.get_pattern_library_summary(team_id=effective_team)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to build library summary: {e}")

    if not library_summary.strip():
        return {"analysis": "No patterns found in the selected scope. Add some patterns first."}

    # Select provider
    provider_name = body.provider or None
    try:
        if provider_name:
            provider = _get_provider(provider_name)
        else:
            provider = _get_provider()  # default
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

    scope_note = ""
    if effective_team:
        scope_note = f"\n\nNote: This analysis is scoped to a single team's patterns (team_id: {effective_team}). Only patterns owned by this team are included.\n"

    user_prompt = f"""Here is the complete pattern library data to analyze. It includes per-pattern content (functionality, interfaces, structural elements, mappings), relationships, PBC compositions, technology usage, and current health metrics.
{scope_note}
{library_summary}

Analyze this library across all 9 areas and return your structured JSON assessment."""

    model_name = body.model or None
    try:
        result = await provider.generate(system_prompt, user_prompt, model=model_name)
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
            health_data = db.get_pattern_health(team_id=effective_team)
            save_data = {
                "analysis_json": analysis,
                "health_score": health_data.get("health_score", 0),
                "score_breakdown_json": health_data.get("score_breakdown", {}),
                "provider": result.get("provider", provider.name),
                "model": result.get("model", ""),
                "pattern_count": health_data.get("counts", {}).get("total", 0),
                "team_id": effective_team,
            }
            saved = db.save_health_analysis(save_data)
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

@router.get("/analyses/latest")
def get_latest_health_analysis(user: dict = Depends(get_current_user)):
    """Get the most recent saved health analysis (full data)."""
    db = _get_db()
    result = db.get_latest_health_analysis()
    if not result:
        raise HTTPException(status_code=404, detail="No health analyses saved yet")
    return result


@router.get("/analyses/{analysis_id}")
def get_health_analysis(analysis_id: str, user: dict = Depends(get_current_user)):
    """Get a specific health analysis by ID."""
    db = _get_db()
    result = db.get_health_analysis(analysis_id)
    if not result:
        raise HTTPException(status_code=404, detail=f"Health analysis '{analysis_id}' not found")
    return result


@router.get("/analyses")
def list_health_analyses(
    limit: int = Query(20, ge=1, le=100),
    user: dict = Depends(get_current_user),
):
    """List saved health analyses (newest first, without full analysis_json)."""
    db = _get_db()
    analyses = db.list_health_analyses(limit)
    return {"analyses": analyses, "total": len(analyses)}


@router.delete("/analyses/{analysis_id}")
def delete_health_analysis(analysis_id: str, user: dict = Depends(get_current_user)):
    """Delete a specific health analysis. Admin only."""
    if user.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Only admins can delete health analyses")
    db = _get_db()
    deleted = db.delete_health_analysis(analysis_id)
    if not deleted:
        raise HTTPException(status_code=404, detail=f"Health analysis '{analysis_id}' not found")
    return {"status": "deleted", "id": analysis_id}


@router.delete("/analyses")
def delete_all_health_analyses(
    confirm: bool = Query(False),
    user: dict = Depends(get_current_user),
):
    """Delete all health analyses. Admin only. Requires ?confirm=true."""
    if user.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Only admins can delete health analyses")
    if not confirm:
        raise HTTPException(status_code=400, detail="Pass ?confirm=true to delete all health analyses")
    db = _get_db()
    count = db.delete_all_health_analyses()
    return {"status": "deleted", "count": count}


@router.get("/analyses/{analysis_id}/export/html")
def export_health_analysis_html(analysis_id: str, user: dict = Depends(get_current_user)):
    """Export a health analysis as a self-contained HTML file."""
    db = _get_db()
    from services.health_analysis_html_export_service import HealthAnalysisHtmlExportService

    analysis = db.get_health_analysis(analysis_id)
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


@router.get("/analyses/{analysis_id}/export/docx")
def export_health_analysis_docx(analysis_id: str, user: dict = Depends(get_current_user)):
    """Export a health analysis as a Word document."""
    db = _get_db()
    from services.health_analysis_docx_export_service import HealthAnalysisDocxExportService

    analysis = db.get_health_analysis(analysis_id)
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
