import json
import logging
from pathlib import Path

from services.neo4j_service import Neo4jService, BUILTIN_CATEGORIES

logger = logging.getLogger(__name__)

# Known IMPLEMENTS relationships
IMPLEMENTS = [
    ("SBB-AGT-001", "ABB-AGT-001"),
    ("SBB-AGT-002", "ABB-AGT-001"),
    ("SBB-AGT-003", "ABB-AGT-001"),
    ("SBB-AGT-004", "ABB-AGT-001"),
    ("SBB-CORE-001", "ABB-CORE-001"),
    ("SBB-CORE-002", "ABB-CORE-001"),
    ("SBB-CORE-003", "ABB-CORE-001"),
    ("SBB-INTG-001", "ABB-INTG-001"),
    ("SBB-INTG-002", "ABB-INTG-001"),
    ("SBB-INTG-003", "ABB-INTG-001"),
    ("SBB-INTG-004", "ABB-INTG-001"),
    ("SBB-INTG-005", "ABB-INTG-001"),
    ("SBB-INTG-006", "ABB-INTG-001"),
    ("SBB-INTG-007", "ABB-INTG-002"),
    ("SBB-INTG-008", "ABB-INTG-002"),
    ("SBB-KR-001", "ABB-KR-001"),
    ("SBB-KR-002", "ABB-KR-001"),
    ("SBB-KR-003", "ABB-KR-001"),
    ("SBB-XCUT-001", "ABB-XCUT-001"),
    ("SBB-XCUT-002", "ABB-XCUT-001"),
]

# Known SBB-to-SBB DEPENDS_ON
SBB_DEPENDS = [
    ("SBB-CORE-001", "SBB-INTG-001"),
    ("SBB-CORE-001", "SBB-XCUT-001"),
    ("SBB-CORE-002", "SBB-INTG-003"),
    ("SBB-CORE-002", "SBB-XCUT-002"),
    ("SBB-CORE-003", "SBB-INTG-001"),
    ("SBB-CORE-003", "SBB-XCUT-001"),
    ("SBB-CORE-003", "SBB-XCUT-002"),
    ("SBB-AGT-001", "SBB-INTG-001"),
    ("SBB-AGT-001", "SBB-KR-002"),
    ("SBB-AGT-001", "SBB-INTG-007"),
    ("SBB-AGT-002", "SBB-INTG-003"),
    ("SBB-AGT-002", "SBB-INTG-007"),
    ("SBB-AGT-002", "SBB-XCUT-002"),
    ("SBB-KR-001", "SBB-INTG-001"),
    ("SBB-KR-001", "SBB-INTG-005"),
    ("SBB-KR-002", "SBB-INTG-001"),
    ("SBB-INTG-003", "SBB-INTG-001"),
    ("SBB-INTG-003", "SBB-INTG-004"),
    ("SBB-XCUT-001", "SBB-INTG-001"),
]

# Known ABB-to-ABB DEPENDS_ON
ABB_DEPENDS = [
    ("ABB-CORE-001", "ABB-INTG-001"),
    ("ABB-KR-001", "ABB-INTG-001"),
    ("ABB-AGT-001", "ABB-CORE-001"),
    ("ABB-AGT-001", "ABB-INTG-001"),
    ("ABB-AGT-001", "ABB-INTG-002"),
    ("ABB-INTG-001", "ABB-PIP-001"),
    ("ABB-INTG-001", "ABB-PIP-002"),
]

# SBB -> Technology USES relationships
SBB_USES_TECH = [
    ("SBB-AGT-001", "aws-api-gateway"),
    ("SBB-AGT-001", "aws-bedrock"),
    ("SBB-AGT-001", "aws-eks"),
    ("SBB-AGT-001", "aws-lambda"),
    ("SBB-AGT-001", "aws-s3"),
    ("SBB-AGT-001", "aws-step-functions"),
    ("SBB-AGT-002", "aws-bedrock"),
    ("SBB-AGT-002", "aws-eks"),
    ("SBB-AGT-002", "aws-lambda"),
    ("SBB-AGT-002", "azure-openai"),
    ("SBB-AGT-002", "crewai"),
    ("SBB-AGT-002", "dynamodb"),
    ("SBB-AGT-002", "langgraph"),
    ("SBB-AGT-002", "litellm"),
    ("SBB-AGT-002", "redis"),
    ("SBB-AGT-003", "salesforce-agentforce"),
    ("SBB-AGT-004", "azure-openai"),
    ("SBB-AGT-004", "ms-copilot-studio"),
    ("SBB-CORE-001", "aws-bedrock"),
    ("SBB-CORE-001", "aws-eks"),
    ("SBB-CORE-001", "aws-s3"),
    ("SBB-CORE-001", "opentelemetry"),
    ("SBB-CORE-002", "aws-bedrock"),
    ("SBB-CORE-002", "aws-eks"),
    ("SBB-CORE-002", "aws-lambda"),
    ("SBB-CORE-002", "azure-openai"),
    ("SBB-CORE-002", "litellm"),
    ("SBB-CORE-003", "aws-api-gateway"),
    ("SBB-CORE-003", "aws-bedrock"),
    ("SBB-CORE-003", "aws-eventbridge"),
    ("SBB-CORE-003", "aws-lambda"),
    ("SBB-CORE-003", "aws-s3"),
    ("SBB-CORE-003", "aws-sqs"),
    ("SBB-CORE-003", "aws-step-functions"),
    ("SBB-INTG-001", "aws-bedrock"),
    ("SBB-INTG-001", "aws-cloudtrail"),
    ("SBB-INTG-002", "aws-bedrock"),
    ("SBB-INTG-002", "aws-eks"),
    ("SBB-INTG-002", "litellm"),
    ("SBB-INTG-002", "opentelemetry"),
    ("SBB-INTG-003", "aws-bedrock"),
    ("SBB-INTG-003", "aws-eks"),
    ("SBB-INTG-003", "azure-openai"),
    ("SBB-INTG-003", "litellm"),
    ("SBB-INTG-003", "tgi"),
    ("SBB-INTG-003", "vllm"),
    ("SBB-INTG-004", "aws-eks"),
    ("SBB-INTG-004", "tgi"),
    ("SBB-INTG-004", "vllm"),
    ("SBB-INTG-005", "aws-aurora-pg"),
    ("SBB-INTG-005", "aws-bedrock"),
    ("SBB-INTG-005", "aws-eks"),
    ("SBB-INTG-005", "aws-opensearch"),
    ("SBB-INTG-005", "onnx-runtime"),
    ("SBB-INTG-006", "aws-eks"),
    ("SBB-INTG-006", "aws-s3"),
    ("SBB-INTG-006", "onnx-runtime"),
    ("SBB-INTG-007", "aws-api-gateway"),
    ("SBB-INTG-007", "aws-bedrock"),
    ("SBB-INTG-007", "aws-cloudtrail"),
    ("SBB-INTG-007", "aws-lambda"),
    ("SBB-INTG-008", "aws-bedrock"),
    ("SBB-INTG-008", "aws-eks"),
    ("SBB-KR-001", "aws-aurora-pg"),
    ("SBB-KR-001", "aws-bedrock"),
    ("SBB-KR-001", "aws-eks"),
    ("SBB-KR-001", "aws-lambda"),
    ("SBB-KR-001", "aws-opensearch"),
    ("SBB-KR-001", "aws-s3"),
    ("SBB-KR-001", "litellm"),
    ("SBB-KR-002", "aws-aurora-pg"),
    ("SBB-KR-002", "aws-bedrock"),
    ("SBB-KR-002", "aws-opensearch"),
    ("SBB-KR-002", "aws-s3"),
    ("SBB-KR-002", "redis"),
    ("SBB-KR-003", "aws-bedrock"),
    ("SBB-KR-003", "aws-kendra"),
    ("SBB-KR-003", "aws-lambda"),
    ("SBB-KR-003", "aws-s3"),
    ("SBB-XCUT-001", "aws-bedrock"),
    ("SBB-XCUT-002", "aws-bedrock"),
    ("SBB-XCUT-002", "aws-lambda"),
    ("SBB-XCUT-002", "azure-openai"),
    ("SBB-XCUT-002", "tgi"),
    ("SBB-XCUT-002", "vllm"),
]

# Cross-references between patterns
PATTERN_REFERENCES = [
    ("ABB-AGT-001", "ABB-CORE-001"),
    ("ABB-AGT-001", "ABB-INTG-001"),
    ("ABB-AGT-001", "ABB-INTG-002"),
    ("ABB-AGT-001", "ABB-KR-001"),
    ("ABB-AGT-001", "ABB-XCUT-001"),
    ("ABB-CORE-001", "ABB-AGT-001"),
    ("ABB-CORE-001", "ABB-INTG-001"),
    ("ABB-CORE-001", "ABB-KR-001"),
    ("ABB-CORE-001", "ABB-XCUT-001"),
    ("ABB-INTG-001", "ABB-AGT-001"),
    ("ABB-INTG-001", "ABB-CORE-001"),
    ("ABB-INTG-001", "ABB-KR-001"),
    ("ABB-INTG-001", "ABB-PIP-001"),
    ("ABB-INTG-001", "ABB-PIP-002"),
    ("ABB-INTG-001", "ABB-XCUT-001"),
    ("ABB-INTG-002", "ABB-AGT-001"),
    ("ABB-INTG-002", "ABB-INTG-001"),
    ("ABB-INTG-002", "ABB-XCUT-001"),
    ("ABB-KR-001", "ABB-AGT-001"),
    ("ABB-KR-001", "ABB-CORE-001"),
    ("ABB-KR-001", "ABB-INTG-001"),
    ("ABB-KR-001", "ABB-XCUT-001"),
    ("ABB-PIP-001", "ABB-PIP-002"),
    ("ABB-PIP-001", "ABB-PIP-003"),
    ("ABB-PIP-001", "ABB-XCUT-001"),
    ("ABB-PIP-002", "ABB-PIP-001"),
    ("ABB-PIP-002", "ABB-XCUT-001"),
    ("ABB-PIP-003", "ABB-PIP-001"),
    ("ABB-PIP-003", "ABB-XCUT-001"),
    ("ABB-XCUT-001", "ABB-AGT-001"),
    ("ABB-XCUT-001", "ABB-CORE-001"),
    ("ABB-XCUT-001", "ABB-INTG-001"),
    ("ABB-XCUT-001", "ABB-KR-001"),
    ("SBB-AGT-001", "ABB-AGT-001"),
    ("SBB-AGT-001", "SBB-INTG-001"),
    ("SBB-AGT-001", "SBB-INTG-007"),
    ("SBB-AGT-001", "SBB-KR-002"),
    ("SBB-AGT-001", "SBB-XCUT-001"),
    ("SBB-AGT-002", "ABB-AGT-001"),
    ("SBB-AGT-002", "SBB-INTG-001"),
    ("SBB-AGT-002", "SBB-INTG-003"),
    ("SBB-AGT-002", "SBB-INTG-007"),
    ("SBB-AGT-002", "SBB-INTG-008"),
    ("SBB-AGT-002", "SBB-KR-001"),
    ("SBB-AGT-002", "SBB-XCUT-002"),
    ("SBB-AGT-003", "ABB-AGT-001"),
    ("SBB-AGT-003", "ABB-XCUT-001"),
    ("SBB-AGT-004", "ABB-AGT-001"),
    ("SBB-CORE-001", "ABB-CORE-001"),
    ("SBB-CORE-001", "SBB-AGT-001"),
    ("SBB-CORE-001", "SBB-AGT-002"),
    ("SBB-CORE-001", "SBB-INTG-001"),
    ("SBB-CORE-001", "SBB-KR-001"),
    ("SBB-CORE-001", "SBB-XCUT-001"),
    ("SBB-CORE-002", "ABB-CORE-001"),
    ("SBB-CORE-002", "SBB-INTG-003"),
    ("SBB-CORE-002", "SBB-XCUT-002"),
    ("SBB-CORE-003", "ABB-CORE-001"),
    ("SBB-CORE-003", "SBB-INTG-001"),
    ("SBB-CORE-003", "SBB-XCUT-001"),
    ("SBB-CORE-003", "SBB-XCUT-002"),
    ("SBB-INTG-001", "ABB-INTG-001"),
    ("SBB-INTG-001", "ABB-KR-001"),
    ("SBB-INTG-001", "SBB-AGT-001"),
    ("SBB-INTG-001", "SBB-CORE-001"),
    ("SBB-INTG-001", "SBB-CORE-003"),
    ("SBB-INTG-001", "SBB-INTG-003"),
    ("SBB-INTG-001", "SBB-KR-001"),
    ("SBB-INTG-001", "SBB-KR-002"),
    ("SBB-INTG-001", "SBB-XCUT-001"),
    ("SBB-INTG-002", "ABB-INTG-001"),
    ("SBB-INTG-002", "SBB-AGT-002"),
    ("SBB-INTG-002", "SBB-CORE-001"),
    ("SBB-INTG-002", "SBB-CORE-003"),
    ("SBB-INTG-002", "SBB-INTG-001"),
    ("SBB-INTG-002", "SBB-KR-001"),
    ("SBB-INTG-002", "SBB-XCUT-001"),
    ("SBB-INTG-003", "ABB-INTG-001"),
    ("SBB-INTG-003", "SBB-AGT-002"),
    ("SBB-INTG-003", "SBB-CORE-002"),
    ("SBB-INTG-003", "SBB-INTG-001"),
    ("SBB-INTG-003", "SBB-INTG-004"),
    ("SBB-INTG-003", "SBB-KR-001"),
    ("SBB-INTG-003", "SBB-XCUT-002"),
    ("SBB-INTG-004", "ABB-INTG-001"),
    ("SBB-INTG-004", "SBB-CORE-002"),
    ("SBB-INTG-004", "SBB-INTG-003"),
    ("SBB-INTG-004", "SBB-XCUT-002"),
    ("SBB-INTG-005", "ABB-INTG-001"),
    ("SBB-INTG-005", "SBB-INTG-003"),
    ("SBB-INTG-005", "SBB-KR-001"),
    ("SBB-INTG-006", "ABB-INTG-001"),
    ("SBB-INTG-006", "SBB-INTG-003"),
    ("SBB-INTG-007", "ABB-INTG-002"),
    ("SBB-INTG-007", "SBB-AGT-001"),
    ("SBB-INTG-007", "SBB-AGT-002"),
    ("SBB-INTG-008", "ABB-INTG-002"),
    ("SBB-INTG-008", "SBB-AGT-001"),
    ("SBB-INTG-008", "SBB-AGT-002"),
    ("SBB-INTG-008", "SBB-INTG-007"),
    ("SBB-KR-001", "ABB-KR-001"),
    ("SBB-KR-001", "SBB-AGT-001"),
    ("SBB-KR-001", "SBB-AGT-002"),
    ("SBB-KR-001", "SBB-CORE-001"),
    ("SBB-KR-001", "SBB-CORE-002"),
    ("SBB-KR-001", "SBB-INTG-001"),
    ("SBB-KR-001", "SBB-INTG-003"),
    ("SBB-KR-001", "SBB-INTG-005"),
    ("SBB-KR-001", "SBB-XCUT-001"),
    ("SBB-KR-001", "SBB-XCUT-002"),
    ("SBB-KR-002", "ABB-KR-001"),
    ("SBB-KR-002", "SBB-AGT-001"),
    ("SBB-KR-002", "SBB-AGT-002"),
    ("SBB-KR-002", "SBB-INTG-001"),
    ("SBB-KR-002", "SBB-XCUT-001"),
    ("SBB-KR-003", "ABB-KR-001"),
    ("SBB-KR-003", "SBB-AGT-001"),
    ("SBB-KR-003", "SBB-AGT-002"),
    ("SBB-KR-003", "SBB-KR-001"),
    ("SBB-KR-003", "SBB-KR-002"),
    ("SBB-KR-003", "SBB-XCUT-001"),
    ("SBB-XCUT-001", "ABB-XCUT-001"),
    ("SBB-XCUT-001", "SBB-AGT-001"),
    ("SBB-XCUT-001", "SBB-CORE-001"),
    ("SBB-XCUT-001", "SBB-CORE-003"),
    ("SBB-XCUT-001", "SBB-INTG-001"),
    ("SBB-XCUT-001", "SBB-INTG-003"),
    ("SBB-XCUT-001", "SBB-KR-002"),
    ("SBB-XCUT-002", "ABB-XCUT-001"),
    ("SBB-XCUT-002", "SBB-AGT-002"),
    ("SBB-XCUT-002", "SBB-CORE-002"),
    ("SBB-XCUT-002", "SBB-CORE-003"),
    ("SBB-XCUT-002", "SBB-INTG-003"),
    ("SBB-XCUT-002", "SBB-INTG-004"),
    ("SBB-XCUT-002", "SBB-KR-001"),
    ("SBB-XCUT-002", "SBB-XCUT-001"),
]

# Technology registry seed data
TECHNOLOGIES = [
    ("aws-ec2", "AWS EC2", "AWS", "cloud-compute", "APPROVED"),
    ("aws-eks", "Amazon EKS", "AWS", "cloud-compute", "APPROVED"),
    ("aws-lambda", "AWS Lambda", "AWS", "cloud-compute", "APPROVED"),
    ("aws-bedrock", "AWS Bedrock", "AWS", "cloud-ai", "APPROVED"),
    ("aws-kendra", "Amazon Kendra", "AWS", "cloud-ai", "APPROVED"),
    ("aws-opensearch", "Amazon OpenSearch", "AWS", "cloud-data", "APPROVED"),
    ("aws-aurora-pg", "Aurora PostgreSQL", "AWS", "cloud-data", "APPROVED"),
    ("aws-s3", "Amazon S3", "AWS", "cloud-data", "APPROVED"),
    ("aws-api-gateway", "Amazon API Gateway", "AWS", "cloud-infra", "APPROVED"),
    ("aws-cloudtrail", "AWS CloudTrail", "AWS", "cloud-infra", "APPROVED"),
    ("aws-step-functions", "AWS Step Functions", "AWS", "cloud-infra", "APPROVED"),
    ("aws-sqs", "Amazon SQS", "AWS", "cloud-infra", "APPROVED"),
    ("aws-eventbridge", "Amazon EventBridge", "AWS", "cloud-infra", "APPROVED"),
    ("azure-openai", "Azure OpenAI", "Microsoft", "cloud-ai", "APPROVED"),
    ("litellm", "LiteLLM", "Open Source", "framework", "APPROVED"),
    ("vllm", "vLLM", "Open Source", "framework", "APPROVED"),
    ("tgi", "Text Generation Inference", "Hugging Face", "framework", "APPROVED"),
    ("langgraph", "LangGraph", "LangChain", "framework", "APPROVED"),
    ("crewai", "CrewAI", "Open Source", "framework", "UNDER_REVIEW"),
    ("salesforce-agentforce", "Salesforce Agentforce", "Salesforce", "saas", "APPROVED"),
    ("ms-copilot-studio", "Microsoft Copilot Studio", "Microsoft", "saas", "APPROVED"),
    ("onnx-runtime", "ONNX Runtime", "Microsoft", "framework", "APPROVED"),
    ("opentelemetry", "OpenTelemetry", "Open Source", "observability", "APPROVED"),
    ("redis", "Redis", "Redis", "database", "APPROVED"),
    ("dynamodb", "Amazon DynamoDB", "AWS", "cloud-data", "APPROVED"),
]

# Seed PBCs extracted from ABB pattern "Business Capabilities" sections
SEED_PBCS = [
    {
        "id": "PBC-001",
        "name": "Intelligent Chat",
        "description": "End-to-end conversational AI capability combining prompt management, model inference, response streaming, and guardrails.",
        "abb_ids": ["ABB-CORE-001", "ABB-INTG-001", "ABB-XCUT-001"],
    },
    {
        "id": "PBC-002",
        "name": "Knowledge Search",
        "description": "Enterprise knowledge retrieval capability combining vector search, document ingestion, and semantic ranking.",
        "abb_ids": ["ABB-KR-001", "ABB-INTG-001"],
    },
    {
        "id": "PBC-003",
        "name": "Autonomous Agent",
        "description": "Self-directed AI agent capability with tool use, planning, memory, and multi-step execution.",
        "abb_ids": ["ABB-AGT-001", "ABB-CORE-001", "ABB-KR-001", "ABB-INTG-002"],
    },
    {
        "id": "PBC-004",
        "name": "Content Generation",
        "description": "AI-powered content creation and transformation capability for documents, summaries, and translations.",
        "abb_ids": ["ABB-CORE-001", "ABB-XCUT-001"],
    },
    {
        "id": "PBC-005",
        "name": "AI Governance",
        "description": "Cross-cutting AI governance capability covering observability, cost management, compliance, and audit trails.",
        "abb_ids": ["ABB-XCUT-001", "ABB-INTG-001"],
    },
]


def _load_seed_patterns() -> list[dict]:
    """Load pre-processed pattern data from JSON."""
    seed_file = Path(__file__).parent.parent / "seed_data" / "patterns.json"
    with open(seed_file, encoding="utf-8") as f:
        return json.load(f)


def seed_database(db: Neo4jService):
    """Seed Neo4j with pattern data from JSON seed file."""
    # Check if already seeded
    if db.count_patterns() > 0:
        logger.info("Database already seeded, skipping.")
        return

    logger.info("Creating constraints and indexes...")
    db.create_constraints()
    db.create_indexes()

    # Seed Category nodes from BUILTIN_CATEGORIES
    logger.info("Seeding built-in categories...")
    for code, label in BUILTIN_CATEGORIES.items():
        db.create_category(code, label, code.upper())
        logger.info(f"  Seeded category: {code} -> {label}")

    # Seed patterns from JSON
    patterns = _load_seed_patterns()
    logger.info(f"Loaded {len(patterns)} patterns from seed data")

    seeded_ids = set()
    for data in patterns:
        try:
            db.create_pattern(data)
            seeded_ids.add(data["id"])
            logger.info(f"  Seeded pattern: {data['id']} -- {data['name']}")
        except Exception as e:
            logger.error(f"  Failed to seed {data.get('id', '?')}: {e}")

    # Seed technologies
    logger.info(f"Seeding {len(TECHNOLOGIES)} technologies...")
    for tech_id, name, vendor, category, status in TECHNOLOGIES:
        try:
            db.create_technology({
                "id": tech_id,
                "name": name,
                "vendor": vendor,
                "category": category,
                "status": status,
            })
            logger.info(f"  Seeded technology: {tech_id} -- {name}")
        except Exception as e:
            logger.error(f"  Failed to seed technology {tech_id}: {e}")

    # Seed IMPLEMENTS relationships
    logger.info("Seeding IMPLEMENTS relationships...")
    for sbb_id, abb_id in IMPLEMENTS:
        if sbb_id in seeded_ids and abb_id in seeded_ids:
            db.add_relationship(sbb_id, abb_id, "IMPLEMENTS")

    # Seed SBB DEPENDS_ON relationships
    logger.info("Seeding SBB DEPENDS_ON relationships...")
    for source, target in SBB_DEPENDS:
        if source in seeded_ids and target in seeded_ids:
            db.add_relationship(source, target, "DEPENDS_ON")

    # Seed ABB DEPENDS_ON relationships
    logger.info("Seeding ABB DEPENDS_ON relationships...")
    for source, target in ABB_DEPENDS:
        if source in seeded_ids and target in seeded_ids:
            db.add_relationship(source, target, "DEPENDS_ON")

    # Seed USES (Technology) relationships
    logger.info("Seeding USES relationships...")
    for sbb_id, tech_id in SBB_USES_TECH:
        if sbb_id in seeded_ids:
            db.add_relationship(sbb_id, tech_id, "USES")

    # Seed REFERENCES relationships
    logger.info("Seeding REFERENCES relationships...")
    for source_id, target_id in PATTERN_REFERENCES:
        if source_id in seeded_ids and target_id in seeded_ids:
            db.add_relationship(source_id, target_id, "REFERENCES")

    # Seed PBCs (Packaged Business Capabilities)
    logger.info(f"Seeding {len(SEED_PBCS)} PBCs...")
    for pbc_data in SEED_PBCS:
        try:
            abb_ids = pbc_data.pop("abb_ids", [])
            db.create_pbc(pbc_data)
            logger.info(f"  Seeded PBC: {pbc_data['id']} -- {pbc_data['name']}")
            for abb_id in abb_ids:
                if abb_id in seeded_ids:
                    db.add_relationship(pbc_data["id"], abb_id, "COMPOSES")
                    logger.info(f"    {pbc_data['id']} -[COMPOSES]-> {abb_id}")
        except Exception as e:
            logger.error(f"  Failed to seed PBC {pbc_data.get('id', '?')}: {e}")

    pattern_count = db.count_patterns()
    tech_count = db.count_technologies()
    pbc_count = db.count_pbcs()
    logger.info(f"Seeding complete: {pattern_count} patterns, {tech_count} technologies, {pbc_count} PBCs")
