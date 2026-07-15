from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from contextlib import asynccontextmanager

from app.core.config import get_settings
from app.core.scheduler import create_scheduler
from app.api.routes.api import router

settings = get_settings()


@asynccontextmanager
async def lifespan(app: FastAPI):
    scheduler = create_scheduler()
    scheduler.start()
    print(f"[app] Poller started — interval: {settings.poll_interval_minutes} min")
    yield
    scheduler.shutdown()
    print("[app] Poller stopped")


app = FastAPI(
    title="Smart Regression Selector",
    description="POC — intelligently selects regression tests based on commit changes",
    version="1.0.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[settings.frontend_url],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(router, prefix="/api")


@app.get("/health")
async def health():
    return {"status": "ok"}
