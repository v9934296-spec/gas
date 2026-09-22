import { clampTen, normalizeWhitespace } from "./lyric.js";

export const SCORECARD_SCHEMA_VERSION = "1.0";
export const PHASE1_STYLE_CARD = "west_coast_raw";
export const PHASE1_MODE = "default";
export const PHASE1_MODEL = "barz-phase1-deterministic";

function citation(barI, quote) {
  return { bar_i: barI, quote };
}

function emptyDim(why) {
  return { value: null, why, citations: [] };
}

function dim(value, why, citations) {
  return { value: clampTen(value), why, citations };
}

export function citationMatchesBar(item, bars) {
  const bar = bars[item?.bar_i];
  if (!bar || typeof item?.quote !== "string" || !item.quote.trim()) return false;
  return normalizeWhitespace(bar.text).includes(normalizeWhitespace(item.quote));
}

function stripCitations(items, bars) {
  return (Array.isArray(items) ? items : []).filter((item) => citationMatchesBar(item, bars));
}

function sanitizeDim(scoreDim, bars) {
  const citations = stripCitations(scoreDim?.citations, bars);
  if (!citations.length) {
    return {
      value: null,
      why: "insufficient evidence",
      citations: [],
    };
  }
  return {
    value: scoreDim.value == null ? null : clampTen(scoreDim.value),
    why: typeof scoreDim.why === "string" && scoreDim.why.trim() ? scoreDim.why.trim() : "insufficient evidence",
    citations,
  };
}

export function sanitizeScorecard(scorecard, bars = []) {
  const scores = scorecard?.scores || {};
  const nextScores = {};
  for (const key of ["technical", "punch", "originality", "coherence", "pocket", "cleanliness", "overall"]) {
    nextScores[key] = sanitizeDim(scores[key] || emptyDim("insufficient evidence"), bars);
  }

  if (scorecard?.mode !== "audio_coach") {
    nextScores.pocket = {
      value: null,
      why: nextScores.pocket.why && nextScores.pocket.why !== "insufficient evidence"
        ? nextScores.pocket.why
        : "pocket.value is null unless audio_coach mode provides delivery evidence.",
      citations: nextScores.pocket.citations,
    };
    if (!nextScores.pocket.citations.length) {
      nextScores.pocket = {
        value: null,
        why: "pocket.value is null unless audio_coach mode provides delivery evidence.",
        citations: [],
      };
    }
  }

  const best = stripCitations(scorecard?.best_bars, bars).slice(0, 3);
  const weak = stripCitations(scorecard?.weak_bars, bars).slice(0, 3);
  const corninessBars = stripCitations(scorecard?.corniness?.bars, bars);
  const uncertain = stripCitations(scorecard?.uncertain, bars);

  let notes = typeof scorecard?.notes === "string" ? scorecard.notes.trim() : "";
  if (notes.length > 900) {
    const clipped = notes.slice(0, 900);
    const lastSentence = clipped.lastIndexOf(".");
    notes = lastSentence > 80 ? clipped.slice(0, lastSentence + 1) : clipped;
  }

  let rewriteOne = scorecard?.rewrite_one || null;
  if (rewriteOne) {
    const bar = bars[rewriteOne.bar_i];
    const original = normalizeWhitespace(rewriteOne.original || "");
    if (!bar || original !== normalizeWhitespace(bar.text)) rewriteOne = null;
  }

  const unknownDropped = Object.keys(scorecard || {}).filter((key) => ![
    "take_id", "model", "mode", "schema_version", "style_card", "scores",
    "best_bars", "weak_bars", "corniness", "uncertain", "notes", "rewrite_one",
  ].includes(key));
  void unknownDropped;

  return {
    take_id: scorecard?.take_id || null,
    model: scorecard?.model || PHASE1_MODEL,
    mode: scorecard?.mode || PHASE1_MODE,
    schema_version: SCORECARD_SCHEMA_VERSION,
    style_card: scorecard?.style_card || PHASE1_STYLE_CARD,
    scores: nextScores,
    best_bars: best,
    weak_bars: weak,
    corniness: {
      flag: Boolean(scorecard?.corniness?.flag) && corninessBars.length > 0,
      bars: corninessBars,
      note: corninessBars.length ? String(scorecard?.corniness?.note || "") : "",
    },
    uncertain,
    notes,
    rewrite_one: rewriteOne,
  };
}

function quoteBar(bar) {
  const words = bar.text.split(/\s+/).slice(0, 8).join(" ");
  return words;
}

function linkedBarIndexes(mechanics) {
  return [...new Set(
    (mechanics.rhyme_links || [])
      .filter((link) => link.kind !== "internal")
      .flatMap((link) => [link.a_bar, link.b_bar]),
  )].sort((a, b) => a - b);
}

export function buildScorecard({ takeId, mechanics, mode = PHASE1_MODE, styleCard = PHASE1_STYLE_CARD } = {}) {
  const bars = mechanics?.bars || [];
  const stats = mechanics?.stats || {};
  const linked = linkedBarIndexes(mechanics);

  const technicalCitations = linked.slice(0, 3)
    .map((i) => bars[i] && citation(i, quoteBar(bars[i])))
    .filter(Boolean);

  let technicalValue = null;
  let technicalWhy = "insufficient evidence";
  if (technicalCitations.length) {
    const density = Number(stats.rhyme_density) || 0;
    const internals = Number(stats.internal_count) || 0;
    const wander = Number(stats.syllable_stdev) || 0;
    technicalValue = 3 + density * 4 + Math.min(2, internals * 0.4) - Math.min(1.5, wander / 6);
    technicalWhy = `Stage 2 rhyme map shows ${linked.length} linked end-bars and scheme ${mechanics.scheme_guess || "free"}.`;
  } else if (bars.length) {
    technicalValue = Math.min(4, 2 + (stats.bar_count > 4 ? 1 : 0));
    technicalWhy = "Few or no Stage 2 end-rhyme links. Talking-on-the-mic stays at or below 4 technical.";
    if (bars[0]) technicalCitations.push(citation(0, quoteBar(bars[0])));
  }

  const fillerCitations = bars
    .filter((bar) => /\b(like|uh|um|basically)\b/i.test(bar.text))
    .slice(0, 2)
    .map((bar) => citation(bar.i, quoteBar(bar)));
  const cleanlinessBase = 10 - Math.min(6, (Number(stats.filler_ratio) || 0) * 20) - Math.min(2, Math.max(0, (stats.longest_repeat_run || 1) - 2));
  const cleanlinessCitations = fillerCitations.length
    ? fillerCitations
    : (bars[0] ? [citation(0, quoteBar(bars[0]))] : []);
  const cleanlinessWhy = fillerCitations.length
    ? "Filler / glue words appear in the cited bars, so cleanliness is discounted."
    : "No heavy glue-word loops in Stage 2 stats.";

  const unlinked = bars.filter((bar) => !linked.includes(bar.i));
  const bestBars = linked.slice(0, 3).map((i) => citation(i, quoteBar(bars[i]))).filter((item) => item.quote);
  const weakBars = unlinked.slice(0, 3).map((bar) => citation(bar.i, quoteBar(bar)));

  const punch = emptyDim("Punch requires a quoted setup/payoff. Phase 1 does not invent punches from slang or profanity.");
  const originality = emptyDim("Originality stays null until a cited image or personal angle is present in the bar text.");
  const coherence = emptyDim("Coherence stays null until a cited through-line can be quoted from consecutive bars.");
  const pocket = emptyDim("pocket.value is null unless audio_coach mode provides delivery evidence.");

  let overallValue = null;
  let overallWhy = "insufficient evidence";
  const overallCitations = [...technicalCitations, ...bestBars].slice(0, 3);
  if (technicalValue != null && overallCitations.length) {
    // Cypher verdict, not a mean. No punch evidence caps overall at 5.
    if (technicalValue <= 4) {
      overallValue = Math.min(4, technicalValue);
      overallWhy = "Low Stage 2 rhyme control. Overall stays in the talking-on-the-mic band.";
    } else {
      overallValue = Math.min(5, technicalValue - 0.5);
      overallWhy = "Scheme is present in the rhyme map, but punch is null so overall cannot clear 5.";
    }
  }

  const notesParts = [];
  if (technicalCitations[0]) {
    notesParts.push(`Technical read cites “${technicalCitations[0].quote}” from bar ${technicalCitations[0].bar_i}.`);
  }
  if (mechanics?.scheme_guess) {
    notesParts.push(`Stage 2 scheme guess is ${mechanics.scheme_guess}.`);
  }
  notesParts.push("Pocket is null. Punch, originality, and coherence stay null until they can quote a bar.");
  if (bestBars[0]) notesParts.push(`Best cited bar: “${bestBars[0].quote}”.`);
  if (weakBars[0]) notesParts.push(`Weaker cited bar: “${weakBars[0].quote}”.`);

  const draft = {
    take_id: takeId || mechanics?.take_id || null,
    model: PHASE1_MODEL,
    mode,
    schema_version: SCORECARD_SCHEMA_VERSION,
    style_card: styleCard,
    scores: {
      technical: dim(technicalValue, technicalWhy, technicalCitations),
      punch,
      originality,
      coherence,
      pocket,
      cleanliness: dim(cleanlinessBase, cleanlinessWhy, cleanlinessCitations),
      overall: dim(overallValue, overallWhy, overallCitations),
    },
    best_bars: bestBars,
    weak_bars: weakBars,
    corniness: { flag: false, bars: [], note: "" },
    uncertain: [],
    notes: notesParts.join(" "),
    rewrite_one: null,
  };

  return sanitizeScorecard(draft, bars);
}
