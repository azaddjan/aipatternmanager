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
- **Graph Visualization** — Interactive vis-network graph with always-visible collapsible detail sidebar, node search, type/category filtering, and double-click navigation
- **AI Authoring** — Generate and enrich patterns using LLM providers (Anthropic, OpenAI, AWS Bedrock, Ollama)
- **Pattern Discovery** — AI-powered discovery of missing patterns in the architecture
- **Pattern Health Dashboard** — Four-dimension health scoring (Completeness, Relationships, Coverage, Problems) with weighted overall score, per-pattern drill-down, and trend tracking
- **AI Deep Analysis** — LLM-powered 9-area semantic analysis of the entire pattern library covering architecture coherence, ABB↔SBB alignment, interface consistency, business capability gaps, vendor risk, content quality, cross-pattern overlap, PBC composition, and maturity roadmap
- **Pattern Advisor** — AI-powered contextual advice for individual patterns with exportable reports (HTML & Word)
- **Multi-format Export** — Export the full catalogue as:
  - Self-contained HTML (offline viewable, collapsible sidebar, embedded diagrams)
  - PowerPoint (dark navy theme, 30-slide deck with category deep-dives)
  - Word Document (cover page, TOC, page numbers, structured content)
  - JSON backup (full data export for backup/restore)
- **Import/Restore** — Import patterns from JSON backup files with automatic database backup before restore
- **Technology Registry** — Track vendor products, map them to SBBs, manage lifecycle status
- **PBC Management** — Define business capabilities composed of ABBs
- **Impact Analysis** — Understand ripple effects of changing a pattern

## Quick Start

### Prerequisites

- [Docker](https://docs.docker.com/get-docker/) and Docker Compose

### Option 1: Using Pre-built Images (Recommended)

No need to clone the repo — just create two files and run:

1. Download `docker-compose.yml` and `.env.example` from the repository, or create a `docker-compose.yml`:
   ```bash
   curl -O https://raw.githubusercontent.com/azaddjan/aipatternmanager/main/docker-compose.yml
   curl -O https://raw.githubusercontent.com/azaddjan/aipatternmanager/main/.env.example
   cp .env.example .env
   ```

2. Edit `.env` and add your API keys:
   ```env
   ANTHROPIC_API_KEY=sk-ant-your-key-here
   OPENAI_API_KEY=sk-your-key-here
   DEFAULT_LLM_PROVIDER=anthropic
   ```

3. Start the stack:
   ```bash
   docker compose up -d
   ```

4. Open the app at **http://localhost:5173**

Docker will pull the images automatically from Docker Hub:
- `azaddjan/aipatternmanager-backend:0.9.0`
- `azaddjan/aipatternmanager-frontend:0.9.0`

### Option 2: Build from Source

1. Clone the repository:
   ```bash
   git clone https://github.com/azaddjan/aipatternmanager.git
   cd aipatternmanager
   ```

2. Create a `.env` file from the example:
   ```bash
   cp .env.example .env
   ```
   Edit `.env` and add your API keys:
   ```env
   ANTHROPIC_API_KEY=sk-ant-your-key-here
   OPENAI_API_KEY=sk-your-key-here
   DEFAULT_LLM_PROVIDER=anthropic
   ```

3. Build and start:
   ```bash
   docker compose up -d --build
   ```
   > The `docker-compose.override.yml` file is automatically loaded, enabling live-reload and source code mounting for development.

4. Open the app at **http://localhost:5173**

The database creates constraints, indexes, and built-in categories on first startup.

## Authentication & Authorization

The platform includes a full role-based access control system with JWT authentication and team-based pattern ownership.

### Default Admin Credentials

On first startup, an admin user is automatically seeded:

| Field | Default Value |
|-------|---------------|
| **Email** | `admin@patternmanager.local` |
| **Password** | `admin123` |

> **Important:** Change the default admin password immediately after first login via the Admin > Users management page.

### Environment Variables

Configure authentication via environment variables in `.env` or `docker-compose.yml`:

```env
JWT_SECRET=change-me-in-production       # Secret key for signing JWT tokens
ADMIN_EMAIL=admin@patternmanager.local   # Initial admin user email
ADMIN_PASSWORD=admin123                  # Initial admin user password
```

### Roles

| Role | Permissions |
|------|-------------|
| **admin** | Full access to all patterns, users, teams, and settings |
| **team_member** | Create patterns (auto-assigned to their team), edit/delete own team's patterns, read all patterns |
| **viewer** | Read-only access to all patterns and data |

### Team-Based Ownership

- Each user belongs to one team
- Patterns created by a team member are automatically assigned to their team via `OWNED_BY` relationship
- Team members can only edit/delete patterns owned by their team
- Admins can edit/delete any pattern regardless of team ownership
- All users (including viewers) can read all patterns across teams

### Anonymous Access

Admins can toggle "Allow Anonymous Read Access" in the Admin > Configuration page. When enabled, unauthenticated users can browse patterns, the graph, and other read-only endpoints without logging in.

### Auth API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/auth/login` | Login with email/password, returns JWT tokens |
| POST | `/api/auth/refresh` | Refresh an expired access token |
| GET | `/api/auth/me` | Get current authenticated user |
| GET/POST | `/api/users` | List / create users (admin only) |
| GET/PUT/DELETE | `/api/users/{id}` | User CRUD (admin only) |
| GET/POST | `/api/teams` | List / create teams (admin only) |
| GET/PUT/DELETE | `/api/teams/{id}` | Team CRUD (admin only) |

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
│   ├── middleware/
│   │   └── dependencies.py      # FastAPI auth dependencies (JWT, roles)
│   ├── routers/
│   │   ├── auth.py              # Login, refresh, me endpoints
│   │   ├── users.py             # User management (admin only)
│   │   ├── teams.py             # Team management (admin only)
│   │   ├── patterns.py          # Pattern CRUD endpoints
│   │   ├── technologies.py      # Technology registry endpoints
│   │   ├── pbcs.py              # PBC management endpoints
│   │   ├── categories.py        # Category endpoints
│   │   ├── graph.py             # Graph query endpoints
│   │   ├── admin.py             # Settings, export, import, health analysis
│   │   ├── advisor.py           # Pattern advisor endpoints
│   │   ├── ai_authoring.py      # AI-powered pattern generation
│   │   └── discovery.py         # AI pattern discovery
│   ├── services/
│   │   ├── neo4j_service.py     # Neo4j database operations & health scoring
│   │   ├── auth_service.py      # JWT, passwords, user/team CRUD
│   │   ├── ai_service.py        # AI orchestration
│   │   ├── settings_service.py  # Configuration management (Neo4j-backed)
│   │   ├── discovery_service.py # Pattern gap analysis
│   │   ├── advisor_service.py   # Pattern advisor AI service
│   │   ├── embedding_service.py # Embedding generation for patterns
│   │   ├── backup_service.py    # Automatic database backup
│   │   ├── html_export_service.py   # Catalogue HTML export
│   │   ├── pptx_export_service.py   # Catalogue PowerPoint export
│   │   ├── docx_export_service.py   # Catalogue Word export
│   │   ├── import_service.py        # JSON import/export
│   │   ├── health_analysis_html_export_service.py  # Health analysis HTML report
│   │   ├── health_analysis_docx_export_service.py  # Health analysis Word report
│   │   ├── advisor_report_html_export_service.py   # Advisor report HTML export
│   │   ├── advisor_report_docx_export_service.py   # Advisor report Word export
│   │   └── llm/                 # LLM provider adapters
│   │       ├── base_provider.py
│   │       ├── provider_factory.py
│   │       ├── anthropic_provider.py
│   │       ├── openai_provider.py
│   │       ├── bedrock_provider.py
│   │       └── ollama_provider.py
│   ├── static/
│   │   ├── framework_diagram.png    # Framework diagram for exports
│   │   └── pptx_assets/             # Icon assets for PPTX slides
├── frontend/
│   ├── src/
│   │   ├── App.jsx              # Main app with routing & auth gate
│   │   ├── api/client.js        # Backend API client (with JWT auth)
│   │   ├── contexts/
│   │   │   └── AuthContext.jsx      # React auth state & token management
│   │   ├── components/
│   │   │   ├── Sidebar.jsx          # Navigation sidebar (role-based)
│   │   │   ├── GraphView.jsx        # vis-network graph with persistent detail sidebar
│   │   │   ├── PatternCard.jsx      # Pattern summary card
│   │   │   ├── MarkdownContent.jsx  # Markdown renderer for AI content
│   │   │   └── AutoLinkedText.jsx   # Auto-link pattern references
│   │   └── pages/
│   │       ├── Login.jsx            # Full-screen login page
│   │       ├── Dashboard.jsx        # Overview dashboard
│   │       ├── PatternList.jsx      # Pattern catalogue
│   │       ├── PatternEditor.jsx    # Pattern create/edit form
│   │       ├── PatternDetail.jsx    # Pattern detail view
│   │       ├── PatternHealth.jsx    # Health dashboard & AI deep analysis
│   │       ├── PatternAdvisor.jsx   # AI pattern advisor interface
│   │       ├── PatternDiscovery.jsx # AI discovery interface
│   │       ├── TechnologyRegistry.jsx
│   │       ├── TechnologyDetail.jsx
│   │       ├── PBCManager.jsx
│   │       ├── PBCDetail.jsx
│   │       ├── GraphExplorer.jsx    # Graph explorer with filters
│   │       ├── ImpactAnalysis.jsx
│   │       ├── Admin.jsx            # Settings, export, import
│   │       ├── UserManagement.jsx   # User admin page
│   │       └── TeamManagement.jsx   # Team admin page
│   ├── Dockerfile
│   ├── package.json
│   ├── vite.config.js
│   └── tailwind.config.js
├── docker-compose.yml              # Base stack (works standalone with Docker Hub images)
├── docker-compose.override.yml     # Dev overrides (live-reload, source mounts)
├── .env.example
└── .gitignore
```

## API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/health` | Health check with stats |
| POST | `/api/auth/login` | Login with email/password |
| POST | `/api/auth/refresh` | Refresh access token |
| GET | `/api/auth/me` | Get current user |
| GET/POST | `/api/users` | List / create users (admin) |
| GET/PUT/DELETE | `/api/users/{id}` | User CRUD (admin) |
| GET/POST | `/api/teams` | List / create teams (admin) |
| GET/PUT/DELETE | `/api/teams/{id}` | Team CRUD (admin) |
| GET/POST | `/api/patterns` | List / create patterns |
| GET/PUT/DELETE | `/api/patterns/{id}` | Pattern CRUD |
| GET/POST | `/api/technologies` | List / create technologies |
| GET/PUT/DELETE | `/api/technologies/{id}` | Technology CRUD |
| GET/POST | `/api/pbcs` | List / create PBCs |
| GET | `/api/categories` | List categories |
| GET | `/api/graph/full` | Full graph data |
| POST | `/api/ai/generate` | AI pattern generation |
| POST | `/api/discovery/analyze` | AI gap analysis |
| GET | `/api/admin/pattern-health` | Pattern health scores & metrics |
| POST | `/api/admin/pattern-health/analyze` | AI deep analysis (9-area) |
| GET | `/api/admin/pattern-health/export/html` | Export health analysis as HTML |
| GET | `/api/admin/pattern-health/export/docx` | Export health analysis as Word |
| POST | `/api/advisor/analyze/{id}` | AI advisor analysis for a pattern |
| GET | `/api/advisor/report/{id}/html` | Export advisor report as HTML |
| GET | `/api/advisor/report/{id}/docx` | Export advisor report as Word |
| GET | `/api/admin/export/html` | Export catalogue as HTML |
| GET | `/api/admin/export/pptx` | Export catalogue as PowerPoint |
| GET | `/api/admin/export/docx` | Export catalogue as Word |
| GET | `/api/admin/export/json` | Export catalogue as JSON backup |
| POST | `/api/admin/import` | Import from JSON backup |

## Export Formats

### HTML Export
Self-contained single-file HTML with collapsible sidebar navigation, embedded framework diagram, pattern level taxonomy, category overviews, and full pattern details. Viewable offline in any browser.

### PowerPoint Export
30-slide presentation with dark navy theme matching enterprise standards. Includes title slide, agenda, framework overview, category deep-dives with ABB/SBB breakdowns, architecture topology, dependency chain, guardrail mode selection, SBB swappability analysis, inventory tables, and closing summary.

### Word Export
Structured Word document with cover page, auto-updating table of contents, page numbers, patterns organized by category with metadata tables and structured fields.

### JSON Export
Complete data backup including all patterns, technologies, PBCs, categories, and relationships. Can be re-imported to restore the full dataset. Automatic backup is created before each import.

### Health Analysis Reports
Export the AI deep analysis results as self-contained HTML or Word documents, including executive summary, all 9 analysis areas with ratings and recommendations, maturity roadmap, and prioritized action plan.

### Advisor Reports
Export individual pattern advisor analysis as HTML or Word, including architecture alignment assessment, improvement recommendations, and relationship analysis.

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
