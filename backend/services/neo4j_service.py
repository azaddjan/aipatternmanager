import json
import os
from contextlib import contextmanager
from datetime import datetime, timezone
from typing import Optional

from neo4j import GraphDatabase

# Fields that are stored as JSON strings in Neo4j (lists of dicts)
_JSON_FIELDS = {"sbb_mapping"}
# Fields that are stored as native Neo4j string lists
_LIST_FIELDS = {"business_capabilities", "consumed_by_ids", "works_with_ids"}


class Neo4jService:
    def __init__(self):
        uri = os.getenv("NEO4J_URI", "bolt://localhost:7687")
        user = os.getenv("NEO4J_USER", "neo4j")
        password = os.getenv("NEO4J_PASSWORD", "patternmanager2026")
        self.driver = GraphDatabase.driver(uri, auth=(user, password))

    def close(self):
        self.driver.close()

    def verify_connectivity(self) -> bool:
        try:
            self.driver.verify_connectivity()
            return True
        except Exception:
            return False

    @contextmanager
    def session(self):
        session = self.driver.session()
        try:
            yield session
        finally:
            session.close()

    # --- Schema / Constraints ---

    def create_constraints(self):
        queries = [
            "CREATE CONSTRAINT pattern_id IF NOT EXISTS FOR (p:Pattern) REQUIRE p.id IS UNIQUE",
            "CREATE CONSTRAINT technology_id IF NOT EXISTS FOR (t:Technology) REQUIRE t.id IS UNIQUE",
            "CREATE CONSTRAINT pbc_id IF NOT EXISTS FOR (p:PBC) REQUIRE p.id IS UNIQUE",
        ]
        with self.session() as session:
            for q in queries:
                session.run(q)

    def create_indexes(self):
        queries = [
            "CREATE INDEX pattern_type IF NOT EXISTS FOR (p:Pattern) ON (p.type)",
            "CREATE INDEX pattern_category IF NOT EXISTS FOR (p:Pattern) ON (p.category)",
            "CREATE INDEX pattern_status IF NOT EXISTS FOR (p:Pattern) ON (p.status)",
            "CREATE INDEX technology_vendor IF NOT EXISTS FOR (t:Technology) ON (t.vendor)",
            "CREATE INDEX technology_status IF NOT EXISTS FOR (t:Technology) ON (t.status)",
        ]
        with self.session() as session:
            for q in queries:
                session.run(q)

    # --- Pattern CRUD ---

    def get_pattern(self, pattern_id: str) -> Optional[dict]:
        query = "MATCH (p:Pattern {id: $id}) RETURN p"
        with self.session() as session:
            result = session.run(query, id=pattern_id)
            record = result.single()
            return self._deserialize_pattern(dict(record["p"])) if record else None

    def list_patterns(
        self,
        type_filter: Optional[str] = None,
        category_filter: Optional[str] = None,
        status_filter: Optional[str] = None,
        skip: int = 0,
        limit: int = 100,
    ) -> tuple[list[dict], int]:
        where_clauses = []
        params: dict = {"skip": skip, "limit": limit}

        if type_filter:
            where_clauses.append("p.type = $type_filter")
            params["type_filter"] = type_filter
        if category_filter:
            where_clauses.append("p.category = $category_filter")
            params["category_filter"] = category_filter
        if status_filter:
            where_clauses.append("p.status = $status_filter")
            params["status_filter"] = status_filter

        where = f"WHERE {' AND '.join(where_clauses)}" if where_clauses else ""

        count_query = f"MATCH (p:Pattern) {where} RETURN count(p) as total"
        data_query = f"MATCH (p:Pattern) {where} RETURN p ORDER BY p.id SKIP $skip LIMIT $limit"

        with self.session() as session:
            total = session.run(count_query, **params).single()["total"]
            records = session.run(data_query, **params)
            patterns = [self._deserialize_pattern(dict(r["p"])) for r in records]
        return patterns, total

    def create_pattern(self, data: dict) -> dict:
        now = datetime.now(timezone.utc).isoformat()
        data["created_date"] = now
        data["updated_date"] = now
        # Serialize complex fields for Neo4j storage
        self._serialize_pattern_fields(data)
        # Remove None values — don't store null properties
        data = {k: v for k, v in data.items() if v is not None}
        props = ", ".join(f"{k}: ${k}" for k in data.keys())
        query = f"CREATE (p:Pattern {{{props}}}) RETURN p"
        with self.session() as session:
            result = session.run(query, **data)
            return self._deserialize_pattern(dict(result.single()["p"]))

    def update_pattern(self, pattern_id: str, data: dict) -> Optional[dict]:
        data["updated_date"] = datetime.now(timezone.utc).isoformat()
        self._serialize_pattern_fields(data)
        set_clauses = ", ".join(f"p.{k} = ${k}" for k in data)
        query = f"MATCH (p:Pattern {{id: $id}}) SET {set_clauses} RETURN p"
        data["id"] = pattern_id
        with self.session() as session:
            result = session.run(query, **data)
            record = result.single()
            return self._deserialize_pattern(dict(record["p"])) if record else None

    @staticmethod
    def _serialize_pattern_fields(data: dict):
        """Serialize complex Python objects for Neo4j storage."""
        for key in _JSON_FIELDS:
            if key in data and isinstance(data[key], (list, dict)):
                data[key] = json.dumps(data[key])
        # Neo4j native lists work for string arrays — ensure they are lists
        for key in _LIST_FIELDS:
            if key in data and data[key] is not None:
                if not isinstance(data[key], list):
                    data[key] = []

    @staticmethod
    def _deserialize_pattern(pattern: dict) -> dict:
        """Deserialize JSON string fields back to Python objects."""
        for key in _JSON_FIELDS:
            val = pattern.get(key)
            if isinstance(val, str):
                try:
                    pattern[key] = json.loads(val)
                except (json.JSONDecodeError, TypeError):
                    pattern[key] = []
        # Ensure list fields are lists (Neo4j native lists come back as lists already)
        for key in _LIST_FIELDS:
            val = pattern.get(key)
            if val is None:
                pattern[key] = []
            elif isinstance(val, str):
                try:
                    pattern[key] = json.loads(val)
                except (json.JSONDecodeError, TypeError):
                    pattern[key] = []
        return pattern

    def delete_pattern(self, pattern_id: str) -> bool:
        query = "MATCH (p:Pattern {id: $id}) DETACH DELETE p RETURN count(p) as deleted"
        with self.session() as session:
            result = session.run(query, id=pattern_id)
            return result.single()["deleted"] > 0

    def pattern_exists(self, pattern_id: str) -> bool:
        query = "MATCH (p:Pattern {id: $id}) RETURN count(p) as c"
        with self.session() as session:
            return session.run(query, id=pattern_id).single()["c"] > 0

    # --- Pattern Relationships ---

    def get_pattern_with_relationships(self, pattern_id: str) -> Optional[dict]:
        pattern = self.get_pattern(pattern_id)  # already deserialized
        if not pattern:
            return None

        rels_query = """
        MATCH (p:Pattern {id: $id})-[r]->(target)
        RETURN type(r) as rel_type, target.id as target_id, target.name as target_name,
               labels(target)[0] as target_label, properties(r) as props
        UNION
        MATCH (source)-[r]->(p:Pattern {id: $id})
        RETURN type(r) as rel_type, source.id as target_id, source.name as target_name,
               labels(source)[0] as target_label, properties(r) as props
        """
        with self.session() as session:
            records = session.run(rels_query, id=pattern_id)
            relationships = []
            for r in records:
                relationships.append({
                    "type": r["rel_type"],
                    "target_id": r["target_id"],
                    "target_name": r["target_name"],
                    "target_label": r["target_label"],
                    "properties": dict(r["props"]) if r["props"] else {},
                })

        pattern["relationships"] = relationships
        return pattern

    def add_relationship(self, source_id: str, target_id: str, rel_type: str, props: dict = None) -> bool:
        props = props or {}
        query = f"""
        MATCH (a {{id: $source_id}})
        MATCH (b {{id: $target_id}})
        MERGE (a)-[r:{rel_type}]->(b)
        SET r += $props
        RETURN count(r) as created
        """
        with self.session() as session:
            result = session.run(query, source_id=source_id, target_id=target_id, props=props)
            return result.single()["created"] > 0

    def remove_relationship(self, source_id: str, target_id: str, rel_type: str) -> bool:
        query = f"""
        MATCH (a {{id: $source_id}})-[r:{rel_type}]->(b {{id: $target_id}})
        DELETE r
        RETURN count(r) as deleted
        """
        with self.session() as session:
            # The count after delete is tricky; use a different approach
            result = session.run(query, source_id=source_id, target_id=target_id)
            return True

    def get_pattern_subgraph(self, pattern_id: str, depth: int = 2) -> dict:
        query = """
        MATCH (p:Pattern {id: $id})-[*1..""" + str(depth) + """]-(n)
        WHERE n <> p
        WITH p, collect(DISTINCT n) AS connected
        WITH [p] + connected AS all_nodes
        UNWIND all_nodes AS a
        UNWIND all_nodes AS b
        WITH all_nodes, a, b
        WHERE elementId(a) < elementId(b)
        OPTIONAL MATCH (a)-[r]-(b)
        WITH all_nodes, collect(r) AS raw_rels
        UNWIND raw_rels AS r
        WITH all_nodes, collect(DISTINCT r) AS rels
        RETURN
            [n IN all_nodes | {id: n.id, name: n.name, type: coalesce(n.type, ''),
                               category: coalesce(n.category, ''), status: coalesce(n.status, ''),
                               node_type: labels(n)[0]}] AS nodes,
            [r IN rels WHERE r IS NOT NULL | {source: startNode(r).id, target: endNode(r).id,
                          type: type(r)}] AS edges
        """
        with self.session() as session:
            result = session.run(query, id=pattern_id)
            record = result.single()
            if not record:
                return {"nodes": [], "edges": []}
            return {"nodes": record["nodes"], "edges": record["edges"]}

    # --- Technology CRUD ---

    def get_technology(self, tech_id: str) -> Optional[dict]:
        query = "MATCH (t:Technology {id: $id}) RETURN t"
        with self.session() as session:
            result = session.run(query, id=tech_id)
            record = result.single()
            return dict(record["t"]) if record else None

    def list_technologies(
        self,
        vendor_filter: Optional[str] = None,
        status_filter: Optional[str] = None,
        category_filter: Optional[str] = None,
        skip: int = 0,
        limit: int = 100,
    ) -> tuple[list[dict], int]:
        where_clauses = []
        params: dict = {"skip": skip, "limit": limit}

        if vendor_filter:
            where_clauses.append("t.vendor = $vendor_filter")
            params["vendor_filter"] = vendor_filter
        if status_filter:
            where_clauses.append("t.status = $status_filter")
            params["status_filter"] = status_filter
        if category_filter:
            where_clauses.append("t.category = $category_filter")
            params["category_filter"] = category_filter

        where = f"WHERE {' AND '.join(where_clauses)}" if where_clauses else ""

        count_query = f"MATCH (t:Technology) {where} RETURN count(t) as total"
        data_query = f"MATCH (t:Technology) {where} RETURN t ORDER BY t.id SKIP $skip LIMIT $limit"

        with self.session() as session:
            total = session.run(count_query, **params).single()["total"]
            records = session.run(data_query, **params)
            technologies = [dict(r["t"]) for r in records]
        return technologies, total

    def create_technology(self, data: dict) -> dict:
        query = """
        CREATE (t:Technology {
            id: $id, name: $name, vendor: $vendor, category: $category,
            status: $status, description: $description, cost_tier: $cost_tier,
            doc_url: $doc_url, website: $website, notes: $notes
        })
        RETURN t
        """
        data.setdefault("description", "")
        data.setdefault("cost_tier", "")
        data.setdefault("doc_url", "")
        data.setdefault("website", "")
        data.setdefault("notes", "")
        with self.session() as session:
            result = session.run(query, **data)
            return dict(result.single()["t"])

    def update_technology(self, tech_id: str, data: dict) -> Optional[dict]:
        set_clauses = ", ".join(f"t.{k} = ${k}" for k in data)
        query = f"MATCH (t:Technology {{id: $id}}) SET {set_clauses} RETURN t"
        data["id"] = tech_id
        with self.session() as session:
            result = session.run(query, **data)
            record = result.single()
            return dict(record["t"]) if record else None

    def delete_technology(self, tech_id: str) -> bool:
        query = "MATCH (t:Technology {id: $id}) DETACH DELETE t RETURN count(t) as deleted"
        with self.session() as session:
            result = session.run(query, id=tech_id)
            return result.single()["deleted"] > 0

    def get_technology_impact(self, tech_id: str) -> list[dict]:
        query = """
        MATCH (p:Pattern)-[:USES]->(t:Technology {id: $id})
        RETURN p.id as id, p.name as name, p.type as type, p.category as category, p.status as status
        """
        with self.session() as session:
            records = session.run(query, id=tech_id)
            return [dict(r) for r in records]

    def get_technology_with_patterns(self, tech_id: str) -> Optional[dict]:
        """Get technology with all SBB patterns that use it."""
        tech = self.get_technology(tech_id)
        if not tech:
            return None
        query = """
        MATCH (p:Pattern)-[:USES]->(t:Technology {id: $id})
        RETURN p.id as id, p.name as name, p.type as type,
               p.category as category, p.status as status
        ORDER BY p.id
        """
        with self.session() as session:
            records = session.run(query, id=tech_id)
            tech["used_by_patterns"] = [dict(r) for r in records]
        return tech

    def cascade_deprecate_technology(self, tech_id: str) -> list[dict]:
        """Deprecate all SBBs that use this technology.
        Returns the list of SBBs that were deprecated."""
        query = """
        MATCH (p:Pattern {type: 'SBB'})-[:USES]->(t:Technology {id: $tech_id})
        WHERE p.status <> 'DEPRECATED'
        SET p.status = 'DEPRECATED',
            p.deprecation_note = 'Auto-deprecated: technology ' + $tech_id + ' was deprecated',
            p.updated_date = $now
        RETURN p.id as id, p.name as name
        """
        now = datetime.now(timezone.utc).isoformat()
        with self.session() as session:
            records = session.run(query, tech_id=tech_id, now=now)
            return [dict(r) for r in records]

    # --- Graph Queries ---

    def get_full_graph(self) -> dict:
        query = """
        MATCH (n)
        WHERE n:Pattern OR n:Technology OR n:PBC
        OPTIONAL MATCH (n)-[r]->()
        WITH collect(DISTINCT n) AS nodes, collect(DISTINCT r) AS rels
        RETURN
            [n IN nodes | {id: n.id, name: n.name, type: coalesce(n.type, ''),
                           category: coalesce(n.category, ''), status: coalesce(n.status, ''),
                           node_type: labels(n)[0]}] AS nodes,
            [r IN rels WHERE r IS NOT NULL | {source: startNode(r).id, target: endNode(r).id,
                          type: type(r)}] AS edges
        """
        with self.session() as session:
            record = session.run(query).single()
            return {"nodes": record["nodes"], "edges": record["edges"]}

    def get_impact_analysis(self, pattern_id: str) -> list[dict]:
        query = """
        MATCH path = (p:Pattern {id: $id})<-[:DEPENDS_ON|IMPLEMENTS*1..5]-(dependent)
        RETURN dependent.id as id, dependent.name as name, dependent.type as type,
               length(path) as depth,
               [n IN nodes(path) | n.id] as path
        ORDER BY depth
        """
        with self.session() as session:
            records = session.run(query, id=pattern_id)
            return [dict(r) for r in records]

    def get_coverage_matrix(self) -> list[dict]:
        query = """
        MATCH (abb:Pattern {type: 'ABB'})
        OPTIONAL MATCH (sbb:Pattern {type: 'SBB'})-[:IMPLEMENTS]->(abb)
        RETURN abb.id as abb_id, abb.name as abb_name,
               count(sbb) as sbb_count,
               collect(sbb.id) as sbb_ids
        ORDER BY abb.id
        """
        with self.session() as session:
            records = session.run(query)
            return [dict(r) for r in records]

    # --- Counts ---

    def count_patterns(self) -> int:
        with self.session() as session:
            return session.run("MATCH (p:Pattern) RETURN count(p) as c").single()["c"]

    def count_technologies(self) -> int:
        with self.session() as session:
            return session.run("MATCH (t:Technology) RETURN count(t) as c").single()["c"]

    # --- Pattern ID Generation ---

    def generate_pattern_id(self, pattern_type: str, category_code: str) -> str:
        """Generate the next sequential pattern ID for a given type and category.

        AB  -> AB-PAT-NNN
        ABB -> ABB-{CAT}-NNN
        SBB -> SBB-{CAT}-NNN
        """
        cat_upper = category_code.upper()

        if pattern_type == "AB":
            prefix = "AB-PAT-"
        elif pattern_type == "ABB":
            prefix = f"ABB-{cat_upper}-"
        elif pattern_type == "SBB":
            prefix = f"SBB-{cat_upper}-"
        else:
            prefix = f"{pattern_type}-{cat_upper}-"

        query = """
        MATCH (p:Pattern)
        WHERE p.id STARTS WITH $prefix
        RETURN p.id AS id
        ORDER BY p.id DESC
        LIMIT 1
        """
        with self.session() as session:
            result = session.run(query, prefix=prefix)
            record = result.single()

        if record:
            last_id = record["id"]
            # Extract the numeric suffix
            num_str = last_id.split("-")[-1]
            next_num = int(num_str) + 1
        else:
            next_num = 1

        return f"{prefix}{next_num:03d}"

    # --- Dynamic Categories ---

    def list_categories(self) -> list[dict]:
        """Get all unique categories from existing patterns + Category nodes."""
        query = """
        MATCH (p:Pattern)
        WITH DISTINCT p.category AS code
        WHERE code IS NOT NULL AND code <> ''
        RETURN code
        ORDER BY code
        """
        with self.session() as session:
            records = session.run(query)
            codes = [r["code"] for r in records]

        # Also check for Category nodes (user-defined)
        query2 = "MATCH (c:Category) RETURN c.code AS code, c.label AS label, c.prefix AS prefix ORDER BY c.code"
        with self.session() as session:
            records = session.run(query2)
            custom = {r["code"]: {"code": r["code"], "label": r["label"], "prefix": r["prefix"]} for r in records}

        # Merge built-in + custom
        all_cats = {}
        for code in codes:
            if code in custom:
                all_cats[code] = custom[code]
            else:
                all_cats[code] = {"code": code, "label": BUILTIN_CATEGORIES.get(code, code), "prefix": code.upper()}
        for code, cat in custom.items():
            if code not in all_cats:
                all_cats[code] = cat

        return list(all_cats.values())

    def create_category(self, code: str, label: str, prefix: str) -> dict:
        """Create a new category node."""
        query = """
        MERGE (c:Category {code: $code})
        SET c.label = $label, c.prefix = $prefix
        RETURN c
        """
        with self.session() as session:
            result = session.run(query, code=code, label=label, prefix=prefix)
            return dict(result.single()["c"])

    # --- PBC (Business Capabilities) CRUD ---

    def get_pbc(self, pbc_id: str) -> Optional[dict]:
        query = """
        MATCH (p:PBC {id: $id})
        OPTIONAL MATCH (p)-[:COMPOSES]->(abb:Pattern)
        RETURN p, collect(abb.id) AS abb_ids
        """
        with self.session() as session:
            result = session.run(query, id=pbc_id)
            record = result.single()
            if not record:
                return None
            pbc = dict(record["p"])
            pbc["abb_ids"] = record["abb_ids"]
            return pbc

    def get_pbc_subgraph(self, pbc_id: str, depth: int = 2) -> dict:
        query = """
        MATCH (p:PBC {id: $id})-[*1..""" + str(depth) + """]-(n)
        WHERE n <> p
        WITH p, collect(DISTINCT n) AS connected
        WITH [p] + connected AS all_nodes
        UNWIND all_nodes AS a
        UNWIND all_nodes AS b
        WITH all_nodes, a, b
        WHERE elementId(a) < elementId(b)
        OPTIONAL MATCH (a)-[r]-(b)
        WITH all_nodes, collect(r) AS raw_rels
        UNWIND raw_rels AS r
        WITH all_nodes, collect(DISTINCT r) AS rels
        RETURN
            [n IN all_nodes | {id: n.id, name: n.name, type: coalesce(n.type, ''),
                               category: coalesce(n.category, ''), status: coalesce(n.status, ''),
                               node_type: labels(n)[0]}] AS nodes,
            [r IN rels WHERE r IS NOT NULL | {source: startNode(r).id, target: endNode(r).id,
                          type: type(r)}] AS edges
        """
        with self.session() as session:
            result = session.run(query, id=pbc_id)
            record = result.single()
            if not record:
                return {"nodes": [], "edges": []}
            return {"nodes": record["nodes"], "edges": record["edges"]}

    def list_pbcs(self) -> list[dict]:
        query = """
        MATCH (p:PBC)
        OPTIONAL MATCH (p)-[:COMPOSES]->(abb:Pattern)
        RETURN p, collect(abb.id) AS abb_ids
        ORDER BY p.id
        """
        with self.session() as session:
            records = session.run(query)
            result = []
            for r in records:
                pbc = dict(r["p"])
                pbc["abb_ids"] = r["abb_ids"]
                result.append(pbc)
            return result

    def create_pbc(self, data: dict) -> dict:
        query = """
        CREATE (p:PBC {
            id: $id, name: $name, description: $description,
            api_endpoint: $api_endpoint, status: $status
        })
        RETURN p
        """
        data.setdefault("api_endpoint", "")
        data.setdefault("status", "ACTIVE")
        data.setdefault("description", "")
        with self.session() as session:
            result = session.run(query, **data)
            return dict(result.single()["p"])

    def update_pbc(self, pbc_id: str, data: dict) -> Optional[dict]:
        set_clauses = ", ".join(f"p.{k} = ${k}" for k in data)
        query = f"MATCH (p:PBC {{id: $id}}) SET {set_clauses} RETURN p"
        data["id"] = pbc_id
        with self.session() as session:
            result = session.run(query, **data)
            record = result.single()
            return dict(record["p"]) if record else None

    def delete_pbc(self, pbc_id: str) -> bool:
        query = "MATCH (p:PBC {id: $id}) DETACH DELETE p RETURN count(p) as deleted"
        with self.session() as session:
            result = session.run(query, id=pbc_id)
            return result.single()["deleted"] > 0

    def generate_pbc_id(self) -> str:
        query = """
        MATCH (p:PBC) RETURN p.id AS id ORDER BY p.id DESC LIMIT 1
        """
        with self.session() as session:
            record = session.run(query).single()
        if record:
            num = int(record["id"].split("-")[-1]) + 1
        else:
            num = 1
        return f"PBC-{num:03d}"

    def count_pbcs(self) -> int:
        with self.session() as session:
            return session.run("MATCH (p:PBC) RETURN count(p) as c").single()["c"]

    def _replace_pbc_composes(self, pbc_id: str, abb_ids: list[str]):
        """Remove existing COMPOSES rels for a PBC, then recreate with new abb_ids."""
        query_delete = "MATCH (p:PBC {id: $pbc_id})-[r:COMPOSES]->() DELETE r"
        with self.session() as session:
            session.run(query_delete, pbc_id=pbc_id)
        for abb_id in abb_ids:
            self.add_relationship(pbc_id, abb_id, "COMPOSES")

    # --- Bulk operations for seeding ---

    def clear_all(self):
        with self.session() as session:
            session.run("MATCH (n) DETACH DELETE n")


BUILTIN_CATEGORIES = {
    "blueprint": "Architecture Topology",
    "core": "Core AI/LLM",
    "intg": "Integration",
    "agt": "Agents",
    "kr": "Knowledge & Retrieval",
    "xcut": "Cross-Cutting",
    "pip": "Platform Integration",
}
