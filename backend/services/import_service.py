"""
Import Service.
Restores patterns, technologies, PBCs, categories, and relationships from a JSON backup.
"""
import json
from datetime import datetime, timezone

from services.neo4j_service import Neo4jService


class ImportService:
    """Handles importing/restoring data from JSON backup files."""

    def __init__(self, db: Neo4jService):
        self.db = db

    def import_from_json(self, json_data: str) -> dict:
        """
        Import data from a JSON string.
        Supports two formats:
        1. Full backup: {"patterns": [...], "technologies": [...], "pbcs": [...], "categories": [...]}
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
            "errors": [],
        }

        # Determine format
        if isinstance(data, list):
            # Legacy format: array of patterns
            self._import_patterns(data, stats)
        elif isinstance(data, dict):
            # Full backup format
            if "categories" in data:
                self._import_categories(data["categories"], stats)
            if "patterns" in data:
                self._import_patterns(data["patterns"], stats)
            if "technologies" in data:
                self._import_technologies(data["technologies"], stats)
            if "pbcs" in data:
                self._import_pbcs(data["pbcs"], stats)
        else:
            raise ValueError("Unrecognized data format. Expected a JSON object or array.")

        return stats

    def export_backup(self) -> dict:
        """
        Export all data as a JSON-serializable dict for backup.
        """
        patterns, _ = self.db.list_patterns(limit=500)
        full_patterns = []
        for p in patterns:
            full = self.db.get_pattern_with_relationships(p["id"])
            if full:
                full_patterns.append(full)

        technologies, _ = self.db.list_technologies(limit=500)
        full_techs = []
        for t in technologies:
            full_t = self.db.get_technology_with_patterns(t["id"])
            if full_t:
                full_techs.append(full_t)

        pbcs = self.db.list_pbcs()
        categories = self.db.list_categories()

        return {
            "export_date": datetime.now(timezone.utc).isoformat(),
            "version": "1.0",
            "patterns": full_patterns,
            "technologies": full_techs,
            "pbcs": pbcs,
            "categories": categories,
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
