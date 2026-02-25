"""
Embedding Service
Generates vector embeddings using configurable providers (OpenAI, Ollama, Bedrock)
and stores them on Neo4j nodes for vector similarity search (GraphRAG retrieval step).
"""
import json
import logging
import os
from typing import Optional

from services.neo4j_service import Neo4jService

logger = logging.getLogger(__name__)

# Fallback defaults
DEFAULT_PROVIDER = "openai"
DEFAULT_MODEL = "text-embedding-3-small"
DEFAULT_DIMS = 1536


class EmbeddingService:
    """Manages vector embeddings for the pattern knowledge graph.

    Supports multiple embedding providers:
    - OpenAI: text-embedding-3-small, text-embedding-3-large, text-embedding-ada-002
    - Ollama: nomic-embed-text, mxbai-embed-large, all-minilm, snowflake-arctic-embed
    - Bedrock: amazon.titan-embed-text-v2:0, amazon.titan-embed-text-v1, cohere.embed-english-v3
    """

    def __init__(self):
        # Load config from settings
        self._provider, self._model, self._dimensions = self._load_config()

        # Initialize the appropriate client
        self._available = False
        self._client = None

        if self._provider == "openai":
            self._init_openai()
        elif self._provider == "ollama":
            self._init_ollama()
        elif self._provider == "bedrock":
            self._init_bedrock()
        else:
            logger.warning(f"EmbeddingService: unknown provider '{self._provider}'")

    @staticmethod
    def _load_config() -> tuple[str, str, int]:
        """Load embedding config from admin settings."""
        try:
            from services.settings_service import get_embedding_settings
            cfg = get_embedding_settings()
            return (
                cfg.get("provider", DEFAULT_PROVIDER),
                cfg.get("model", DEFAULT_MODEL),
                cfg.get("dimensions", DEFAULT_DIMS),
            )
        except Exception:
            return DEFAULT_PROVIDER, DEFAULT_MODEL, DEFAULT_DIMS

    # --- Provider initialization ---

    def _init_openai(self):
        api_key = os.getenv("OPENAI_API_KEY")
        if api_key:
            from openai import OpenAI
            self._client = OpenAI(api_key=api_key)
            self._available = True
            logger.info(f"EmbeddingService initialized: OpenAI / {self._model}")
        else:
            logger.warning("EmbeddingService: OPENAI_API_KEY not set")

    def _init_ollama(self):
        try:
            import ollama as ollama_lib
            base_url = os.getenv("OLLAMA_BASE_URL", "http://localhost:11434")
            self._client = ollama_lib.Client(host=base_url)
            self._available = True
            logger.info(f"EmbeddingService initialized: Ollama / {self._model} @ {base_url}")
        except Exception as e:
            logger.warning(f"EmbeddingService: Ollama init failed: {e}")

    def _init_bedrock(self):
        ak = os.getenv("AWS_ACCESS_KEY_ID", "")
        sk = os.getenv("AWS_SECRET_ACCESS_KEY", "")
        profile = os.getenv("AWS_PROFILE", "")
        has_explicit_keys = ak and sk and not ak.startswith("your-")
        if has_explicit_keys or profile:
            try:
                import boto3
                region = os.getenv("AWS_DEFAULT_REGION", "us-east-1")
                session_kwargs = {}
                if profile:
                    session_kwargs["profile_name"] = profile
                session = boto3.Session(**session_kwargs)
                client_kwargs = {"region_name": region}
                if has_explicit_keys:
                    client_kwargs["aws_access_key_id"] = ak
                    client_kwargs["aws_secret_access_key"] = sk
                    st = os.getenv("AWS_SESSION_TOKEN", "")
                    if st:
                        client_kwargs["aws_session_token"] = st
                self._client = session.client("bedrock-runtime", **client_kwargs)
                self._available = True
                logger.info(f"EmbeddingService initialized: Bedrock / {self._model} ({region})")
            except Exception as e:
                logger.warning(f"EmbeddingService: Bedrock init failed: {e}")
        else:
            logger.warning("EmbeddingService: AWS credentials not set for Bedrock")

    # --- Properties ---

    @property
    def provider(self) -> str:
        return self._provider

    @property
    def model(self) -> str:
        return self._model

    @property
    def dimensions(self) -> int:
        return self._dimensions

    @property
    def available(self) -> bool:
        return self._available

    # --- Core embedding methods ---

    def generate_embedding(self, text: str) -> list[float]:
        """Generate a single embedding vector from text."""
        if not self._available:
            raise RuntimeError(f"Embedding service unavailable ({self._provider})")

        if self._provider == "openai":
            return self._openai_embed(text)
        elif self._provider == "ollama":
            return self._ollama_embed(text)
        elif self._provider == "bedrock":
            return self._bedrock_embed(text)
        else:
            raise RuntimeError(f"Unknown embedding provider: {self._provider}")

    def generate_embeddings_batch(self, texts: list[str]) -> list[list[float]]:
        """Generate embeddings for a batch of texts."""
        if not self._available:
            raise RuntimeError(f"Embedding service unavailable ({self._provider})")

        if self._provider == "openai":
            return self._openai_embed_batch(texts)
        elif self._provider == "ollama":
            return self._ollama_embed_batch(texts)
        elif self._provider == "bedrock":
            return self._bedrock_embed_batch(texts)
        else:
            raise RuntimeError(f"Unknown embedding provider: {self._provider}")

    # --- OpenAI ---

    def _openai_embed(self, text: str) -> list[float]:
        response = self._client.embeddings.create(input=text, model=self._model)
        return response.data[0].embedding

    def _openai_embed_batch(self, texts: list[str]) -> list[list[float]]:
        response = self._client.embeddings.create(input=texts, model=self._model)
        return [item.embedding for item in response.data]

    # --- Ollama ---

    def _ollama_embed(self, text: str) -> list[float]:
        response = self._client.embed(model=self._model, input=text)
        embeddings = response.get("embeddings", [])
        if embeddings:
            return embeddings[0]
        raise RuntimeError("Ollama returned no embeddings")

    def _ollama_embed_batch(self, texts: list[str]) -> list[list[float]]:
        # Ollama embed API supports list input
        response = self._client.embed(model=self._model, input=texts)
        embeddings = response.get("embeddings", [])
        if len(embeddings) == len(texts):
            return embeddings
        # Fallback: embed one by one
        return [self._ollama_embed(t) for t in texts]

    # --- Bedrock ---

    def _bedrock_embed(self, text: str) -> list[float]:
        model_id = self._model
        if model_id.startswith("amazon.titan"):
            body = json.dumps({"inputText": text})
            response = self._client.invoke_model(modelId=model_id, body=body)
            result = json.loads(response["body"].read())
            return result["embedding"]
        elif model_id.startswith("cohere."):
            body = json.dumps({
                "texts": [text],
                "input_type": "search_document",
            })
            response = self._client.invoke_model(modelId=model_id, body=body)
            result = json.loads(response["body"].read())
            return result["embeddings"][0]
        else:
            raise RuntimeError(f"Unsupported Bedrock embedding model: {model_id}")

    def _bedrock_embed_batch(self, texts: list[str]) -> list[list[float]]:
        model_id = self._model
        if model_id.startswith("cohere."):
            # Cohere supports batch natively
            body = json.dumps({
                "texts": texts,
                "input_type": "search_document",
            })
            response = self._client.invoke_model(modelId=model_id, body=body)
            result = json.loads(response["body"].read())
            return result["embeddings"]
        # Titan doesn't support batch — embed one by one
        return [self._bedrock_embed(t) for t in texts]

    # --- Text builders ---

    @staticmethod
    def _build_pattern_text(p: dict) -> str:
        """Build embedding text from a pattern's fields.

        Includes all semantically meaningful fields so vector search can find
        patterns by quality attributes, interfaces, vendor, deployment model, etc.
        """
        parts = [p.get("name", "")]
        ptype = p.get("type", "")

        # Description is common across all types
        if p.get("description"):
            parts.append(p["description"][:300])

        if ptype == "AB":
            for field in ["intent", "problem", "solution"]:
                if p.get(field):
                    parts.append(p[field][:500])
            if p.get("structural_elements"):
                parts.append(f"Structure: {p['structural_elements'][:200]}")
            if p.get("invariants"):
                parts.append(f"Invariants: {p['invariants'][:200]}")

        elif ptype == "ABB":
            if p.get("functionality"):
                parts.append(p["functionality"][:500])
            caps = p.get("business_capabilities")
            if caps:
                parts.append(f"Business capabilities: {', '.join(caps)}")
            if p.get("quality_attributes"):
                parts.append(f"Quality attributes: {p['quality_attributes'][:200]}")
            if p.get("compliance_requirements"):
                parts.append(f"Compliance: {p['compliance_requirements'][:200]}")
            if p.get("inbound_interfaces"):
                parts.append(f"Inbound interfaces: {p['inbound_interfaces'][:200]}")
            if p.get("outbound_interfaces"):
                parts.append(f"Outbound interfaces: {p['outbound_interfaces'][:200]}")

        elif ptype == "SBB":
            if p.get("specific_functionality"):
                parts.append(p["specific_functionality"][:500])
            caps = p.get("business_capabilities")
            if caps:
                parts.append(f"Business capabilities: {', '.join(caps)}")
            if p.get("vendor"):
                parts.append(f"Vendor: {p['vendor']}")
            if p.get("deployment_model"):
                parts.append(f"Deployment: {p['deployment_model']}")
            if p.get("cost_tier"):
                parts.append(f"Cost: {p['cost_tier']}")
            if p.get("licensing"):
                parts.append(f"Licensing: {p['licensing']}")
            if p.get("maturity"):
                parts.append(f"Maturity: {p['maturity']}")
            if p.get("inbound_interfaces"):
                parts.append(f"Inbound interfaces: {p['inbound_interfaces'][:200]}")
            if p.get("outbound_interfaces"):
                parts.append(f"Outbound interfaces: {p['outbound_interfaces'][:200]}")
            # sbb_mapping is a list of {key, value} dicts
            mapping = p.get("sbb_mapping")
            if mapping:
                if isinstance(mapping, str):
                    try:
                        import json as _json
                        mapping = _json.loads(mapping)
                    except Exception:
                        mapping = []
                if isinstance(mapping, list):
                    map_parts = [f"{m.get('key', '')}: {m.get('value', '')}" for m in mapping if isinstance(m, dict)]
                    if map_parts:
                        parts.append(f"Stack: {', '.join(map_parts)}")

        # Common fields for all types
        if p.get("restrictions"):
            parts.append(f"Restrictions: {p['restrictions'][:200]}")

        tags = p.get("tags")
        if tags and isinstance(tags, list):
            parts.append(f"Tags: {', '.join(tags)}")

        return ". ".join(filter(None, parts))

    @staticmethod
    def _build_technology_text(t: dict) -> str:
        """Build embedding text from a technology's fields."""
        parts = [t.get("name", "")]
        if t.get("vendor"):
            parts.append(f"by {t['vendor']}")
        if t.get("description"):
            parts.append(t["description"][:500])
        if t.get("category"):
            parts.append(f"Category: {t['category']}")
        return ". ".join(filter(None, parts))

    @staticmethod
    def _build_pbc_text(pbc: dict) -> str:
        """Build embedding text from a PBC's fields."""
        parts = [pbc.get("name", "")]
        if pbc.get("description"):
            parts.append(pbc["description"][:500])
        return ". ".join(filter(None, parts))

    # --- Single-node embedding ---

    def embed_pattern(self, db: Neo4jService, pattern_id: str):
        """Embed (or re-embed) a single pattern node. Safe to call even if unavailable."""
        if not self._available:
            return
        try:
            with db.session() as session:
                result = session.run("""
                    MATCH (p:Pattern {id: $id})
                    RETURN p.id as id, p.name as name, p.type as type,
                           p.description as description, p.tags as tags,
                           p.intent as intent, p.problem as problem, p.solution as solution,
                           p.structural_elements as structural_elements,
                           p.invariants as invariants,
                           p.functionality as functionality,
                           p.specific_functionality as specific_functionality,
                           p.business_capabilities as business_capabilities,
                           p.restrictions as restrictions,
                           p.quality_attributes as quality_attributes,
                           p.compliance_requirements as compliance_requirements,
                           p.inbound_interfaces as inbound_interfaces,
                           p.outbound_interfaces as outbound_interfaces,
                           p.vendor as vendor,
                           p.deployment_model as deployment_model,
                           p.cost_tier as cost_tier,
                           p.licensing as licensing,
                           p.maturity as maturity,
                           p.sbb_mapping as sbb_mapping
                """, id=pattern_id)
                record = result.single()
            if not record:
                return
            text = self._build_pattern_text(dict(record))
            embedding = self.generate_embedding(text)
            with db.session() as session:
                session.run(
                    "MATCH (p:Pattern {id: $id}) SET p.embedding = $embedding",
                    id=pattern_id, embedding=embedding
                )
            logger.debug(f"Embedded pattern {pattern_id}")
        except Exception as e:
            logger.warning(f"Failed to embed pattern {pattern_id}: {e}")

    def embed_technology(self, db: Neo4jService, tech_id: str):
        """Embed (or re-embed) a single technology node."""
        if not self._available:
            return
        try:
            with db.session() as session:
                result = session.run("""
                    MATCH (t:Technology {id: $id})
                    RETURN t.id as id, t.name as name, t.vendor as vendor,
                           t.description as description, t.category as category
                """, id=tech_id)
                record = result.single()
            if not record:
                return
            text = self._build_technology_text(dict(record))
            embedding = self.generate_embedding(text)
            with db.session() as session:
                session.run(
                    "MATCH (t:Technology {id: $id}) SET t.embedding = $embedding",
                    id=tech_id, embedding=embedding
                )
            logger.debug(f"Embedded technology {tech_id}")
        except Exception as e:
            logger.warning(f"Failed to embed technology {tech_id}: {e}")

    def embed_pbc(self, db: Neo4jService, pbc_id: str):
        """Embed (or re-embed) a single PBC node."""
        if not self._available:
            return
        try:
            with db.session() as session:
                result = session.run("""
                    MATCH (p:PBC {id: $id})
                    RETURN p.id as id, p.name as name, p.description as description
                """, id=pbc_id)
                record = result.single()
            if not record:
                return
            text = self._build_pbc_text(dict(record))
            embedding = self.generate_embedding(text)
            with db.session() as session:
                session.run(
                    "MATCH (p:PBC {id: $id}) SET p.embedding = $embedding",
                    id=pbc_id, embedding=embedding
                )
            logger.debug(f"Embedded PBC {pbc_id}")
        except Exception as e:
            logger.warning(f"Failed to embed PBC {pbc_id}: {e}")

    # --- Bulk operations ---

    def embed_missing_nodes(self, db: Neo4jService) -> dict:
        """Embed all nodes that are missing embeddings. Called on startup."""
        if not self._available:
            return {"patterns": 0, "technologies": 0, "pbcs": 0}

        stats = {"patterns": 0, "technologies": 0, "pbcs": 0}

        try:
            # Patterns without embeddings
            with db.session() as session:
                result = session.run("""
                    MATCH (p:Pattern) WHERE p.embedding IS NULL
                    RETURN p.id as id, p.name as name, p.type as type,
                           p.description as description, p.tags as tags,
                           p.intent as intent, p.problem as problem, p.solution as solution,
                           p.structural_elements as structural_elements,
                           p.invariants as invariants,
                           p.functionality as functionality,
                           p.specific_functionality as specific_functionality,
                           p.business_capabilities as business_capabilities,
                           p.restrictions as restrictions,
                           p.quality_attributes as quality_attributes,
                           p.compliance_requirements as compliance_requirements,
                           p.inbound_interfaces as inbound_interfaces,
                           p.outbound_interfaces as outbound_interfaces,
                           p.vendor as vendor,
                           p.deployment_model as deployment_model,
                           p.cost_tier as cost_tier,
                           p.licensing as licensing,
                           p.maturity as maturity,
                           p.sbb_mapping as sbb_mapping
                    ORDER BY p.id
                """)
                missing_patterns = [dict(r) for r in result]

            if missing_patterns:
                texts = [self._build_pattern_text(p) for p in missing_patterns]
                embeddings = self.generate_embeddings_batch(texts)
                with db.session() as session:
                    for p, emb in zip(missing_patterns, embeddings):
                        session.run(
                            "MATCH (p:Pattern {id: $id}) SET p.embedding = $embedding",
                            id=p["id"], embedding=emb
                        )
                stats["patterns"] = len(missing_patterns)

            # Technologies without embeddings
            with db.session() as session:
                result = session.run("""
                    MATCH (t:Technology) WHERE t.embedding IS NULL
                    RETURN t.id as id, t.name as name, t.vendor as vendor,
                           t.description as description, t.category as category
                    ORDER BY t.id
                """)
                missing_techs = [dict(r) for r in result]

            if missing_techs:
                texts = [self._build_technology_text(t) for t in missing_techs]
                embeddings = self.generate_embeddings_batch(texts)
                with db.session() as session:
                    for t, emb in zip(missing_techs, embeddings):
                        session.run(
                            "MATCH (t:Technology {id: $id}) SET t.embedding = $embedding",
                            id=t["id"], embedding=emb
                        )
                stats["technologies"] = len(missing_techs)

            # PBCs without embeddings
            with db.session() as session:
                result = session.run("""
                    MATCH (p:PBC) WHERE p.embedding IS NULL
                    RETURN p.id as id, p.name as name, p.description as description
                    ORDER BY p.id
                """)
                missing_pbcs = [dict(r) for r in result]

            if missing_pbcs:
                texts = [self._build_pbc_text(p) for p in missing_pbcs]
                embeddings = self.generate_embeddings_batch(texts)
                with db.session() as session:
                    for p, emb in zip(missing_pbcs, embeddings):
                        session.run(
                            "MATCH (p:PBC {id: $id}) SET p.embedding = $embedding",
                            id=p["id"], embedding=emb
                        )
                stats["pbcs"] = len(missing_pbcs)

            total = sum(stats.values())
            if total > 0:
                logger.info(f"Embedded {total} missing nodes via {self._provider}/{self._model} ({stats})")
            else:
                logger.info("All nodes already have embeddings")

        except Exception as e:
            logger.warning(f"Embedding missing nodes failed: {e}")

        return stats

    def embed_all_nodes(self, db: Neo4jService) -> dict:
        """Generate and store embeddings for all Pattern, Technology, and PBC nodes."""
        if not self._available:
            raise RuntimeError(f"Embedding service unavailable ({self._provider})")

        stats = {"patterns": 0, "technologies": 0, "pbcs": 0}

        # --- Patterns ---
        with db.session() as session:
            patterns = session.run("""
                MATCH (p:Pattern)
                RETURN p.id as id, p.name as name, p.type as type,
                       p.description as description, p.tags as tags,
                       p.intent as intent, p.problem as problem, p.solution as solution,
                       p.structural_elements as structural_elements,
                       p.invariants as invariants,
                       p.functionality as functionality,
                       p.specific_functionality as specific_functionality,
                       p.business_capabilities as business_capabilities,
                       p.restrictions as restrictions,
                       p.quality_attributes as quality_attributes,
                       p.compliance_requirements as compliance_requirements,
                       p.inbound_interfaces as inbound_interfaces,
                       p.outbound_interfaces as outbound_interfaces,
                       p.vendor as vendor,
                       p.deployment_model as deployment_model,
                       p.cost_tier as cost_tier,
                       p.licensing as licensing,
                       p.maturity as maturity,
                       p.sbb_mapping as sbb_mapping
                ORDER BY p.id
            """)
            pattern_list = [dict(r) for r in patterns]

        if pattern_list:
            texts = [self._build_pattern_text(p) for p in pattern_list]
            embeddings = self.generate_embeddings_batch(texts)
            with db.session() as session:
                for p, emb in zip(pattern_list, embeddings):
                    session.run(
                        "MATCH (p:Pattern {id: $id}) SET p.embedding = $embedding",
                        id=p["id"], embedding=emb
                    )
            stats["patterns"] = len(pattern_list)
            logger.info(f"Embedded {len(pattern_list)} patterns")

        # --- Technologies ---
        with db.session() as session:
            techs = session.run("""
                MATCH (t:Technology)
                RETURN t.id as id, t.name as name, t.vendor as vendor,
                       t.description as description, t.category as category
                ORDER BY t.id
            """)
            tech_list = [dict(r) for r in techs]

        if tech_list:
            texts = [self._build_technology_text(t) for t in tech_list]
            embeddings = self.generate_embeddings_batch(texts)
            with db.session() as session:
                for t, emb in zip(tech_list, embeddings):
                    session.run(
                        "MATCH (t:Technology {id: $id}) SET t.embedding = $embedding",
                        id=t["id"], embedding=emb
                    )
            stats["technologies"] = len(tech_list)
            logger.info(f"Embedded {len(tech_list)} technologies")

        # --- PBCs ---
        with db.session() as session:
            pbcs = session.run("""
                MATCH (p:PBC)
                RETURN p.id as id, p.name as name, p.description as description
                ORDER BY p.id
            """)
            pbc_list = [dict(r) for r in pbcs]

        if pbc_list:
            texts = [self._build_pbc_text(p) for p in pbc_list]
            embeddings = self.generate_embeddings_batch(texts)
            with db.session() as session:
                for p, emb in zip(pbc_list, embeddings):
                    session.run(
                        "MATCH (p:PBC {id: $id}) SET p.embedding = $embedding",
                        id=p["id"], embedding=emb
                    )
            stats["pbcs"] = len(pbc_list)
            logger.info(f"Embedded {len(pbc_list)} PBCs")

        return stats

    def get_embedding_status(self, db: Neo4jService) -> dict:
        """Check how many nodes have embeddings vs total."""
        with db.session() as session:
            result = session.run("""
                MATCH (p:Pattern)
                RETURN count(p) as total,
                       count(p.embedding) as embedded,
                       'patterns' as type
                UNION ALL
                MATCH (t:Technology)
                RETURN count(t) as total,
                       count(t.embedding) as embedded,
                       'technologies' as type
                UNION ALL
                MATCH (p:PBC)
                RETURN count(p) as total,
                       count(p.embedding) as embedded,
                       'pbcs' as type
            """)
            status = {}
            for r in result:
                status[r["type"]] = {
                    "total": r["total"],
                    "embedded": r["embedded"],
                }
        return status
