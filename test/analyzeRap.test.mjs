import test from "node:test";
import assert from "node:assert/strict";
import { analyzeRapText, buildBarzPhase0, normalizeBarzEvidence } from "../src/analyzeRap.js";

const STRONG_TRANSCRIPT = [
  "I paint the flame and stake a claim",
  "I train the aim and shape the name",
  "I bend the bass and make it bang",
  "I send the phrase and lace the slang",
].join("\n");

test("BARZ Phase 0 scores when evidence is present", () => {
  const analysis = analyzeRapText(STRONG_TRANSCRIPT, {
    durationMs: 12000,
    beat: { id: "boom-bap-92", name: "Boom Bap 92", bpm: 92 },
  });

  assert.equal(analysis.barz.status, "scored");
  assert.equal(typeof analysis.barz.score, "number");
  assert.ok(analysis.barz.score > 0);
  assert.ok(analysis.barz.evidence.length > 0);
  assert.ok(analysis.barz.evidence.every((item) => item.reason && item.lyricSpan.text));
});

test("BARZ Phase 0 is withheld when evidence is absent", () => {
  const analysis = analyzeRapText("", {
    durationMs: 6000,
    beat: { id: "boom-bap-92", name: "Boom Bap 92", bpm: 92 },
    evidence: [],
  });

  assert.equal(analysis.barz.status, "withheld");
  assert.deepEqual(analysis.barz.evidence, []);
  assert.ok(!Object.hasOwn(analysis.barz, "score"));
});

test("BARZ Phase 0 rejects empty and invalid evidence payloads", () => {
  const base = analyzeRapText("steady bars ready scars heavy stars", {
    durationMs: 9000,
    beat: { id: "drill-140", name: "Drill 140", bpm: 140 },
  });
  const invalidPayload = [
    { metric: "", value: 12, points: 8, reason: "Missing metric name", timestamp: { startMs: 0, endMs: 2000 }, lyricSpan: { startWord: 0, endWord: 2, text: "steady bars" } },
    { metric: "wordCount", value: "12", points: 8, reason: "Wrong value type", timestamp: { startMs: 0, endMs: 2000 }, lyricSpan: { startWord: 0, endWord: 2, text: "steady bars" } },
    { metric: "rhymeDensityPct", value: 22, points: 0, reason: "Zero points", timestamp: { startMs: 0, endMs: 2000 }, lyricSpan: { startWord: 0, endWord: 2, text: "steady bars" } },
  ];

  assert.deepEqual(normalizeBarzEvidence(invalidPayload), []);

  const blocked = buildBarzPhase0(base, invalidPayload);
  assert.equal(blocked.status, "withheld");
  assert.deepEqual(blocked.evidence, []);
  assert.ok(!Object.hasOwn(blocked, "score"));
});
