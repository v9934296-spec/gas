import {
  FILLER_WORDS,
  estimateSyllables,
  normalizeText,
  rhymeKey,
  wordsFrom,
} from "./lyric.js";

const MIN_BAR_SYLLABLES = 8;
const MAX_BAR_SYLLABLES = 14;

function lineSyllables(words) {
  return words.reduce((total, word) => total + estimateSyllables(word), 0);
}

function splitExplicitLines(text) {
  return normalizeText(text)
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function splitPunctuated(text) {
  return normalizeText(text)
    .split(/[.!?;]+/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function packBySyllableBudget(words) {
  const bars = [];
  let current = [];
  let syllables = 0;

  for (const word of words) {
    const next = estimateSyllables(word);
    if (current.length && syllables + next > MAX_BAR_SYLLABLES && syllables >= MIN_BAR_SYLLABLES) {
      bars.push(current);
      current = [word];
      syllables = next;
      continue;
    }
    current.push(word);
    syllables += next;
  }

  if (current.length) bars.push(current);
  return bars;
}

function mergeShortFragments(fragments) {
  const bars = [];
  let current = [];

  for (const fragment of fragments) {
    const words = wordsFrom(fragment);
    if (!words.length) continue;
    const combined = current.concat(words);
    const syllables = lineSyllables(combined);
    if (!current.length || syllables <= MAX_BAR_SYLLABLES) {
      current = combined;
      if (syllables >= MIN_BAR_SYLLABLES) {
        bars.push(current);
        current = [];
      }
      continue;
    }
    if (current.length) bars.push(current);
    current = words;
    if (lineSyllables(current) >= MIN_BAR_SYLLABLES) {
      bars.push(current);
      current = [];
    }
  }

  if (current.length) bars.push(current);
  return bars;
}

export function splitBars(text) {
  const explicit = splitExplicitLines(text);
  if (explicit.length >= 4) {
    return explicit.map((line) => wordsFrom(line)).filter((words) => words.length);
  }

  const punctuated = splitPunctuated(text);
  if (punctuated.length >= 3) {
    const merged = mergeShortFragments(punctuated);
    if (merged.length >= 2) return merged;
  }

  const words = wordsFrom(text);
  return packBySyllableBudget(words);
}

function charSpanForWords(barText, spanWords) {
  const haystack = barText.toLowerCase();
  const needle = spanWords.join(" ").toLowerCase();
  const start = haystack.indexOf(needle);
  if (start < 0) return [0, barText.length];
  return [start, start + needle.length];
}

function guessScheme(endings) {
  const keys = endings.map((item) => item.key).filter(Boolean);
  if (keys.length < 2) return null;
  if (keys.every((key) => key === keys[0])) return "AAAA";

  const pairs = [];
  for (let i = 0; i + 1 < keys.length; i += 2) {
    pairs.push(keys[i] === keys[i + 1]);
  }
  if (pairs.length >= 2 && pairs.every(Boolean)) return "AABB";

  if (keys.length >= 4) {
    const abab = keys[0] === keys[2] && keys[1] === keys[3] && keys[0] !== keys[1];
    if (abab) return "ABAB";
  }

  return "free";
}

function longestRepeatRun(words) {
  let longest = 1;
  let run = 1;
  for (let i = 1; i < words.length; i += 1) {
    if (words[i] === words[i - 1]) {
      run += 1;
      longest = Math.max(longest, run);
    } else {
      run = 1;
    }
  }
  return words.length ? longest : 0;
}

export function buildMechanicsReport(text, options = {}) {
  const normalized = normalizeText(text);
  const allWords = wordsFrom(normalized);
  const groups = splitBars(normalized);
  let wordCursor = 0;

  const bars = groups.map((words, i) => {
    const start = wordCursor;
    wordCursor += words.length;
    const barText = words.join(" ");
    const last = words[words.length - 1] || "";
    const internals = [];
    const buckets = new Map();
    words.forEach((word, wordIndex) => {
      const key = rhymeKey(word);
      if (!key) return;
      if (!buckets.has(key)) buckets.set(key, []);
      buckets.get(key).push({ word, wordIndex });
    });
    for (const [key, hits] of buckets.entries()) {
      const unique = [...new Set(hits.map((item) => item.word))];
      if (unique.length < 2) continue;
      internals.push({
        kind: "internal",
        phoneme_key: key,
        words: unique.slice(0, 4),
      });
    }

    return {
      i,
      text: barText,
      syllables: lineSyllables(words),
      word_ids: Array.from({ length: words.length }, (_, offset) => start + offset),
      end_phonemes: rhymeKey(last),
      internals,
    };
  });

  const endings = bars
    .map((bar) => {
      const words = wordsFrom(bar.text);
      const word = words[words.length - 1];
      return word && bar.end_phonemes ? { i: bar.i, word, key: bar.end_phonemes, text: bar.text } : null;
    })
    .filter(Boolean);

  const rhyme_links = [];
  const seen = new Set();
  for (let a = 0; a < endings.length; a += 1) {
    for (let b = a + 1; b < endings.length; b += 1) {
      if (endings[a].word === endings[b].word || endings[a].key !== endings[b].key) continue;
      const stamp = `${endings[a].i}:${endings[b].i}:${endings[a].key}`;
      if (seen.has(stamp)) continue;
      seen.add(stamp);
      rhyme_links.push({
        a_bar: endings[a].i,
        b_bar: endings[b].i,
        a_span: charSpanForWords(endings[a].text, [endings[a].word]),
        b_span: charSpanForWords(endings[b].text, [endings[b].word]),
        kind: "perfect",
        phoneme_key: endings[a].key,
      });
    }
  }

  for (const bar of bars) {
    for (const hit of bar.internals) {
      const spanWords = hit.words.slice(0, 2);
      rhyme_links.push({
        a_bar: bar.i,
        b_bar: bar.i,
        a_span: charSpanForWords(bar.text, [spanWords[0]]),
        b_span: charSpanForWords(bar.text, [spanWords[1] || spanWords[0]]),
        kind: "internal",
        phoneme_key: hit.phoneme_key,
      });
    }
  }

  const uniqueWords = new Set(allWords).size;
  const fillerHits = allWords.filter((word) => FILLER_WORDS.has(word)).length;
  const syllableValues = bars.map((bar) => bar.syllables);
  const meanSyllables = syllableValues.length
    ? syllableValues.reduce((sum, value) => sum + value, 0) / syllableValues.length
    : 0;
  const variance = syllableValues.length
    ? syllableValues.reduce((sum, value) => sum + ((value - meanSyllables) ** 2), 0) / syllableValues.length
    : 0;
  const linkedEnds = new Set(rhyme_links.filter((link) => link.kind !== "internal").flatMap((link) => [link.a_bar, link.b_bar]));

  return {
    take_id: options.takeId || null,
    bars,
    rhyme_links,
    stats: {
      bar_count: bars.length,
      mean_syllables: Number(meanSyllables.toFixed(1)),
      syllable_stdev: Number(Math.sqrt(variance).toFixed(1)),
      rhyme_density: bars.length ? Number((linkedEnds.size / bars.length).toFixed(2)) : 0,
      multi_count: 0,
      internal_count: bars.reduce((sum, bar) => sum + bar.internals.length, 0),
      unique_word_ratio: allWords.length ? Number((uniqueWords / allWords.length).toFixed(2)) : 0,
      filler_ratio: allWords.length ? Number((fillerHits / allWords.length).toFixed(2)) : 0,
      longest_repeat_run: longestRepeatRun(allWords),
    },
    scheme_guess: guessScheme(endings),
  };
}
