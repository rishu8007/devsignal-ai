from fastapi import APIRouter

from app.api.routes.generations import router as generations_router
from app.api.routes.health import router as health_router
from app.api.routes.indexings import router as indexings_router
from app.api.routes.research_briefs import router as research_briefs_router
from app.api.routes.research_retrievals import router as research_retrievals_router
from app.api.routes.retrievals import router as retrievals_router
from app.api.routes.topic_plans import router as topic_plans_router

router = APIRouter(prefix="/api/v1")
router.include_router(health_router)
router.include_router(generations_router)
router.include_router(indexings_router)
router.include_router(retrievals_router)
router.include_router(topic_plans_router)
router.include_router(research_briefs_router)
router.include_router(research_retrievals_router)
