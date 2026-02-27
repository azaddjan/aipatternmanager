"""
Sample Data Seed Script.
Provides Content Intelligence sample data for demo/evaluation purposes.
Used on first boot (empty database) and via Admin "Reset to Sample Data".
"""
import json
import logging
import uuid
from datetime import datetime, timezone

from services.neo4j_service import Neo4jService

logger = logging.getLogger(__name__)

NOW = datetime.now(timezone.utc).isoformat()


def _uid():
    return str(uuid.uuid4())


# ---------------------------------------------------------------------------
# Technologies  (deterministic IDs so SBBs can reference them)
# ---------------------------------------------------------------------------
TECHNOLOGIES = [
    {
        "id": "TECH-001", "name": "AWS Textract",
        "vendor": "Amazon Web Services", "category": "Document Processing",
        "status": "Approved", "cost_tier": "Pay-per-use",
        "description": "Machine learning service that automatically extracts text, handwriting, and data from scanned documents.",
        "website": "https://aws.amazon.com/textract/",
        "doc_url": "https://docs.aws.amazon.com/textract/",
    },
    {
        "id": "TECH-002", "name": "Azure Document Intelligence",
        "vendor": "Microsoft", "category": "Document Processing",
        "status": "Approved", "cost_tier": "Pay-per-use",
        "description": "AI service that applies machine learning to extract text, key-value pairs, tables, and structures from documents.",
        "website": "https://azure.microsoft.com/en-us/products/ai-services/ai-document-intelligence",
        "doc_url": "https://learn.microsoft.com/en-us/azure/ai-services/document-intelligence/",
    },
    {
        "id": "TECH-003", "name": "Google Document AI",
        "vendor": "Google Cloud", "category": "Document Processing",
        "status": "Approved", "cost_tier": "Pay-per-use",
        "description": "Unified platform for document processing using Google Cloud AI to classify, extract, and enrich data from documents.",
        "website": "https://cloud.google.com/document-ai",
        "doc_url": "https://cloud.google.com/document-ai/docs",
    },
    {
        "id": "TECH-004", "name": "AWS Comprehend",
        "vendor": "Amazon Web Services", "category": "NLP",
        "status": "Approved", "cost_tier": "Pay-per-use",
        "description": "Natural language processing service that uses machine learning to find insights and relationships in text.",
        "website": "https://aws.amazon.com/comprehend/",
        "doc_url": "https://docs.aws.amazon.com/comprehend/",
    },
    {
        "id": "TECH-005", "name": "Azure Text Analytics",
        "vendor": "Microsoft", "category": "NLP",
        "status": "Approved", "cost_tier": "Pay-per-use",
        "description": "Cloud-based NLP service for sentiment analysis, key phrase extraction, named entity recognition, and language detection.",
        "website": "https://azure.microsoft.com/en-us/products/ai-services/text-analytics",
        "doc_url": "https://learn.microsoft.com/en-us/azure/ai-services/language-service/",
    },
    {
        "id": "TECH-006", "name": "Google Natural Language API",
        "vendor": "Google Cloud", "category": "NLP",
        "status": "Approved", "cost_tier": "Pay-per-use",
        "description": "Provides natural language understanding including sentiment analysis, entity recognition, and syntax analysis.",
        "website": "https://cloud.google.com/natural-language",
        "doc_url": "https://cloud.google.com/natural-language/docs",
    },
    {
        "id": "TECH-007", "name": "AWS Translate",
        "vendor": "Amazon Web Services", "category": "Translation",
        "status": "Approved", "cost_tier": "Pay-per-use",
        "description": "Neural machine translation service delivering fast, high-quality, affordable, and customizable language translation.",
        "website": "https://aws.amazon.com/translate/",
        "doc_url": "https://docs.aws.amazon.com/translate/",
    },
    {
        "id": "TECH-008", "name": "Azure Translator",
        "vendor": "Microsoft", "category": "Translation",
        "status": "Approved", "cost_tier": "Pay-per-use",
        "description": "Cloud-based machine translation service supporting real-time text translation across more than 100 languages.",
        "website": "https://azure.microsoft.com/en-us/products/ai-services/ai-translator",
        "doc_url": "https://learn.microsoft.com/en-us/azure/ai-services/translator/",
    },
    {
        "id": "TECH-009", "name": "Google Cloud Translation",
        "vendor": "Google Cloud", "category": "Translation",
        "status": "Approved", "cost_tier": "Pay-per-use",
        "description": "Dynamically translates text between thousands of language pairs using Google's neural machine translation.",
        "website": "https://cloud.google.com/translate",
        "doc_url": "https://cloud.google.com/translate/docs",
    },
    {
        "id": "TECH-010", "name": "AWS Bedrock",
        "vendor": "Amazon Web Services", "category": "Generative AI",
        "status": "Approved", "cost_tier": "Pay-per-use",
        "description": "Fully managed service providing access to foundation models from leading AI companies for generative AI applications.",
        "website": "https://aws.amazon.com/bedrock/",
        "doc_url": "https://docs.aws.amazon.com/bedrock/",
    },
    {
        "id": "TECH-011", "name": "Azure OpenAI Service",
        "vendor": "Microsoft", "category": "Generative AI",
        "status": "Approved", "cost_tier": "Pay-per-use",
        "description": "Provides REST API access to OpenAI's models including GPT-4, with enterprise security and compliance.",
        "website": "https://azure.microsoft.com/en-us/products/ai-services/openai-service",
        "doc_url": "https://learn.microsoft.com/en-us/azure/ai-services/openai/",
    },
    {
        "id": "TECH-012", "name": "Google Vertex AI",
        "vendor": "Google Cloud", "category": "Generative AI",
        "status": "Approved", "cost_tier": "Pay-per-use",
        "description": "Machine learning platform for training, deploying, and customizing ML models and AI applications including generative AI.",
        "website": "https://cloud.google.com/vertex-ai",
        "doc_url": "https://cloud.google.com/vertex-ai/docs",
    },
    {
        "id": "TECH-013", "name": "Google AutoML",
        "vendor": "Google Cloud", "category": "AutoML",
        "status": "Approved", "cost_tier": "Pay-per-use",
        "description": "Suite of machine learning products enabling developers with limited ML expertise to train high-quality custom models.",
        "website": "https://cloud.google.com/automl",
        "doc_url": "https://cloud.google.com/automl/docs",
    },
]

# Build lookup by name for linking SBBs to technologies
_TECH_BY_NAME = {t["name"]: t["id"] for t in TECHNOLOGIES}


# ---------------------------------------------------------------------------
# ABBs (Architecture Building Blocks)
# ---------------------------------------------------------------------------
ABBS = [
    {
        "id": "ABB-KR-002",
        "name": "Document Intelligence",
        "type": "ABB",
        "category": "kr",
        "status": "ACTIVE",
        "version": "1.0.0",
        "description": "Provides capability for automated extraction of structured data from unstructured and semi-structured documents including PDFs, images, and scanned forms.",
        "tags": ["document-processing", "ocr", "data-extraction", "content-intelligence"],
        "functionality": (
            "Document Intelligence enables the enterprise to automatically process, classify, and extract information "
            "from a wide variety of document types. Core capabilities include:\n\n"
            "- **Text Extraction**: OCR and handwriting recognition from scanned documents and images\n"
            "- **Table Extraction**: Structured data extraction from tables within documents\n"
            "- **Form Processing**: Key-value pair extraction from standardized forms\n"
            "- **Document Classification**: Automatic categorization of document types\n"
            "- **Entity Extraction**: Identification of named entities within document text\n"
            "- **Layout Analysis**: Understanding document structure and spatial relationships"
        ),
        "inbound_interfaces": (
            "- Document Upload API (REST): Accepts PDF, PNG, JPEG, TIFF formats\n"
            "- Batch Processing Queue: Async processing via message queue\n"
            "- S3/Blob Trigger: Event-driven processing on document arrival"
        ),
        "outbound_interfaces": (
            "- Extracted Data API (REST/JSON): Structured extraction results\n"
            "- Webhook Notifications: Processing completion callbacks\n"
            "- Event Stream: Real-time extraction events for downstream consumers"
        ),
        "quality_attributes": (
            "- Accuracy: >95% text extraction accuracy for printed documents\n"
            "- Latency: <5 seconds for single-page document processing\n"
            "- Throughput: Support for 1000+ documents/hour in batch mode\n"
            "- Availability: 99.9% uptime SLA\n"
            "- Security: Encryption at rest and in transit, data residency compliance"
        ),
        "restrictions": "Documents must not exceed 50MB. Maximum 500 pages per document in batch mode.",
    },
    {
        "id": "ABB-KR-003",
        "name": "Text Understanding / NLP",
        "type": "ABB",
        "category": "kr",
        "status": "ACTIVE",
        "version": "1.0.0",
        "description": "Provides natural language processing capabilities for analyzing, understanding, and extracting insights from unstructured text content.",
        "tags": ["nlp", "text-analytics", "sentiment-analysis", "entity-recognition", "content-intelligence"],
        "functionality": (
            "Text Understanding enables the enterprise to derive meaning and structure from unstructured text. "
            "Core capabilities include:\n\n"
            "- **Sentiment Analysis**: Determine emotional tone (positive, negative, neutral, mixed)\n"
            "- **Named Entity Recognition (NER)**: Identify people, organizations, locations, dates, amounts\n"
            "- **Key Phrase Extraction**: Identify the most relevant phrases and topics\n"
            "- **Language Detection**: Automatically detect the language of input text\n"
            "- **Syntax Analysis**: Part-of-speech tagging and dependency parsing\n"
            "- **Topic Modeling**: Discover abstract topics within document collections"
        ),
        "inbound_interfaces": (
            "- Text Analysis API (REST): Accepts plain text or rich text input\n"
            "- Batch Analysis Endpoint: Bulk text processing\n"
            "- Streaming API: Real-time text analysis for chat/messaging"
        ),
        "outbound_interfaces": (
            "- Analysis Results API (REST/JSON): Structured NLP results\n"
            "- Enrichment Pipeline: Annotated text with entity/sentiment metadata\n"
            "- Analytics Dashboard Feed: Aggregated insights for visualization"
        ),
        "quality_attributes": (
            "- Accuracy: >90% F1 score for entity recognition across supported languages\n"
            "- Latency: <200ms for single-document sentiment and NER\n"
            "- Languages: Support for 25+ languages\n"
            "- Scalability: Auto-scaling to handle burst workloads"
        ),
        "restrictions": "Input text limited to 100KB per request. Custom model training requires minimum 200 labeled examples.",
    },
    {
        "id": "ABB-KR-004",
        "name": "Translation & Localization",
        "type": "ABB",
        "category": "kr",
        "status": "ACTIVE",
        "version": "1.0.0",
        "description": "Provides machine translation and content localization capabilities for multi-language support across enterprise applications.",
        "tags": ["translation", "localization", "multilingual", "i18n", "content-intelligence"],
        "functionality": (
            "Translation & Localization enables the enterprise to operate across language boundaries. "
            "Core capabilities include:\n\n"
            "- **Real-time Translation**: Instant text translation between language pairs\n"
            "- **Document Translation**: Full document translation preserving formatting\n"
            "- **Custom Terminology**: Domain-specific glossaries and translation memory\n"
            "- **Language Detection**: Auto-detect source language before translation\n"
            "- **Batch Translation**: High-volume asynchronous translation jobs\n"
            "- **Quality Estimation**: Confidence scores for translation output"
        ),
        "inbound_interfaces": (
            "- Translation API (REST): Text or document input with source/target language\n"
            "- Batch Translation Queue: Async processing for large volumes\n"
            "- Glossary Management API: CRUD for custom terminology dictionaries"
        ),
        "outbound_interfaces": (
            "- Translated Content API (REST/JSON): Translated text with metadata\n"
            "- Callback URL: Notification when batch jobs complete\n"
            "- TMX Export: Translation memory exchange format for portability"
        ),
        "quality_attributes": (
            "- Quality: BLEU score >40 for major language pairs\n"
            "- Latency: <500ms for text under 5000 characters\n"
            "- Languages: 100+ language pairs supported\n"
            "- Customization: Domain adaptation improves quality by 15-30%"
        ),
        "restrictions": "Custom glossary limited to 10,000 entries. Real-time translation limited to 10,000 characters per request.",
    },
    {
        "id": "ABB-KR-005",
        "name": "Content Classification",
        "type": "ABB",
        "category": "kr",
        "status": "ACTIVE",
        "version": "1.0.0",
        "description": "Provides automated content categorization and labeling capabilities using machine learning for organizing and routing enterprise content.",
        "tags": ["classification", "categorization", "taxonomy", "content-routing", "content-intelligence"],
        "functionality": (
            "Content Classification enables automated organization and routing of enterprise content. "
            "Core capabilities include:\n\n"
            "- **Text Classification**: Assign predefined categories/labels to text content\n"
            "- **Multi-label Classification**: Apply multiple relevant labels simultaneously\n"
            "- **Custom Classifiers**: Train domain-specific classification models\n"
            "- **Hierarchical Taxonomy**: Support for nested category hierarchies\n"
            "- **Confidence Scoring**: Probability scores for each classification\n"
            "- **Active Learning**: Iterative model improvement from human feedback"
        ),
        "inbound_interfaces": (
            "- Classification API (REST): Text input with optional model/taxonomy selection\n"
            "- Training Data API: Upload labeled examples for custom model training\n"
            "- Taxonomy Management API: CRUD for classification hierarchies"
        ),
        "outbound_interfaces": (
            "- Classification Results API (REST/JSON): Labels with confidence scores\n"
            "- Content Routing Events: Trigger downstream workflows based on classification\n"
            "- Model Metrics API: Training/evaluation metrics for monitoring"
        ),
        "quality_attributes": (
            "- Accuracy: >85% accuracy for custom models with 500+ training examples\n"
            "- Latency: <100ms for single-document classification\n"
            "- Scalability: Support for 1000+ categories in taxonomy\n"
            "- Retraining: Incremental learning without full model rebuild"
        ),
        "restrictions": "Custom model training requires minimum 100 labeled examples per category. Maximum 5000 categories per taxonomy.",
    },
    {
        "id": "ABB-KR-006",
        "name": "Summarization",
        "type": "ABB",
        "category": "kr",
        "status": "ACTIVE",
        "version": "1.0.0",
        "description": "Provides AI-powered text summarization capabilities for condensing long documents, articles, and conversations into concise summaries.",
        "tags": ["summarization", "generative-ai", "content-condensation", "content-intelligence"],
        "functionality": (
            "Summarization enables the enterprise to efficiently consume large volumes of text content. "
            "Core capabilities include:\n\n"
            "- **Extractive Summarization**: Select and compose key sentences from source text\n"
            "- **Abstractive Summarization**: Generate novel summary text using generative AI\n"
            "- **Configurable Length**: Control output length (short, medium, detailed)\n"
            "- **Multi-document Summarization**: Synthesize across multiple related documents\n"
            "- **Conversation Summarization**: Condense chat/meeting transcripts\n"
            "- **Domain-aware Summaries**: Customizable for legal, medical, financial domains"
        ),
        "inbound_interfaces": (
            "- Summarization API (REST): Text input with length/style parameters\n"
            "- Document Upload: Full document summarization from file upload\n"
            "- Batch Summarization: Queue-based processing for multiple documents"
        ),
        "outbound_interfaces": (
            "- Summary API (REST/JSON): Generated summary with metadata\n"
            "- Key Points API: Bullet-point extraction from summaries\n"
            "- Webhook: Notification when batch summarization completes"
        ),
        "quality_attributes": (
            "- Quality: ROUGE-L score >0.4 for abstractive summaries\n"
            "- Latency: <3 seconds for documents under 10,000 words\n"
            "- Coherence: Summaries maintain factual consistency with source\n"
            "- Flexibility: Adjustable compression ratio from 10% to 50%"
        ),
        "restrictions": "Maximum input length of 100,000 tokens. Abstractive summarization requires LLM provider API key configuration.",
    },
]


# ---------------------------------------------------------------------------
# SBBs (Solution Building Blocks)
# ---------------------------------------------------------------------------
def _sbb(sbb_id, name, abb_parent_id, tech_name, vendor, description, specific_functionality, tags):
    """Helper to create an SBB dict with standard fields and proper relationships."""
    tech_id = _TECH_BY_NAME.get(tech_name, "")
    relationships = [
        {"type": "IMPLEMENTS", "target_id": abb_parent_id},
    ]
    if tech_id:
        relationships.append({"type": "USES", "target_id": tech_id})
    return {
        "id": sbb_id,
        "name": name,
        "type": "SBB",
        "category": "kr",
        "status": "ACTIVE",
        "version": "1.0.0",
        "description": description,
        "tags": tags,
        "specific_functionality": specific_functionality,
        "inbound_interfaces": "REST API (HTTPS/JSON), SDK client libraries, CLI tools",
        "outbound_interfaces": "JSON response payloads, webhook callbacks, event notifications",
        "vendor": vendor,
        "deployment_model": "Cloud SaaS",
        "cost_tier": "Pay-per-use",
        "licensing": "Commercial — cloud consumption pricing",
        "maturity": "GA (Generally Available)",
        "restrictions": f"Requires {vendor} cloud account and appropriate IAM permissions.",
        "relationships": relationships,
    }


SBBS = [
    # --- Document Intelligence SBBs ---
    _sbb(
        "SBB-KR-002", "AWS Textract", "ABB-KR-002", "AWS Textract",
        "Amazon Web Services",
        "AWS implementation of Document Intelligence using Amazon Textract for OCR, form processing, and table extraction from documents.",
        (
            "- Detect and extract text from scanned documents using deep learning\n"
            "- Extract structured data from forms (key-value pairs)\n"
            "- Parse tables with row/column structure preservation\n"
            "- Analyze lending documents (paystubs, bank statements)\n"
            "- Identity document analysis (passports, driver licenses)\n"
            "- Expense receipt analysis with line-item extraction"
        ),
        ["aws", "textract", "ocr", "document-processing"],
    ),
    _sbb(
        "SBB-KR-003", "Azure Document Intelligence", "ABB-KR-002", "Azure Document Intelligence",
        "Microsoft",
        "Azure implementation of Document Intelligence using Azure AI Document Intelligence for layout analysis, custom model training, and prebuilt document models.",
        (
            "- Layout analysis with reading order detection\n"
            "- Prebuilt models for invoices, receipts, identity documents\n"
            "- Custom model training with labeled data\n"
            "- Composed models combining multiple custom models\n"
            "- Add-on capabilities: formulas, font properties, barcodes\n"
            "- Document classification with split/classify capabilities"
        ),
        ["azure", "document-intelligence", "ocr", "document-processing"],
    ),
    _sbb(
        "SBB-KR-004", "Google Document AI", "ABB-KR-002", "Google Document AI",
        "Google Cloud",
        "Google Cloud implementation of Document Intelligence using Document AI for specialized document processing with pre-trained and custom processors.",
        (
            "- General document OCR with high-accuracy text extraction\n"
            "- Specialized processors for invoices, contracts, tax forms\n"
            "- Custom Document Extractor for domain-specific documents\n"
            "- Document splitter and classifier processors\n"
            "- Human-in-the-loop review for quality assurance\n"
            "- Warehouse API for large-scale document management"
        ),
        ["gcp", "document-ai", "ocr", "document-processing"],
    ),

    # --- Text Understanding / NLP SBBs ---
    _sbb(
        "SBB-KR-005", "AWS Comprehend", "ABB-KR-003", "AWS Comprehend",
        "Amazon Web Services",
        "AWS implementation of Text Understanding using Amazon Comprehend for NLP tasks including sentiment, entities, key phrases, and custom classification.",
        (
            "- Sentiment analysis (positive, negative, neutral, mixed)\n"
            "- Entity recognition for standard and custom entity types\n"
            "- Key phrase extraction from documents\n"
            "- Language detection for 100+ languages\n"
            "- PII detection and redaction\n"
            "- Custom classification and entity recognition training"
        ),
        ["aws", "comprehend", "nlp", "text-analytics"],
    ),
    _sbb(
        "SBB-KR-006", "Azure Text Analytics", "ABB-KR-003", "Azure Text Analytics",
        "Microsoft",
        "Azure implementation of Text Understanding using Azure AI Language service for sentiment, NER, key phrase extraction, and custom text analysis.",
        (
            "- Multi-language sentiment analysis with opinion mining\n"
            "- Named entity recognition and linking to knowledge bases\n"
            "- Key phrase extraction and abstractive summarization\n"
            "- Custom text classification (single/multi-label)\n"
            "- Custom NER with labeled training data\n"
            "- Healthcare NER with FHIR-compatible output"
        ),
        ["azure", "text-analytics", "nlp", "language-service"],
    ),
    _sbb(
        "SBB-KR-007", "Google Natural Language API", "ABB-KR-003", "Google Natural Language API",
        "Google Cloud",
        "Google Cloud implementation of Text Understanding using Cloud Natural Language API for syntax analysis, entity recognition, and content classification.",
        (
            "- Sentiment analysis at document and sentence level\n"
            "- Entity recognition with salience scoring\n"
            "- Syntax analysis with dependency parse trees\n"
            "- Content classification into 1000+ categories\n"
            "- Entity sentiment analysis (sentiment per entity)\n"
            "- Custom AutoML text classification models"
        ),
        ["gcp", "natural-language", "nlp", "text-analytics"],
    ),

    # --- Translation & Localization SBBs ---
    _sbb(
        "SBB-KR-008", "AWS Translate", "ABB-KR-004", "AWS Translate",
        "Amazon Web Services",
        "AWS implementation of Translation & Localization using Amazon Translate for neural machine translation with custom terminology support.",
        (
            "- Neural machine translation for 75+ language pairs\n"
            "- Real-time and batch translation modes\n"
            "- Custom terminology for domain-specific translations\n"
            "- Parallel data for adaptive custom translation\n"
            "- Profanity masking in translation output\n"
            "- Formality setting (formal/informal) for supported languages"
        ),
        ["aws", "translate", "translation", "localization"],
    ),
    _sbb(
        "SBB-KR-009", "Azure Translator", "ABB-KR-004", "Azure Translator",
        "Microsoft",
        "Azure implementation of Translation & Localization using Azure AI Translator for text translation, transliteration, and custom model training.",
        (
            "- Text translation across 130+ languages and dialects\n"
            "- Document translation preserving original formatting\n"
            "- Custom Translator for domain-adapted models\n"
            "- Transliteration between scripts\n"
            "- Dictionary lookup with alternative translations\n"
            "- Language detection and script identification"
        ),
        ["azure", "translator", "translation", "localization"],
    ),
    _sbb(
        "SBB-KR-010", "Google Cloud Translation", "ABB-KR-004", "Google Cloud Translation",
        "Google Cloud",
        "Google Cloud implementation of Translation & Localization using Cloud Translation API for dynamic text translation with AutoML custom models.",
        (
            "- Translation API (Basic): Simple text translation\n"
            "- Translation API (Advanced): Glossaries, batch, model selection\n"
            "- AutoML Translation for custom domain models\n"
            "- Adaptive translation with real-time quality improvement\n"
            "- Media translation for audio content\n"
            "- Romanization for non-Latin scripts"
        ),
        ["gcp", "cloud-translation", "translation", "localization"],
    ),

    # --- Content Classification SBBs ---
    _sbb(
        "SBB-KR-011", "AWS Comprehend Custom Classifier", "ABB-KR-005", "AWS Comprehend",
        "Amazon Web Services",
        "AWS implementation of Content Classification using Amazon Comprehend custom classification for training and deploying domain-specific text classifiers.",
        (
            "- Custom multi-class text classification\n"
            "- Custom multi-label classification\n"
            "- Real-time classification endpoints\n"
            "- Asynchronous batch classification jobs\n"
            "- Model versioning and A/B testing\n"
            "- Flywheel for continuous model improvement"
        ),
        ["aws", "comprehend", "classification", "custom-ml"],
    ),
    _sbb(
        "SBB-KR-012", "Azure Custom Text Classification", "ABB-KR-005", "Azure Text Analytics",
        "Microsoft",
        "Azure implementation of Content Classification using Azure AI Language custom text classification for single-label and multi-label document categorization.",
        (
            "- Single-label custom classification\n"
            "- Multi-label custom classification\n"
            "- Built-in evaluation metrics (precision, recall, F1)\n"
            "- Incremental training with new labeled data\n"
            "- Deployment slots for staging and production\n"
            "- Integration with Azure AI Studio for labeling"
        ),
        ["azure", "custom-classification", "text-analytics", "ml"],
    ),
    _sbb(
        "SBB-KR-013", "Google AutoML Text", "ABB-KR-005", "Google AutoML",
        "Google Cloud",
        "Google Cloud implementation of Content Classification using AutoML Natural Language for custom text classification with minimal ML expertise.",
        (
            "- Single-label and multi-label classification\n"
            "- Automated model architecture search\n"
            "- Built-in data augmentation and preprocessing\n"
            "- One-click model deployment to endpoints\n"
            "- Model evaluation with confusion matrix\n"
            "- Export models for edge deployment"
        ),
        ["gcp", "automl", "classification", "custom-ml"],
    ),

    # --- Summarization SBBs ---
    _sbb(
        "SBB-KR-014", "AWS Bedrock Summarization", "ABB-KR-006", "AWS Bedrock",
        "Amazon Web Services",
        "AWS implementation of Summarization using Amazon Bedrock foundation models for abstractive text summarization with enterprise guardrails.",
        (
            "- Abstractive summarization via Claude, Titan, and other FMs\n"
            "- Configurable output length and style\n"
            "- Guardrails for content filtering and safety\n"
            "- Knowledge base integration for grounded summaries\n"
            "- Batch inference for high-volume summarization\n"
            "- Prompt engineering templates for domain-specific summaries"
        ),
        ["aws", "bedrock", "summarization", "generative-ai"],
    ),
    _sbb(
        "SBB-KR-015", "Azure OpenAI Summarizer", "ABB-KR-006", "Azure OpenAI Service",
        "Microsoft",
        "Azure implementation of Summarization using Azure OpenAI Service GPT models for extractive and abstractive text summarization.",
        (
            "- GPT-4 based abstractive summarization\n"
            "- Configurable system prompts for domain adaptation\n"
            "- Azure AI Language extractive summarization\n"
            "- Conversation summarization for meeting transcripts\n"
            "- Content safety filtering via Azure AI Content Safety\n"
            "- Fine-tuned models for specialized summarization"
        ),
        ["azure", "openai", "summarization", "generative-ai"],
    ),
    _sbb(
        "SBB-KR-016", "Google Vertex AI Summarization", "ABB-KR-006", "Google Vertex AI",
        "Google Cloud",
        "Google Cloud implementation of Summarization using Vertex AI Gemini models for multi-modal summarization with grounding capabilities.",
        (
            "- Gemini-based abstractive summarization\n"
            "- Multi-modal summarization (text + images)\n"
            "- Grounding with Google Search or custom data\n"
            "- Tuned model endpoints for domain-specific summaries\n"
            "- Evaluation pipelines with ROUGE metrics\n"
            "- Responsible AI filters and safety settings"
        ),
        ["gcp", "vertex-ai", "summarization", "generative-ai"],
    ),
]


# ---------------------------------------------------------------------------
# PBC (Platform Business Capability)
# ---------------------------------------------------------------------------
PBC = {
    "id": "PBC-001",
    "name": "Content Intelligence",
    "description": (
        "The Content Intelligence capability encompasses all services and building blocks "
        "that enable the enterprise to automatically understand, process, classify, translate, "
        "and summarize unstructured content. It provides the foundational AI/ML services that "
        "turn raw documents and text into structured, actionable information."
    ),
    "status": "ACTIVE",
    "abb_ids": [abb["id"] for abb in ABBS],
}


# ---------------------------------------------------------------------------
# Team
# ---------------------------------------------------------------------------
TEAM = {
    "id": _uid(),
    "name": "Architecture Team",
    "description": "Enterprise architecture team responsible for defining and governing technology patterns.",
}


# ---------------------------------------------------------------------------
# Category (just the kr category for this sample)
# ---------------------------------------------------------------------------
CATEGORIES = [
    {"code": "kr", "label": "Knowledge & Retrieval", "prefix": "KR"},
]


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

def get_sample_data() -> str:
    """Return sample data as a JSON string in the ImportService-compatible format."""
    data = {
        "meta": {
            "export_date": NOW,
            "version": "1.3",
            "name": "Sample Data — Content Intelligence",
        },
        "categories": CATEGORIES,
        "teams": [TEAM],
        "patterns": ABBS + SBBS,
        "technologies": TECHNOLOGIES,
        "pbcs": [PBC],
        "users": [],
        "settings": [],
    }
    return json.dumps(data, indent=2, default=str)


def _is_db_initialized(db: Neo4jService) -> bool:
    """Check if the database has been initialized (first boot already ran)."""
    with db.session() as session:
        result = session.run(
            "MATCH (c:SystemConfig {key: 'db_initialized'}) RETURN c.value AS v"
        ).single()
        return result is not None and result["v"] == "true"


def mark_db_initialized(db: Neo4jService):
    """Set a flag so seed_if_empty won't re-seed on hot-reload after reset-empty."""
    with db.session() as session:
        session.run(
            "MERGE (c:SystemConfig {key: 'db_initialized'}) "
            "SET c.value = 'true'"
        )


def seed_if_empty(db: Neo4jService):
    """
    On first boot, if the database has no patterns AND has not been
    initialized before, seed with sample data.
    This is called from main.py during startup.
    """
    # If db_initialized flag exists, someone already ran a reset or first-boot seed
    if _is_db_initialized(db):
        logger.info("Database already initialized — skipping sample data seed")
        return

    with db.session() as session:
        count = session.run("MATCH (p:Pattern) RETURN count(p) AS cnt").single()["cnt"]

    if count > 0:
        logger.info(f"Database already has {count} patterns — skipping sample data seed")
        mark_db_initialized(db)
        return

    logger.info("Empty database detected — seeding sample Content Intelligence data...")
    from services.import_service import ImportService
    importer = ImportService(db)
    stats = importer.import_from_json(get_sample_data())
    logger.info(
        f"Sample data seeded: "
        f"{stats.get('patterns_imported', 0)} patterns, "
        f"{stats.get('technologies_imported', 0)} technologies, "
        f"{stats.get('pbcs_imported', 0)} PBCs, "
        f"{stats.get('relationships_imported', 0)} relationships"
    )
    mark_db_initialized(db)
