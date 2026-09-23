from typing import Any, cast

from fastapi import APIRouter, Depends
from langgraph.types import Command

from app.api.dependencies import require_internal_workflow_graph
from app.schemas.workflow import WorkflowRequest, WorkflowResponse

router = APIRouter()


@router.post("/workflows", response_model=WorkflowResponse)
async def advance_workflow(
    request: WorkflowRequest,
    graph: Any = Depends(require_internal_workflow_graph),  # noqa: B008
) -> WorkflowResponse:
    config = {"configurable": {"thread_id": request.thread_id}}
    if request.resume:
        payload: Any = Command(resume=request.approval or {"continue": True})
    else:
        payload = request.model_dump(by_alias=False, exclude={"resume", "approval"})
    result = cast(dict[str, Any], await graph.ainvoke(payload, config=config))
    interrupts = result.get("__interrupt__", ())
    if interrupts:
        interrupt_value = getattr(interrupts[0], "value", interrupts[0])
        interrupt_kind = interrupt_value.get("kind") if isinstance(interrupt_value, dict) else None
        interrupt_phase = (
            interrupt_value.get("phase") if isinstance(interrupt_value, dict) else None
        )
        return WorkflowResponse(
            data={
                "status": (
                    "awaiting_approval" if interrupt_kind == "workflow_approval" else "paused"
                ),
                "phase": result.get("phase", interrupt_phase or "running"),
                "state": result,
                "interrupt": interrupt_value,
            }
        )
    return WorkflowResponse(
        data={
            "status": result.get("phase", "completed"),
            "phase": result.get("phase", "completed"),
            "state": result,
        }
    )
