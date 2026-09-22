import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { analyzeRapText } from "../src/analyzeRap.js";
import { buildMechanicsReport } from "../src/mechanics.js";
import { buildScorecard, citationMatchesBar, sanitizeScorecard } from "../src/scorecard.js";

const STRONG_TRANSCRIPT = [
  "I paint the flame and stake a claim",
  "I train the aim and shape the name",
  "I bend the bass and make it bang",
  "I send the phrase and lace the slang",
].join("\n");

const TALKING_TRANSCRIPT = "Yeah so I was just going to the store and then I saw my friend and we talked about nothing really and then I came back.";

const e22 = readFileSync(new URL("../eval/truth/e22.txt", import.meta.url), "utf8");

test("Phase 1 pocket stays null in default mode", () => {
  const analysis = analyzeRapText(STRONG_TRANSCRIPT, { durationMs: 12000, takeId: "take-strong" });
  assert.equal(analysis.barz.phase, 1);
  assert.equal(analysis.scorecard.mode, "default");
  assert.equal(analysis.scorecard.scores.pocket.value, null);
  assert.equal(analysis.scorecard.schema_version, "1.0");
});

test("Scorecard citations must be substrings of the cited bar", () => {
  const analysis = analyzeRapText(STRONG_TRANSCRIPT, { durationMs: 12000 });
  const bars = analysis.mechanics.bars;
  for (const dim of Object.values(analysis.scorecard.scores)) {
    for (const item of dim.citations) {
      assert.equal(citationMatchesBar(item, bars), true);
    }
  }
  for (const item of analysis.scorecard.best_bars) {
    assert.equal(citationMatchesBar(item, bars), true);
  }
});

test("Sanitizer strips invented citations and drops uncited dim claims", () => {
  const mechanics = buildMechanicsReport(STRONG_TRANSCRIPT);
  const dirty = buildScorecard({ mechanics, takeId: "x" });
  dirty.scores.technical.citations.push({ bar_i: 0, quote: "this bar was never said" });
  dirty.scores.punch = {
    value: 9,
    why: "secret second meaning",
    citations: [{ bar_i: 99, quote: "invented" }],
  };
  dirty.best_bars.push({ bar_i: 0, quote: "not in the bar" });
  const clean = sanitizeScorecard(dirty, mechanics.bars);
  assert.equal(clean.scores.punch.value, null);
  assert.equal(clean.scores.punch.why, "insufficient evidence");
  assert.equal(clean.scores.technical.citations.every((item) => citationMatchesBar(item, mechanics.bars)), true);
  assert.equal(clean.best_bars.every((item) => citationMatchesBar(item, mechanics.bars)), true);
});

test("Talking-on-the-mic 16 stays at or below 4 technical and overall", () => {
  const analysis = analyzeRapText(TALKING_TRANSCRIPT, { durationMs: 14000 });
  assert.ok((analysis.scorecard.scores.technical.value ?? 0) <= 4);
  assert.ok((analysis.scorecard.scores.overall.value ?? 0) <= 4);
  assert.equal(analysis.scorecard.scores.pocket.value, null);
});

test("e22 real-audio truth produces a cited Phase 1 scorecard", () => {
  const analysis = analyzeRapText(e22, { durationMs: 26000, takeId: "e22" });
  assert.ok(analysis.mechanics.bars.length >= 2);
  assert.equal(analysis.scorecard.take_id, "e22");
  assert.equal(analysis.scorecard.scores.pocket.value, null);
  assert.equal(analysis.scorecard.scores.punch.value, null);
  assert.ok(analysis.scorecard.notes.length > 0);
  if (analysis.scorecard.scores.technical.value != null) {
    assert.ok(analysis.scorecard.scores.technical.citations.length >= 1);
  }
});

test("Overall is not the mean of the other dimensions", () => {
  const analysis = analyzeRapText(STRONG_TRANSCRIPT, { durationMs: 12000 });
  const scores = analysis.scorecard.scores;
  const numeric = ["technical", "punch", "originality", "coherence", "cleanliness"]
    .map((key) => scores[key].value)
    .filter((value) => typeof value === "number");
  if (numeric.length && typeof scores.overall.value === "number") {
    const mean = numeric.reduce((sum, value) => sum + value, 0) / numeric.length;
    assert.notEqual(Number(scores.overall.value.toFixed(1)), Number(mean.toFixed(1)));
  }
  assert.ok((scores.overall.value ?? 0) <= 5);
});
