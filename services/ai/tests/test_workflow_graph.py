import asyncio

from langgraph.checkpoint.memory import InMemorySaver
from langgraph.types import Command

from app.providers.openai_provider import ProviderGenerationResult
from app.schemas.draft_review import DraftReviewData
from app.schemas.generation import GenerationVariation, ProviderGenerationOutput
from app.schemas.research_brief import ResearchBriefData
from app.workflow_graph import build_workflow_graph


class FakeResearch:
    def __init__(self, events: list[str]) -> None:
        self.calls = 0
        self.events = events

    async def research(self, _request):
        self.calls += 1
        self.events.append("research")
        return ResearchBriefData(
            model="test",
            noEvidence=False,
            topicSummary="Summary",
            talkingPoints=[],
            claimAssessments=[],
            missingInformation=[],
            questions=[],
            limitations=[],
        )


class FakeGeneration:
    def __init__(self, events: list[str]) -> None:
        self.calls = 0
        self.events = events

    async def generate(self, _request):
        self.calls += 1
        self.events.append("write")
        variations = [
            GenerationVariation(
                angle=angle,
                content="A sufficiently long draft " * 10,
                citations=[],
            )
            for angle in ("technical_depth", "learning_story", "professional_impact")
        ]
        return ProviderGenerationResult(
            output=ProviderGenerationOutput(variations=variations),
            model="test",
        )


class FakeReview:
    def __init__(self, events: list[str]) -> None:
        self.calls = 0
        self.events = events

    async def review(self, _request):
        self.calls += 1
        self.events.append("review")
        return DraftReviewData(
            model="test",
            summary="Review",
            findings=[],
            proposedDraft=None,
        )


async def _run() -> None:
    events: list[str] = []
    research = FakeResearch(events)
    generation = FakeGeneration(events)
    review = FakeReview(events)
    checkpointer = InMemorySaver()
    graph = build_workflow_graph(
        research,
        generation,
        review,
        checkpointer,
    )
    config = {"configurable": {"thread_id": "workflow-test"}}
    initial = await graph.ainvoke(
        {
            "owner_id": "owner",
            "topic": "A valid workflow topic",
            "notes": "This is enough signal context for a workflow test.",
            "primary_audience": "Developers & engineers",
            "content_type": "Technical insight",
            "evidence": [],
            "research": {"topicSummary": "admitted research"},
        },
        config=config,
    )
    assert initial["__interrupt__"]
    assert research.calls == 0
    assert generation.calls == 1
    assert review.calls == 0
    assert events == ["write"]

    resumed_graph = build_workflow_graph(
        research,
        generation,
        review,
        checkpointer,
    )
    review_pause = await resumed_graph.ainvoke(
        Command(resume={"continue": True}),
        config=config,
    )
    assert review_pause["__interrupt__"]
    assert review.calls == 1
    assert events == ["write", "review"]

    approval_pause = await resumed_graph.ainvoke(
        Command(resume={"continue": True}),
        config=config,
    )
    assert approval_pause["__interrupt__"]
    completed = await resumed_graph.ainvoke(
        Command(resume={"variationId": "draft-1", "draftHash": "hash"}),
        config=config,
    )
    assert completed["phase"] == "completed"
    assert research.calls == 0
    assert generation.calls == 1
    assert review.calls == 1


def test_workflow_graph_durable_interrupt_and_resume() -> None:
    asyncio.run(_run())


def test_workflow_graph_requires_admitted_research() -> None:
    events: list[str] = []
    graph = build_workflow_graph(
        FakeResearch(events),
        FakeGeneration(events),
        FakeReview(events),
        InMemorySaver(),
    )
    try:
        asyncio.run(
            graph.ainvoke(
                {
                    "owner_id": "owner",
                    "topic": "A valid workflow topic",
                    "notes": "This is enough signal context for a workflow test.",
                    "primary_audience": "Developers & engineers",
                    "content_type": "Technical insight",
                    "evidence": [],
                },
                config={"configurable": {"thread_id": "missing-research"}},
            )
        )
    except ValueError as exception:
        assert "must be admitted" in str(exception)
    else:
        raise AssertionError("workflow accepted missing admitted research")
    assert events == []
