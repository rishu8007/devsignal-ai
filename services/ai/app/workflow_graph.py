from typing import Any, TypedDict

from langgraph.graph import END, START, StateGraph
from langgraph.types import interrupt

from app.providers.draft_review_provider import DraftReviewProvider
from app.providers.openai_provider import OpenAIProvider
from app.providers.research_brief_provider import ResearchBriefProvider
from app.schemas.draft_review import DraftReviewRequest
from app.schemas.generation import GenerationRequest
from app.schemas.research_brief import ResearchBriefRequest


class WorkflowState(TypedDict, total=False):
    owner_id: str
    topic: str
    notes: str
    primary_audience: str
    content_type: str
    evidence: list[dict[str, Any]]
    research: dict[str, Any]
    generation: dict[str, Any]
    review: dict[str, Any]
    approval: dict[str, Any]
    phase: str
    cancelled: bool


def build_workflow_graph(
    research_provider: ResearchBriefProvider,
    generation_provider: OpenAIProvider,
    review_provider: DraftReviewProvider,
    checkpointer: Any,
) -> Any:
    async def research_node(state: WorkflowState) -> dict[str, Any]:
        if state.get("research"):
            return {"phase": "research_complete"}
        result = await research_provider.research(
            ResearchBriefRequest.model_validate(
                {
                    "topic": state["topic"],
                    "notes": state["notes"],
                    "evidence": state.get("evidence", []),
                }
            )
        )
        return {"research": result.model_dump(by_alias=True), "phase": "research_complete"}

    async def write_node(state: WorkflowState) -> dict[str, Any]:
        if state.get("generation"):
            return {"phase": "write_complete"}
        result = await generation_provider.generate(
            GenerationRequest.model_validate(
                {
                    "topic": state["topic"],
                    "notes": state["notes"],
                    "primaryAudience": state["primary_audience"],
                    "contentType": state["content_type"],
                    "context": [
                        {"chunkId": item["evidenceId"], "text": item["text"]}
                        for item in state.get("evidence", [])[:5]
                    ],
                }
            )
        )
        return {
            "generation": {
                "model": result.model,
                "variations": [item.model_dump() for item in result.output.variations],
            },
            "phase": "write_complete",
        }

    async def review_node(state: WorkflowState) -> dict[str, Any]:
        if state.get("review"):
            return {"phase": "review_complete"}
        variations = state["generation"]["variations"]
        draft = next(
            (item["content"] for item in variations if item["angle"] == "technical_depth"),
            variations[0]["content"],
        )
        result = await review_provider.review(
            DraftReviewRequest.model_validate(
                {
                    "draft": draft,
                    "evidence": [
                        {"evidenceId": item["evidenceId"], "text": item["text"]}
                        for item in state.get("evidence", [])
                    ],
                }
            )
        )
        return {"review": result.model_dump(by_alias=True), "phase": "review_complete"}

    def step_boundary(state: WorkflowState) -> dict[str, Any]:
        interrupt(
            {
                "kind": "workflow_step",
                "phase": state.get("phase", "running"),
                "message": "The completed step is persisted before the next AI step.",
            }
        )
        return {}

    def approval_node(state: WorkflowState) -> dict[str, Any]:
        decision = interrupt(
            {
                "kind": "workflow_approval",
                "message": (
                    "Inspect the saved drafts and technical review, then approve one exact draft."
                ),
                "drafts": state.get("generation", {}).get("variations", []),
                "review": state.get("review", {}),
            }
        )
        if not isinstance(decision, dict) or decision.get("cancelled"):
            return {"cancelled": True, "phase": "cancelled"}
        return {"approval": decision, "phase": "completed"}

    graph = StateGraph(WorkflowState)
    graph.add_node("research", research_node)
    graph.add_node("write", write_node)
    graph.add_node("write_boundary", step_boundary)
    graph.add_node("review", review_node)
    graph.add_node("review_boundary", step_boundary)
    graph.add_node("approval", approval_node)
    graph.add_edge(START, "research")
    graph.add_edge("research", "write")
    graph.add_edge("write", "write_boundary")
    graph.add_edge("write_boundary", "review")
    graph.add_edge("review", "review_boundary")
    graph.add_edge("review_boundary", "approval")
    graph.add_edge("approval", END)
    return graph.compile(checkpointer=checkpointer)
