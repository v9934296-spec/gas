import test from "node:test";
import assert from "node:assert/strict";
import { PHASE0_THRESHOLDS, summarizePhase0Validation } from "../src/phase0Validation.js";

const fixtures = {
  cleanStt: {
    cases: [
      { id: "c1", reference: "alpha beta gamma delta", hypothesis: "alpha beta gamma delta" },
      { id: "c2", reference: "pocket stays deep in the groove", hypothesis: "pocket stays deep in groove" },
    ],
  },
  phoneStt: {
    cases: [
      { id: "p1", reference: "phone mic catches the room tone", hypothesis: "phone mic catches room tone" },
      { id: "p2", reference: "cadence survives the noise outside", hypothesis: "cadence survives noise outside" },
    ],
  },
  silence: {
    cases: [
      { expectedNoBars: true, detectedNoBars: true },
      { expectedNoBars: false, detectedNoBars: false },
    ],
  },
  rhyme: {
    cases: [
      { obviousRhyme: true, detectedAsRhyme: true },
      { obviousRhyme: true, detectedAsRhyme: true },
      { obviousRhyme: true, detectedAsRhyme: true },
      { obviousRhyme: true, detectedAsRhyme: true },
      { obviousRhyme: false, detectedAsRhyme: true },
      { obviousRhyme: false, detectedAsRhyme: false },
      { obviousRhyme: false, detectedAsRhyme: false },
      { obviousRhyme: false, detectedAsRhyme: false },
      { obviousRhyme: false, detectedAsRhyme: false },
      { obviousRhyme: false, detectedAsRhyme: false },
      { obviousRhyme: false, detectedAsRhyme: false },
    ],
  },
  timing: {
    cases: [
      { humanLabel: "tight", analyzerLabel: "tight" },
      { humanLabel: "late", analyzerLabel: "late" },
      { humanLabel: "rushed", analyzerLabel: "rushed" },
      { humanLabel: "late", analyzerLabel: "tight" },
      { humanLabel: "tight", analyzerLabel: "tight" },
    ],
  },
};

test("Phase 0 validation summary exposes launch gates", () => {
  const report = summarizePhase0Validation(fixtures);

  assert.equal(report.thresholds.cleanSttPct, PHASE0_THRESHOLDS.cleanSttPct);
  assert.ok(report.cleanStt.averagePct >= PHASE0_THRESHOLDS.cleanSttPct);
  assert.ok(report.phoneStt.averagePct >= PHASE0_THRESHOLDS.phoneSttPct);
  assert.ok(report.rhyme.obviousRhymePrecisionPct >= PHASE0_THRESHOLDS.rhymePrecisionPct);
  assert.ok(report.rhyme.fakeRhymeRatePct <= PHASE0_THRESHOLDS.fakeRhymeRatePct);
  assert.equal(report.launchReady, true);
});

test("Phase 0 launch stays gated when thresholds fail", () => {
  const report = summarizePhase0Validation({
    ...fixtures,
    phoneStt: { cases: [{ id: "bad", reference: "alpha beta gamma delta", hypothesis: "alpha" }] },
  });

  assert.equal(report.launchReady, false);
});
