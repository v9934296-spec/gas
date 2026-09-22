import { STOP_WORDS, clampScore, estimateSyllables, normalizeText, rhymeKey, wordsFrom } from "./lyric.js";
import { buildMechanicsReport } from "./mechanics.js";
import { buildScorecard } from "./scorecard.js";

const BARZ_PHASE = Object.freeze({
  phase: 1,
  label: "BARZ Phase 1",
  rule: "no-score-without-evidence",
});

function buildLineLikeGroups(text, words) {
  const explicit = normalizeText(text)
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean);

  if (explicit.length >= 2) {
    return explicit.map((line) => wordsFrom(line));
  }

  const punctuated = normalizeText(text)
    .split(/[.!?;]+/)
    .map((line) => wordsFrom(line))
    .filter((line) => line.length > 0);

  if (punctuated.length >= 2) return punctuated;

  const groups = [];
  for (let i = 0; i < words.length; i += 8) {
    groups.push(words.slice(i, i + 8));
  }
  return groups;
}

function repeatedLanguage(words) {
  const counts = new Map();
  for (const word of words) {
    if (word.length < 3 || STOP_WORDS.has(word)) continue;
    counts.set(word, (counts.get(word) || 0) + 1);
  }

  return [...counts.entries()]
    .filter(([, count]) => count > 1)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 6)
    .map(([word, count]) => ({ word, count }));
}

function endRhymeStats(groups) {
  const endings = groups
    .map((group, index) => {
      const word = group[group.length - 1];
      return word ? { index, word, key: rhymeKey(word) } : null;
    })
    .filter(Boolean)
    .filter((item) => item.key);

  let pairs = 0;
  const matched = new Set();
  const examples = [];
  for (let i = 0; i < endings.length; i += 1) {
    for (let j = i + 1; j < endings.length; j += 1) {
      if (endings[i].word !== endings[j].word && endings[i].key === endings[j].key) {
        pairs += 1;
        matched.add(endings[i].index);
        matched.add(endings[j].index);
        if (examples.length < 4) {
          examples.push({
            key: endings[i].key,
            words: [endings[i].word, endings[j].word],
            groupIndexes: [endings[i].index, endings[j].index],
          });
        }
      }
    }
  }

  let longestChain = 0;
  let activeKey = null;
  let activeLength = 0;
  for (const ending of endings) {
    if (ending.key === activeKey) {
      activeLength += 1;
    } else {
      activeKey = ending.key;
      activeLength = 1;
    }
    longestChain = Math.max(longestChain, activeLength);
  }

  return {
    pairs,
    matchedGroups: matched.size,
    longestChain: longestChain >= 2 ? longestChain : 0,
    matchedGroupIndexes: [...matched].sort((a, b) => a - b),
    examples,
  };
}

function internalRhymeCandidates(groups) {
  let count = 0;
  const examples = [];

  for (let groupIndex = 0; groupIndex < groups.length; groupIndex += 1) {
    const group = groups[groupIndex];
    const buckets = new Map();
    for (const word of group) {
      const key = rhymeKey(word);
      if (!key) continue;
      if (!buckets.has(key)) buckets.set(key, new Set());
      buckets.get(key).add(word);
    }

    for (const [key, bucket] of buckets.entries()) {
      const unique = [...bucket];
      if (unique.length < 2) continue;
      count += (unique.length * (unique.length - 1)) / 2;
      if (examples.length < 4) {
        examples.push({ key, words: unique.slice(0, 3), groupIndex });
      }
    }
  }

  return { count, examples };
}

function normalizeBeat(beat) {
  if (!beat || typeof beat !== "object") {
    return {
      id: "practice-92",
      name: "Practice Loop",
      bpm: 92,
      secondsPerBar: 240 / 92,
    };
  }

  const bpm = Number.isFinite(beat.bpm) && beat.bpm > 0 ? beat.bpm : 92;
  return {
    id: typeof beat.id === "string" && beat.id.trim() ? beat.id.trim() : `beat-${bpm}`,
    name: typeof beat.name === "string" && beat.name.trim() ? beat.name.trim() : `Beat ${bpm} BPM`,
    bpm,
    secondsPerBar: 240 / bpm,
  };
}

function buildGroupSegments(groups, durationMs) {
  const totalWords = groups.reduce((sum, group) => sum + group.length, 0);
  let cursor = 0;

  return groups.map((group, index) => {
    const startWord = cursor;
    const endWord = Math.max(startWord, cursor + group.length - 1);
    cursor += group.length;
    const startMs = totalWords ? Math.round((startWord / totalWords) * durationMs) : 0;
    const endMs = totalWords ? Math.round((cursor / totalWords) * durationMs) : 0;

    return {
      index,
      text: group.join(" "),
      words: group,
      startWord,
      endWord,
      startMs,
      endMs,
    };
  });
}

function transcriptSpan(text, wordCount, durationMs) {
  return {
    lyricSpan: {
      startWord: wordCount ? 0 : null,
      endWord: wordCount ? wordCount - 1 : null,
      text: normalizeText(text).trim(),
    },
    timestamp: {
      startMs: 0,
      endMs: Math.max(0, Math.round(durationMs || 0)),
    },
  };
}

function makeEvidence({ id, category, metric, value, points, reason, source, timestamp, lyricSpan }) {
  return {
    id,
    category,
    metric,
    value,
    points,
    reason,
    source: source || "deterministic",
    timestamp,
    lyricSpan,
  };
}

export function normalizeBarzEvidence(evidence) {
  if (!Array.isArray(evidence)) return [];

  return evidence
    .filter((item) => item && typeof item === "object")
    .map((item) => ({
      id: typeof item.id === "string" ? item.id.trim() : "",
      category: typeof item.category === "string" ? item.category.trim() : "",
      metric: typeof item.metric === "string" ? item.metric.trim() : "",
      value: Number.isFinite(item.value) ? item.value : NaN,
      points: Number.isFinite(item.points) ? item.points : NaN,
      reason: typeof item.reason === "string" ? item.reason.trim() : "",
      source: typeof item.source === "string" && item.source.trim() ? item.source.trim() : "deterministic",
      timestamp: {
        startMs: Number.isFinite(item.timestamp?.startMs) ? item.timestamp.startMs : NaN,
        endMs: Number.isFinite(item.timestamp?.endMs) ? item.timestamp.endMs : NaN,
      },
      lyricSpan: {
        startWord: Number.isInteger(item.lyricSpan?.startWord) || item.lyricSpan?.startWord === null ? item.lyricSpan.startWord : NaN,
        endWord: Number.isInteger(item.lyricSpan?.endWord) || item.lyricSpan?.endWord === null ? item.lyricSpan.endWord : NaN,
        text: typeof item.lyricSpan?.text === "string" ? item.lyricSpan.text.trim() : "",
      },
    }))
    .filter((item) => item.metric
      && item.reason
      && Number.isFinite(item.value)
      && Number.isFinite(item.points)
      && item.points > 0
      && Number.isFinite(item.timestamp.startMs)
      && Number.isFinite(item.timestamp.endMs)
      && item.timestamp.endMs >= item.timestamp.startMs
      && item.lyricSpan.text);
}

function deriveBarzEvidence({ text, metrics, groups, segments, beat }) {
  const evidence = [];
  const overallSpan = transcriptSpan(text, metrics.wordCount, metrics.durationMs);
  const safeSpan = segments[0] ? {
    timestamp: { startMs: segments[0].startMs, endMs: segments[segments.length - 1]?.endMs ?? segments[0].endMs },
    lyricSpan: { startWord: 0, endWord: metrics.wordCount ? metrics.wordCount - 1 : 0, text: normalizeText(text).trim() },
  } : overallSpan;

  if (metrics.wordCount >= 16) {
    evidence.push(makeEvidence({
      id: "word-count-floor",
      category: "structure",
      metric: "wordCount",
      value: metrics.wordCount,
      points: metrics.wordCount >= 32 ? 20 : 10,
      reason: `${metrics.wordCount} words clears the transcript evidence floor for BARZ Phase 1.`,
      ...safeSpan,
    }));
  }

  if (metrics.vocabularyVarietyPct >= 40) {
    evidence.push(makeEvidence({
      id: "vocabulary-variety",
      category: "language",
      metric: "vocabularyVarietyPct",
      value: metrics.vocabularyVarietyPct,
      points: metrics.vocabularyVarietyPct >= 55 ? 20 : 12,
      reason: `${metrics.vocabularyVarietyPct}% vocabulary variety shows enough lexical spread to support a writing score.`,
      ...safeSpan,
    }));
  }

  if (metrics.rhymeDensityPct >= 6) {
    evidence.push(makeEvidence({
      id: "rhyme-density",
      category: "rhyme",
      metric: "rhymeDensityPct",
      value: metrics.rhymeDensityPct,
      points: metrics.rhymeDensityPct >= 12 ? 20 : 10,
      reason: `${metrics.rhymeDensityPct}% rhyme density indicates repeatable rhyme activity instead of a guessed score.`,
      ...safeSpan,
    }));
  }

  if (metrics.endRhymeExamples[0]) {
    const example = metrics.endRhymeExamples[0];
    const firstIndex = example.groupIndexes[0] ?? 0;
    const span = segments[firstIndex] || segments[0] || { startMs: 0, endMs: metrics.durationMs, startWord: 0, endWord: metrics.wordCount - 1, text: normalizeText(text).trim() };
    evidence.push(makeEvidence({
      id: `end-rhyme-${firstIndex}`,
      category: "rhyme",
      metric: "endRhymeCandidates",
      value: metrics.endRhymeCandidates,
      points: Math.min(20, metrics.endRhymeCandidates * 5),
      reason: `End-rhyme candidate ${example.words.join(" / ")} appears in the transcript groups and supports the rhyme score.`,
      timestamp: { startMs: span.startMs, endMs: span.endMs },
      lyricSpan: { startWord: span.startWord, endWord: span.endWord, text: span.text },
    }));
  }

  if (metrics.internalRhymeExamples[0]) {
    const example = metrics.internalRhymeExamples[0];
    const span = segments[example.groupIndex] || segments[0] || { startMs: 0, endMs: metrics.durationMs, startWord: 0, endWord: metrics.wordCount - 1, text: normalizeText(text).trim() };
    evidence.push(makeEvidence({
      id: `internal-rhyme-${example.groupIndex}`,
      category: "rhyme",
      metric: "internalRhymeCandidates",
      value: metrics.internalRhymeCandidates,
      points: Math.min(20, metrics.internalRhymeCandidates * 4),
      reason: `Internal rhyme words ${example.words.join(" / ")} appear in the same lyric span.`,
      timestamp: { startMs: span.startMs, endMs: span.endMs },
      lyricSpan: { startWord: span.startWord, endWord: span.endWord, text: span.text },
    }));
  }

  if (beat && metrics.timingAgreementPct >= 60 && groups.length > 0) {
    evidence.push(makeEvidence({
      id: "timing-agreement",
      category: "timing",
      metric: "timingAgreementPct",
      value: metrics.timingAgreementPct,
      points: metrics.timingAgreementPct >= 80 ? 15 : 8,
      reason: `${metrics.timingAgreementPct}% timing agreement against the selected ${beat.bpm} BPM beat supports cadence consistency.`,
      ...safeSpan,
    }));
  }

  return evidence;
}

export function buildBarzPhase0(metrics, evidence, blockedReason) {
  const normalizedEvidence = normalizeBarzEvidence(evidence);

  if (blockedReason) {
    return {
      ...BARZ_PHASE,
      status: "withheld",
      evidence: [],
      blockedReason,
      note: "BARZ Phase 1 withholds scores until explicit supporting evidence is attached.",
    };
  }

  if (!normalizedEvidence.length) {
    return {
      ...BARZ_PHASE,
      status: "withheld",
      evidence: [],
      blockedReason: "No explicit evidence objects were available for scoring.",
      note: "BARZ Phase 1 withholds scores until explicit supporting evidence is attached.",
    };
  }

  return {
    ...BARZ_PHASE,
    status: "scored",
    score: clampScore(normalizedEvidence.reduce((total, item) => total + item.points, 0)),
    evidence: normalizedEvidence,
      note: "BARZ Phase 1 scores only from deterministic evidence objects with timestamps, lyric spans, and metric reasons.",
  };
}

export function analyzeRapText(text, options = {}) {
  const normalized = normalizeText(text);
  const beat = normalizeBeat(options.beat);
  const words = wordsFrom(normalized);
  const wordCount = words.length;
  const uniqueWords = new Set(words).size;
  const syllables = words.reduce((total, word) => total + estimateSyllables(word), 0);
  const groups = buildLineLikeGroups(normalized, words);
  const segments = buildGroupSegments(groups, Math.max(0, Math.round(options.durationMs || 0)));
  const endRhymes = endRhymeStats(groups);
  const internal = internalRhymeCandidates(groups);
  const rhymeCandidateCount = endRhymes.pairs + internal.count;
  const durationMs = Math.max(0, Math.round(options.durationMs || 0));
  const durationSeconds = durationMs / 1000;
  const avgWordsPerSecond = durationSeconds > 0 ? Number((wordCount / durationSeconds).toFixed(2)) : 0;
  const avgSyllablesPerSecond = durationSeconds > 0 ? Number((syllables / durationSeconds).toFixed(2)) : 0;
  const estimatedBars = groups.length;
  const measuredSecondsPerBar = estimatedBars > 0 && durationSeconds > 0 ? durationSeconds / estimatedBars : 0;
  const timingAgreementPct = measuredSecondsPerBar
    ? clampScore(100 - (Math.abs(measuredSecondsPerBar - beat.secondsPerBar) / beat.secondsPerBar) * 100)
    : 0;
  const likelyNoBars = wordCount === 0 || (durationSeconds >= 4 && wordCount < 4);
  const blockedReason = likelyNoBars ? "No bars were confidently detected, so BARZ cannot score this take." : "";

  const analysis = {
    wordCount,
    uniqueWords,
    vocabularyVarietyPct: wordCount ? Math.round((uniqueWords / wordCount) * 100) : 0,
    estimatedSyllables: syllables,
    analysisGroups: groups.length,
    endRhymeCandidates: endRhymes.pairs,
    groupsWithEndRhyme: endRhymes.matchedGroups,
    internalRhymeCandidates: internal.count,
    longestEndRhymeChain: endRhymes.longestChain,
    rhymeDensityPct: wordCount ? Math.min(100, Math.round((rhymeCandidateCount / wordCount) * 100)) : 0,
    repeatedWords: repeatedLanguage(words),
    rhymeExamples: internal.examples.map((item) => item.words),
    endRhymeExamples: endRhymes.examples,
    internalRhymeExamples: internal.examples,
    beat,
    durationMs,
    durationSeconds,
    avgWordsPerSecond,
    avgSyllablesPerSecond,
    estimatedBars,
    measuredSecondsPerBar,
    timingAgreementPct,
    silence: {
      likelyNoBars,
      silent: wordCount === 0,
      reason: likelyNoBars
        ? "The transcript did not contain enough bars to produce score evidence."
        : "Transcript contains enough material for evidence-based scoring checks.",
    },
    note:
      "Rhyme counts are deterministic transcript candidates. BARZ only scores when explicit evidence objects are available.",
  };

  const explicitEvidence = Object.prototype.hasOwnProperty.call(options, "evidence")
    ? normalizeBarzEvidence(options.evidence)
    : deriveBarzEvidence({ text: normalized, metrics: analysis, groups, segments, beat });
  const barz = buildBarzPhase0(analysis, explicitEvidence, blockedReason || undefined);
  const mechanics = buildMechanicsReport(normalized, { takeId: options.takeId });
  const scorecard = buildScorecard({
    takeId: options.takeId,
    mechanics,
    mode: options.mode,
    styleCard: options.styleCard,
  });

  return {
    ...analysis,
    evidence: explicitEvidence,
    receipts: explicitEvidence,
    barz,
    mechanics,
    scorecard,
  };
}
