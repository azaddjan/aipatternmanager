# AI Architecture Pattern Manager

A composable enterprise AI architecture pattern management platform built on the **ABB / SBB / PBC framework** — combining TOGAF Architecture & Solution Building Blocks with Gartner Packaged Business Capabilities.

## Overview

This tool manages a catalogue of AI architecture patterns across multiple abstraction layers:

- **Architecture Blueprints (AB)** — Level 4 enterprise topology patterns (e.g., Segmented Platform Pattern)
- **Architecture Building Blocks (ABB)** — Level 3 vendor-neutral capability contracts (e.g., Prompt Engineering, Model Gateway)
- **Solution Building Blocks (SBB)** — Concrete vendor-specific implementations fulfilling ABB contracts
- **Packaged Business Capabilities (PBC)** — Business-consumable services bundling ABB/SBB combinations
- **Technologies** — Vendor products and services mapped to SBBs

Patterns are organized into categories: Core AI/LLM, Integration, Agents, Knowledge & Retrieval, Cross-Cutting, Platform Integration, and Architecture Topology.

## Architecture

| Component | Technology | Port |
|-----------|-----------|------|
| **Frontend** | React 18 + Vite + Tailwind CSS | 5173 |
| **Backend** | FastAPI (Python 3.11) | 8000 |
| **Database** | Neo4j 5 (Graph DB) | 7474 / 7687 |

### Key Features

- **Pattern CRUD** — Create, edit, and manage structured patterns with typed fields (intent, problem, solution, interfaces, invariants, etc.)
- **Graph Visualization** — Interactive vis-network graph showing pattern relationships (DEPENDS_ON, IMPLEMENTS, CONSUMED_BY)
- **AI Authoring** — Generate and enrich patterns using LLM providers (Anthropic, OpenAI, AWS Bedrock, Ollama)
- **Pattern Discovery** — AI-powered discovery of missing patterns in the architecture
- **Multi-format Export** — Export the full catalogue as:
  - Self-contained HTML (offline viewable, collapsible sidebar, embedded diagrams)
  - PowerPoint (dark navy theme, 30-slide deck with category deep-dives)
  - Word Document (cover page, TOC, page numbers, structured content)
  - JSON backup (full data export for backup/restore)
- **Import/Restore** — Import patterns from JSON backup files
- **Technology Registry** — Track vendor products, map them to SBBs, manage lifecycle status
- **PBC Management** — Define business capabilities composed of ABBs
- **Impact Analysis** — Understand ripple effects of changing a pattern

## Quick Start

### Prerequisites

- [Docker](https://docs.docker.com/get-docker/) and Docker Compose

### Setup

1. Clone the repository:
   ```bash
   git clone https://github.com/azaddjan/patterns.git
   cd patterns
   ```

2. Create a `.env` file from the example:
   ```bash
   cp .env.example .env
   ```
   Edit `.env` and add your API keys:
   ```env
   ANTHROPIC_API_KEY=sk-ant-your-key-here
   OPENAI_API_KEY=sk-your-key-here
   OLLAMA_BASE_URL=http://localhost:11434
   DEFAULT_LLM_PROVIDER=anthropic
   ```

3. Start the stack:
   ```bash
   docker compose up -d
   ```

4. Open the app:
   - **Frontend**: http://localhost:5173
   - **API docs**: http://localhost:8000/docs
   - **Neo4j Browser**: http://localhost:7474 (credentials: `neo4j` / `patternmanager2026`)

The database auto-seeds with built-in categories and seed patterns on first startup.

## Project Structure

```
.
├── backend/
│   ├── main.py                  # FastAPI application entry point
│   ├── requirements.txt         # Python dependencies
│   ├── Dockerfile
│   ├── prompts.yaml             # AI authoring prompt templates
│   ├── models/
│   │   └── schemas.py           # Pydantic request/response models
│   ├── routers/
│   │   ├── patterns.py          # Pattern CRUD endpoints
│   │   ├── technologies.py      # Technology registry endpoints
│   │   ├── pbcs.py              # PBC management endpoints
│   │   ├── categories.py        # Category endpoints
│   │   ├── graph.py             # Graph query endpoints
│   │   ├── admin.py             # Settings, export, import endpoints
│   │   ├── ai_authoring.py      # AI-powered pattern generation
│   │   └── discovery.py         # AI pattern discovery
│   ├── services/
│   │   ├── neo4j_service.py     # Neo4j database operations
│   │   ├── ai_service.py        # AI orchestration
│   │   ├── settings_service.py  # Configuration management
│   │   ├── seed_service.py      # Database seeding
│   │   ├── discovery_service.py # Pattern gap analysis
│   │   ├── html_export_service.py   # HTML export
│   │   ├── pptx_export_service.py   # PowerPoint export
│   │   ├── docx_export_service.py   # Word export
│   │   ├── import_service.py        # JSON import/export
│   │   └── llm/                 # LLM provider adapters
│   │       ├── anthropic_provider.py
│   │       ├── openai_provider.py
│   │       ├── bedrock_provider.py
│   │       └── ollama_provider.py
│   ├── static/
│   │   ├── framework_diagram.png    # Framework diagram for exports
│   │   └── pptx_assets/             # Icon assets for PPTX slides
│   └── seed_data/
│       └── patterns.json        # Initial pattern seed data
├── frontend/
│   ├── src/
│   │   ├── App.jsx              # Main app with routing
│   │   ├── api/client.js        # Backend API client
│   │   ├── components/
│   │   │   ├── Sidebar.jsx      # Navigation sidebar
│   │   │   ├── GraphView.jsx    # vis-network graph visualization
│   │   │   ├── PatternCard.jsx  # Pattern summary card
│   │   │   └── AutoLinkedText.jsx
│   │   └── pages/
│   │       ├── Dashboard.jsx        # Overview dashboard
│   │       ├── PatternList.jsx      # Pattern catalogue
│   │       ├── PatternEditor.jsx    # Pattern create/edit form
│   │       ├── PatternDetail.jsx    # Pattern detail view
│   │       ├── PatternDiscovery.jsx # AI discovery interface
│   │       ├── TechnologyRegistry.jsx
│   │       ├── TechnologyDetail.jsx
│   │       ├── PBCManager.jsx
│   │       ├── PBCDetail.jsx
│   │       ├── GraphExplorer.jsx
│   │       ├── ImpactAnalysis.jsx
│   │       └── Admin.jsx            # Settings, export, import
│   ├── Dockerfile
│   ├── package.json
│   ├── vite.config.js
│   └── tailwind.config.js
├── docker-compose.yml
├── .env.example
└── .gitignore
```

## API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/health` | Health check with stats |
| GET/POST | `/api/patterns` | List / create patterns |
| GET/PUT/DELETE | `/api/patterns/{id}` | Pattern CRUD |
| GET/POST | `/api/technologies` | List / create technologies |
| GET/POST | `/api/pbcs` | List / create PBCs |
| GET | `/api/categories` | List categories |
| GET | `/api/graph/full` | Full graph data |
| POST | `/api/ai/generate` | AI pattern generation |
| POST | `/api/discovery/analyze` | AI gap analysis |
| GET | `/api/admin/export/html` | Export as HTML |
| GET | `/api/admin/export/pptx` | Export as PowerPoint |
| GET | `/api/admin/export/docx` | Export as Word |
| GET | `/api/admin/export/json` | Export as JSON backup |
| POST | `/api/admin/import` | Import from JSON backup |

## Export Formats

### HTML Export
Self-contained single-file HTML with collapsible sidebar navigation, embedded framework diagram, pattern level taxonomy, category overviews, and full pattern details. Viewable offline in any browser.

### PowerPoint Export
30-slide presentation with dark navy theme matching enterprise standards. Includes title slide, agenda, framework overview, category deep-dives with ABB/SBB breakdowns, architecture topology, dependency chain, guardrail mode selection, SBB swappability analysis, inventory tables, and closing summary.

### Word Export
Structured Word document with cover page, auto-updating table of contents, page numbers, patterns organized by category with metadata tables and structured fields.

### JSON Export
Complete data backup including all patterns, technologies, PBCs, categories, and relationships. Can be re-imported to restore the full dataset.

## LLM Providers

The platform supports multiple LLM providers for AI-powered features:

| Provider | Models | Notes |
|----------|--------|-------|
| **Anthropic** | Claude Opus 4, Claude Sonnet 4 | Default provider |
| **OpenAI** | GPT-4o, GPT-4o-mini, o1-preview | |
| **AWS Bedrock** | Claude, Titan, Llama 3 | Requires AWS credentials |
| **Ollama** | Llama 3.x, Mistral, CodeLlama | Local/self-hosted |

Configure providers in the Admin > Configuration tab or via environment variables.

## License

MIT
