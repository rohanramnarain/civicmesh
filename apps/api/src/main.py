from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from src.config.settings import get_settings
from src.routes.ask import router as ask_router
from src.routes.compute import router as compute_router
from src.routes.datasets import router as datasets_router
from src.routes.embeddings import router as embeddings_router
from src.routes.featured import router as featured_router
from src.routes.health import router as health_router
from src.routes.ingest import router as ingest_router
from src.routes.jobs import router as jobs_router
from src.routes.runs import router as runs_router

settings = get_settings()

app = FastAPI(
    title="CivicGrid NYC API",
    version="0.1.0",
    description="Local-first civic intelligence API for NYC Open Data.",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[origin.strip() for origin in settings.cors_allow_origins.split(",") if origin.strip()],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(health_router)
app.include_router(ask_router)
app.include_router(ingest_router)
app.include_router(datasets_router)
app.include_router(featured_router)
app.include_router(jobs_router)
app.include_router(embeddings_router)
app.include_router(compute_router)
app.include_router(runs_router)


@app.get("/", tags=["root"])
def root() -> dict[str, str]:
    return {
        "name": "civicmesh-nyc",
        "env": settings.api_env,
        "message": "API is up. Next: ingestion, retrieval, planning, and verification routes.",
    }
