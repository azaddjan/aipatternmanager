from pydantic import BaseModel, Field
from typing import Optional
from datetime import datetime
from enum import Enum


# --- Enums ---

class UserRole(str, Enum):
    ADMIN = "admin"
    TEAM_MEMBER = "team_member"
    VIEWER = "viewer"


class PatternType(str, Enum):
    AB = "AB"
    ABB = "ABB"
    SBB = "SBB"


class PatternStatus(str, Enum):
    DRAFT = "DRAFT"
    ACTIVE = "ACTIVE"
    DEPRECATED = "DEPRECATED"


# CategoryCode is now dynamic — no longer a hardcoded enum.
# Categories are loaded from the database via /api/categories.


class TechnologyCategory(str, Enum):
    COMPUTE = "compute"
    AI_SERVICE = "ai-service"
    DATABASE = "database"
    SECURITY = "security"
    NETWORKING = "networking"
    STORAGE = "storage"
    ORCHESTRATION = "orchestration"


class TechnologyStatus(str, Enum):
    APPROVED = "APPROVED"
    UNDER_REVIEW = "UNDER_REVIEW"
    DEPRECATED = "DEPRECATED"


class CostTier(str, Enum):
    FREE = "FREE"
    LOW = "LOW"
    MEDIUM = "MEDIUM"
    HIGH = "HIGH"


class RelationshipType(str, Enum):
    IMPLEMENTS = "IMPLEMENTS"
    CONSTRAINED_BY = "CONSTRAINED_BY"
    USES = "USES"
    COMPATIBLE_WITH = "COMPATIBLE_WITH"
    DEPENDS_ON = "DEPENDS_ON"
    COMPOSES = "COMPOSES"
    REFERENCES = "REFERENCES"


class LLMProvider(str, Enum):
    ANTHROPIC = "anthropic"
    OPENAI = "openai"
    OLLAMA = "ollama"
    BEDROCK = "bedrock"


# --- Pattern ---

class PatternCreate(BaseModel):
    """Create a new pattern. ID is optional — if omitted, auto-generated."""
    id: Optional[str] = None
    name: str
    type: PatternType
    category: str  # dynamic — any string category code
    status: PatternStatus = PatternStatus.DRAFT
    version: str = "1.0.0"
    # --- AB (Architecture Blueprint) fields ---
    intent: Optional[str] = None
    problem: Optional[str] = None
    solution: Optional[str] = None
    structural_elements: Optional[str] = None
    invariants: Optional[str] = None
    inter_element_contracts: Optional[str] = None
    related_patterns_text: Optional[str] = None
    related_adrs: Optional[str] = None
    building_blocks_note: Optional[str] = None
    # --- ABB fields ---
    functionality: Optional[str] = None
    # --- SBB fields ---
    specific_functionality: Optional[str] = None
    # --- Shared ABB/SBB fields ---
    inbound_interfaces: Optional[str] = None
    outbound_interfaces: Optional[str] = None
    business_capabilities: list[str] = []
    sbb_mapping: list[dict] = []  # [{key, value}, ...]
    consumed_by_ids: list[str] = []  # pattern IDs
    works_with_ids: list[str] = []   # pattern IDs
    # --- Shared all-type fields ---
    restrictions: Optional[str] = None  # usage restrictions, platform constraints, licensing
    # --- New metadata fields (all types) ---
    description: Optional[str] = None  # short summary
    tags: list[str] = []  # cross-cutting labels for filtering
    deprecation_note: Optional[str] = None  # reason for deprecation, migration guidance
    # --- ABB-specific new fields ---
    quality_attributes: Optional[str] = None  # NFR contract: latency, availability, throughput
    compliance_requirements: Optional[str] = None  # GDPR, SOC2, ISO 27001, etc.
    # --- SBB-specific new fields ---
    vendor: Optional[str] = None  # vendor name
    deployment_model: Optional[str] = None  # SaaS / self-hosted / hybrid / managed
    cost_tier: Optional[str] = None  # FREE / LOW / MEDIUM / HIGH
    licensing: Optional[str] = None  # open-source / commercial / BYOL / pay-per-use
    maturity: Optional[str] = None  # POC / pilot / production-ready / battle-tested
    # --- Diagrams & Images (JSON arrays) ---
    diagrams: list[dict] = []  # [{id, title, content}] mermaid source
    images: list[dict] = []  # [{id, title, filename, content_type, size}]
    # Relationship hints — auto-create edges on creation
    implements_abbs: list[str] = []  # ABB IDs this SBB implements (can be multiple)
    technology_ids: list[str] = []  # Technology IDs this pattern USES (core dependency)
    compatible_tech_ids: list[str] = []  # Technology IDs this pattern is COMPATIBLE_WITH
    depends_on_ids: list[str] = []  # Pattern IDs this pattern DEPENDS_ON


class PatternUpdate(BaseModel):
    name: Optional[str] = None
    type: Optional[PatternType] = None
    status: Optional[PatternStatus] = None
    version: Optional[str] = None
    category: Optional[str] = None
    # --- AB fields ---
    intent: Optional[str] = None
    problem: Optional[str] = None
    solution: Optional[str] = None
    structural_elements: Optional[str] = None
    invariants: Optional[str] = None
    inter_element_contracts: Optional[str] = None
    related_patterns_text: Optional[str] = None
    related_adrs: Optional[str] = None
    building_blocks_note: Optional[str] = None
    # --- ABB fields ---
    functionality: Optional[str] = None
    # --- SBB fields ---
    specific_functionality: Optional[str] = None
    # --- Shared ABB/SBB fields ---
    inbound_interfaces: Optional[str] = None
    outbound_interfaces: Optional[str] = None
    business_capabilities: Optional[list[str]] = None
    sbb_mapping: Optional[list[dict]] = None
    consumed_by_ids: Optional[list[str]] = None
    works_with_ids: Optional[list[str]] = None
    # --- Shared all-type fields ---
    restrictions: Optional[str] = None
    # --- New metadata fields (all types) ---
    description: Optional[str] = None
    tags: Optional[list[str]] = None
    deprecation_note: Optional[str] = None
    # --- ABB-specific new fields ---
    quality_attributes: Optional[str] = None
    compliance_requirements: Optional[str] = None
    # --- SBB-specific new fields ---
    vendor: Optional[str] = None
    deployment_model: Optional[str] = None
    cost_tier: Optional[str] = None
    licensing: Optional[str] = None
    maturity: Optional[str] = None
    # --- Diagrams & Images (JSON arrays) ---
    diagrams: Optional[list[dict]] = None
    images: Optional[list[dict]] = None
    # Relationship updates
    implements_abbs: Optional[list[str]] = None  # set/change the parent ABBs (can be multiple)
    technology_ids: Optional[list[str]] = None  # set/change core tech dependencies (USES)
    compatible_tech_ids: Optional[list[str]] = None  # set/change compatible techs (COMPATIBLE_WITH)
    depends_on_ids: Optional[list[str]] = None  # set/change DEPENDS_ON relationships


# --- Technology ---

class TechnologyCreate(BaseModel):
    id: str
    name: str
    vendor: str
    category: str  # keep flexible
    status: str = "APPROVED"
    description: str = ""
    cost_tier: Optional[str] = None
    doc_url: Optional[str] = None
    website: Optional[str] = None
    notes: Optional[str] = None


class TechnologyUpdate(BaseModel):
    name: Optional[str] = None
    vendor: Optional[str] = None
    category: Optional[str] = None
    status: Optional[str] = None
    description: Optional[str] = None
    cost_tier: Optional[str] = None
    doc_url: Optional[str] = None
    website: Optional[str] = None
    notes: Optional[str] = None


# --- Category ---

class CategoryCreate(BaseModel):
    code: str = Field(..., pattern=r"^[a-z][a-z0-9_-]{1,19}$", description="Short lowercase code e.g. 'ml'")
    label: str = Field(..., description="Display name e.g. 'Machine Learning'")
    prefix: Optional[str] = None  # auto-derived from code.upper() if omitted


class CategoryUpdate(BaseModel):
    label: Optional[str] = None
    prefix: Optional[str] = None


# --- PBC (Packaged Business Capabilities) ---

class PBCCreate(BaseModel):
    id: Optional[str] = None  # auto-generated if omitted
    name: str
    description: str = ""
    api_endpoint: Optional[str] = None
    status: str = "ACTIVE"
    abb_ids: list[str] = []  # ABBs this PBC composes


class PBCUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    api_endpoint: Optional[str] = None
    status: Optional[str] = None
    abb_ids: Optional[list[str]] = None


# --- Relationships ---

class RelationshipCreate(BaseModel):
    target_id: str
    type: RelationshipType
    properties: dict = {}


# --- AI Authoring ---

class AIGenerateRequest(BaseModel):
    template_type: PatternType
    parent_abb_id: Optional[str] = None
    context_notes: str = ""
    enriched_context: Optional[str] = None  # follow-up answers + system context from analysis
    provider: Optional[LLMProvider] = None
    model: Optional[str] = None


class AIAnalyzeContextRequest(BaseModel):
    """Request for AI to analyze user's pattern description and predict category, relationships, follow-ups."""
    template_type: PatternType
    context_notes: str
    provider: Optional[LLMProvider] = None
    model: Optional[str] = None


class AIResponse(BaseModel):
    content: dict  # structured JSON fields for the generated pattern
    provider: str
    model: str


# --- Settings ---

class AppSettings(BaseModel):
    default_provider: LLMProvider = LLMProvider.ANTHROPIC
    anthropic_model: str = "claude-opus-4-20250514"
    openai_model: str = "gpt-4o"
    ollama_model: str = "llama3.1"
    bedrock_model: str = "anthropic.claude-sonnet-4-20250514-v1:0"
    ollama_base_url: str = "http://localhost:11434"
    aws_region: str = "us-east-1"


class AdminSettingsUpdate(BaseModel):
    default_provider: Optional[str] = None
    anthropic_model: Optional[str] = None
    openai_model: Optional[str] = None
    ollama_model: Optional[str] = None
    bedrock_model: Optional[str] = None
    ollama_base_url: Optional[str] = None
    aws_region: Optional[str] = None


class APIKeyUpdate(BaseModel):
    provider: str  # "anthropic", "openai", "bedrock"
    key: str  # actual API key
    secret: Optional[str] = None  # for AWS secret key


# --- Pattern ID Generation ---

class GenerateIDRequest(BaseModel):
    type: PatternType
    category: str


# --- Pattern Advisor ---

class AdvisorRequest(BaseModel):
    """Request for the Intelligent Pattern Advisor (GraphRAG)."""
    problem: str = Field(..., min_length=10, max_length=5000,
                         description="Natural language problem description")
    category_focus: Optional[str] = None
    technology_preferences: list[str] = []
    include_gap_analysis: bool = True
    provider: Optional[LLMProvider] = None
    model: Optional[str] = None
    clarifications: Optional[dict[str, str]] = Field(
        None, description="Answers from the clarification pre-flight step: {question_id: answer}"
    )


class AdvisorClarifyRequest(BaseModel):
    """Pre-flight check: assess if the problem needs clarification before full analysis."""
    problem: str = Field(..., min_length=10, max_length=5000,
                         description="Natural language problem description")
    category_focus: Optional[str] = None
    technology_preferences: list[str] = []
    provider: Optional[LLMProvider] = None
    model: Optional[str] = None


# --- Advisor Reports ---

class AdvisorReportUpdate(BaseModel):
    """Partial update for a saved advisor report."""
    title: Optional[str] = None
    starred: Optional[bool] = None


class AdvisorFollowupRequest(BaseModel):
    """Follow-up question on an existing advisor report."""
    question: str = Field(..., min_length=5, max_length=3000,
                          description="Follow-up question about the analysis")
    provider: Optional[LLMProvider] = None
    model: Optional[str] = None


# --- AI Field Assist (per-field editing support) ---

class AIFieldAssistAction(str, Enum):
    SUGGEST = "suggest"
    IMPROVE = "improve"
    CUSTOM = "custom"


class AIFieldAssistRequest(BaseModel):
    """Per-field AI assist during pattern editing."""
    field_name: str
    action: AIFieldAssistAction
    custom_prompt: Optional[str] = None  # required when action == "custom"
    current_value: str = ""
    pattern_context: dict  # all current form fields
    pattern_type: PatternType
    pattern_id: Optional[str] = None  # set when editing existing pattern
    provider: Optional[LLMProvider] = None
    model: Optional[str] = None


class AISmartAction(str, Enum):
    AUTO_TAGS = "auto_tags"
    GENERATE_DESCRIPTION = "generate_description"
    SUGGEST_RELATIONSHIPS = "suggest_relationships"
    QUALITY_CHECK = "quality_check"
    AUTO_FILL_EMPTY = "auto_fill_empty"
    CUSTOM = "custom"


class AISmartActionRequest(BaseModel):
    """Pattern-level smart AI actions."""
    action: AISmartAction
    pattern_context: dict
    pattern_type: PatternType
    pattern_id: Optional[str] = None
    custom_prompt: Optional[str] = None
    provider: Optional[LLMProvider] = None
    model: Optional[str] = None


# --- Documents ---

class DocumentCreate(BaseModel):
    title: str = "Untitled Document"
    doc_type: str = "guide"  # guide | reference | adr | overview | other
    status: str = "draft"  # draft | published | archived
    summary: str = ""
    tags: list[str] = []
    team_id: Optional[str] = None
    source_analysis_id: Optional[str] = None
    sections: list[dict] = []  # [{title, content}] for initial creation

class DocumentUpdate(BaseModel):
    title: Optional[str] = None
    doc_type: Optional[str] = None
    status: Optional[str] = None
    summary: Optional[str] = None
    tags: Optional[list[str]] = None
    team_id: Optional[str] = None

class DocumentSectionCreate(BaseModel):
    title: str = "New Section"
    content: str = ""
    order_index: Optional[int] = None

class DocumentSectionUpdate(BaseModel):
    title: Optional[str] = None
    content: Optional[str] = None

class DocumentSectionReorder(BaseModel):
    section_ids: list[str]

class DocumentLinkCreate(BaseModel):
    entity_id: str
    entity_label: str = "Pattern"  # Pattern | Technology | PBC
