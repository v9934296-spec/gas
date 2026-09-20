import test from "node:test";
import assert from "node:assert/strict";
import { sanitizeTakeScoreInvariant } from "../src/historyStore.js";

const evidence = [
  {
    id: "timing-agreement",
    category: "timing",
    metric: "timingAgreementPct",
    value: 80,
    points: 8,
    reason: "Timing stayed locked to the beat.",
    timestamp: { startMs: 0, endMs: 1000 },
    lyricSpan: { startWord: 0, endWord: 4, text: "timing stayed locked" },
  },
];

test("sanitizeTakeScoreInvariant preserves persisted BARZ results", () => {
  const take = {
    id: "take-1",
    analysis: {
      evidence,
      barz: {
        phase: "BARZ Phase 0",
        status: "scored",
        score: 73,
        evidence: [],
        note: "Persisted score should not change on reload.",
      },
    },
  };

  const sanitized = sanitizeTakeScoreInvariant(take);

  assert.equal(sanitized.analysis.barz.score, 73);
  assert.equal(sanitized.analysis.barz.note, "Persisted score should not change on reload.");
  assert.deepEqual(sanitized.analysis.evidence, sanitized.analysis.receipts);
  assert.equal(sanitized.analysis.receipts[0].source, "deterministic");
});

test("sanitizeTakeScoreInvariant backfills BARZ when stored data is missing it", () => {
  const sanitized = sanitizeTakeScoreInvariant({
    id: "take-2",
    analysis: {
      evidence,
    },
  });

  assert.equal(sanitized.analysis.barz.status, "scored");
  assert.equal(sanitized.analysis.barz.score, 8);
  assert.deepEqual(sanitized.analysis.barz.evidence, sanitized.analysis.evidence);
});
