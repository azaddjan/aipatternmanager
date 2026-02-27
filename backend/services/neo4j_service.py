import json
import os
from contextlib import contextmanager
from datetime import datetime, timezone
from typing import Optional

from neo4j import GraphDatabase

# Fields that are stored as JSON strings in Neo4j (lists of dicts)
_JSON_FIELDS = {"sbb_mapping", "diagrams", "images"}
# Fields that are stored as native Neo4j string lists
_LIST_FIELDS = {"business_capabilities", "consumed_by_ids", "works_with_ids", "tags"}

# Per-type completeness field definitions (shared by get_pattern_health & get_team_stats)
_TYPE_FIELDS = {
    "AB": {
        "description": "Description",
        "intent": "Intent",
        "problem": "Problem",
        "solution": "Solution",
        "structural_elements": "Structural Elements",
        "invariants": "Invariants",
        "inter_element_contracts": "Contracts",
        "related_patterns_text": "Related Patterns",
        "related_adrs": "Related ADRs",
        "building_blocks_note": "Building Blocks",
    },
    "ABB": {
        "description": "Description",
        "functionality": "Functionality",
        "inbound_interfaces": "Inbound Interfaces",
        "outbound_interfaces": "Outbound Interfaces",
        "business_capabilities": "Business Capabilities",
        "quality_attributes": "Quality Attributes",
        "compliance_requirements": "Compliance Requirements",
    },
    "SBB": {
        "description": "Description",
        "specific_functionality": "Specific Functionality",
        "inbound_interfaces": "Inbound Interfaces",
        "outbound_interfaces": "Outbound Interfaces",
        "sbb_mapping": "SBB Mapping",
        "business_capabilities": "Business Capabilities",
        "vendor": "Vendor",
        "deployment_model": "Deployment Model",
        "cost_tier": "Cost Tier",
        "licensing": "Licensing",
        "maturity": "Maturity",
    },
}
# Fields checked via list length > 0 (rather than string non-empty)
_COMPLETENESS_LIST_FIELDS = {"business_capabilities", "sbb_mapping", "consumed_by_ids", "works_with_ids", "tags"}


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
            "CREATE CONSTRAINT advisor_report_id IF NOT EXISTS FOR (r:AdvisorReport) REQUIRE r.id IS UNIQUE",
            "CREATE CONSTRAINT health_analysis_id IF NOT EXISTS FOR (h:HealthAnalysis) REQUIRE h.id IS UNIQUE",
            "CREATE CONSTRAINT discovery_analysis_id IF NOT EXISTS FOR (d:DiscoveryAnalysis) REQUIRE d.id IS UNIQUE",
            "CREATE CONSTRAINT legacy_analysis_id IF NOT EXISTS FOR (l:LegacyImportAnalysis) REQUIRE l.id IS UNIQUE",
            # Auth & config
            "CREATE CONSTRAINT user_id IF NOT EXISTS FOR (u:User) REQUIRE u.id IS UNIQUE",
            "CREATE CONSTRAINT user_email IF NOT EXISTS FOR (u:User) REQUIRE u.email IS UNIQUE",
            "CREATE CONSTRAINT team_id IF NOT EXISTS FOR (t:Team) REQUIRE t.id IS UNIQUE",
            "CREATE CONSTRAINT team_name IF NOT EXISTS FOR (t:Team) REQUIRE t.name IS UNIQUE",
            "CREATE CONSTRAINT system_config_key IF NOT EXISTS FOR (c:SystemConfig) REQUIRE c.key IS UNIQUE",
            "CREATE CONSTRAINT audit_log_id IF NOT EXISTS FOR (a:AuditLog) REQUIRE a.id IS UNIQUE",
            # Documents
            "CREATE CONSTRAINT document_id IF NOT EXISTS FOR (d:Document) REQUIRE d.id IS UNIQUE",
            "CREATE CONSTRAINT document_section_id IF NOT EXISTS FOR (s:DocumentSection) REQUIRE s.id IS UNIQUE",
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
            # Auth indexes
            "CREATE INDEX user_role IF NOT EXISTS FOR (u:User) ON (u.role)",
            "CREATE INDEX user_active IF NOT EXISTS FOR (u:User) ON (u.is_active)",
            # Audit indexes
            "CREATE INDEX audit_timestamp IF NOT EXISTS FOR (a:AuditLog) ON (a.timestamp)",
            "CREATE INDEX audit_entity IF NOT EXISTS FOR (a:AuditLog) ON (a.entity_type, a.entity_id)",
            # Document indexes
            "CREATE INDEX document_status IF NOT EXISTS FOR (d:Document) ON (d.status)",
            "CREATE INDEX document_doc_type IF NOT EXISTS FOR (d:Document) ON (d.doc_type)",
        ]
        with self.session() as session:
            for q in queries:
                session.run(q)

    def create_vector_indexes(self, dimensions: int = 1536):
        """Create vector indexes for semantic search (Neo4j 5.11+)."""
        indexes = [
            ("pattern_embedding", "Pattern", "p"),
            ("technology_embedding", "Technology", "t"),
            ("pbc_embedding", "PBC", "p"),
        ]
        with self.session() as session:
            for idx_name, label, var in indexes:
                q = f"""CREATE VECTOR INDEX {idx_name} IF NOT EXISTS
                        FOR ({var}:{label}) ON ({var}.embedding)
                        OPTIONS {{ indexConfig: {{
                          `vector.dimensions`: {dimensions},
                          `vector.similarity_function`: 'cosine'
                        }}}}"""
                try:
                    session.run(q)
                except Exception as e:
                    import logging
                    logging.getLogger(__name__).warning(f"Vector index creation skipped: {e}")

    def recreate_vector_indexes(self, dimensions: int):
        """Drop and recreate vector indexes with new dimensions.
        Also clears all existing embeddings since they're now incompatible."""
        import logging
        log = logging.getLogger(__name__)

        indexes = ["pattern_embedding", "technology_embedding", "pbc_embedding"]
        with self.session() as session:
            # Drop existing vector indexes
            for idx_name in indexes:
                try:
                    session.run(f"DROP INDEX {idx_name} IF EXISTS")
                    log.info(f"Dropped vector index: {idx_name}")
                except Exception as e:
                    log.warning(f"Failed to drop index {idx_name}: {e}")

            # Clear all existing embeddings (they're incompatible with new dimensions)
            session.run("MATCH (p:Pattern) WHERE p.embedding IS NOT NULL REMOVE p.embedding")
            session.run("MATCH (t:Technology) WHERE t.embedding IS NOT NULL REMOVE t.embedding")
            session.run("MATCH (p:PBC) WHERE p.embedding IS NOT NULL REMOVE p.embedding")
            log.info("Cleared all existing embeddings")

        # Recreate with new dimensions
        self.create_vector_indexes(dimensions)
        log.info(f"Recreated vector indexes with {dimensions} dimensions")

    def vector_search_patterns(self, query_embedding: list[float], limit: int = 10) -> list[dict]:
        """Semantic search across Pattern nodes using vector similarity."""
        query = """
        CALL db.index.vector.queryNodes('pattern_embedding', $limit, $embedding)
        YIELD node, score
        RETURN node.id as id, node.name as name, node.type as type,
               node.category as category, node.status as status, score
        ORDER BY score DESC
        """
        with self.session() as session:
            result = session.run(query, limit=limit, embedding=query_embedding)
            return [dict(r) for r in result]

    def vector_search_technologies(self, query_embedding: list[float], limit: int = 5) -> list[dict]:
        """Semantic search across Technology nodes."""
        query = """
        CALL db.index.vector.queryNodes('technology_embedding', $limit, $embedding)
        YIELD node, score
        RETURN node.id as id, node.name as name, node.vendor as vendor,
               node.category as category, score
        ORDER BY score DESC
        """
        with self.session() as session:
            result = session.run(query, limit=limit, embedding=query_embedding)
            return [dict(r) for r in result]

    def vector_search_pbcs(self, query_embedding: list[float], limit: int = 3) -> list[dict]:
        """Semantic search across PBC nodes."""
        query = """
        CALL db.index.vector.queryNodes('pbc_embedding', $limit, $embedding)
        YIELD node, score
        RETURN node.id as id, node.name as name, score
        ORDER BY score DESC
        """
        with self.session() as session:
            result = session.run(query, limit=limit, embedding=query_embedding)
            return [dict(r) for r in result]

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
        team_ids: list[str] = None,
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
        if team_ids:
            where_clauses.append("EXISTS { (p)-[:OWNED_BY]->(t:Team) WHERE t.id IN $team_ids }")
            params["team_ids"] = team_ids

        where = f"WHERE {' AND '.join(where_clauses)}" if where_clauses else ""

        count_query = f"MATCH (p:Pattern) {where} RETURN count(p) as total"
        data_query = f"""MATCH (p:Pattern) {where}
            OPTIONAL MATCH (p)-[:OWNED_BY]->(team:Team)
            RETURN p, team.id AS team_id, team.name AS team_name
            ORDER BY p.id SKIP $skip LIMIT $limit"""

        with self.session() as session:
            total = session.run(count_query, **params).single()["total"]
            records = session.run(data_query, **params)
            patterns = []
            for r in records:
                pat = self._deserialize_pattern(dict(r["p"]))
                pat["team_id"] = r["team_id"]
                pat["team_name"] = r["team_name"]
                patterns.append(pat)
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
            if val is None:
                pattern[key] = []
            elif isinstance(val, str):
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
        WHERE NOT type(r) = 'OWNED_BY'
        RETURN type(r) as rel_type, target.id as target_id, target.name as target_name,
               labels(target)[0] as target_label, properties(r) as props
        UNION
        MATCH (source)-[r]->(p:Pattern {id: $id})
        WHERE NOT type(r) = 'OWNED_BY'
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

        # Add team ownership info
        team_query = """
        MATCH (p:Pattern {id: $id})-[:OWNED_BY]->(t:Team)
        RETURN t.id AS team_id, t.name AS team_name
        """
        with self.session() as session:
            team_rec = session.run(team_query, id=pattern_id).single()
            pattern["team_id"] = team_rec["team_id"] if team_rec else None
            pattern["team_name"] = team_rec["team_name"] if team_rec else None

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
        now = datetime.now(timezone.utc).isoformat()
        query = """
        CREATE (t:Technology {
            id: $id, name: $name, vendor: $vendor, category: $category,
            status: $status, description: $description, cost_tier: $cost_tier,
            doc_url: $doc_url, website: $website, notes: $notes,
            created_at: $created_at, updated_at: $updated_at
        })
        RETURN t
        """
        data.setdefault("description", "")
        data.setdefault("cost_tier", "")
        data.setdefault("doc_url", "")
        data.setdefault("website", "")
        data.setdefault("notes", "")
        data["created_at"] = now
        data["updated_at"] = now
        with self.session() as session:
            result = session.run(query, **data)
            return dict(result.single()["t"])

    def update_technology(self, tech_id: str, data: dict) -> Optional[dict]:
        data["updated_at"] = datetime.now(timezone.utc).isoformat()
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

    def get_technology_subgraph(self, tech_id: str) -> dict:
        """Get the subgraph around a technology for visualization."""
        query = """
        MATCH (t:Technology {id: $id})
        OPTIONAL MATCH (sbb:Pattern)-[:USES]->(t)
        OPTIONAL MATCH (sbb)-[:IMPLEMENTS]->(abb:Pattern)
        WHERE abb IS NOT NULL
        OPTIONAL MATCH (compat:Pattern)-[:COMPATIBLE_WITH]->(t)
        WITH t,
             collect(DISTINCT sbb) AS sbbs,
             collect(DISTINCT abb) AS abbs,
             collect(DISTINCT compat) AS compats
        WITH [t] + sbbs + abbs + compats AS all_nodes
        UNWIND all_nodes AS n
        WITH collect(DISTINCT n) AS nodes
        UNWIND nodes AS n
        OPTIONAL MATCH (n)-[r]->(target)
        WHERE target IN nodes AND (type(r) IN ['USES', 'IMPLEMENTS', 'COMPATIBLE_WITH', 'DEPENDS_ON'])
        WITH nodes, collect(DISTINCT r) AS rels
        RETURN
            [n IN nodes | {id: n.id, name: n.name, type: coalesce(n.type, ''),
                           category: coalesce(n.category, ''), status: coalesce(n.status, ''),
                           node_type: labels(n)[0]}] AS nodes,
            [r IN rels WHERE r IS NOT NULL | {source: startNode(r).id, target: endNode(r).id,
                          type: type(r)}] AS edges
        """
        with self.session() as session:
            record = session.run(query, id=tech_id).single()
            if not record:
                return {"nodes": [], "edges": []}
            return {"nodes": record["nodes"], "edges": record["edges"]}

    def get_technology_alternatives(self, tech_id: str) -> list:
        """Get alternative technologies: same category + shared SBB co-usage."""
        query = """
        MATCH (t:Technology {id: $id})
        // Same category alternatives
        OPTIONAL MATCH (alt1:Technology)
        WHERE alt1.category = t.category AND alt1.id <> t.id
        WITH t, collect(DISTINCT alt1) AS cat_alts

        // Shared SBB alternatives (other techs used by same SBBs)
        OPTIONAL MATCH (sbb:Pattern)-[:USES]->(t)
        OPTIONAL MATCH (sbb)-[:USES]->(alt2:Technology)
        WHERE alt2.id <> t.id
        WITH t, cat_alts, collect(DISTINCT alt2) AS sbb_alts

        // Combine and deduplicate
        WITH t, cat_alts, sbb_alts,
             [a IN cat_alts | a.id] AS cat_ids
        WITH t, cat_alts + [a IN sbb_alts WHERE NOT a.id IN cat_ids] AS all_alts,
             cat_ids
        UNWIND all_alts AS alt
        // Count usage of each alternative
        OPTIONAL MATCH (p:Pattern)-[:USES]->(alt)
        WITH alt, count(p) AS usage_count, alt.id IN cat_ids AS same_category
        RETURN alt.id AS id, alt.name AS name, alt.vendor AS vendor,
               alt.category AS category, alt.status AS status,
               alt.cost_tier AS cost_tier, alt.description AS description,
               usage_count, same_category
        ORDER BY usage_count DESC
        LIMIT 20
        """
        with self.session() as session:
            records = session.run(query, id=tech_id)
            return [dict(r) for r in records]

    def get_technology_adoption(self, tech_id: str) -> dict:
        """Get adoption/usage breakdown for a technology."""
        query = """
        MATCH (t:Technology {id: $id})
        OPTIONAL MATCH (p:Pattern)-[:USES]->(t)
        WITH t, collect(p) AS patterns
        WITH t, patterns, size(patterns) AS total,
             [p IN patterns WHERE p.type = 'SBB' | p] AS sbbs,
             [p IN patterns WHERE p.type = 'ABB' | p] AS abbs,
             [p IN patterns WHERE p.type = 'AB' | p] AS abs,
             [p IN patterns WHERE p.status = 'ACTIVE' | p] AS active,
             [p IN patterns WHERE p.status = 'DRAFT' | p] AS draft,
             [p IN patterns WHERE p.status = 'DEPRECATED' | p] AS deprecated
        RETURN total,
               size(sbbs) AS sbb_count, size(abbs) AS abb_count, size(abs) AS ab_count,
               size(active) AS active_count, size(draft) AS draft_count, size(deprecated) AS deprecated_count
        """
        with self.session() as session:
            record = session.run(query, id=tech_id).single()
            if not record:
                return {"total_patterns": 0, "by_type": {}, "by_status": {}, "by_category": [], "by_team": []}

            result = {
                "total_patterns": record["total"],
                "by_type": {"SBB": record["sbb_count"], "ABB": record["abb_count"], "AB": record["ab_count"]},
                "by_status": {"ACTIVE": record["active_count"], "DRAFT": record["draft_count"], "DEPRECATED": record["deprecated_count"]},
            }

        # Category breakdown
        cat_query = """
        MATCH (p:Pattern)-[:USES]->(t:Technology {id: $id})
        WITH p.category AS category, count(p) AS cnt
        WHERE category IS NOT NULL
        RETURN category, cnt ORDER BY cnt DESC
        """
        with self.session() as session:
            records = session.run(cat_query, id=tech_id)
            result["by_category"] = [{"category": r["category"], "count": r["cnt"]} for r in records]

        # Team breakdown
        team_query = """
        MATCH (p:Pattern)-[:USES]->(t:Technology {id: $id})
        OPTIONAL MATCH (p)-[:OWNED_BY]->(team:Team)
        WITH coalesce(team.name, 'Unassigned') AS team_name, count(p) AS cnt
        RETURN team_name, cnt ORDER BY cnt DESC
        """
        with self.session() as session:
            records = session.run(team_query, id=tech_id)
            result["by_team"] = [{"team_name": r["team_name"], "count": r["cnt"]} for r in records]

        return result

    def get_technology_health(self, tech_id: str) -> dict:
        """Calculate health score for a technology (0-100)."""
        tech = self.get_technology(tech_id)
        if not tech:
            return {}

        # 1. Completeness (40%) — 7 fields
        check_fields = ["description", "vendor", "category", "cost_tier", "doc_url", "website", "notes"]
        filled = sum(1 for f in check_fields if tech.get(f) and str(tech.get(f, "")).strip())
        total_fields = len(check_fields)
        missing_fields = [f for f in check_fields if not (tech.get(f) and str(tech.get(f, "")).strip())]
        completeness_score = (filled / total_fields) * 100

        # 2. Usage (30%) — active pattern ratio
        patterns = self.get_technology_impact(tech_id)
        active_count = sum(1 for p in patterns if p.get("status") == "ACTIVE")
        deprecated_count = sum(1 for p in patterns if p.get("status") == "DEPRECATED")
        total_patterns = len(patterns)

        if total_patterns == 0:
            usage_score = 20  # No usage = low score
        else:
            usage_score = (active_count / total_patterns) * 100

        # 3. Documentation (20%)
        has_doc_url = bool(tech.get("doc_url") and str(tech.get("doc_url", "")).strip())
        has_website = bool(tech.get("website") and str(tech.get("website", "")).strip())
        if has_doc_url and has_website:
            doc_score = 100
        elif has_doc_url or has_website:
            doc_score = 50
        else:
            doc_score = 0

        # 4. Problems (10%) — penalty-based, start at 100
        problems = []
        problem_score = 100

        # Error: deprecated tech used by active patterns
        if tech.get("status") == "DEPRECATED" and active_count > 0:
            problems.append({"severity": "error", "message": f"Deprecated but used by {active_count} active pattern(s)"})
            problem_score -= 15 * min(active_count, 5)

        # Warning: no usage
        if total_patterns == 0:
            problems.append({"severity": "warning", "message": "Not used by any patterns"})
            problem_score -= 5

        # Warning: missing description
        if not tech.get("description") or not str(tech.get("description", "")).strip():
            problems.append({"severity": "warning", "message": "Missing description"})
            problem_score -= 5

        # Warning: no category
        if not tech.get("category") or not str(tech.get("category", "")).strip():
            problems.append({"severity": "warning", "message": "Missing category"})
            problem_score -= 5

        problem_score = max(0, problem_score)

        # Weighted total
        health_score = round(
            completeness_score * 0.4 +
            usage_score * 0.3 +
            doc_score * 0.2 +
            problem_score * 0.1
        )
        health_score = max(0, min(100, health_score))

        return {
            "health_score": health_score,
            "score_breakdown": {
                "completeness": {"score": round(completeness_score), "weight": 40},
                "usage": {"score": round(usage_score), "weight": 30},
                "documentation": {"score": round(doc_score), "weight": 20},
                "problems": {"score": round(problem_score), "weight": 10},
            },
            "field_completeness": {"filled": filled, "total": total_fields, "missing_fields": missing_fields},
            "usage_stats": {"total_patterns": total_patterns, "active": active_count, "deprecated": deprecated_count},
            "documentation": {"has_doc_url": has_doc_url, "has_website": has_website},
            "problems": problems,
        }

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

    def get_full_graph(self, team_id: str = None) -> dict:
        """Complete pattern graph for visualization.

        Args:
            team_id: If provided, scope to patterns owned by this team
                     (plus their connected Technologies and PBCs).
                     If None, return the full graph.
        """
        if team_id:
            # Team-scoped: start from team's patterns, include connected Tech/PBC nodes
            query = """
            MATCH (p:Pattern)-[:OWNED_BY]->(:Team {id: $team_id})
            WITH collect(p) AS team_patterns
            UNWIND team_patterns AS tp
            OPTIONAL MATCH (tp)-[r]->(target)
            WHERE target:Pattern OR target:Technology OR target:PBC
            OPTIONAL MATCH (source)-[r2]->(tp)
            WHERE source:Pattern OR source:Technology OR source:PBC
            WITH team_patterns,
                 collect(DISTINCT target) + collect(DISTINCT source) AS connected,
                 collect(DISTINCT r) + collect(DISTINCT r2) AS all_rels
            WITH team_patterns + [n IN connected WHERE n IS NOT NULL] AS all_nodes, all_rels
            UNWIND all_nodes AS n
            WITH collect(DISTINCT n) AS nodes, all_rels
            UNWIND all_rels AS r
            WITH nodes, collect(DISTINCT r) AS rels
            RETURN
                [n IN nodes | {id: n.id, name: n.name, type: coalesce(n.type, ''),
                               category: coalesce(n.category, ''), status: coalesce(n.status, ''),
                               node_type: labels(n)[0]}] AS nodes,
                [r IN rels WHERE r IS NOT NULL | {source: startNode(r).id, target: endNode(r).id,
                              type: type(r)}] AS edges
            """
            params = {"team_id": team_id}
        else:
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
            params = {}
        with self.session() as session:
            record = session.run(query, **params).single()
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

    def get_coverage_matrix(self, team_id: str = None) -> list[dict]:
        if team_id:
            query = """
            MATCH (abb:Pattern {type: 'ABB'})-[:OWNED_BY]->(:Team {id: $team_id})
            OPTIONAL MATCH (sbb:Pattern {type: 'SBB'})-[:IMPLEMENTS]->(abb)
            WHERE EXISTS { (sbb)-[:OWNED_BY]->(:Team {id: $team_id}) }
            RETURN abb.id as abb_id, abb.name as abb_name,
                   count(sbb) as sbb_count,
                   collect(sbb.id) as sbb_ids
            ORDER BY abb.id
            """
            params = {"team_id": team_id}
        else:
            query = """
            MATCH (abb:Pattern {type: 'ABB'})
            OPTIONAL MATCH (sbb:Pattern {type: 'SBB'})-[:IMPLEMENTS]->(abb)
            RETURN abb.id as abb_id, abb.name as abb_name,
                   count(sbb) as sbb_count,
                   collect(sbb.id) as sbb_ids
            ORDER BY abb.id
            """
            params = {}
        with self.session() as session:
            records = session.run(query, **params)
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

    def update_category(self, code: str, updates: dict) -> Optional[dict]:
        """Update category label/prefix."""
        allowed = {k: v for k, v in updates.items() if k in ("label", "prefix") and v is not None}
        if not allowed:
            return None
        set_clauses = ", ".join(f"c.{k} = ${k}" for k in allowed)
        query = f"MATCH (c:Category {{code: $code}}) SET {set_clauses} RETURN c"
        with self.session() as session:
            result = session.run(query, code=code, **allowed)
            record = result.single()
            return dict(record["c"]) if record else None

    def delete_category(self, code: str) -> bool:
        """Delete a category node. Returns False if it doesn't exist."""
        with self.session() as session:
            result = session.run(
                "MATCH (c:Category {code: $code}) DELETE c RETURN count(c) AS deleted",
                code=code,
            )
            return result.single()["deleted"] > 0

    def count_patterns_in_category(self, code: str) -> int:
        """Count patterns that use this category code."""
        with self.session() as session:
            result = session.run(
                "MATCH (p:Pattern {category: $code}) RETURN count(p) AS cnt",
                code=code,
            )
            return result.single()["cnt"]

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

    def get_system_stats(self) -> dict:
        """Get comprehensive graph database statistics for the admin dashboard."""
        stats = {}
        with self.session() as session:
            # Node counts by type
            result = session.run("""
                MATCH (p:Pattern)
                WITH count(p) as total,
                     count(CASE WHEN p.type = 'AB' THEN 1 END) as ab_count,
                     count(CASE WHEN p.type = 'ABB' THEN 1 END) as abb_count,
                     count(CASE WHEN p.type = 'SBB' THEN 1 END) as sbb_count,
                     count(CASE WHEN p.status = 'DEPRECATED' THEN 1 END) as deprecated_count
                RETURN total, ab_count, abb_count, sbb_count, deprecated_count
            """)
            r = result.single()
            stats["patterns"] = {
                "total": r["total"], "ab": r["ab_count"],
                "abb": r["abb_count"], "sbb": r["sbb_count"],
                "deprecated": r["deprecated_count"],
            }

            result = session.run("MATCH (t:Technology) RETURN count(t) as total, count(CASE WHEN t.status = 'DEPRECATED' THEN 1 END) as deprecated")
            r = result.single()
            stats["technologies"] = {"total": r["total"], "deprecated": r["deprecated"]}

            result = session.run("MATCH (p:PBC) RETURN count(p) as total")
            stats["pbcs"] = {"total": result.single()["total"]}

            result = session.run("MATCH (c:Category) RETURN count(c) as total")
            stats["categories"] = {"total": result.single()["total"]}

            # Relationship counts by type
            result = session.run("""
                MATCH ()-[r]->()
                RETURN type(r) as rel_type, count(r) as count
                ORDER BY count DESC
            """)
            rel_counts = {}
            total_rels = 0
            for rec in result:
                rel_counts[rec["rel_type"]] = rec["count"]
                total_rels += rec["count"]
            stats["relationships"] = {"total": total_rels, "by_type": rel_counts}

            # Index info
            try:
                result = session.run("SHOW INDEXES YIELD name, type, state, entityType, labelsOrTypes, properties")
                indexes = []
                for rec in result:
                    indexes.append({
                        "name": rec["name"],
                        "type": rec["type"],
                        "state": rec["state"],
                        "entity_type": rec["entityType"],
                        "labels": rec["labelsOrTypes"],
                        "properties": rec["properties"],
                    })
                stats["indexes"] = indexes
            except Exception:
                stats["indexes"] = []

            # Embedding counts
            result = session.run("""
                MATCH (p:Pattern)
                RETURN count(p) as total, count(p.embedding) as embedded, 'patterns' as type
                UNION ALL
                MATCH (t:Technology)
                RETURN count(t) as total, count(t.embedding) as embedded, 'technologies' as type
                UNION ALL
                MATCH (p:PBC)
                RETURN count(p) as total, count(p.embedding) as embedded, 'pbcs' as type
            """)
            embeddings = {}
            for rec in result:
                embeddings[rec["type"]] = {
                    "total": rec["total"],
                    "embedded": rec["embedded"],
                    "missing": rec["total"] - rec["embedded"],
                }
            stats["embeddings"] = embeddings

        return stats

    def _replace_pbc_composes(self, pbc_id: str, abb_ids: list[str]):
        """Remove existing COMPOSES rels for a PBC, then recreate with new abb_ids."""
        query_delete = "MATCH (p:PBC {id: $pbc_id})-[r:COMPOSES]->() DELETE r"
        with self.session() as session:
            session.run(query_delete, pbc_id=pbc_id)
        for abb_id in abb_ids:
            self.add_relationship(pbc_id, abb_id, "COMPOSES")

    # --- Advisor Reports ---

    def generate_report_id(self) -> str:
        """Generate next sequential report ID (RPT-001, RPT-002, ...)."""
        query = "MATCH (r:AdvisorReport) RETURN r.id AS id ORDER BY r.id DESC LIMIT 1"
        with self.session() as session:
            record = session.run(query).single()
        if record and record["id"]:
            try:
                num = int(record["id"].split("-")[-1]) + 1
            except (ValueError, IndexError):
                num = 1
        else:
            num = 1
        return f"RPT-{num:03d}"

    def save_report(self, data: dict) -> dict:
        """Persist an AdvisorReport node and RECOMMENDS relationships."""
        report_id = self.generate_report_id()
        now = datetime.now(timezone.utc).isoformat()

        # Auto-generate title from first ~80 chars of problem
        problem = data.get("problem", "")
        title = data.get("title") or (problem[:80] + ("..." if len(problem) > 80 else ""))

        # Build initial conversation messages
        result_json = data.get("result_json", {})
        initial_messages = [
            {"role": "user", "content": problem, "type": "initial"},
            {"role": "assistant", "content": json.dumps(result_json), "type": "initial"},
        ]

        props = {
            "id": report_id,
            "title": title,
            "problem": problem,
            "summary": data.get("summary", ""),
            "confidence": data.get("confidence", "MEDIUM"),
            "starred": False,
            "provider": data.get("provider", ""),
            "model": data.get("model", ""),
            "result_json": json.dumps(result_json),
            "messages_json": json.dumps(initial_messages),
            "message_count": 2,
            "created_at": now,
        }
        if data.get("category_focus"):
            props["category_focus"] = data["category_focus"]
        if data.get("technology_preferences"):
            props["technology_preferences"] = data["technology_preferences"]

        props = {k: v for k, v in props.items() if v is not None}
        prop_str = ", ".join(f"{k}: ${k}" for k in props)
        query = f"CREATE (r:AdvisorReport {{{prop_str}}}) RETURN r"

        with self.session() as session:
            result = session.run(query, **props)
            report = dict(result.single()["r"])

        # Create RECOMMENDS relationships
        analysis = data.get("result_json", {}).get("analysis", {})
        self._create_report_relationships(report_id, analysis)

        return self._deserialize_report(report)

    def _create_report_relationships(self, report_id: str, analysis: dict):
        """Create RECOMMENDS edges from report to Pattern/PBC nodes."""
        items = []
        for pbc in analysis.get("recommended_pbcs", []):
            items.append({"id": pbc.get("id"), "role": "pbc", "confidence": pbc.get("confidence", "")})
        for abb in analysis.get("recommended_abbs", []):
            items.append({"id": abb.get("id"), "role": "abb", "confidence": abb.get("confidence", "")})
        for sbb in analysis.get("recommended_sbbs", []):
            items.append({"id": sbb.get("id"), "role": "sbb", "confidence": sbb.get("confidence", "")})

        query = """
        MATCH (r:AdvisorReport {id: $report_id})
        OPTIONAL MATCH (p:Pattern {id: $target_id})
        OPTIONAL MATCH (pbc:PBC {id: $target_id})
        WITH r, coalesce(p, pbc) AS target
        WHERE target IS NOT NULL
        MERGE (r)-[rel:RECOMMENDS]->(target)
        SET rel.role = $role, rel.confidence = $confidence
        """
        with self.session() as session:
            for item in items:
                if not item.get("id"):
                    continue
                try:
                    session.run(query,
                                report_id=report_id,
                                target_id=item["id"],
                                role=item["role"],
                                confidence=item["confidence"])
                except Exception:
                    pass  # Skip invalid target IDs

    def list_reports(self, limit: int = 50) -> list:
        """List saved reports (no result_json), starred first then newest."""
        query = """
        MATCH (r:AdvisorReport)
        RETURN r.id AS id, r.title AS title, r.problem AS problem,
               r.summary AS summary, r.confidence AS confidence,
               r.starred AS starred, r.provider AS provider,
               r.model AS model, r.created_at AS created_at,
               r.category_focus AS category_focus,
               r.technology_preferences AS technology_preferences,
               r.message_count AS message_count
        ORDER BY r.starred DESC, r.created_at DESC
        LIMIT $limit
        """
        with self.session() as session:
            records = session.run(query, limit=limit)
            results = []
            for r in records:
                row = dict(r)
                row["starred"] = bool(row.get("starred"))
                row["technology_preferences"] = row.get("technology_preferences") or []
                row["message_count"] = row.get("message_count") or 0
                results.append(row)
            return results

    def get_report(self, report_id: str) -> Optional[dict]:
        """Get a single report with full result_json."""
        query = "MATCH (r:AdvisorReport {id: $id}) RETURN r"
        with self.session() as session:
            result = session.run(query, id=report_id)
            record = result.single()
            if not record:
                return None
            return self._deserialize_report(dict(record["r"]))

    def update_report(self, report_id: str, data: dict) -> Optional[dict]:
        """Update report fields (title, starred)."""
        allowed = {}
        if "title" in data and data["title"] is not None:
            allowed["title"] = data["title"]
        if "starred" in data and data["starred"] is not None:
            allowed["starred"] = bool(data["starred"])

        if not allowed:
            return self.get_report(report_id)

        set_clauses = ", ".join(f"r.{k} = ${k}" for k in allowed)
        query = f"MATCH (r:AdvisorReport {{id: $id}}) SET {set_clauses} RETURN r"
        allowed["id"] = report_id

        with self.session() as session:
            result = session.run(query, **allowed)
            record = result.single()
            if not record:
                return None
            return self._deserialize_report(dict(record["r"]))

    def delete_report(self, report_id: str) -> bool:
        """Delete a single advisor report and all its relationships."""
        query = "MATCH (r:AdvisorReport {id: $id}) DETACH DELETE r RETURN count(r) as deleted"
        with self.session() as session:
            result = session.run(query, id=report_id)
            return result.single()["deleted"] > 0

    def delete_all_reports(self, keep_starred: bool = True) -> int:
        """Delete all non-starred reports (or all if keep_starred=False)."""
        if keep_starred:
            query = """
            MATCH (r:AdvisorReport) WHERE r.starred <> true
            DETACH DELETE r RETURN count(r) as deleted
            """
        else:
            query = "MATCH (r:AdvisorReport) DETACH DELETE r RETURN count(r) as deleted"
        with self.session() as session:
            result = session.run(query)
            return result.single()["deleted"]

    def cleanup_old_reports(self, max_reports: int = 20, retention_days: int = 30) -> dict:
        """Enforce retention: delete non-starred excess + aged reports."""
        deleted_by_count = 0
        deleted_by_age = 0

        with self.session() as session:
            # 1. Keep only newest max_reports (skip starred)
            count_query = """
            MATCH (r:AdvisorReport) WHERE r.starred <> true
            WITH r ORDER BY r.created_at DESC
            WITH collect(r) AS all_reports
            WITH all_reports[$skip..] AS old_reports
            UNWIND old_reports AS r
            DETACH DELETE r
            RETURN count(r) as deleted
            """
            # Use SKIP via parameter
            result = session.run(count_query, skip=max_reports)
            rec = result.single()
            if rec:
                deleted_by_count = rec["deleted"]

            # 2. Delete non-starred reports older than retention_days
            age_query = """
            MATCH (r:AdvisorReport)
            WHERE r.starred <> true
              AND r.created_at < $cutoff
            DETACH DELETE r
            RETURN count(r) as deleted
            """
            from datetime import timedelta
            cutoff = (datetime.now(timezone.utc) - timedelta(days=retention_days)).isoformat()
            result = session.run(age_query, cutoff=cutoff)
            rec = result.single()
            if rec:
                deleted_by_age = rec["deleted"]

        return {"deleted_by_count": deleted_by_count, "deleted_by_age": deleted_by_age}

    def count_reports(self) -> int:
        """Count total advisor reports."""
        with self.session() as session:
            return session.run("MATCH (r:AdvisorReport) RETURN count(r) as c").single()["c"]

    def append_messages(self, report_id: str, new_messages: list) -> Optional[dict]:
        """Append new messages to a report's conversation and increment message_count."""
        with self.session() as session:
            # Read current messages
            result = session.run(
                "MATCH (r:AdvisorReport {id: $id}) RETURN r.messages_json AS mj, r.message_count AS mc",
                id=report_id,
            )
            record = result.single()
            if not record:
                return None

            existing_json = record["mj"] or "[]"
            try:
                existing = json.loads(existing_json)
            except (json.JSONDecodeError, TypeError):
                existing = []

            existing.extend(new_messages)
            new_count = (record["mc"] or 0) + len(new_messages)

            # Write back
            session.run(
                """
                MATCH (r:AdvisorReport {id: $id})
                SET r.messages_json = $messages_json, r.message_count = $message_count
                """,
                id=report_id,
                messages_json=json.dumps(existing),
                message_count=new_count,
            )

        return self.get_report(report_id)

    def _deserialize_report(self, report: dict) -> dict:
        """Deserialize result_json and messages_json strings back to dicts/lists."""
        val = report.get("result_json")
        if isinstance(val, str):
            try:
                report["result_json"] = json.loads(val)
            except (json.JSONDecodeError, TypeError):
                report["result_json"] = {}
        # Deserialize messages_json (backward compat: default to [])
        msg_val = report.get("messages_json")
        if isinstance(msg_val, str):
            try:
                report["messages_json"] = json.loads(msg_val)
            except (json.JSONDecodeError, TypeError):
                report["messages_json"] = []
        elif msg_val is None:
            report["messages_json"] = []
        report["message_count"] = report.get("message_count") or len(report.get("messages_json", []))
        report["starred"] = bool(report.get("starred"))
        report["technology_preferences"] = report.get("technology_preferences") or []
        return report

    # --- Health Analysis Persistence ---

    def generate_health_analysis_id(self) -> str:
        """Generate next sequential health analysis ID (HA-001, HA-002, ...)."""
        query = "MATCH (h:HealthAnalysis) RETURN h.id AS id ORDER BY h.id DESC LIMIT 1"
        with self.session() as session:
            record = session.run(query).single()
        if record and record["id"]:
            try:
                num = int(record["id"].split("-")[-1]) + 1
            except (ValueError, IndexError):
                num = 1
        else:
            num = 1
        return f"HA-{num:03d}"

    def save_health_analysis(self, data: dict) -> dict:
        """Persist a HealthAnalysis node."""
        analysis_id = self.generate_health_analysis_id()
        now = datetime.now(timezone.utc).isoformat()
        from datetime import datetime as dt
        date_str = dt.now().strftime("%b %d, %Y %H:%M")
        title = data.get("title") or f"Health Analysis — {date_str}"

        props = {
            "id": analysis_id,
            "title": title,
            "analysis_json": json.dumps(data.get("analysis_json", {})),
            "health_score": data.get("health_score", 0),
            "score_breakdown_json": json.dumps(data.get("score_breakdown_json", {})),
            "provider": data.get("provider", ""),
            "model": data.get("model", ""),
            "pattern_count": data.get("pattern_count", 0),
            "created_at": now,
        }
        props = {k: v for k, v in props.items() if v is not None}
        prop_str = ", ".join(f"{k}: ${k}" for k in props)
        query = f"CREATE (h:HealthAnalysis {{{prop_str}}}) RETURN h"

        with self.session() as session:
            result = session.run(query, **props)
            return self._deserialize_health_analysis(dict(result.single()["h"]))

    def get_health_analysis(self, analysis_id: str) -> Optional[dict]:
        """Get a single health analysis by ID (full data)."""
        query = "MATCH (h:HealthAnalysis {id: $id}) RETURN h"
        with self.session() as session:
            result = session.run(query, id=analysis_id)
            record = result.single()
            if not record:
                return None
            return self._deserialize_health_analysis(dict(record["h"]))

    def get_latest_health_analysis(self) -> Optional[dict]:
        """Get the most recent health analysis."""
        query = "MATCH (h:HealthAnalysis) RETURN h ORDER BY h.created_at DESC LIMIT 1"
        with self.session() as session:
            result = session.run(query)
            record = result.single()
            if not record:
                return None
            return self._deserialize_health_analysis(dict(record["h"]))

    def list_health_analyses(self, limit: int = 20) -> list:
        """List health analyses (without analysis_json), newest first."""
        query = """
        MATCH (h:HealthAnalysis)
        RETURN h.id AS id, h.title AS title, h.health_score AS health_score,
               h.provider AS provider, h.model AS model,
               h.pattern_count AS pattern_count, h.created_at AS created_at
        ORDER BY h.created_at DESC
        LIMIT $limit
        """
        with self.session() as session:
            records = session.run(query, limit=limit)
            return [dict(r) for r in records]

    def delete_health_analysis(self, analysis_id: str) -> bool:
        """Delete a single health analysis."""
        query = "MATCH (h:HealthAnalysis {id: $id}) DELETE h RETURN count(h) as deleted"
        with self.session() as session:
            result = session.run(query, id=analysis_id)
            return result.single()["deleted"] > 0

    def delete_all_health_analyses(self) -> int:
        """Delete all health analyses."""
        query = "MATCH (h:HealthAnalysis) DELETE h RETURN count(h) as deleted"
        with self.session() as session:
            result = session.run(query)
            return result.single()["deleted"]

    def _deserialize_health_analysis(self, data: dict) -> dict:
        """Deserialize JSON string fields back to dicts."""
        for key in ("analysis_json", "score_breakdown_json"):
            val = data.get(key)
            if isinstance(val, str):
                try:
                    data[key] = json.loads(val)
                except (json.JSONDecodeError, TypeError):
                    data[key] = {}
        return data

    # ── Discovery Analysis Persistence ──────────────────────────────────

    def generate_discovery_analysis_id(self) -> str:
        """Generate next sequential discovery analysis ID (DA-001, DA-002, ...)."""
        query = "MATCH (d:DiscoveryAnalysis) RETURN d.id AS id ORDER BY d.id DESC LIMIT 1"
        with self.session() as session:
            record = session.run(query).single()
        if record and record["id"]:
            try:
                num = int(record["id"].split("-")[-1]) + 1
            except (ValueError, IndexError):
                num = 1
        else:
            num = 1
        return f"DA-{num:03d}"

    def save_discovery_analysis(self, data: dict) -> dict:
        """Persist a DiscoveryAnalysis node."""
        analysis_id = self.generate_discovery_analysis_id()
        now = datetime.now(timezone.utc).isoformat()
        from datetime import datetime as dt
        date_str = dt.now().strftime("%b %d, %Y %H:%M")
        title = data.get("title") or f"Discovery — {date_str}"

        props = {
            "id": analysis_id,
            "title": title,
            "suggestions_json": json.dumps(data.get("suggestions", [])),
            "provider": data.get("provider", ""),
            "model": data.get("model", ""),
            "focus_area": data.get("focus_area", ""),
            "suggestion_count": data.get("suggestion_count", 0),
            "created_at": now,
        }
        props = {k: v for k, v in props.items() if v is not None}
        prop_str = ", ".join(f"{k}: ${k}" for k in props)
        query = f"CREATE (d:DiscoveryAnalysis {{{prop_str}}}) RETURN d"

        with self.session() as session:
            result = session.run(query, **props)
            return self._deserialize_discovery_analysis(dict(result.single()["d"]))

    def get_discovery_analysis(self, analysis_id: str) -> Optional[dict]:
        """Get a single discovery analysis by ID (full data)."""
        query = "MATCH (d:DiscoveryAnalysis {id: $id}) RETURN d"
        with self.session() as session:
            result = session.run(query, id=analysis_id)
            record = result.single()
            if not record:
                return None
            return self._deserialize_discovery_analysis(dict(record["d"]))

    def list_discovery_analyses(self, limit: int = 20) -> list:
        """List discovery analyses (without suggestions_json), newest first."""
        query = """
        MATCH (d:DiscoveryAnalysis)
        RETURN d.id AS id, d.title AS title,
               d.provider AS provider, d.model AS model,
               d.focus_area AS focus_area, d.suggestion_count AS suggestion_count,
               d.created_at AS created_at
        ORDER BY d.created_at DESC
        LIMIT $limit
        """
        with self.session() as session:
            records = session.run(query, limit=limit)
            return [dict(r) for r in records]

    def delete_discovery_analysis(self, analysis_id: str) -> bool:
        """Delete a single discovery analysis."""
        query = "MATCH (d:DiscoveryAnalysis {id: $id}) DELETE d RETURN count(d) as deleted"
        with self.session() as session:
            result = session.run(query, id=analysis_id)
            return result.single()["deleted"] > 0

    def _deserialize_discovery_analysis(self, data: dict) -> dict:
        """Deserialize JSON string fields back to dicts/lists."""
        val = data.get("suggestions_json")
        if isinstance(val, str):
            try:
                data["suggestions_json"] = json.loads(val)
            except (json.JSONDecodeError, TypeError):
                data["suggestions_json"] = []
        return data

    # ── Legacy Import Analysis Persistence ────────────────────────────

    def generate_legacy_analysis_id(self) -> str:
        """Generate next sequential legacy analysis ID (LIA-001, LIA-002, ...)."""
        query = "MATCH (l:LegacyImportAnalysis) RETURN l.id AS id ORDER BY l.id DESC LIMIT 1"
        with self.session() as session:
            record = session.run(query).single()
        if record and record["id"]:
            try:
                num = int(record["id"].split("-")[-1]) + 1
            except (ValueError, IndexError):
                num = 1
        else:
            num = 1
        return f"LIA-{num:03d}"

    def save_legacy_analysis(self, data: dict) -> dict:
        """Persist a LegacyImportAnalysis node."""
        analysis_id = self.generate_legacy_analysis_id()
        now = datetime.now(timezone.utc).isoformat()

        props = {
            "id": analysis_id,
            "title": data.get("title", ""),
            "filename": data.get("filename", ""),
            "document_type": data.get("document_type", ""),
            "page_count": data.get("page_count", 0),
            "overview_json": json.dumps(data.get("overview", {})),
            "entities_json": json.dumps(data.get("entities", {})),
            "cross_references_json": json.dumps(data.get("cross_references", {})),
            "summary_json": json.dumps(data.get("summary", {})),
            "provider": data.get("provider", ""),
            "model": data.get("model", ""),
            "created_by": data.get("created_by", ""),
            "messages_json": "[]",
            "message_count": 0,
            "created_at": now,
        }
        props = {k: v for k, v in props.items() if v is not None}
        prop_str = ", ".join(f"{k}: ${k}" for k in props)
        query = f"CREATE (l:LegacyImportAnalysis {{{prop_str}}}) RETURN l"

        with self.session() as session:
            result = session.run(query, **props)
            return self._deserialize_legacy_analysis(dict(result.single()["l"]))

    def get_legacy_analysis(self, analysis_id: str) -> Optional[dict]:
        """Get a single legacy import analysis by ID (full data)."""
        query = "MATCH (l:LegacyImportAnalysis {id: $id}) RETURN l"
        with self.session() as session:
            result = session.run(query, id=analysis_id)
            record = result.single()
            if not record:
                return None
            return self._deserialize_legacy_analysis(dict(record["l"]))

    def list_legacy_analyses(self, limit: int = 50) -> list:
        """List legacy analyses (without full JSON payloads), newest first."""
        query = """
        MATCH (l:LegacyImportAnalysis)
        RETURN l.id AS id, l.title AS title, l.filename AS filename,
               l.document_type AS document_type, l.page_count AS page_count,
               l.summary_json AS summary_json,
               l.provider AS provider, l.model AS model,
               l.message_count AS message_count,
               l.created_by AS created_by, l.created_at AS created_at
        ORDER BY l.created_at DESC
        LIMIT $limit
        """
        with self.session() as session:
            records = session.run(query, limit=limit)
            results = []
            for r in records:
                row = dict(r)
                # Deserialize summary_json for list display
                val = row.get("summary_json")
                if isinstance(val, str):
                    try:
                        row["summary_json"] = json.loads(val)
                    except (json.JSONDecodeError, TypeError):
                        row["summary_json"] = {}
                results.append(row)
            return results

    def delete_legacy_analysis(self, analysis_id: str) -> bool:
        """Delete a single legacy import analysis."""
        query = "MATCH (l:LegacyImportAnalysis {id: $id}) DELETE l RETURN count(l) as deleted"
        with self.session() as session:
            result = session.run(query, id=analysis_id)
            return result.single()["deleted"] > 0

    def update_legacy_analysis_chat(
        self, analysis_id: str, messages_json: str, message_count: int
    ):
        """Update chat history on a legacy import analysis."""
        with self.session() as session:
            session.run(
                """
                MATCH (l:LegacyImportAnalysis {id: $id})
                SET l.messages_json = $messages_json,
                    l.message_count = $message_count
                """,
                id=analysis_id,
                messages_json=messages_json,
                message_count=message_count,
            )

    def update_legacy_analysis_entities(self, analysis_id: str, entities_json: str, summary_json: str):
        """Update entities and summary on a legacy import analysis (after chat refinement)."""
        with self.session() as session:
            session.run(
                """
                MATCH (l:LegacyImportAnalysis {id: $id})
                SET l.entities_json = $entities_json,
                    l.summary_json = $summary_json
                """,
                id=analysis_id,
                entities_json=entities_json,
                summary_json=summary_json,
            )

    def _deserialize_legacy_analysis(self, data: dict) -> dict:
        """Deserialize JSON string fields back to dicts/lists."""
        json_fields = [
            "overview_json", "entities_json", "cross_references_json",
            "summary_json", "messages_json",
        ]
        for field in json_fields:
            val = data.get(field)
            if isinstance(val, str):
                try:
                    data[field] = json.loads(val)
                except (json.JSONDecodeError, TypeError):
                    data[field] = {} if field != "messages_json" else []
        return data

    # --- Pattern Health Analysis ---

    def get_pattern_health(self, team_id: str = None) -> dict:
        """Comprehensive pattern library health analysis via Cypher queries.

        Args:
            team_id: If provided, scope analysis to patterns owned by this team.
                     If None, analyse all patterns (admin / global view).
        """
        health: dict = {}
        # Build reusable team filter fragments for Cypher
        if team_id:
            _team_match = "MATCH (p)-[:OWNED_BY]->(team:Team {id: $team_id})"
            _team_where = "AND EXISTS { (p)-[:OWNED_BY]->(:Team {id: $team_id}) }"
            _team_params = {"team_id": team_id}
        else:
            _team_match = ""
            _team_where = ""
            _team_params = {}

        # Use module-level constants for field definitions
        TYPE_FIELDS = _TYPE_FIELDS
        LIST_FIELDS = _COMPLETENESS_LIST_FIELDS

        with self.session() as session:
            # ── 1. Overall Counts ──
            counts_q = "MATCH (p:Pattern)\n"
            if team_id:
                counts_q += "MATCH (p)-[:OWNED_BY]->(:Team {id: $team_id})\n"
            counts_q += """
                WITH count(p) as total,
                     count(CASE WHEN p.status = 'ACTIVE' THEN 1 END) as active,
                     count(CASE WHEN p.status = 'DRAFT' THEN 1 END) as draft,
                     count(CASE WHEN p.status = 'DEPRECATED' THEN 1 END) as deprecated,
                     count(CASE WHEN p.type = 'AB' THEN 1 END) as ab,
                     count(CASE WHEN p.type = 'ABB' THEN 1 END) as abb,
                     count(CASE WHEN p.type = 'SBB' THEN 1 END) as sbb
                RETURN total, active, draft, deprecated, ab, abb, sbb
            """
            r = session.run(counts_q, **_team_params).single()
            health["counts"] = {
                "total": r["total"], "active": r["active"], "draft": r["draft"],
                "deprecated": r["deprecated"], "ab": r["ab"], "abb": r["abb"], "sbb": r["sbb"],
            }

            # ── 2. Status & Category Distributions ──
            status_dist = {}
            if r["active"]: status_dist["Active"] = r["active"]
            if r["draft"]: status_dist["Draft"] = r["draft"]
            if r["deprecated"]: status_dist["Deprecated"] = r["deprecated"]

            cat_query = "MATCH (p:Pattern)\n"
            if team_id:
                cat_query += "MATCH (p)-[:OWNED_BY]->(:Team {id: $team_id})\n"
            cat_query += """
            WITH p.category as category, count(p) as count
            RETURN category, count
            ORDER BY count DESC
            """
            records = session.run(cat_query, **_team_params)
            category_dist = {}
            for rec in records:
                category_dist[rec["category"] or "Uncategorized"] = rec["count"]

            health["distributions"] = {
                "status": status_dist,
                "category": category_dist,
            }

            # ── 3. Field Completeness (per-type, using actual field names) ──
            # Fetch all patterns with their properties for completeness analysis
            completeness_query = "MATCH (p:Pattern)\n"
            if team_id:
                completeness_query += "MATCH (p)-[:OWNED_BY]->(:Team {id: $team_id})\n"
            completeness_query += """
            RETURN p as node
            ORDER BY p.id
            """
            records = list(session.run(completeness_query, **_team_params))

            all_patterns = []
            total_completeness = 0.0
            pattern_count = 0
            by_type: dict = {}  # {type: {count, fields: {label: pct}, field_details: {label: {has, total}}}}

            for rec in records:
                node = rec["node"]
                props = dict(node)
                pid = props.get("id", "")
                pname = props.get("name", "")
                ptype = props.get("type", "")
                pstatus = props.get("status", "")

                fields_def = TYPE_FIELDS.get(ptype, {})
                if not fields_def:
                    continue

                filled = 0
                total_fields = len(fields_def)
                missing = []

                for prop_name, label in fields_def.items():
                    val = props.get(prop_name)
                    if prop_name in LIST_FIELDS:
                        has = val is not None and len(val) > 0
                    else:
                        has = val is not None and str(val).strip() != ""
                    if has:
                        filled += 1
                    else:
                        missing.append(label)

                pct = round((filled / total_fields) * 100, 1) if total_fields > 0 else 0.0
                total_completeness += pct
                pattern_count += 1

                all_patterns.append({
                    "id": pid, "name": pname, "type": ptype,
                    "status": pstatus, "score": pct,
                    "missing_fields": missing,
                })

                # Accumulate per-type field stats
                if ptype not in by_type:
                    by_type[ptype] = {
                        "count": 0,
                        "fields": {},
                        "_accum": {label: 0 for label in fields_def.values()},
                    }
                by_type[ptype]["count"] += 1
                for prop_name, label in fields_def.items():
                    val = props.get(prop_name)
                    if prop_name in LIST_FIELDS:
                        has = val is not None and len(val) > 0
                    else:
                        has = val is not None and str(val).strip() != ""
                    if has:
                        by_type[ptype]["_accum"][label] += 1

            # Finalize by_type field percentages
            for ptype, data in by_type.items():
                cnt = data["count"]
                data["fields"] = {
                    label: round((v / cnt) * 100, 1) if cnt > 0 else 0
                    for label, v in data["_accum"].items()
                }
                del data["_accum"]

            # Sort all_patterns by score ascending for incomplete list
            all_patterns.sort(key=lambda p: p["score"])
            incomplete = [p for p in all_patterns if p["missing_fields"]]

            health["completeness"] = {
                "avg_score": round(total_completeness / max(pattern_count, 1), 1),
                "fully_complete": len(all_patterns) - len(incomplete),
                "incomplete_count": len(incomplete),
                "by_type": by_type,
                "incomplete_patterns": incomplete,
            }

            # ── 4. Orphan Patterns (no relationships at all) ──
            # AB patterns are excluded: they are independent enterprise-level
            # blueprints/topologies and don't require graph relationships.
            if team_id:
                # For team scope, orphan = no non-OWNED_BY rels (OWNED_BY is the team link)
                orphan_query = """
                MATCH (p:Pattern)-[:OWNED_BY]->(:Team {id: $team_id})
                WHERE p.type <> 'AB'
                  AND NOT EXISTS {
                    MATCH (p)-[r]-() WHERE NOT type(r) = 'OWNED_BY'
                  }
                RETURN p.id as id, p.name as name, p.type as type,
                       p.status as status, p.category as category
                ORDER BY p.id
                """
            else:
                orphan_query = """
                MATCH (p:Pattern)
                WHERE NOT (p)-[]-() AND p.type <> 'AB'
                RETURN p.id as id, p.name as name, p.type as type,
                       p.status as status, p.category as category
                ORDER BY p.id
                """
            records = session.run(orphan_query, **_team_params)
            orphan_patterns = [dict(r) for r in records]

            # ── 5. Relationship Analysis ──
            rel_query = "MATCH (p:Pattern)\n"
            if team_id:
                rel_query += "MATCH (p)-[:OWNED_BY]->(:Team {id: $team_id})\n"
            rel_query += """
            OPTIONAL MATCH (p)-[r]-()
            WITH p.id as id, p.name as name, p.type as type, count(r) as rel_count
            RETURN id, name, type, rel_count
            ORDER BY rel_count DESC
            """
            records = session.run(rel_query, **_team_params)
            rel_data = [dict(r) for r in records]
            rel_counts = [d["rel_count"] for d in rel_data]
            # AB patterns are independent; exclude from unconnected count
            unconnected = len([d for d in rel_data if d["rel_count"] == 0 and d["type"] != "AB"])

            # ── 6. Relationship Type Distribution ──
            if team_id:
                rel_type_query = """
                MATCH (p:Pattern)-[r]->()
                WHERE NOT type(r) IN ['RECOMMENDS']
                  AND EXISTS { (p)-[:OWNED_BY]->(:Team {id: $team_id}) }
                RETURN type(r) as rel_type, count(r) as count
                ORDER BY count DESC
                """
            else:
                rel_type_query = """
                MATCH ()-[r]->()
                WHERE NOT type(r) IN ['RECOMMENDS']
                RETURN type(r) as rel_type, count(r) as count
                ORDER BY count DESC
                """
            records = session.run(rel_type_query, **_team_params)
            rel_type_obj = {}
            total_directed_rels = 0
            for rec in records:
                rel_type_obj[rec["rel_type"]] = rec["count"]
                total_directed_rels += rec["count"]

            health["relationships"] = {
                "total_relationships": total_directed_rels,
                "avg_per_pattern": round(sum(rel_counts) / max(len(rel_counts), 1), 1),
                "unconnected": unconnected,
                "max_relationships": max(rel_counts) if rel_counts else 0,
                "by_type": rel_type_obj,
                "most_connected": [
                    {"id": d["id"], "name": d["name"], "count": d["rel_count"]}
                    for d in rel_data[:10]
                ],
            }

            # ── 7. Cross-references (deprecated patterns still used) ──
            deprecated_refs_query = "MATCH (a:Pattern)-[r]->(b:Pattern)\n"
            deprecated_refs_query += "WHERE b.status = 'DEPRECATED' AND a.status = 'ACTIVE'\n"
            if team_id:
                deprecated_refs_query += "AND EXISTS { (a)-[:OWNED_BY]->(:Team {id: $team_id}) }\n"
            deprecated_refs_query += """
            RETURN b.id as id, b.name as name, count(DISTINCT a) as referenced_by
            ORDER BY referenced_by DESC
            """
            records = session.run(deprecated_refs_query, **_team_params)
            deprecated_referenced = [dict(r) for r in records]

            # ── 8. Duplicate Pattern Names ──
            dup_query = "MATCH (p:Pattern)\n"
            if team_id:
                dup_query += "MATCH (p)-[:OWNED_BY]->(:Team {id: $team_id})\n"
            dup_query += """
            WITH p.name as name, count(p) as cnt
            WHERE cnt > 1
            RETURN name, cnt as count
            ORDER BY cnt DESC
            """
            records = session.run(dup_query, **_team_params)
            duplicate_names = [dict(r) for r in records]

            health["problems"] = {
                "orphans": orphan_patterns,
                "deprecated_referenced": deprecated_referenced,
                "duplicate_names": duplicate_names,
            }

            # ── 9. ABB → SBB Implementation Coverage ──
            abb_sbb_query = "MATCH (abb:Pattern {type: 'ABB'})\n"
            if team_id:
                abb_sbb_query += "MATCH (abb)-[:OWNED_BY]->(:Team {id: $team_id})\n"
            abb_sbb_query += """
            OPTIONAL MATCH (sbb:Pattern {type: 'SBB'})-[:IMPLEMENTS]->(abb)
            WITH abb.id as abb_id, abb.name as abb_name, abb.category as category,
                 collect(CASE WHEN sbb IS NOT NULL THEN {id: sbb.id, name: sbb.name} END) as sbbs
            RETURN abb_id, abb_name, category,
                   [s IN sbbs WHERE s IS NOT NULL] as implementing_sbbs
            ORDER BY abb_id
            """
            records = session.run(abb_sbb_query, **_team_params)
            abb_coverage = []
            abbs_with_sbbs = 0
            abbs_without_sbbs = 0
            for rec in records:
                d = dict(rec)
                sbbs = d["implementing_sbbs"]
                if sbbs:
                    abbs_with_sbbs += 1
                else:
                    abbs_without_sbbs += 1
                abb_coverage.append({
                    "id": d["abb_id"], "name": d["abb_name"], "category": d["category"],
                    "sbb_count": len(sbbs),
                    "sbbs": sbbs[:5],  # limit to 5 for readability
                })

            health["abb_coverage"] = {
                "total_abbs": abbs_with_sbbs + abbs_without_sbbs,
                "with_sbbs": abbs_with_sbbs,
                "without_sbbs": abbs_without_sbbs,
                "coverage_pct": round((abbs_with_sbbs / max(abbs_with_sbbs + abbs_without_sbbs, 1)) * 100, 1),
                "details": sorted(abb_coverage, key=lambda x: x["sbb_count"]),
            }

            # ── 10. Technology Coverage ──
            tech_query = """
            MATCH (t:Technology)
            WITH count(t) as total,
                 count(CASE WHEN t.status = 'DEPRECATED' THEN 1 END) as deprecated
            OPTIONAL MATCH (p:Pattern)-[:USES]->(t2:Technology)
            WITH total, deprecated, count(DISTINCT t2) as techs_with_patterns
            RETURN total, deprecated, techs_with_patterns
            """
            r = session.run(tech_query).single()
            health["technology_stats"] = {
                "total": r["total"],
                "deprecated": r["deprecated"],
                "with_patterns": r["techs_with_patterns"],
                "without_patterns": r["total"] - r["techs_with_patterns"],
            }

            # ── 11. PBC Coverage ──
            pbc_query = """
            MATCH (pbc:PBC)
            OPTIONAL MATCH (pbc)-[:COMPOSES]->(abb:Pattern)
            WITH pbc.id as id, pbc.name as name, count(abb) as abb_count
            RETURN id, name, abb_count
            ORDER BY abb_count ASC
            """
            records = session.run(pbc_query)
            pbc_data = [dict(r) for r in records]
            health["pbc_stats"] = {
                "total": len(pbc_data),
                "empty_pbcs": [d for d in pbc_data if d["abb_count"] == 0],
                "avg_abbs_per_pbc": round(sum(d["abb_count"] for d in pbc_data) / max(len(pbc_data), 1), 1),
                "details": pbc_data,
            }

            # ── 12. Compute overall health score ──
            # Weighted: completeness (30%), relationships (25%), coverage (25%), problems (20%)
            completeness_score = health["completeness"]["avg_score"]

            connected = len([c for c in rel_counts if c > 0])
            rel_score = (connected / max(pattern_count, 1)) * 100

            abb_cov_pct = health["abb_coverage"]["coverage_pct"]
            coverage_score = abb_cov_pct

            error_count = len(deprecated_referenced)
            warning_count = len(orphan_patterns)
            problem_penalty = min(error_count * 15 + warning_count * 5, 100)
            problem_score = max(100 - problem_penalty, 0)

            health["health_score"] = round(
                completeness_score * 0.3 + rel_score * 0.25 + coverage_score * 0.25 + problem_score * 0.2, 1
            )
            health["score_breakdown"] = {
                "completeness": round(completeness_score, 1),
                "relationships": round(rel_score, 1),
                "coverage": round(coverage_score, 1),
                "problems": round(problem_score, 1),
            }

            # Include scope metadata
            health["scope"] = {"team_id": team_id} if team_id else {"team_id": None}

        return health

    # --- Dashboard Team Stats ---

    def get_team_stats(self) -> dict:
        """Aggregated per-team pattern statistics for the Dashboard comparison table.

        Returns a dict with 'teams' (list of per-team stats) and 'unowned' (unowned pattern counts).
        """
        result = {"teams": [], "unowned": {}}

        with self.session() as session:
            # 1. Per-team counts in a single query
            counts_q = """
            MATCH (t:Team)
            OPTIONAL MATCH (u:User)-[:MEMBER_OF]->(t)
            OPTIONAL MATCH (p:Pattern)-[:OWNED_BY]->(t)
            WITH t, count(DISTINCT u) AS member_count, collect(DISTINCT p) AS pats
            RETURN t.id AS team_id, t.name AS team_name, t.description AS description,
                   member_count,
                   size(pats) AS total,
                   size([x IN pats WHERE x.type = 'AB']) AS ab,
                   size([x IN pats WHERE x.type = 'ABB']) AS abb,
                   size([x IN pats WHERE x.type = 'SBB']) AS sbb,
                   size([x IN pats WHERE x.status = 'ACTIVE']) AS active,
                   size([x IN pats WHERE x.status = 'DRAFT']) AS draft,
                   size([x IN pats WHERE x.status = 'DEPRECATED']) AS deprecated
            ORDER BY t.name
            """
            team_rows = [dict(r) for r in session.run(counts_q)]

            # 2. Per-team completeness — fetch patterns grouped by team
            comp_q = """
            MATCH (p:Pattern)-[:OWNED_BY]->(t:Team)
            RETURN t.id AS team_id, collect(properties(p)) AS patterns
            """
            comp_map = {}
            for row in session.run(comp_q):
                team_id = row["team_id"]
                patterns = row["patterns"]
                if not patterns:
                    comp_map[team_id] = 0.0
                    continue
                scores = []
                for p in patterns:
                    p_type = p.get("type")
                    fields = _TYPE_FIELDS.get(p_type, {})
                    if not fields:
                        continue
                    filled = 0
                    for field_name in fields:
                        val = p.get(field_name)
                        if field_name in _COMPLETENESS_LIST_FIELDS:
                            if val and (isinstance(val, list) and len(val) > 0):
                                filled += 1
                        else:
                            if val and str(val).strip():
                                filled += 1
                    scores.append(filled / len(fields) * 100)
                comp_map[team_id] = round(sum(scores) / len(scores), 1) if scores else 0.0

            # 3. Assemble team entries
            for row in team_rows:
                result["teams"].append({
                    "id": row["team_id"],
                    "name": row["team_name"],
                    "description": row.get("description") or "",
                    "member_count": row["member_count"],
                    "patterns": {
                        "total": row["total"],
                        "ab": row["ab"],
                        "abb": row["abb"],
                        "sbb": row["sbb"],
                    },
                    "status": {
                        "active": row["active"],
                        "draft": row["draft"],
                        "deprecated": row["deprecated"],
                    },
                    "completeness_avg": comp_map.get(row["team_id"], 0.0),
                })

            # 4. Unowned patterns
            unowned_q = """
            MATCH (p:Pattern)
            WHERE NOT EXISTS { (p)-[:OWNED_BY]->(:Team) }
            RETURN count(p) AS total,
                   count(CASE WHEN p.type = 'AB' THEN 1 END) AS ab,
                   count(CASE WHEN p.type = 'ABB' THEN 1 END) AS abb,
                   count(CASE WHEN p.type = 'SBB' THEN 1 END) AS sbb
            """
            unowned = session.run(unowned_q).single()
            if unowned:
                result["unowned"] = {
                    "total": unowned["total"],
                    "ab": unowned["ab"],
                    "abb": unowned["abb"],
                    "sbb": unowned["sbb"],
                }

        return result

    def get_pattern_library_summary(self, team_id: str = None) -> str:
        """Get a rich text summary of the pattern library for LLM analysis.

        Args:
            team_id: If provided, scope summary to patterns owned by this team.

        Sends type-specific content so the LLM can perform semantic analysis:
        - AB: intent, problem, solution, structural_elements, invariants, contracts
        - ABB: functionality, inbound/outbound interfaces, business_capabilities
        - SBB: specific_functionality, inbound/outbound interfaces, sbb_mapping
        Plus relationships, PBCs, technologies, and health metrics.
        """
        lines: list[str] = []
        _params = {"team_id": team_id} if team_id else {}

        def _trunc(val, limit=300) -> str:
            if not val:
                return ""
            s = str(val).strip()
            return s[:limit] + "..." if len(s) > limit else s

        with self.session() as session:
            # ── Patterns with full properties ──
            pat_q = "MATCH (p:Pattern)\n"
            if team_id:
                pat_q += "MATCH (p)-[:OWNED_BY]->(:Team {id: $team_id})\n"
            pat_q += """
                OPTIONAL MATCH (p)-[r]->(t)
                WITH p, collect(DISTINCT {type: type(r), target: t.id, target_name: t.name}) as rels
                RETURN p as node, rels
                ORDER BY p.type, p.category, p.id
            """
            records = list(session.run(pat_q, **_params))

            current_type = None
            for rec in records:
                props = dict(rec["node"])
                rels = rec["rels"]
                ptype = props.get("type", "")
                pid = props.get("id", "")
                pname = props.get("name", "")
                category = props.get("category", "")
                status = props.get("status", "")

                # Type section header
                if ptype != current_type:
                    type_labels = {"AB": "Architecture Blueprints", "ABB": "Architecture Building Blocks", "SBB": "Solution Building Blocks"}
                    lines.append(f"\n## {type_labels.get(ptype, ptype)}")
                    current_type = ptype

                lines.append(f"\n### {pid}: {pname}")
                lines.append(f"Type: {ptype} | Category: {category} | Status: {status}")

                # Type-specific content
                if ptype == "AB":
                    if props.get("intent"):
                        lines.append(f"Intent: {_trunc(props['intent'], 400)}")
                    if props.get("problem"):
                        lines.append(f"Problem: {_trunc(props['problem'], 300)}")
                    if props.get("solution"):
                        lines.append(f"Solution: {_trunc(props['solution'], 300)}")
                    if props.get("structural_elements"):
                        lines.append(f"Structural Elements: {_trunc(props['structural_elements'], 500)}")
                    if props.get("invariants"):
                        lines.append(f"Invariants: {_trunc(props['invariants'], 400)}")
                    if props.get("inter_element_contracts"):
                        lines.append(f"Inter-Element Contracts: {_trunc(props['inter_element_contracts'], 500)}")
                    if props.get("building_blocks_note"):
                        lines.append(f"Building Blocks Note: {_trunc(props['building_blocks_note'], 300)}")

                elif ptype == "ABB":
                    if props.get("functionality"):
                        lines.append(f"Functionality: {_trunc(props['functionality'], 400)}")
                    if props.get("inbound_interfaces"):
                        lines.append(f"Inbound Interfaces: {_trunc(props['inbound_interfaces'], 300)}")
                    if props.get("outbound_interfaces"):
                        lines.append(f"Outbound Interfaces: {_trunc(props['outbound_interfaces'], 300)}")
                    caps = props.get("business_capabilities")
                    if caps and len(caps) > 0:
                        lines.append(f"Business Capabilities: {', '.join(caps)}")
                    works = props.get("works_with_ids")
                    if works and len(works) > 0:
                        lines.append(f"Works With: {', '.join(works)}")

                elif ptype == "SBB":
                    if props.get("specific_functionality"):
                        lines.append(f"Specific Functionality: {_trunc(props['specific_functionality'], 400)}")
                    if props.get("inbound_interfaces"):
                        lines.append(f"Inbound Interfaces: {_trunc(props['inbound_interfaces'], 300)}")
                    if props.get("outbound_interfaces"):
                        lines.append(f"Outbound Interfaces: {_trunc(props['outbound_interfaces'], 300)}")
                    mapping = props.get("sbb_mapping")
                    if mapping and len(mapping) > 0:
                        if isinstance(mapping, str):
                            try:
                                mapping = json.loads(mapping)
                            except Exception:
                                mapping = []
                        if isinstance(mapping, list):
                            parts = [f"{m.get('key', '')}: {m.get('value', '')}" for m in mapping if isinstance(m, dict)]
                            if parts:
                                lines.append(f"Technology Stack: {' | '.join(parts)}")
                    caps = props.get("business_capabilities")
                    if caps and len(caps) > 0:
                        lines.append(f"Business Capabilities: {', '.join(caps)}")
                    works = props.get("works_with_ids")
                    if works and len(works) > 0:
                        lines.append(f"Works With: {', '.join(works)}")

                # Relationships for all types
                if rels:
                    rel_parts = [f"{r['type']}->{r['target']} ({r.get('target_name', '')})" for r in rels if r.get("target")]
                    if rel_parts:
                        lines.append(f"Relationships: {', '.join(rel_parts[:15])}")

            # ── Categories ──
            cat_records = session.run("""
                MATCH (c:Category)
                OPTIONAL MATCH (p:Pattern {category: c.code})
                RETURN c.code as code, c.name as name, count(p) as pattern_count
                ORDER BY c.code
            """)
            lines.append("\n## Categories")
            for rec in cat_records:
                d = dict(rec)
                lines.append(f"- {d['code']}: {d['name']} ({d['pattern_count']} patterns)")

            # ── PBCs with ABB details ──
            pbc_records = session.run("""
                MATCH (pbc:PBC)
                OPTIONAL MATCH (pbc)-[:COMPOSES]->(abb:Pattern)
                RETURN pbc.id as id, pbc.name as name,
                       collect({id: abb.id, name: abb.name}) as abbs
                ORDER BY pbc.id
            """)
            lines.append("\n## Packaged Business Capabilities (PBCs)")
            for rec in pbc_records:
                d = dict(rec)
                abb_parts = [f"{a['id']} ({a['name']})" for a in d["abbs"] if a.get("id")]
                abbs_str = ", ".join(abb_parts) if abb_parts else "no ABBs composed"
                lines.append(f"- {d['id']}: {d['name']} -> [{abbs_str}]")

            # ── Technologies ──
            tech_records = session.run("""
                MATCH (t:Technology)
                OPTIONAL MATCH (p:Pattern)-[:USES]->(t)
                RETURN t.id as id, t.name as name, t.status as status,
                       collect(p.id) as used_by
                ORDER BY t.id
            """)
            tech_list = list(tech_records)
            if tech_list:
                lines.append("\n## Technologies")
                for rec in tech_list:
                    d = dict(rec)
                    used = ", ".join(d["used_by"][:10]) if d["used_by"] else "unused"
                    status_str = f" [DEPRECATED]" if d.get("status") == "DEPRECATED" else ""
                    lines.append(f"- {d['id']}: {d['name']}{status_str} (used by: {used})")

            # ── ABB→SBB Implementation Map ──
            impl_records = session.run("""
                MATCH (abb:Pattern {type: 'ABB'})
                OPTIONAL MATCH (sbb:Pattern {type: 'SBB'})-[:IMPLEMENTS]->(abb)
                RETURN abb.id as abb_id, abb.name as abb_name,
                       collect({id: sbb.id, name: sbb.name}) as sbbs
                ORDER BY abb.id
            """)
            lines.append("\n## ABB → SBB Implementation Map")
            for rec in impl_records:
                d = dict(rec)
                sbb_parts = [f"{s['id']} ({s['name']})" for s in d["sbbs"] if s.get("id")]
                sbbs_str = ", ".join(sbb_parts) if sbb_parts else "NO SBBs — implementation gap"
                lines.append(f"- {d['abb_id']} ({d['abb_name']}) <- [{sbbs_str}]")

            # ── Health Metrics Summary ──
            try:
                health = self.get_pattern_health(team_id=team_id)
                lines.append("\n## Current Health Metrics")
                lines.append(f"Health Score: {health.get('health_score', 'N/A')}/100")
                sb = health.get("score_breakdown", {})
                lines.append(f"Completeness: {sb.get('completeness', 'N/A')}% | Relationships: {sb.get('relationships', 'N/A')}% | Coverage: {sb.get('coverage', 'N/A')}% | Problems: {sb.get('problems', 'N/A')}%")
                counts = health.get("counts", {})
                lines.append(f"Patterns: {counts.get('total', 0)} total ({counts.get('active', 0)} active, {counts.get('draft', 0)} draft, {counts.get('deprecated', 0)} deprecated)")
                abb_cov = health.get("abb_coverage", {})
                lines.append(f"ABB Coverage: {abb_cov.get('coverage_pct', 0)}% ({abb_cov.get('with_sbbs', 0)}/{abb_cov.get('total_abbs', 0)} ABBs have SBBs)")
                orphans = health.get("problems", {}).get("orphans", [])
                if orphans:
                    lines.append(f"Orphaned patterns: {', '.join(o['id'] for o in orphans)}")
            except Exception:
                pass

        return "\n".join(lines)

    # --- Documents ---

    def _next_document_id(self) -> str:
        """Generate next sequential DOC-NNN id."""
        query = """
        MATCH (d:Document)
        WHERE d.id STARTS WITH 'DOC-'
        RETURN d.id AS id
        ORDER BY d.id DESC
        LIMIT 1
        """
        with self.session() as session:
            record = session.run(query).single()
        if record:
            num_str = record["id"].split("-")[-1]
            next_num = int(num_str) + 1
        else:
            next_num = 1
        return f"DOC-{next_num:03d}"

    def create_document(self, data: dict) -> dict:
        """Create a new Document node with optional initial sections."""
        doc_id = self._next_document_id()
        now = datetime.now(timezone.utc).isoformat()

        tags = data.get("tags", [])
        if not isinstance(tags, list):
            tags = []

        props = {
            "id": doc_id,
            "title": data.get("title", "Untitled Document"),
            "doc_type": data.get("doc_type", "guide"),
            "status": data.get("status", "draft"),
            "summary": data.get("summary", ""),
            "tags": tags,
            "created_by": data.get("created_by", ""),
            "source_analysis_id": data.get("source_analysis_id", ""),
            "created_date": now,
            "updated_date": now,
        }
        props = {k: v for k, v in props.items() if v is not None}
        prop_str = ", ".join(f"{k}: ${k}" for k in props)
        query = f"CREATE (d:Document {{{prop_str}}}) RETURN d"

        with self.session() as session:
            result = session.run(query, **props)
            doc = dict(result.single()["d"])

        # Create initial sections if provided
        sections = data.get("sections", [])
        for idx, sec in enumerate(sections):
            sec["order_index"] = idx
            self.add_document_section(doc_id, sec)

        # Link to source analysis if provided
        source_id = data.get("source_analysis_id")
        if source_id:
            self.add_relationship(doc_id, source_id, "SOURCED_FROM")

        # Assign to team if provided
        team_id = data.get("team_id")
        if team_id:
            self.add_relationship(doc_id, team_id, "OWNED_BY")

        return self.get_document(doc_id)

    def get_document(self, doc_id: str) -> Optional[dict]:
        """Get document with its sections and linked entities."""
        query = "MATCH (d:Document {id: $id}) RETURN d"
        with self.session() as session:
            record = session.run(query, id=doc_id).single()
            if not record:
                return None
            doc = dict(record["d"])

        # Ensure tags is a list
        tags = doc.get("tags")
        if tags is None:
            doc["tags"] = []
        elif isinstance(tags, str):
            try:
                doc["tags"] = json.loads(tags)
            except (json.JSONDecodeError, TypeError):
                doc["tags"] = []

        # Fetch sections ordered
        sections_query = """
        MATCH (d:Document {id: $id})-[:HAS_SECTION]->(s:DocumentSection)
        RETURN s
        ORDER BY s.order_index
        """
        with self.session() as session:
            records = session.run(sections_query, id=doc_id)
            doc["sections"] = [dict(r["s"]) for r in records]

        # Fetch linked entities
        links_query = """
        MATCH (d:Document {id: $id})-[:REFERENCES]->(e)
        RETURN e.id AS entity_id, e.name AS entity_name, labels(e)[0] AS entity_label
        """
        with self.session() as session:
            records = session.run(links_query, id=doc_id)
            doc["linked_entities"] = [
                {"id": r["entity_id"], "name": r["entity_name"], "label": r["entity_label"]}
                for r in records
            ]

        # Fetch team ownership
        team_query = """
        MATCH (d:Document {id: $id})-[:OWNED_BY]->(t:Team)
        RETURN t.id AS team_id, t.name AS team_name
        """
        with self.session() as session:
            team_rec = session.run(team_query, id=doc_id).single()
            doc["team_id"] = team_rec["team_id"] if team_rec else None
            doc["team_name"] = team_rec["team_name"] if team_rec else None

        return doc

    def list_documents(
        self,
        status: Optional[str] = None,
        doc_type: Optional[str] = None,
        search: Optional[str] = None,
        team_id: Optional[str] = None,
        skip: int = 0,
        limit: int = 50,
    ) -> tuple[list[dict], int]:
        """List documents with optional filters, paginated."""
        where_clauses = []
        params: dict = {"skip": skip, "limit": limit}

        if status:
            where_clauses.append("d.status = $status")
            params["status"] = status
        if doc_type:
            where_clauses.append("d.doc_type = $doc_type")
            params["doc_type"] = doc_type
        if search:
            where_clauses.append("(toLower(d.title) CONTAINS toLower($search) OR toLower(d.summary) CONTAINS toLower($search))")
            params["search"] = search
        if team_id:
            where_clauses.append("EXISTS { (d)-[:OWNED_BY]->(t:Team) WHERE t.id = $team_id }")
            params["team_id"] = team_id

        where = f"WHERE {' AND '.join(where_clauses)}" if where_clauses else ""

        count_query = f"MATCH (d:Document) {where} RETURN count(d) AS total"
        data_query = f"""
        MATCH (d:Document) {where}
        OPTIONAL MATCH (d)-[:HAS_SECTION]->(s:DocumentSection)
        OPTIONAL MATCH (d)-[:REFERENCES]->(e)
        OPTIONAL MATCH (d)-[:OWNED_BY]->(team:Team)
        RETURN d,
               count(DISTINCT s) AS section_count,
               count(DISTINCT e) AS link_count,
               team.id AS team_id,
               team.name AS team_name
        ORDER BY d.updated_date DESC
        SKIP $skip LIMIT $limit
        """

        with self.session() as session:
            total = session.run(count_query, **params).single()["total"]
            records = session.run(data_query, **params)
            docs = []
            for r in records:
                doc = dict(r["d"])
                tags = doc.get("tags")
                if tags is None:
                    doc["tags"] = []
                elif isinstance(tags, str):
                    try:
                        doc["tags"] = json.loads(tags)
                    except (json.JSONDecodeError, TypeError):
                        doc["tags"] = []
                doc["section_count"] = r["section_count"]
                doc["link_count"] = r["link_count"]
                doc["team_id"] = r["team_id"]
                doc["team_name"] = r["team_name"]
                docs.append(doc)
        return docs, total

    def update_document(self, doc_id: str, data: dict) -> Optional[dict]:
        """Update document metadata fields."""
        data["updated_date"] = datetime.now(timezone.utc).isoformat()
        # Don't allow changing id
        data.pop("id", None)
        data.pop("created_date", None)

        # Handle team assignment separately
        team_id = data.pop("team_id", None)

        if data:
            set_clauses = ", ".join(f"d.{k} = ${k}" for k in data)
            query = f"MATCH (d:Document {{id: $id}}) SET {set_clauses} RETURN d"
            data["id"] = doc_id

            with self.session() as session:
                result = session.run(query, **data)
                record = result.single()
                if not record:
                    return None

        # Update team ownership if provided
        if team_id is not None:
            # Remove existing ownership
            with self.session() as session:
                session.run(
                    "MATCH (d:Document {id: $id})-[r:OWNED_BY]->() DELETE r",
                    id=doc_id,
                )
            # Set new team if not empty
            if team_id:
                self.add_relationship(doc_id, team_id, "OWNED_BY")

        return self.get_document(doc_id)

    def delete_document(self, doc_id: str) -> bool:
        """Delete document and cascade-delete its sections."""
        # Delete sections first
        sec_query = """
        MATCH (d:Document {id: $id})-[:HAS_SECTION]->(s:DocumentSection)
        DETACH DELETE s
        """
        # Then delete the document
        doc_query = "MATCH (d:Document {id: $id}) DETACH DELETE d RETURN count(d) AS deleted"

        with self.session() as session:
            session.run(sec_query, id=doc_id)
            result = session.run(doc_query, id=doc_id)
            return result.single()["deleted"] > 0

    def document_exists(self, doc_id: str) -> bool:
        query = "MATCH (d:Document {id: $id}) RETURN count(d) AS c"
        with self.session() as session:
            return session.run(query, id=doc_id).single()["c"] > 0

    # --- Document Sections ---

    def _next_section_id(self, doc_id: str) -> str:
        """Generate next section ID like DOC-001-S01."""
        query = """
        MATCH (d:Document {id: $doc_id})-[:HAS_SECTION]->(s:DocumentSection)
        RETURN s.id AS id
        ORDER BY s.id DESC
        LIMIT 1
        """
        with self.session() as session:
            record = session.run(query, doc_id=doc_id).single()
        if record:
            # Extract SNN suffix
            last_id = record["id"]
            suffix = last_id.split("-S")[-1]
            next_num = int(suffix) + 1
        else:
            next_num = 1
        return f"{doc_id}-S{next_num:02d}"

    def add_document_section(self, doc_id: str, section_data: dict) -> Optional[dict]:
        """Add a new section to a document."""
        section_id = self._next_section_id(doc_id)
        now = datetime.now(timezone.utc).isoformat()

        # Determine order_index: use provided or append at end
        order_index = section_data.get("order_index")
        if order_index is None:
            count_query = """
            MATCH (d:Document {id: $doc_id})-[:HAS_SECTION]->(s:DocumentSection)
            RETURN count(s) AS c
            """
            with self.session() as session:
                order_index = session.run(count_query, doc_id=doc_id).single()["c"]

        props = {
            "id": section_id,
            "title": section_data.get("title", "New Section"),
            "content": section_data.get("content", ""),
            "order_index": order_index,
            "created_date": now,
            "updated_date": now,
        }
        prop_str = ", ".join(f"{k}: ${k}" for k in props)

        query = f"""
        MATCH (d:Document {{id: $doc_id}})
        CREATE (s:DocumentSection {{{prop_str}}})
        CREATE (d)-[:HAS_SECTION]->(s)
        SET d.updated_date = $now
        RETURN s
        """
        params = {**props, "doc_id": doc_id, "now": now}

        with self.session() as session:
            result = session.run(query, **params)
            record = result.single()
            return dict(record["s"]) if record else None

    def update_document_section(self, section_id: str, data: dict) -> Optional[dict]:
        """Update a section's title or content."""
        data["updated_date"] = datetime.now(timezone.utc).isoformat()
        data.pop("id", None)
        data.pop("created_date", None)

        set_clauses = ", ".join(f"s.{k} = ${k}" for k in data)
        # Also bump parent document's updated_date
        query = f"""
        MATCH (d:Document)-[:HAS_SECTION]->(s:DocumentSection {{id: $id}})
        SET {set_clauses}, d.updated_date = $updated_date
        RETURN s
        """
        data["id"] = section_id

        with self.session() as session:
            result = session.run(query, **data)
            record = result.single()
            return dict(record["s"]) if record else None

    def delete_document_section(self, section_id: str) -> bool:
        """Delete a section and update parent document timestamp."""
        query = """
        MATCH (d:Document)-[:HAS_SECTION]->(s:DocumentSection {id: $id})
        SET d.updated_date = $now
        DETACH DELETE s
        RETURN count(s) AS deleted
        """
        now = datetime.now(timezone.utc).isoformat()
        with self.session() as session:
            result = session.run(query, id=section_id, now=now)
            return result.single()["deleted"] > 0

    def reorder_document_sections(self, doc_id: str, section_ids: list[str]) -> bool:
        """Reorder sections by setting order_index based on position in section_ids list."""
        query = """
        MATCH (d:Document {id: $doc_id})-[:HAS_SECTION]->(s:DocumentSection {id: $sid})
        SET s.order_index = $idx, d.updated_date = $now
        RETURN count(s) AS updated
        """
        now = datetime.now(timezone.utc).isoformat()
        with self.session() as session:
            for idx, sid in enumerate(section_ids):
                session.run(query, doc_id=doc_id, sid=sid, idx=idx, now=now)
        return True

    # --- Document Linking ---

    def link_document_to_entity(self, doc_id: str, entity_id: str, entity_label: str) -> bool:
        """Create REFERENCES relationship from document to an entity, and reverse DOCUMENTED_BY."""
        # Use label-safe approach: match by id across all node types
        query = """
        MATCH (d:Document {id: $doc_id})
        MATCH (e {id: $entity_id})
        MERGE (d)-[:REFERENCES]->(e)
        MERGE (e)-[:DOCUMENTED_BY]->(d)
        RETURN count(d) AS linked
        """
        with self.session() as session:
            result = session.run(query, doc_id=doc_id, entity_id=entity_id)
            return result.single()["linked"] > 0

    def unlink_document_from_entity(self, doc_id: str, entity_id: str) -> bool:
        """Remove REFERENCES and DOCUMENTED_BY relationships between document and entity."""
        query = """
        MATCH (d:Document {id: $doc_id})-[r1:REFERENCES]->(e {id: $entity_id})
        DELETE r1
        WITH d, e
        OPTIONAL MATCH (e)-[r2:DOCUMENTED_BY]->(d)
        DELETE r2
        RETURN 1 AS done
        """
        with self.session() as session:
            session.run(query, doc_id=doc_id, entity_id=entity_id)
            return True

    def get_documents_for_entity(self, entity_id: str) -> list[dict]:
        """Get all documents linked to a specific entity (reverse lookup)."""
        query = """
        MATCH (d:Document)-[:REFERENCES]->(e {id: $entity_id})
        RETURN d.id AS id, d.title AS title, d.doc_type AS doc_type,
               d.status AS status, d.updated_date AS updated_date
        ORDER BY d.updated_date DESC
        """
        with self.session() as session:
            records = session.run(query, entity_id=entity_id)
            return [dict(r) for r in records]

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
