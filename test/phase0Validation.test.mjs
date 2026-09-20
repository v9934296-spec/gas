import test from "node:test";
import assert from "node:assert/strict";
import { PHASE0_THRESHOLDS, summarizePhase0Validation } from "../src/phase0Validation.js";

const passingFixtures = {
  cleanStt: {
    cases: [
      { id: "c1", reference: "alpha beta gamma delta", hypothesis: "alpha beta gamma delta" },
      { id: "c2", reference: "pocket stays deep in the groove", hypothesis: "pocket stays deep in the groove" },
    ],
  },
  phoneStt: {
    cases: [
      { id: "p1", reference: "phone mic catches the room tone", hypothesis: "phone mic catches the room tone" },
      { id: "p2", reference: "cadence survives the noise outside", hypothesis: "cadence survives the noise outside" },
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

test("Phase 0 validation summary can clear launch gates", () => {
  const report = summarizePhase0Validation(passingFixtures);

  assert.equal(report.thresholds.cleanSttPct, PHASE0_THRESHOLDS.cleanSttPct);
  assert.ok(report.cleanStt.averagePct >= PHASE0_THRESHOLDS.cleanSttPct);
  assert.ok(report.phoneStt.averagePct >= PHASE0_THRESHOLDS.phoneSttPct);
  assert.ok(report.rhyme.obviousRhymePrecisionPct >= PHASE0_THRESHOLDS.rhymePrecisionPct);
  assert.ok(report.rhyme.fakeRhymeRatePct <= PHASE0_THRESHOLDS.fakeRhymeRatePct);
  assert.equal(report.silence.inventedVerses, 0);
  assert.ok(report.timing.agreementPct >= 62.5);
  assert.equal(report.gates.silenceInventedVerses.pass, true);
  assert.equal(report.gates.timingAgreement.pass, true);
  assert.equal(report.launchReady, true);
});

test("Phase 0 launch stays gated when thresholds fail", () => {
  const report = summarizePhase0Validation({
    ...passingFixtures,
    phoneStt: { cases: [{ id: "bad", reference: "alpha beta gamma delta", hypothesis: "alpha" }] },
  });

  assert.equal(report.launchReady, false);
});

test("Seed fixture profile remains below the phone STT launch gate", () => {
  const report = summarizePhase0Validation({
    ...passingFixtures,
    phoneStt: {
      cases: [
        { id: "phone-1", reference: "phone mic catches the verse with a little room tone", hypothesis: "phone mic catches the verse with a little tone" },
        { id: "phone-2", reference: "even with traffic outside the cadence still holds", hypothesis: "even with traffic outside cadence still holds" },
        { id: "phone-3", reference: "pocket stays tight though the corners get noisy", hypothesis: "pocket stays tight though corners get noisy" },
      ],
    },
  });

  assert.equal(report.phoneStt.averagePct < PHASE0_THRESHOLDS.phoneSttPct, true);
  assert.equal(report.gates.phoneStt.pass, false);
  assert.equal(report.launchReady, false);
});

test("Phase 0 launch stays gated when silence invents bars", () => {
  const report = summarizePhase0Validation({
    ...passingFixtures,
    silence: {
      cases: [
        { expectedNoBars: true, detectedNoBars: false },
        { expectedNoBars: true, detectedNoBars: true },
      ],
    },
  });

  assert.equal(report.silence.inventedVerses, 1);
  assert.equal(report.gates.silenceInventedVerses.pass, false);
  assert.equal(report.launchReady, false);
});

test("Phase 0 launch stays gated when timing agreement is below 5/8", () => {
  const report = summarizePhase0Validation({
    ...passingFixtures,
    timing: {
      cases: [
        { humanLabel: "tight", analyzerLabel: "tight" },
        { humanLabel: "late", analyzerLabel: "tight" },
        { humanLabel: "rushed", analyzerLabel: "tight" },
      ],
    },
  });

  assert.equal(report.timing.matches, 1);
  assert.equal(report.gates.timingAgreement.pass, false);
  assert.equal(report.launchReady, false);
});
