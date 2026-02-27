"""
Import Service.
Restores patterns, technologies, PBCs, categories, and relationships from a JSON backup.
Supports preview mode (dry run), selective import, and auto-backup before import.
"""
import json
from datetime import datetime, timezone

from services.neo4j_service import Neo4jService

# ── Schema validation ────────────────────────────────────────────────
VALID_TOP_LEVEL_KEYS = {
    "meta", "export_date", "version",
    "patterns", "technologies", "pbcs", "categories",
    "teams", "users", "settings",
    "advisor_reports", "health_analyses",
}

REQUIRED_PATTERN_FIELDS = {"id"}
REQUIRED_TECHNOLOGY_FIELDS = {"id"}
REQUIRED_PBC_FIELDS = {"id"}
REQUIRED_CATEGORY_FIELDS = {"code"}
REQUIRED_TEAM_FIELDS = {"id"}
REQUIRED_USER_FIELDS = {"id", "email"}

VALID_PATTERN_TYPES = {"AB", "ABB", "SBB"}
VALID_STATUSES = {"DRAFT", "REVIEW", "ACTIVE", "DEPRECATED", "Draft", "Review", "Active", "Deprecated"}
VALID_TECH_STATUSES = {"Candidate", "APPROVED", "DEPRECATED", "EXPERIMENTAL", "Approved", "Deprecated", "Experimental"}
VALID_ROLES = {"admin", "editor", "viewer", "team_member"}


def validate_backup_schema(data: dict) -> list:
    """
    Validate a parsed backup dict against the expected schema.
    Returns a list of validation error strings. Empty list = valid.
    """
    errors = []

    if not isinstance(data, (dict, list)):
        return ["Root element must be a JSON object or array."]

    # Legacy list format — just validate pattern entries
    if isinstance(data, list):
        for i, p in enumerate(data):
            if not isinstance(p, dict):
                errors.append(f"patterns[{i}]: must be a JSON object, got {type(p).__name__}")
            elif "id" not in p:
                errors.append(f"patterns[{i}]: missing required field 'id'")
        return errors

    # Full backup format
    unknown_keys = set(data.keys()) - VALID_TOP_LEVEL_KEYS
    if unknown_keys:
        errors.append(f"Unknown top-level keys: {', '.join(sorted(unknown_keys))}")

    # Validate each collection
    def _validate_items(collection_name, items, required_fields, extra_checks=None):
        if not isinstance(items, list):
            errors.append(f"'{collection_name}' must be an array, got {type(items).__name__}")
            return
        for i, item in enumerate(items):
            if not isinstance(item, dict):
                errors.append(f"{collection_name}[{i}]: must be a JSON object, got {type(item).__name__}")
                continue
            for field in required_fields:
                val = item.get(field)
                if val is None or (isinstance(val, str) and not val.strip()):
                    errors.append(f"{collection_name}[{i}]: missing required field '{field}'")
            if extra_checks:
                extra_checks(i, item)

    # Patterns
    if "patterns" in data:
        def check_pattern(i, p):
            ptype = p.get("type", "")
            if ptype and ptype not in VALID_PATTERN_TYPES:
                errors.append(f"patterns[{i}] (id={p.get('id','?')}): invalid type '{ptype}', expected one of {VALID_PATTERN_TYPES}")
            rels = p.get("relationships")
            if rels is not None and not isinstance(rels, list):
                errors.append(f"patterns[{i}] (id={p.get('id','?')}): 'relationships' must be an array")
        _validate_items("patterns", data["patterns"], REQUIRED_PATTERN_FIELDS, check_pattern)

    # Technologies
    if "technologies" in data:
        _validate_items("technologies", data["technologies"], REQUIRED_TECHNOLOGY_FIELDS)

    # PBCs
    if "pbcs" in data:
        _validate_items("pbcs", data["pbcs"], REQUIRED_PBC_FIELDS)

    # Categories
    if "categories" in data:
        _validate_items("categories", data["categories"], REQUIRED_CATEGORY_FIELDS)

    # Teams
    if "teams" in data:
        _validate_items("teams", data["teams"], REQUIRED_TEAM_FIELDS)

    # Users
    if "users" in data:
        def check_user(i, u):
            role = u.get("role", "")
            if role and role not in VALID_ROLES:
                errors.append(f"users[{i}] (email={u.get('email','?')}): invalid role '{role}', expected one of {VALID_ROLES}")
        _validate_items("users", data["users"], REQUIRED_USER_FIELDS, check_user)

    # Settings
    if "settings" in data:
        if not isinstance(data["settings"], list):
            errors.append(f"'settings' must be an array, got {type(data['settings']).__name__}")
        else:
            for i, s in enumerate(data["settings"]):
                if not isinstance(s, dict):
                    errors.append(f"settings[{i}]: must be a JSON object")
                elif "key" not in s:
                    errors.append(f"settings[{i}]: missing required field 'key'")

    # Advisor reports
    if "advisor_reports" in data:
        _validate_items("advisor_reports", data["advisor_reports"], {"id"})

    # Health analyses
    if "health_analyses" in data:
        _validate_items("health_analyses", data["health_analyses"], {"id"})

    return errors


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

        # Schema validation
        schema_errors = validate_backup_schema(data)
        if schema_errors:
            raise ValueError(
                f"Backup file has {len(schema_errors)} schema error(s):\n"
                + "\n".join(f"  • {e}" for e in schema_errors[:20])
                + (f"\n  ... and {len(schema_errors) - 20} more" if len(schema_errors) > 20 else "")
            )

        result = {
            "teams": {"new": [], "updated": [], "unchanged": []},
            "users": {"new": [], "updated": [], "unchanged": []},
            "settings": {"new": [], "updated": [], "unchanged": []},
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
            teams, users, settings = [], [], []
        elif isinstance(data, dict):
            patterns = data.get("patterns", [])
            technologies = data.get("technologies", [])
            pbcs = data.get("pbcs", [])
            categories = data.get("categories", [])
            advisor_reports = data.get("advisor_reports", [])
            health_analyses = data.get("health_analyses", [])
            teams = data.get("teams", [])
            users = data.get("users", [])
            settings = data.get("settings", [])
        else:
            raise ValueError("Unrecognized data format.")

        # Preview teams
        for team in teams:
            tid = team.get("id", "")
            if not tid:
                continue
            entry = {"id": tid, "name": team.get("name", "")}
            with self.db.session() as session:
                existing = session.run(
                    "MATCH (t:Team {id: $id}) RETURN t.id AS id", {"id": tid}
                ).single()
            if existing:
                result["teams"]["unchanged"].append(entry)
                result["stats"]["total_unchanged"] += 1
            else:
                result["teams"]["new"].append(entry)
                result["stats"]["total_new"] += 1

        # Preview users
        for user in users:
            email = user.get("email", "")
            if not email:
                continue
            entry = {"id": user.get("id", ""), "name": user.get("name", ""), "email": email}
            with self.db.session() as session:
                existing = session.run(
                    "MATCH (u:User) WHERE u.email = $email RETURN u.id AS id", {"email": email}
                ).single()
            if existing:
                result["users"]["unchanged"].append(entry)
                result["stats"]["total_unchanged"] += 1
            else:
                result["users"]["new"].append(entry)
                result["stats"]["total_new"] += 1

        # Preview settings
        for setting in settings:
            key = setting.get("key", "")
            if not key or key.startswith("prompt_override:"):
                continue
            entry = {"key": key}
            with self.db.session() as session:
                existing = session.run(
                    "MATCH (c:SystemConfig {key: $key}) RETURN c.key AS key", {"key": key}
                ).single()
            if existing:
                result["settings"]["updated"].append(entry)
                result["stats"]["total_updated"] += 1
            else:
                result["settings"]["new"].append(entry)
                result["stats"]["total_new"] += 1

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
                     ["patterns", "technologies", "pbcs", "categories",
                      "teams", "users", "settings"].
                     If None, imports everything.

        Supports two formats:
        1. Full backup: {"patterns": [...], "technologies": [...], ...}
        2. Legacy: [...] (array of patterns only)

        Import order:
        1. Teams (no dependencies)
        2. Users (depends on Teams for MEMBER_OF)
        3. Settings (no dependencies)
        4. Categories (existing)
        5. Patterns (existing)
        6. OWNED_BY restoration (depends on Teams + Patterns)
        7. Technologies (existing)
        8. PBCs (existing)
        9. Advisor Reports (existing)
        10. Health Analyses (existing)

        Returns a summary of what was imported.
        """
        try:
            data = json.loads(json_data)
        except json.JSONDecodeError as e:
            raise ValueError(f"Invalid JSON: {e}")

        # Schema validation
        schema_errors = validate_backup_schema(data)
        if schema_errors:
            raise ValueError(
                f"Backup file has {len(schema_errors)} schema error(s):\n"
                + "\n".join(f"  • {e}" for e in schema_errors[:20])
                + (f"\n  ... and {len(schema_errors) - 20} more" if len(schema_errors) > 20 else "")
            )

        stats = {
            "teams_imported": 0,
            "users_imported": 0,
            "settings_imported": 0,
            "patterns_imported": 0,
            "technologies_imported": 0,
            "pbcs_imported": 0,
            "categories_imported": 0,
            "relationships_imported": 0,
            "owned_by_restored": 0,
            "advisor_reports_imported": 0,
            "health_analyses_imported": 0,
            "discovery_analyses_imported": 0,
            "errors": [],
        }

        # Default: include everything
        if include is None:
            include = ["teams", "users", "settings",
                       "patterns", "technologies", "pbcs", "categories",
                       "advisor_reports", "health_analyses", "discovery_analyses"]

        # Determine format
        if isinstance(data, list):
            if "patterns" in include:
                self._import_patterns(data, stats)
        elif isinstance(data, dict):
            # 1. Teams first (no dependencies)
            if "teams" in include and "teams" in data:
                self._import_teams(data["teams"], stats)
            # 2. Users (depends on Teams for MEMBER_OF)
            if "users" in include and "users" in data:
                self._import_users(data["users"], stats)
            # 3. Settings
            if "settings" in include and "settings" in data:
                self._import_settings(data["settings"], stats)
            # 4. Categories
            if "categories" in include and "categories" in data:
                self._import_categories(data["categories"], stats)
            # 5. Technologies (before patterns — patterns may USES technologies)
            if "technologies" in include and "technologies" in data:
                self._import_technologies(data["technologies"], stats)
            # 6. Patterns (after technologies so USES relationships can resolve)
            if "patterns" in include and "patterns" in data:
                self._import_patterns(data["patterns"], stats)
            # 7. OWNED_BY restoration (only if both teams and patterns included)
            if "teams" in include and "patterns" in include and "patterns" in data:
                self._restore_owned_by(data["patterns"], stats)
            # 8. PBCs (after patterns so COMPOSES relationships can resolve)
            if "pbcs" in include and "pbcs" in data:
                self._import_pbcs(data["pbcs"], stats)
            # 9. Advisor Reports
            if "advisor_reports" in include and "advisor_reports" in data:
                self._import_advisor_reports(data["advisor_reports"], stats)
            # 10. Health Analyses
            if "health_analyses" in include and "health_analyses" in data:
                self._import_health_analyses(data["health_analyses"], stats)
            # 11. Discovery Analyses
            if "discovery_analyses" in include and "discovery_analyses" in data:
                self._import_discovery_analyses(data["discovery_analyses"], stats)
        else:
            raise ValueError("Unrecognized data format. Expected a JSON object or array.")

        return stats

    @staticmethod
    def _strip_embeddings(records: list[dict]) -> list[dict]:
        """Remove embedding vectors from exported records.

        Embeddings are large float arrays (1536+ dims) that bloat backup files
        and must be regenerated after restore anyway (provider/model may change).
        """
        for rec in records:
            rec.pop("embedding", None)
        return records

    def export_backup(self) -> dict:
        """
        Export all data as a JSON-serializable dict for backup.
        Includes patterns, technologies, PBCs, categories, advisor reports,
        health analyses, discovery analyses, teams, users, and settings.

        Note: Vector embeddings are excluded — they must be regenerated
        after restore via the Admin > Embed Missing/All endpoints.
        """
        patterns, _ = self.db.list_patterns(limit=10000)
        full_patterns = []
        for p in patterns:
            full = self.db.get_pattern_with_relationships(p["id"])
            if full:
                full_patterns.append(full)
        self._strip_embeddings(full_patterns)

        technologies, _ = self.db.list_technologies(limit=10000)
        full_techs = []
        for t in technologies:
            full_t = self.db.get_technology_with_patterns(t["id"])
            if full_t:
                full_techs.append(full_t)
        self._strip_embeddings(full_techs)

        pbcs = self.db.list_pbcs()
        self._strip_embeddings(pbcs)

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

        # Export discovery analyses (full data including suggestions_json)
        discovery_analyses = []
        try:
            da_list = self.db.list_discovery_analyses(limit=10000)
            for da in da_list:
                full_da = self.db.get_discovery_analysis(da["id"])
                if full_da:
                    discovery_analyses.append(full_da)
        except Exception:
            pass

        # Export teams
        teams = []
        try:
            with self.db.session() as session:
                result = session.run("""
                    MATCH (t:Team)
                    RETURN t.id AS id, t.name AS name, t.description AS description,
                           t.created_at AS created_at, t.updated_at AS updated_at
                """)
                for record in result:
                    teams.append(dict(record))
        except Exception:
            pass

        # Export users (include password_hash for full restore)
        users = []
        try:
            with self.db.session() as session:
                result = session.run("""
                    MATCH (u:User)
                    OPTIONAL MATCH (u)-[:MEMBER_OF]->(t:Team)
                    RETURN u.id AS id, u.email AS email, u.name AS name,
                           u.password_hash AS password_hash, u.role AS role,
                           u.is_active AS is_active, u.created_at AS created_at,
                           u.updated_at AS updated_at, t.id AS team_id
                """)
                for record in result:
                    users.append(dict(record))
        except Exception:
            pass

        # Export settings (exclude prompt overrides — those are managed separately)
        settings = []
        try:
            with self.db.session() as session:
                result = session.run("""
                    MATCH (c:SystemConfig)
                    WHERE NOT c.key STARTS WITH 'prompt_override:'
                    RETURN c.key AS key, c.value_json AS value_json
                """)
                for record in result:
                    settings.append(dict(record))
        except Exception:
            pass

        return {
            "export_date": datetime.now(timezone.utc).isoformat(),
            "version": "1.3",
            "teams": teams,
            "users": users,
            "settings": settings,
            "patterns": full_patterns,
            "technologies": full_techs,
            "pbcs": pbcs,
            "categories": categories,
            "advisor_reports": advisor_reports,
            "health_analyses": health_analyses,
            "discovery_analyses": discovery_analyses,
        }

    # ------------------------------------------------------------------
    # Import helpers
    # ------------------------------------------------------------------

    def _import_teams(self, teams: list, stats: dict):
        """Import team nodes, preserving original IDs and timestamps."""
        for team in teams:
            try:
                tid = team.get("id", "")
                if not tid:
                    continue
                # Check if team already exists
                with self.db.session() as session:
                    existing = session.run(
                        "MATCH (t:Team {id: $id}) RETURN t.id AS id",
                        {"id": tid}
                    ).single()
                    if existing:
                        continue  # Skip existing teams
                    session.run("""
                        CREATE (t:Team {
                            id: $id,
                            name: $name,
                            description: $description,
                            created_at: $created_at,
                            updated_at: $updated_at
                        })
                    """, {
                        "id": tid,
                        "name": team.get("name", ""),
                        "description": team.get("description", ""),
                        "created_at": team.get("created_at", datetime.now(timezone.utc).isoformat()),
                        "updated_at": team.get("updated_at", datetime.now(timezone.utc).isoformat()),
                    })
                stats["teams_imported"] += 1
            except Exception as e:
                stats["errors"].append(f"Team '{team.get('id', '?')}': {e}")

    def _import_users(self, users: list, stats: dict):
        """Import user nodes with MEMBER_OF relationships. Never overwrites existing users."""
        for user in users:
            try:
                uid = user.get("id", "")
                email = user.get("email", "")
                if not uid or not email:
                    continue
                # Check if user already exists by email (never overwrite credentials)
                with self.db.session() as session:
                    existing = session.run(
                        "MATCH (u:User) WHERE u.email = $email RETURN u.id AS id",
                        {"email": email}
                    ).single()
                    if existing:
                        continue  # Skip existing users
                    session.run("""
                        CREATE (u:User {
                            id: $id,
                            email: $email,
                            name: $name,
                            password_hash: $password_hash,
                            role: $role,
                            is_active: $is_active,
                            created_at: $created_at,
                            updated_at: $updated_at
                        })
                    """, {
                        "id": uid,
                        "email": email,
                        "name": user.get("name", ""),
                        "password_hash": user.get("password_hash", ""),
                        "role": user.get("role", "viewer"),
                        "is_active": user.get("is_active", True),
                        "created_at": user.get("created_at", datetime.now(timezone.utc).isoformat()),
                        "updated_at": user.get("updated_at", datetime.now(timezone.utc).isoformat()),
                    })
                    # Create MEMBER_OF relationship if team_id is present
                    team_id = user.get("team_id")
                    if team_id:
                        session.run("""
                            MATCH (u:User {id: $uid}), (t:Team {id: $tid})
                            MERGE (u)-[:MEMBER_OF]->(t)
                        """, {"uid": uid, "tid": team_id})
                stats["users_imported"] += 1
            except Exception as e:
                stats["errors"].append(f"User '{user.get('email', '?')}': {e}")

    def _import_settings(self, settings: list, stats: dict):
        """Import system settings (SystemConfig nodes). Skips prompt overrides."""
        now = datetime.now(timezone.utc).isoformat()
        for setting in settings:
            try:
                key = setting.get("key", "")
                if not key or key.startswith("prompt_override:"):
                    continue
                value_json = setting.get("value_json", "")
                with self.db.session() as session:
                    session.run("""
                        MERGE (c:SystemConfig {key: $key})
                        SET c.value_json = $value_json, c.updated_at = $now
                    """, {"key": key, "value_json": value_json, "now": now})
                stats["settings_imported"] += 1
            except Exception as e:
                stats["errors"].append(f"Setting '{setting.get('key', '?')}': {e}")

    def _restore_owned_by(self, patterns: list, stats: dict):
        """Restore OWNED_BY relationships between patterns and teams."""
        for p in patterns:
            try:
                pid = p.get("id", "")
                team_id = p.get("team_id")
                if not pid or not team_id:
                    continue
                with self.db.session() as session:
                    # Delete existing OWNED_BY, then create new one
                    session.run("""
                        MATCH (p:Pattern {id: $pid})-[r:OWNED_BY]->()
                        DELETE r
                    """, {"pid": pid})
                    result = session.run("""
                        MATCH (p:Pattern {id: $pid}), (t:Team {id: $tid})
                        CREATE (p)-[:OWNED_BY]->(t)
                        RETURN p.id AS id
                    """, {"pid": pid, "tid": team_id})
                    if result.single():
                        stats["owned_by_restored"] += 1
            except Exception as e:
                stats["errors"].append(f"OWNED_BY '{p.get('id', '?')}' -> '{p.get('team_id', '?')}': {e}")

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
        """Import PBCs and their COMPOSES relationships to ABBs."""
        for pbc in pbcs:
            try:
                abb_ids = pbc.get("abb_ids", [])
                pbc_data = {
                    "id": pbc["id"],
                    "name": pbc.get("name", ""),
                    "description": pbc.get("description", ""),
                    "status": pbc.get("status", "Draft"),
                    "api_endpoint": pbc.get("api_endpoint", ""),
                }
                existing = self.db.get_pbc(pbc_data["id"])
                if existing:
                    self.db.update_pbc(pbc_data["id"], pbc_data)
                else:
                    self.db.create_pbc(pbc_data)
                stats["pbcs_imported"] += 1

                # Create COMPOSES relationships (PBC → ABBs)
                if abb_ids:
                    self.db._replace_pbc_composes(pbc_data["id"], abb_ids)
                    stats["relationships_imported"] += len(abb_ids)
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

    def _import_discovery_analyses(self, analyses: list, stats: dict):
        """Import discovery analyses, preserving original IDs and timestamps."""
        for da in analyses:
            try:
                did = da.get("id", "")
                if not did:
                    continue
                existing = self.db.get_discovery_analysis(did)
                if existing:
                    # Already exists, skip
                    continue
                suggestions = da.get("suggestions_json", [])
                if isinstance(suggestions, list):
                    suggestions_str = json.dumps(suggestions)
                else:
                    suggestions_str = str(suggestions)

                query = """
                CREATE (d:DiscoveryAnalysis {
                    id: $id,
                    title: $title,
                    suggestions_json: $suggestions_json,
                    provider: $provider,
                    model: $model,
                    focus_area: $focus_area,
                    suggestion_count: $suggestion_count,
                    created_at: $created_at
                })
                RETURN d
                """
                with self.db.session() as session:
                    session.run(query, {
                        "id": did,
                        "title": da.get("title", ""),
                        "suggestions_json": suggestions_str,
                        "provider": da.get("provider", ""),
                        "model": da.get("model", ""),
                        "focus_area": da.get("focus_area", ""),
                        "suggestion_count": da.get("suggestion_count", 0),
                        "created_at": da.get("created_at", datetime.now(timezone.utc).isoformat()),
                    })
                stats["discovery_analyses_imported"] += 1
            except Exception as e:
                stats["errors"].append(f"DiscoveryAnalysis '{da.get('id', '?')}': {e}")

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
            # New metadata fields
            "description", "tags", "deprecation_note", "restrictions",
            "quality_attributes", "compliance_requirements",
            "vendor", "deployment_model", "cost_tier", "licensing", "maturity",
            "diagrams", "images",
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
