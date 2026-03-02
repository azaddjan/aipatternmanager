# Contributing to AI Architecture Pattern Manager

Thank you for your interest in contributing! This guide will help you get started.

## Getting Started

### Prerequisites

- [Docker](https://docs.docker.com/get-docker/) and Docker Compose
- [Node.js 20+](https://nodejs.org/) (for frontend development outside Docker)
- [Python 3.11+](https://www.python.org/) (for backend development outside Docker)
- At least one LLM API key (Anthropic, OpenAI, or AWS Bedrock) for AI features

### Development Setup

1. Fork and clone the repository:
   ```bash
   git clone https://github.com/<your-username>/aipatternmanager.git
   cd aipatternmanager
   ```

2. Copy the environment template and add your API keys:
   ```bash
   cp .env.example .env
   # Edit .env with your API keys and preferred settings
   ```

3. Start all services:
   ```bash
   docker compose up -d --build
   ```

4. Access the app at `http://localhost:5173`

### Project Structure

```
backend/           # FastAPI backend (Python)
  services/        # Business logic services
  models/          # Pydantic schemas
  prompts.yaml     # All LLM prompt templates
frontend/          # React + Vite frontend
  src/components/  # Reusable UI components
  src/pages/       # Page-level components
  src/api/         # API client
docker-compose.yml # Container orchestration
```

## How to Contribute

### Reporting Bugs

- Open an issue with a clear title and description
- Include steps to reproduce the bug
- Include browser/OS information if relevant
- Attach screenshots or error logs if available

### Suggesting Features

- Open an issue with the `enhancement` label
- Describe the use case and expected behavior
- Explain how it fits within the ABB/SBB/PBC framework if applicable

### Submitting Changes

1. Create a feature branch from `main`:
   ```bash
   git checkout -b feature/your-feature-name
   ```

2. Make your changes following the code style guidelines below

3. Test your changes:
   - Verify the frontend builds without errors
   - Verify the backend starts without errors
   - Test the feature manually through the UI

4. Commit with a descriptive message:
   ```bash
   git commit -m "Add feature: brief description of what and why"
   ```

5. Push and open a Pull Request against `main`

## Code Style

### Frontend (React/JavaScript)

- Functional components with hooks
- Tailwind CSS for styling (dark theme)
- Component files in PascalCase (e.g., `PatternEditor.jsx`)
- API calls centralized in `frontend/src/api/client.js`

### Backend (Python/FastAPI)

- Type hints on all function signatures
- Pydantic models for request/response schemas
- Services in `backend/services/` for business logic
- Routes in `backend/routes/` for API endpoints
- LLM prompts in `backend/prompts.yaml` (not hardcoded in Python)

### General

- No hardcoded credentials or API keys
- Use environment variables for configuration
- Keep commits focused and atomic

## Architecture Guidelines

This project follows the **TOGAF ABB/SBB framework** with Gartner PBC extensions:

- **ABB** (Architecture Building Block) — Vendor-neutral capability
- **SBB** (Solution Building Block) — Vendor-specific implementation
- **PBC** (Packaged Business Capability) — Business-consumable service
- **Technology** — Vendor products mapped to SBBs

When adding new features, consider how they fit within this pattern hierarchy and the Neo4j graph model.

## Questions?

Open an issue with the `question` label and we'll be happy to help.
