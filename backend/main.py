import logging
import os
import threading
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from services.neo4j_service import Neo4jService
from services.llm import get_available_providers
from services.embedding_service import EmbeddingService

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(name)s %(levelname)s %(message)s")
logger = logging.getLogger(__name__)

db_service: Neo4jService = None  # type: ignore


@asynccontextmanager
async def lifespan(app: FastAPI):
    global db_service
    logger.info("Starting AI Pattern Manager API...")

    # Initialize Neo4j
    db_service = Neo4jService()
    if db_service.verify_connectivity():
        logger.info("Neo4j connected successfully")
        db_service.create_constraints()
        db_service.create_indexes()
        # Create vector indexes for semantic search (safe to run every startup)
        try:
            svc = EmbeddingService()
            db_service.create_vector_indexes(svc.dimensions)
            logger.info(f"Vector indexes initialized ({svc.dimensions}d)")
        except Exception as e:
            logger.warning(f"Vector index creation skipped: {e}")
        # Auto-embed any nodes missing embeddings (background thread)
        def _startup_embed():
            try:
                svc = EmbeddingService()
                if svc.available:
                    svc.embed_missing_nodes(db_service)
            except Exception as e:
                logger.warning(f"Startup embedding skipped: {e}")
        threading.Thread(target=_startup_embed, daemon=True).start()
    else:
        logger.error("Neo4j connection failed -- running without database")

    yield

    # Shutdown
    if db_service:
        db_service.close()
        logger.info("Neo4j connection closed")


app = FastAPI(
    title="AI Pattern Manager",
    description="Architecture pattern management with Neo4j and AI authoring",
    version="1.0.0",
    lifespan=lifespan,
)

# CORS -- allow frontend dev server
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://localhost:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Register routers
from routers.patterns import router as patterns_router
from routers.technologies import router as technologies_router
from routers.graph import router as graph_router
from routers.ai_authoring import router as ai_router
from routers.categories import router as categories_router
from routers.pbcs import router as pbcs_router
from routers.admin import router as admin_router
from routers.discovery import router as discovery_router
from routers.advisor import router as advisor_router

app.include_router(patterns_router)
app.include_router(technologies_router)
app.include_router(graph_router)
app.include_router(ai_router)
app.include_router(categories_router)
app.include_router(pbcs_router)
app.include_router(admin_router)
app.include_router(discovery_router)
app.include_router(advisor_router)

# Serve uploaded images
UPLOAD_DIR = os.environ.get("UPLOAD_DIR", "/app/uploads")
os.makedirs(UPLOAD_DIR, exist_ok=True)
app.mount("/api/uploads", StaticFiles(directory=UPLOAD_DIR), name="uploads")


@app.get("/api/health", tags=["System"])
def health_check():
    neo4j_ok = db_service.verify_connectivity() if db_service else False
    providers = get_available_providers()
    return {
        "status": "healthy" if neo4j_ok else "degraded",
        "neo4j": "connected" if neo4j_ok else "disconnected",
        "llm_providers": providers,
        "pattern_count": db_service.count_patterns() if neo4j_ok else 0,
        "technology_count": db_service.count_technologies() if neo4j_ok else 0,
        "pbc_count": db_service.count_pbcs() if neo4j_ok else 0,
    }
