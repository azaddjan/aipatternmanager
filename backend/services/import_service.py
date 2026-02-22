"""
Import Service.
Restores patterns, technologies, PBCs, categories, and relationships from a JSON backup.
Supports preview mode (dry run), selective import, and auto-backup before import.
"""
import json
from datetime import datetime, timezone

from services.neo4j_service import Neo4jService


class ImportService:
    """Handles importing/restoring data from JSON backup files."""

    def __init__(self, db: Neo4jService):
        self.db = db

    def preview_import(self, json_data: str) -> dict:
        """
        Dry-run: parse the uploaded JSON and return a diff summary
        showing what would be created, updated, or left unchanged.
        No data is modified.
        """
        try:
            data = json.loads(json_data)
        except json.JSONDecodeError as e:
            raise ValueError(f"Invalid JSON: {e}")

        result = {
            "patterns": {"new": [], "updated": [], "unchanged": []},
            "technologies": {"new": [], "updated": [], "unchanged": []},
            "pbcs": {"new": [], "updated": [], "unchanged": []},
            "categories": {"new": [], "updated": [], "unchanged": []},
            "advisor_reports": {"new": [], "updated": [], "unchanged": []},
            "health_analyses": {"new": [], "updated": [], "unchanged": []},
            "stats": {
                "total_new": 0,
                "total_updated": 0,
                "total_unchanged": 0,
            }
        }

        if isinstance(data, list):
            patterns, technologies, pbcs, categories = data, [], [], []
            advisor_reports, health_analyses = [], []
        elif isinstance(data, dict):
            patterns = data.get("patterns", [])
            technologies = data.get("technologies", [])
            pbcs = data.get("pbcs", [])
            categories = data.get("categories", [])
            advisor_reports = data.get("advisor_reports", [])
            health_analyses = data.get("health_analyses", [])
        else:
            raise ValueError("Unrecognized data format.")

        # Preview advisor reports
        for rpt in advisor_reports:
            rid = rpt.get("id", "")
            if not rid:
                continue
            entry = {"id": rid, "title": rpt.get("title", "")}
            existing = self.db.get_report(rid)
            if existing:
                result["advisor_reports"]["unchanged"].append(entry)
                result["stats"]["total_unchanged"] += 1
            else:
                result["advisor_reports"]["new"].append(entry)
                result["stats"]["total_new"] += 1

        # Preview health analyses
        for ha in health_analyses:
            hid = ha.get("id", "")
            if not hid:
                continue
            entry = {"id": hid, "title": ha.get("title", "")}
            existing = self.db.get_health_analysis(hid)
            if existing:
                result["health_analyses"]["unchanged"].append(entry)
                result["stats"]["total_unchanged"] += 1
            else:
                result["health_analyses"]["new"].append(entry)
                result["stats"]["total_new"] += 1

        # Preview categories
        existing_cats = self.db.list_categories()
        existing_codes = {c["code"] for c in existing_cats}
        for cat in categories:
            code = cat.get("code")
            if not code:
                continue
            entry = {"code": code, "label": cat.get("label", code)}
            if code in existing_codes:
                result["categories"]["unchanged"].append(entry)
                result["stats"]["total_unchanged"] += 1
            else:
                result["categories"]["new"].append(entry)
                result["stats"]["total_new"] += 1

        # Preview patterns
        for p in patterns:
            pid = p.get("id", "")
            if not pid:
                continue
            entry = {"id": pid, "name": p.get("name", ""), "type": p.get("type", "")}
            existing = self.db.get_pattern(pid)
            if existing:
                prepared = self._prepare_pattern_data(p)
                changed_fields = []
                for field, value in prepared.items():
                    if field == "id":
                        continue
                    old_val = existing.get(field, "")
                    if str(value) != str(old_val) and value:
                        changed_fields.append(field)
                if changed_fields:
                    entry["changes"] = changed_fields
                    result["patterns"]["updated"].append(entry)
                    result["stats"]["total_updated"] += 1
                else:
                    result["patterns"]["unchanged"].append(entry)
                    result["stats"]["total_unchanged"] += 1
            else:
                result["patterns"]["new"].append(entry)
                result["stats"]["total_new"] += 1

        # Preview technologies
        for t in technologies:
            tid = t.get("id", "")
            if not tid:
                continue
            entry = {"id": tid, "name": t.get("name", "")}
            existing = self.db.get_technology(tid)
            if existing:
                changed_fields = []
                for field in ["name", "vendor", "category", "status", "description"]:
                    new_val = t.get(field, "")
                    old_val = existing.get(field, "")
                    if str(new_val) != str(old_val) and new_val:
                        changed_fields.append(field)
                if changed_fields:
                    entry["changes"] = changed_fields
                    result["technologies"]["updated"].append(entry)
                    result["stats"]["total_updated"] += 1
                else:
                    result["technologies"]["unchanged"].append(entry)
                    result["stats"]["total_unchanged"] += 1
            else:
                result["technologies"]["new"].append(entry)
                result["stats"]["total_new"] += 1

        # Preview PBCs
        for pbc in pbcs:
            pid = pbc.get("id", "")
            if not pid:
                continue
            entry = {"id": pid, "name": pbc.get("name", "")}
            existing = self.db.get_pbc(pid)
            if existing:
                changed_fields = []
                for field in ["name", "description", "status", "api_endpoint"]:
                    new_val = pbc.get(field, "")
                    old_val = existing.get(field, "")
                    if str(new_val) != str(old_val) and new_val:
                        changed_fields.append(field)
                if changed_fields:
                    entry["changes"] = changed_fields
                    result["pbcs"]["updated"].append(entry)
                    result["stats"]["total_updated"] += 1
                else:
                    result["pbcs"]["unchanged"].append(entry)
                    result["stats"]["total_unchanged"] += 1
            else:
                result["pbcs"]["new"].append(entry)
                result["stats"]["total_new"] += 1

        return result

    def import_from_json(self, json_data: str, include: list = None) -> dict:
        """
        Import data from a JSON string.

        Args:
            json_data: The JSON string to import.
            include: Optional list of types to import, e.g.
                     ["patterns", "technologies", "pbcs", "categories"].
                     If None, imports everything.

        Supports two formats:
        1. Full backup: {"patterns": [...], "technologies": [...], ...}
        2. Legacy: [...] (array of patterns only)

        Returns a summary of what was imported.
        """
        try:
            data = json.loads(json_data)
        except json.JSONDecodeError as e:
            raise ValueError(f"Invalid JSON: {e}")

        stats = {
            "patterns_imported": 0,
            "technologies_imported": 0,
            "pbcs_imported": 0,
            "categories_imported": 0,
            "relationships_imported": 0,
            "advisor_reports_imported": 0,
            "health_analyses_imported": 0,
            "errors": [],
        }

        # Default: include everything
        if include is None:
            include = ["patterns", "technologies", "pbcs", "categories",
                       "advisor_reports", "health_analyses"]

        # Determine format
        if isinstance(data, list):
            if "patterns" in include:
                self._import_patterns(data, stats)
        elif isinstance(data, dict):
            if "categories" in include and "categories" in data:
                self._import_categories(data["categories"], stats)
            if "patterns" in include and "patterns" in data:
                self._import_patterns(data["patterns"], stats)
            if "technologies" in include and "technologies" in data:
                self._import_technologies(data["technologies"], stats)
            if "pbcs" in include and "pbcs" in data:
                self._import_pbcs(data["pbcs"], stats)
            if "advisor_reports" in include and "advisor_reports" in data:
                self._import_advisor_reports(data["advisor_reports"], stats)
            if "health_analyses" in include and "health_analyses" in data:
                self._import_health_analyses(data["health_analyses"], stats)
        else:
            raise ValueError("Unrecognized data format. Expected a JSON object or array.")

        return stats

    def export_backup(self) -> dict:
        """
        Export all data as a JSON-serializable dict for backup.
        Includes patterns, technologies, PBCs, categories, advisor reports,
        and health analyses.
        """
        patterns, _ = self.db.list_patterns(limit=10000)
        full_patterns = []
        for p in patterns:
            full = self.db.get_pattern_with_relationships(p["id"])
            if full:
                full_patterns.append(full)

        technologies, _ = self.db.list_technologies(limit=10000)
        full_techs = []
        for t in technologies:
            full_t = self.db.get_technology_with_patterns(t["id"])
            if full_t:
                full_techs.append(full_t)

        pbcs = self.db.list_pbcs()
        categories = self.db.list_categories()

        # Export advisor reports (full data including result_json)
        advisor_reports = []
        try:
            report_list = self.db.list_reports(limit=10000)
            for rpt in report_list:
                full_rpt = self.db.get_report(rpt["id"])
                if full_rpt:
                    advisor_reports.append(full_rpt)
        except Exception:
            pass

        # Export health analyses (full data including analysis_json)
        health_analyses = []
        try:
            ha_list = self.db.list_health_analyses(limit=10000)
            for ha in ha_list:
                full_ha = self.db.get_health_analysis(ha["id"])
                if full_ha:
                    health_analyses.append(full_ha)
        except Exception:
            pass

        return {
            "export_date": datetime.now(timezone.utc).isoformat(),
            "version": "1.1",
            "patterns": full_patterns,
            "technologies": full_techs,
            "pbcs": pbcs,
            "categories": categories,
            "advisor_reports": advisor_reports,
            "health_analyses": health_analyses,
        }

    # ------------------------------------------------------------------
    # Import helpers
    # ------------------------------------------------------------------

    def _import_categories(self, categories: list, stats: dict):
        """Import category nodes."""
        for cat in categories:
            try:
                code = cat.get("code")
                label = cat.get("label", code)
                prefix = cat.get("prefix", code.upper()[:3] if code else "UNK")
                if code:
                    self.db.create_category(code, label, prefix)
                    stats["categories_imported"] += 1
            except Exception as e:
                stats["errors"].append(f"Category '{cat.get('code', '?')}': {e}")

    def _import_patterns(self, patterns: list, stats: dict):
        """Import patterns and their relationships."""
        for p in patterns:
            try:
                pattern_data = self._prepare_pattern_data(p)
                # Check if pattern exists
                existing = self.db.get_pattern(pattern_data["id"])
                if existing:
                    # Update existing
                    self.db.update_pattern(pattern_data["id"], pattern_data)
                else:
                    # Create new
                    self.db.create_pattern(pattern_data)
                stats["patterns_imported"] += 1

                # Import relationships
                rels = p.get("relationships", [])
                for rel in rels:
                    try:
                        target_id = rel.get("target_id", "")
                        rel_type = rel.get("type", "")
                        if target_id and rel_type:
                            self.db.add_relationship(
                                pattern_data["id"],
                                target_id,
                                rel_type,
                                {}
                            )
                            stats["relationships_imported"] += 1
                    except Exception as re:
                        stats["errors"].append(
                            f"Relationship {pattern_data['id']} -> {rel.get('target_id', '?')}: {re}"
                        )

            except Exception as e:
                stats["errors"].append(f"Pattern '{p.get('id', '?')}': {e}")

    def _import_technologies(self, technologies: list, stats: dict):
        """Import technologies."""
        for t in technologies:
            try:
                tech_data = {
                    "id": t["id"],
                    "name": t.get("name", t["id"]),
                    "vendor": t.get("vendor", ""),
                    "category": t.get("category", ""),
                    "status": t.get("status", "Candidate"),
                    "cost_tier": t.get("cost_tier", ""),
                    "description": t.get("description", ""),
                    "notes": t.get("notes", ""),
                    "doc_url": t.get("doc_url", ""),
                    "website": t.get("website", ""),
                }
                existing = self.db.get_technology(tech_data["id"])
                if existing:
                    self.db.update_technology(tech_data["id"], tech_data)
                else:
                    self.db.create_technology(tech_data)
                stats["technologies_imported"] += 1
            except Exception as e:
                stats["errors"].append(f"Technology '{t.get('id', '?')}': {e}")

    def _import_pbcs(self, pbcs: list, stats: dict):
        """Import PBCs."""
        for pbc in pbcs:
            try:
                pbc_data = {
                    "id": pbc["id"],
                    "name": pbc.get("name", ""),
                    "description": pbc.get("description", ""),
                    "status": pbc.get("status", "Draft"),
                    "api_endpoint": pbc.get("api_endpoint", ""),
                    "abb_ids": pbc.get("abb_ids", []),
                }
                existing = self.db.get_pbc(pbc_data["id"])
                if existing:
                    self.db.update_pbc(pbc_data["id"], pbc_data)
                else:
                    self.db.create_pbc(pbc_data)
                stats["pbcs_imported"] += 1
            except Exception as e:
                stats["errors"].append(f"PBC '{pbc.get('id', '?')}': {e}")

    def _import_advisor_reports(self, reports: list, stats: dict):
        """Import advisor reports, preserving original IDs and timestamps."""
        for rpt in reports:
            try:
                rid = rpt.get("id", "")
                if not rid:
                    continue
                existing = self.db.get_report(rid)
                if existing:
                    # Already exists, skip (don't overwrite)
                    continue
                # Serialize result_json if it's a dict
                result_json = rpt.get("result_json", {})
                if isinstance(result_json, dict):
                    result_json_str = json.dumps(result_json)
                else:
                    result_json_str = str(result_json)

                tech_prefs = rpt.get("technology_preferences", [])
                if isinstance(tech_prefs, list):
                    tech_prefs_str = json.dumps(tech_prefs)
                else:
                    tech_prefs_str = str(tech_prefs)

                query = """
                CREATE (r:AdvisorReport {
                    id: $id,
                    title: $title,
                    problem: $problem,
                    category_focus: $category_focus,
                    technology_preferences: $technology_preferences,
                    confidence: $confidence,
                    provider: $provider,
                    model: $model,
                    result_json: $result_json,
                    starred: $starred,
                    created_at: $created_at
                })
                RETURN r
                """
                with self.db.session() as session:
                    session.run(query, {
                        "id": rid,
                        "title": rpt.get("title", ""),
                        "problem": rpt.get("problem", ""),
                        "category_focus": rpt.get("category_focus", ""),
                        "technology_preferences": tech_prefs_str,
                        "confidence": rpt.get("confidence", ""),
                        "provider": rpt.get("provider", ""),
                        "model": rpt.get("model", ""),
                        "result_json": result_json_str,
                        "starred": rpt.get("starred", False),
                        "created_at": rpt.get("created_at", datetime.now(timezone.utc).isoformat()),
                    })
                stats["advisor_reports_imported"] += 1
            except Exception as e:
                stats["errors"].append(f"AdvisorReport '{rpt.get('id', '?')}': {e}")

    def _import_health_analyses(self, analyses: list, stats: dict):
        """Import health analyses, preserving original IDs and timestamps."""
        for ha in analyses:
            try:
                hid = ha.get("id", "")
                if not hid:
                    continue
                existing = self.db.get_health_analysis(hid)
                if existing:
                    # Already exists, skip
                    continue
                analysis_json = ha.get("analysis_json", {})
                if isinstance(analysis_json, dict):
                    analysis_json_str = json.dumps(analysis_json)
                else:
                    analysis_json_str = str(analysis_json)

                score_breakdown = ha.get("score_breakdown_json", ha.get("score_breakdown", {}))
                if isinstance(score_breakdown, dict):
                    score_breakdown_str = json.dumps(score_breakdown)
                else:
                    score_breakdown_str = str(score_breakdown)

                query = """
                CREATE (h:HealthAnalysis {
                    id: $id,
                    title: $title,
                    analysis_json: $analysis_json,
                    health_score: $health_score,
                    score_breakdown_json: $score_breakdown_json,
                    provider: $provider,
                    model: $model,
                    pattern_count: $pattern_count,
                    created_at: $created_at
                })
                RETURN h
                """
                with self.db.session() as session:
                    session.run(query, {
                        "id": hid,
                        "title": ha.get("title", ""),
                        "analysis_json": analysis_json_str,
                        "health_score": ha.get("health_score", 0),
                        "score_breakdown_json": score_breakdown_str,
                        "provider": ha.get("provider", ""),
                        "model": ha.get("model", ""),
                        "pattern_count": ha.get("pattern_count", 0),
                        "created_at": ha.get("created_at", datetime.now(timezone.utc).isoformat()),
                    })
                stats["health_analyses_imported"] += 1
            except Exception as e:
                stats["errors"].append(f"HealthAnalysis '{ha.get('id', '?')}': {e}")

    def _prepare_pattern_data(self, p: dict) -> dict:
        """Prepare pattern data dict, handling both old and new format fields."""
        base = {
            "id": p["id"],
            "name": p.get("name", ""),
            "type": p.get("type", "ABB"),
            "category": p.get("category", ""),
            "status": p.get("status", "Draft"),
            "version": p.get("version", "1.0.0"),
        }

        # Copy all structured fields that exist
        structured_fields = [
            "intent", "problem", "solution", "structural_elements",
            "invariants", "inter_element_contracts", "related_patterns_text",
            "related_adrs", "building_blocks_note",
            "functionality", "inbound_interfaces", "outbound_interfaces",
            "specific_functionality", "sbb_mapping",
            "consumed_by_ids", "works_with_ids", "business_capabilities",
        ]

        for field in structured_fields:
            if field in p:
                base[field] = p[field]

        # Handle legacy markdown_content field
        if "markdown_content" in p and not any(p.get(f) for f in structured_fields):
            # Store as functionality for ABBs, specific_functionality for SBBs, intent for ABs
            ptype = p.get("type", "ABB")
            if ptype == "AB":
                base["intent"] = p["markdown_content"]
            elif ptype == "SBB":
                base["specific_functionality"] = p["markdown_content"]
            else:
                base["functionality"] = p["markdown_content"]

        return base
