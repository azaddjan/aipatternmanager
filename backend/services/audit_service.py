"""Audit logging service — records all create/update/delete operations."""
import json
import uuid
from datetime import datetime, timezone

from services.neo4j_service import Neo4jService


def get_db() -> Neo4jService:
    from main import db_service
    return db_service


def log_action(
    user_id: str,
    user_name: str,
    action: str,          # CREATE, UPDATE, DELETE, STATUS_CHANGE, etc.
    entity_type: str,     # pattern, technology, pbc, category, user, team
    entity_id: str,
    entity_name: str = "",
    changes: dict = None,
    details: str = "",
):
    """Write an AuditLog node to Neo4j."""
    db = get_db()
    log_id = f"audit-{uuid.uuid4().hex[:12]}"
    now = datetime.now(timezone.utc).isoformat()
    changes_json = json.dumps(changes) if changes else ""

    with db.session() as session:
        session.run(
            """
            CREATE (a:AuditLog {
                id: $id,
                user_id: $user_id,
                user_name: $user_name,
                action: $action,
                entity_type: $entity_type,
                entity_id: $entity_id,
                entity_name: $entity_name,
                changes_json: $changes_json,
                details: $details,
                timestamp: $timestamp
            })
            """,
            id=log_id,
            user_id=user_id,
            user_name=user_name,
            action=action,
            entity_type=entity_type,
            entity_id=entity_id,
            entity_name=entity_name,
            changes_json=changes_json,
            details=details,
            timestamp=now,
        )
    return log_id


def get_audit_logs(
    entity_type: str = None,
    entity_id: str = None,
    user_id: str = None,
    action: str = None,
    skip: int = 0,
    limit: int = 50,
):
    """Retrieve audit logs with optional filters, newest first."""
    db = get_db()
    where_parts = []
    params = {"skip": skip, "limit": limit}

    if entity_type:
        where_parts.append("a.entity_type = $entity_type")
        params["entity_type"] = entity_type
    if entity_id:
        where_parts.append("a.entity_id = $entity_id")
        params["entity_id"] = entity_id
    if user_id:
        where_parts.append("a.user_id = $user_id")
        params["user_id"] = user_id
    if action:
        where_parts.append("a.action = $action")
        params["action"] = action

    where_clause = f"WHERE {' AND '.join(where_parts)}" if where_parts else ""

    with db.session() as session:
        # Get total count
        count_result = session.run(
            f"MATCH (a:AuditLog) {where_clause} RETURN count(a) AS total",
            **params,
        )
        total = count_result.single()["total"]

        # Get paginated results
        result = session.run(
            f"""
            MATCH (a:AuditLog)
            {where_clause}
            RETURN a
            ORDER BY a.timestamp DESC
            SKIP $skip LIMIT $limit
            """,
            **params,
        )
        logs = []
        for record in result:
            node = dict(record["a"])
            # Parse changes_json back to dict for response
            if node.get("changes_json"):
                try:
                    node["changes"] = json.loads(node["changes_json"])
                except Exception:
                    node["changes"] = None
            else:
                node["changes"] = None
            del node["changes_json"]
            logs.append(node)

    return logs, total


def get_entity_history(entity_type: str, entity_id: str, limit: int = 20):
    """Get audit trail for a specific entity."""
    return get_audit_logs(entity_type=entity_type, entity_id=entity_id, limit=limit)
