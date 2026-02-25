"""
Authentication service: JWT creation/validation, password hashing, user/team CRUD in Neo4j.
"""
import os
import uuid
import logging
from datetime import datetime, timezone, timedelta
from typing import Optional

import bcrypt
import jwt

logger = logging.getLogger(__name__)

# JWT configuration from environment variables
JWT_SECRET = os.getenv("JWT_SECRET", "CHANGE_ME_IN_PRODUCTION")
JWT_ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = 30
REFRESH_TOKEN_EXPIRE_DAYS = 7

# Admin seed credentials
ADMIN_EMAIL = os.getenv("ADMIN_EMAIL", "")
ADMIN_PASSWORD = os.getenv("ADMIN_PASSWORD", "")


def _get_db():
    from main import db_service
    return db_service


# ── Password Hashing ──

def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")


def verify_password(password: str, password_hash: str) -> bool:
    return bcrypt.checkpw(password.encode("utf-8"), password_hash.encode("utf-8"))


# ── JWT Token Management ──

def create_access_token(user_id: str, email: str, role: str) -> str:
    now = datetime.now(timezone.utc)
    payload = {
        "sub": user_id,
        "email": email,
        "role": role,
        "type": "access",
        "iat": now,
        "exp": now + timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES),
    }
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGORITHM)


def create_refresh_token(user_id: str) -> str:
    now = datetime.now(timezone.utc)
    payload = {
        "sub": user_id,
        "type": "refresh",
        "iat": now,
        "exp": now + timedelta(days=REFRESH_TOKEN_EXPIRE_DAYS),
    }
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGORITHM)


def decode_token(token: str) -> dict:
    """Decode and validate a JWT. Raises jwt.ExpiredSignatureError or jwt.InvalidTokenError."""
    return jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])


# ── User CRUD in Neo4j ──

def get_user_by_email(email: str) -> Optional[dict]:
    db = _get_db()
    with db.session() as session:
        result = session.run(
            "MATCH (u:User {email: $email}) RETURN u",
            email=email.lower(),
        )
        record = result.single()
        if not record:
            return None
        user = dict(record["u"])
        # Load team membership
        team_result = session.run(
            """
            MATCH (u:User {id: $uid})-[:MEMBER_OF]->(t:Team)
            RETURN t.id AS team_id, t.name AS team_name
            """,
            uid=user["id"],
        )
        team_rec = team_result.single()
        user["team_id"] = team_rec["team_id"] if team_rec else None
        user["team_name"] = team_rec["team_name"] if team_rec else None
        return user


def get_user_by_id(user_id: str) -> Optional[dict]:
    db = _get_db()
    with db.session() as session:
        result = session.run("MATCH (u:User {id: $id}) RETURN u", id=user_id)
        record = result.single()
        if not record:
            return None
        user = dict(record["u"])
        team_result = session.run(
            "MATCH (u:User {id: $uid})-[:MEMBER_OF]->(t:Team) RETURN t.id AS team_id, t.name AS team_name",
            uid=user_id,
        )
        team_rec = team_result.single()
        user["team_id"] = team_rec["team_id"] if team_rec else None
        user["team_name"] = team_rec["team_name"] if team_rec else None
        return user


def create_user(
    email: str, password: str, name: str, role: str, team_id: Optional[str] = None
) -> dict:
    db = _get_db()
    now = datetime.now(timezone.utc).isoformat()
    user_id = str(uuid.uuid4())
    pw_hash = hash_password(password)

    with db.session() as session:
        result = session.run(
            """
            CREATE (u:User {
                id: $id, email: $email, name: $name,
                password_hash: $pw_hash, role: $role,
                is_active: true, created_at: $now, updated_at: $now
            })
            RETURN u
            """,
            id=user_id, email=email.lower(), name=name,
            pw_hash=pw_hash, role=role, now=now,
        )
        user = dict(result.single()["u"])

        # Assign to team if provided
        if team_id:
            session.run(
                "MATCH (u:User {id: $uid}), (t:Team {id: $tid}) CREATE (u)-[:MEMBER_OF]->(t)",
                uid=user_id, tid=team_id,
            )
            user["team_id"] = team_id
        else:
            user["team_id"] = None
        user["team_name"] = None

    return _sanitize_user(user)


def update_user(user_id: str, updates: dict) -> Optional[dict]:
    """Update user fields. Does NOT handle password or team — use separate functions."""
    db = _get_db()
    allowed = {}
    for k in ("name", "email", "role", "is_active"):
        if k in updates:
            allowed[k] = updates[k]
    if "email" in allowed:
        allowed["email"] = allowed["email"].lower()

    allowed["updated_at"] = datetime.now(timezone.utc).isoformat()
    set_clauses = ", ".join(f"u.{k} = ${k}" for k in allowed)

    with db.session() as session:
        result = session.run(
            f"MATCH (u:User {{id: $id}}) SET {set_clauses} RETURN u",
            id=user_id, **allowed,
        )
        record = result.single()
        if not record:
            return None
    return _sanitize_user(get_user_by_id(user_id))


def change_user_password(user_id: str, new_password: str) -> bool:
    db = _get_db()
    pw_hash = hash_password(new_password)
    now = datetime.now(timezone.utc).isoformat()
    with db.session() as session:
        result = session.run(
            "MATCH (u:User {id: $id}) SET u.password_hash = $pw_hash, u.updated_at = $now RETURN u",
            id=user_id, pw_hash=pw_hash, now=now,
        )
        return result.single() is not None


def set_user_team(user_id: str, team_id: Optional[str]) -> bool:
    """Change user's team membership. Set team_id=None to remove from team."""
    db = _get_db()
    with db.session() as session:
        # Remove existing membership
        session.run("MATCH (u:User {id: $uid})-[r:MEMBER_OF]->() DELETE r", uid=user_id)
        # Add new membership
        if team_id:
            session.run(
                "MATCH (u:User {id: $uid}), (t:Team {id: $tid}) CREATE (u)-[:MEMBER_OF]->(t)",
                uid=user_id, tid=team_id,
            )
    return True


def delete_user(user_id: str) -> bool:
    db = _get_db()
    with db.session() as session:
        result = session.run(
            "MATCH (u:User {id: $id}) DETACH DELETE u RETURN count(u) AS deleted",
            id=user_id,
        )
        return result.single()["deleted"] > 0


def list_users() -> list[dict]:
    db = _get_db()
    with db.session() as session:
        result = session.run("""
            MATCH (u:User)
            OPTIONAL MATCH (u)-[:MEMBER_OF]->(t:Team)
            RETURN u, t.id AS team_id, t.name AS team_name
            ORDER BY u.email
        """)
        users = []
        for record in result:
            user = _sanitize_user(dict(record["u"]))
            user["team_id"] = record["team_id"]
            user["team_name"] = record["team_name"]
            users.append(user)
        return users


def _sanitize_user(user: dict) -> dict:
    """Remove password_hash from user dict before returning to API."""
    user.pop("password_hash", None)
    return user


# ── Authentication Flow ──

def authenticate(email: str, password: str) -> Optional[dict]:
    """Authenticate user. Returns user dict (without password_hash) or None."""
    user = get_user_by_email(email)
    if not user:
        return None
    if not user.get("is_active", True):
        return None
    if not verify_password(password, user.get("password_hash", "")):
        return None
    return _sanitize_user(user)


# ── Admin Seed ──

def seed_admin_user():
    """On first boot, create admin user from environment variables if no users exist."""
    if not ADMIN_EMAIL or not ADMIN_PASSWORD:
        logger.info("No ADMIN_EMAIL/ADMIN_PASSWORD set, skipping admin seed")
        return

    db = _get_db()
    if not db or not db.verify_connectivity():
        return

    with db.session() as session:
        count = session.run("MATCH (u:User) RETURN count(u) AS cnt").single()["cnt"]

    if count > 0:
        logger.info(f"Users already exist ({count}), skipping admin seed")
        return

    logger.info(f"Seeding admin user: {ADMIN_EMAIL}")
    create_user(
        email=ADMIN_EMAIL,
        password=ADMIN_PASSWORD,
        name="Admin",
        role="admin",
        team_id=None,
    )
    logger.info("Admin user seeded successfully")


# ── Team CRUD ──

def create_team(name: str, description: str = "") -> dict:
    db = _get_db()
    now = datetime.now(timezone.utc).isoformat()
    team_id = str(uuid.uuid4())
    with db.session() as session:
        result = session.run(
            """
            CREATE (t:Team {id: $id, name: $name, description: $desc,
                            created_at: $now, updated_at: $now})
            RETURN t
            """,
            id=team_id, name=name, desc=description, now=now,
        )
        return dict(result.single()["t"])


def update_team(team_id: str, updates: dict) -> Optional[dict]:
    db = _get_db()
    allowed = {}
    for k in ("name", "description"):
        if k in updates:
            allowed[k] = updates[k]
    allowed["updated_at"] = datetime.now(timezone.utc).isoformat()
    set_clauses = ", ".join(f"t.{k} = ${k}" for k in allowed)
    with db.session() as session:
        result = session.run(
            f"MATCH (t:Team {{id: $id}}) SET {set_clauses} RETURN t",
            id=team_id, **allowed,
        )
        record = result.single()
        return dict(record["t"]) if record else None


def delete_team(team_id: str) -> bool:
    db = _get_db()
    with db.session() as session:
        result = session.run(
            "MATCH (t:Team {id: $id}) DETACH DELETE t RETURN count(t) AS deleted",
            id=team_id,
        )
        return result.single()["deleted"] > 0


def list_teams() -> list[dict]:
    db = _get_db()
    with db.session() as session:
        result = session.run("""
            MATCH (t:Team)
            OPTIONAL MATCH (u:User)-[:MEMBER_OF]->(t)
            OPTIONAL MATCH (p:Pattern)-[:OWNED_BY]->(t)
            RETURN t, count(DISTINCT u) AS member_count, count(DISTINCT p) AS pattern_count
            ORDER BY t.name
        """)
        teams = []
        for record in result:
            team = dict(record["t"])
            team["member_count"] = record["member_count"]
            team["pattern_count"] = record["pattern_count"]
            teams.append(team)
        return teams


def get_team(team_id: str) -> Optional[dict]:
    db = _get_db()
    with db.session() as session:
        result = session.run("MATCH (t:Team {id: $id}) RETURN t", id=team_id)
        record = result.single()
        if not record:
            return None
        team = dict(record["t"])
        # Get members
        members = session.run(
            "MATCH (u:User)-[:MEMBER_OF]->(t:Team {id: $tid}) RETURN u ORDER BY u.email",
            tid=team_id,
        )
        team["members"] = [_sanitize_user(dict(r["u"])) for r in members]
        # Get owned patterns count
        pcount = session.run(
            "MATCH (p:Pattern)-[:OWNED_BY]->(t:Team {id: $tid}) RETURN count(p) AS cnt",
            tid=team_id,
        ).single()["cnt"]
        team["pattern_count"] = pcount
        return team


# ── Pattern Ownership Queries ──

def get_pattern_team(pattern_id: str) -> Optional[str]:
    """Return the team_id that owns this pattern, or None if unassigned."""
    db = _get_db()
    with db.session() as session:
        result = session.run(
            "MATCH (p:Pattern {id: $pid})-[:OWNED_BY]->(t:Team) RETURN t.id AS team_id",
            pid=pattern_id,
        )
        record = result.single()
        return record["team_id"] if record else None


def assign_pattern_to_team(pattern_id: str, team_id: str):
    """Assign or reassign a pattern to a team."""
    db = _get_db()
    with db.session() as session:
        # Remove existing OWNED_BY
        session.run("MATCH (p:Pattern {id: $pid})-[r:OWNED_BY]->() DELETE r", pid=pattern_id)
        # Create new
        session.run(
            "MATCH (p:Pattern {id: $pid}), (t:Team {id: $tid}) CREATE (p)-[:OWNED_BY]->(t)",
            pid=pattern_id, tid=team_id,
        )


def remove_pattern_team(pattern_id: str):
    """Remove team ownership from a pattern."""
    db = _get_db()
    with db.session() as session:
        session.run("MATCH (p:Pattern {id: $pid})-[r:OWNED_BY]->() DELETE r", pid=pattern_id)
