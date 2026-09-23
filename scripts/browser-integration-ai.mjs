import { createServer } from "node:http";

const port = Number(process.env.BROWSER_AI_PORT ?? 8100);
const researchSourceId = "6ab39abec9ce8add09440011";
const workflowSourceId = "6ab39abec9ce8add09440012";
const researchSourceText = "Deterministic browser research evidence proves the local workflow boundary.";
const workflowSourceText = "Deterministic workflow evidence supports human approval without publishing.";
const calls = { generations: 0, retrievals: 0, research: 0, reviews: 0, workflows: 0 };
const longText = (angle) =>
  `${angle} deterministic browser integration draft. This synthetic provider response is deliberately long enough to satisfy the production draft contract and gives the browser suite stable content without contacting an external AI provider.`;
const workflowText = (angle) =>
  `${angle} workflow draft is deterministic and long enough to satisfy the production draft contract while remaining local to this isolated browser test.`;

function json(response, status, body) {
  response.writeHead(status, { "Content-Type": "application/json" });
  response.end(JSON.stringify(body));
}

async function readBody(request) {
  let body = "";
  for await (const chunk of request) body += chunk;
  return body ? JSON.parse(body) : {};
}

const server = createServer(async (request, response) => {
  if (request.method === "GET" && request.url === "/__test__/calls") {
    json(response, 200, { ...calls });
    return;
  }
  if (request.method !== "POST") {
    json(response, 404, { success: false });
    return;
  }
  const body = await readBody(request);
  if (request.url === "/api/v1/generations") {
    calls.generations += 1;
    json(response, 200, {
      success: true,
      data: {
        model: "browser-test-model",
        variations: [
          { angle: "technical_depth", content: longText("Technical depth"), citations: [] },
          { angle: "learning_story", content: longText("Learning story"), citations: [] },
          { angle: "professional_impact", content: longText("Professional impact"), citations: [] },
        ],
      },
      usage: { model: "browser-test-model", inputTokens: 12, outputTokens: 90, embeddingTokens: null },
    });
    return;
  }
  if (request.url === "/api/v1/research-retrievals" || request.url === "/api/v1/retrievals") {
    calls.retrievals += 1;
    const sourceId = body.sourceIds?.[0] ?? researchSourceId;
    const text = sourceId === workflowSourceId ? workflowSourceText : researchSourceText;
    json(response, 200, {
      success: true,
      data: [{
        pointId: "browser-point-1",
        ownerId: body.ownerId,
        sourceId,
        contentVersion: 1,
        chunkerVersion: "browser-chunker",
        chunkIndex: 0,
        chunkId: "browser-chunk-1",
        text,
        startOffset: 0,
        endOffset: Array.from(text).length,
        embeddingModel: "browser-embedding",
        score: 0.99,
      }],
      usage: { model: "browser-embedding", inputTokens: null, outputTokens: null, embeddingTokens: 4 },
    });
    return;
  }
  if (request.url === "/api/v1/research-briefs") {
    calls.research += 1;
    json(response, 200, {
      success: true,
      data: {
        model: "browser-research-model",
        noEvidence: false,
        topicSummary: "A deterministic browser research brief.",
        talkingPoints: [{ text: "The local evidence supports this browser workflow.", evidenceIds: ["e1"] }],
        claimAssessments: [{ claim: "The workflow is locally testable.", assessment: "supported", explanation: "The selected source says so.", evidenceIds: ["e1"] }],
        missingInformation: [],
        questions: ["What should be verified next?"],
        limitations: ["This is synthetic evidence."],
      },
      usage: { model: "browser-research-model", inputTokens: 20, outputTokens: 40, embeddingTokens: null },
    });
    return;
  }
  if (request.url === "/api/v1/draft-reviews") {
    calls.reviews += 1;
    const draft = body.draft ?? "";
    json(response, 200, {
      success: true,
      data: {
        model: "browser-review-model",
        summary: "The technical draft is clear and evidence-linked.",
        findings: [{
          category: "clarity",
          severity: "low",
          passage: draft.slice(0, Math.min(80, draft.length)),
          explanation: "The passage is understandable.",
          evidenceIds: ["e1"],
          suggestion: "Keep the evidence reference visible.",
        }],
        proposedDraft: null,
      },
      usage: { model: "browser-review-model", inputTokens: 30, outputTokens: 20, embeddingTokens: null },
    });
    return;
  }
  if (request.url === "/api/v1/workflows") {
    calls.workflows += 1;
    const variations = [
      { angle: "technical_depth", content: workflowText("Technical depth"), citations: ["browser-chunk-1"] },
      { angle: "learning_story", content: workflowText("Learning story"), citations: ["browser-chunk-1"] },
      { angle: "professional_impact", content: workflowText("Professional impact"), citations: ["browser-chunk-1"] },
    ];
    const review = {
      model: "browser-workflow-review-model",
      summary: "Workflow technical review completed.",
      findings: [],
      proposedDraft: null,
      usage: { model: "browser-workflow-review-model", inputTokens: 24, outputTokens: 18, embeddingTokens: null },
    };
    const state = body.resume && body.approval
      ? { phase: "completed", generation: { model: "browser-workflow-model", variations }, review }
      : body.resume
        ? { phase: "review", generation: { model: "browser-workflow-model", variations }, review, __interrupt__: [{ value: { kind: "workflow_approval", phase: "approval" } }] }
        : { phase: "review", generation: { model: "browser-workflow-model", variations }, review, __interrupt__: [{ value: { kind: "workflow_approval", phase: "approval" } }] };
    json(response, 200, {
      success: true,
      data: {
        status: state.__interrupt__ ? (state.__interrupt__[0].value.kind === "workflow_approval" ? "awaiting_approval" : "paused") : "completed",
        phase: state.phase,
        state,
        interrupt: state.__interrupt__?.[0]?.value,
        usage: { model: "browser-workflow-model", inputTokens: 24, outputTokens: 18, embeddingTokens: null },
      },
    });
    return;
  }
  json(response, 404, { success: false });
});

server.listen(port, "127.0.0.1", () => {
  console.log(`Browser test AI adapter listening on ${port}`);
});

const stop = () => server.close(() => process.exit(0));
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
