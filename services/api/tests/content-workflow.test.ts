import assert from "node:assert/strict";
import test from "node:test";
import { mapWorkflowGenerationCitations } from "../src/services/content-workflow.service.js";

const evidence = [{
  evidenceId: "e1",
  sourceId: "507f1f77bcf86cd799439011",
  title: "Profile",
  contentVersion: 3,
  chunkId: "507f1f77bcf86cd799439011_v3_c0",
  chunkIndex: 0,
  text: "Built a reliable deployment pipeline.",
  startOffset: 0,
  endOffset: 36,
  score: 0.9,
}];

function variations(citations: string[]) {
  return (["technical_depth", "learning_story", "professional_impact"] as const).map((angle) => ({
    angle,
    content: "A sufficiently long draft based on the supplied evidence. ".repeat(3),
    citations,
  }));
}

test("workflow citation mapping preserves server-owned provenance", () => {
  const result = mapWorkflowGenerationCitations(evidence, { model: "test", variations: variations(["e1"]) }, new Map());
  assert.equal(result.variations[0].citations[0].sourceId, evidence[0].sourceId);
  assert.equal(result.variations[0].citations[0].contentVersion, 3);
  assert.equal(result.variations[0].citations[0].chunkId, evidence[0].chunkId);
  assert.equal(result.variations[0].citations[0].startOffset, 0);
});

test("workflow citation mapping rejects fabricated evidence references", () => {
  assert.throws(
    () => mapWorkflowGenerationCitations(evidence, { model: "test", variations: variations(["forged"]) }, new Map()),
    /invalid response/i,
  );
});
