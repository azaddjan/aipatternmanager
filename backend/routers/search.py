"""Global search across patterns, technologies, and PBCs."""
from fastapi import APIRouter, Query, Depends
from typing import Optional

from middleware.dependencies import get_current_user_or_anonymous

router = APIRouter(prefix="/api/search", tags=["Search"])


def get_db():
    from main import db_service
    return db_service


@router.get("")
def global_search(
    q: str = Query(..., min_length=1, description="Search query"),
    types: Optional[str] = Query(None, description="Comma-separated types: pattern,technology,pbc"),
    limit: int = Query(30, ge=1, le=100),
    _user=Depends(get_current_user_or_anonymous),
):
    """Search across patterns, technologies, and PBCs by keyword."""
    db = get_db()
    query = q.strip().lower()
    type_set = set((types or "pattern,technology,pbc").split(","))

    results = []

    if "pattern" in type_set:
        patterns = _search_patterns(db, query, limit)
        results.extend(patterns)

    if "technology" in type_set:
        techs = _search_technologies(db, query, limit)
        results.extend(techs)

    if "pbc" in type_set:
        pbcs = _search_pbcs(db, query, limit)
        results.extend(pbcs)

    # Sort by relevance (exact id/name matches first, then partial)
    def score(item):
        name = (item.get("name") or "").lower()
        item_id = (item.get("id") or "").lower()
        if item_id == query or name == query:
            return 0  # exact match
        if query in item_id:
            return 1  # id contains
        if name.startswith(query):
            return 2  # name starts with
        return 3  # other match

    results.sort(key=score)
    return {"results": results[:limit], "total": len(results)}


def _search_patterns(db, query: str, limit: int) -> list[dict]:
    cypher = """
    MATCH (p:Pattern)
    WHERE toLower(p.id) CONTAINS $q
       OR toLower(p.name) CONTAINS $q
       OR toLower(p.description) CONTAINS $q
       OR toLower(p.functionality) CONTAINS $q
       OR toLower(p.specific_functionality) CONTAINS $q
       OR toLower(p.intent) CONTAINS $q
       OR toLower(p.vendor) CONTAINS $q
       OR any(tag IN coalesce(p.tags, []) WHERE toLower(tag) CONTAINS $q)
    RETURN p.id AS id, p.name AS name, p.type AS type, p.category AS category,
           p.status AS status, p.description AS description
    LIMIT $limit
    """
    with db.session() as session:
        result = session.run(cypher, q=query, limit=limit)
        return [{"result_type": "pattern", **dict(r)} for r in result]


def _search_technologies(db, query: str, limit: int) -> list[dict]:
    cypher = """
    MATCH (t:Technology)
    WHERE toLower(t.id) CONTAINS $q
       OR toLower(t.name) CONTAINS $q
       OR toLower(t.vendor) CONTAINS $q
       OR toLower(t.description) CONTAINS $q
       OR toLower(t.category) CONTAINS $q
    RETURN t.id AS id, t.name AS name, t.vendor AS vendor,
           t.category AS category, t.status AS status, t.description AS description
    LIMIT $limit
    """
    with db.session() as session:
        result = session.run(cypher, q=query, limit=limit)
        return [{"result_type": "technology", **dict(r)} for r in result]


def _search_pbcs(db, query: str, limit: int) -> list[dict]:
    cypher = """
    MATCH (p:PBC)
    WHERE toLower(p.id) CONTAINS $q
       OR toLower(p.name) CONTAINS $q
       OR toLower(p.description) CONTAINS $q
    RETURN p.id AS id, p.name AS name, p.description AS description,
           p.status AS status
    LIMIT $limit
    """
    with db.session() as session:
        result = session.run(cypher, q=query, limit=limit)
        return [{"result_type": "pbc", **dict(r)} for r in result]
