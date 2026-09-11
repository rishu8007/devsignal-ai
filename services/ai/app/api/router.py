from fastapi import APIRouter

from app.api.routes.generations import router as generations_router
from app.api.routes.health import router as health_router

router = APIRouter(prefix="/api/v1")
router.include_router(health_router)
router.include_router(generations_router)
