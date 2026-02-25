"""
Backup Service.
Manages server-side backup history — create, list, download, delete, restore.
Backups are stored as JSON files in the backups/ directory.
"""
import json
import os
import logging
from datetime import datetime, timezone

from services.neo4j_service import Neo4jService
from services.import_service import ImportService

logger = logging.getLogger(__name__)

BACKUPS_DIR = os.path.join(os.path.dirname(__file__), '..', 'backups')


class BackupService:
    """Manages server-side backup files."""

    def __init__(self, db: Neo4jService):
        self.db = db
        os.makedirs(BACKUPS_DIR, exist_ok=True)

    def create_backup(self, name: str = "") -> dict:
        """
        Create a server-side backup with optional name.
        Returns metadata about the created backup.
        """
        importer = ImportService(self.db)
        data = importer.export_backup()

        # Count stats
        stats = {
            "teams": len(data.get("teams", [])),
            "users": len(data.get("users", [])),
            "settings": len(data.get("settings", [])),
            "patterns": len(data.get("patterns", [])),
            "technologies": len(data.get("technologies", [])),
            "pbcs": len(data.get("pbcs", [])),
            "categories": len(data.get("categories", [])),
            "advisor_reports": len(data.get("advisor_reports", [])),
            "health_analyses": len(data.get("health_analyses", [])),
        }

        timestamp = datetime.now().strftime("%Y%m%d_%H%M")
        safe_name = "".join(c for c in name if c.isalnum() or c in "-_").strip()
        if safe_name:
            filename = f"backup_{timestamp}_{safe_name}.json"
        else:
            filename = f"backup_{timestamp}.json"

        # Embed metadata
        backup_data = {
            "meta": {
                "export_date": datetime.now(timezone.utc).isoformat(),
                "version": "1.2",
                "name": name or f"Backup {timestamp}",
                "filename": filename,
                "stats": stats,
            },
            "teams": data.get("teams", []),
            "users": data.get("users", []),
            "settings": data.get("settings", []),
            "patterns": data.get("patterns", []),
            "technologies": data.get("technologies", []),
            "pbcs": data.get("pbcs", []),
            "categories": data.get("categories", []),
            "advisor_reports": data.get("advisor_reports", []),
            "health_analyses": data.get("health_analyses", []),
        }

        filepath = os.path.join(BACKUPS_DIR, filename)
        with open(filepath, 'w', encoding='utf-8') as f:
            json.dump(backup_data, f, indent=2, default=str)

        size_bytes = os.path.getsize(filepath)
        logger.info(f"Backup created: {filename} ({size_bytes} bytes)")

        return {
            "filename": filename,
            "name": backup_data["meta"]["name"],
            "date": backup_data["meta"]["export_date"],
            "size_bytes": size_bytes,
            "stats": stats,
        }

    def create_auto_backup(self, reason: str = "pre_import") -> dict:
        """Create an automatic backup (e.g., before import). Returns metadata."""
        return self.create_backup(name=f"auto_{reason}")

    def list_backups(self) -> list:
        """List all backup files with metadata, sorted by date descending."""
        backups = []

        for filename in os.listdir(BACKUPS_DIR):
            if not filename.endswith('.json'):
                continue

            filepath = os.path.join(BACKUPS_DIR, filename)
            try:
                size_bytes = os.path.getsize(filepath)
                # Try to read metadata from file
                with open(filepath, 'r', encoding='utf-8') as f:
                    data = json.load(f)

                meta = data.get("meta", {})
                backups.append({
                    "filename": filename,
                    "name": meta.get("name", filename),
                    "date": meta.get("export_date", ""),
                    "size_bytes": size_bytes,
                    "stats": meta.get("stats", {}),
                    "is_auto": "auto_" in filename,
                })
            except Exception as e:
                # File exists but can't parse metadata — still list it
                backups.append({
                    "filename": filename,
                    "name": filename,
                    "date": "",
                    "size_bytes": os.path.getsize(filepath) if os.path.exists(filepath) else 0,
                    "stats": {},
                    "is_auto": "auto_" in filename,
                    "error": str(e),
                })

        # Sort by date descending (most recent first)
        backups.sort(key=lambda b: b.get("date", ""), reverse=True)
        return backups

    def get_backup(self, filename: str) -> bytes:
        """Read a backup file and return raw bytes for download."""
        # Sanitize filename to prevent path traversal
        safe = os.path.basename(filename)
        filepath = os.path.join(BACKUPS_DIR, safe)

        if not os.path.exists(filepath):
            raise FileNotFoundError(f"Backup not found: {safe}")

        with open(filepath, 'rb') as f:
            return f.read()

    def delete_backup(self, filename: str) -> bool:
        """Delete a backup file. Returns True if deleted."""
        safe = os.path.basename(filename)
        filepath = os.path.join(BACKUPS_DIR, safe)

        if not os.path.exists(filepath):
            raise FileNotFoundError(f"Backup not found: {safe}")

        os.remove(filepath)
        logger.info(f"Backup deleted: {safe}")
        return True

    def restore_backup(self, filename: str) -> dict:
        """
        Restore from a backup file.
        Creates an auto-backup of current state first, then imports the backup.
        Returns import stats.
        """
        safe = os.path.basename(filename)
        filepath = os.path.join(BACKUPS_DIR, safe)

        if not os.path.exists(filepath):
            raise FileNotFoundError(f"Backup not found: {safe}")

        # Auto-backup current state before restoring
        self.create_auto_backup(reason="pre_restore")

        # Read and import the backup
        with open(filepath, 'r', encoding='utf-8') as f:
            json_data = f.read()

        importer = ImportService(self.db)
        result = importer.import_from_json(json_data)
        logger.info(f"Backup restored: {safe}")
        return result
