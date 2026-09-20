const STOP_WORDS = new Set([
  "a", "an", "and", "are", "as", "at", "be", "but", "by", "for", "from", "had", "has",
  "have", "he", "her", "his", "i", "if", "in", "is", "it", "its", "me", "my", "of", "on",
  "or", "our", "she", "so", "that", "the", "their", "them", "they", "this", "to", "was", "we",
  "were", "with", "you", "your",
]);

function wordsFrom(text) {
  return (text.toLowerCase().match(/[a-z0-9']+/g) || []).filter(Boolean);
}

function estimateSyllables(word) {
  const cleaned = word.toLowerCase().replace(/[^a-z]/g, "");
  if (!cleaned) return 0;
  if (cleaned.length <= 3) return 1;

  let candidate = cleaned;
  if (candidate.endsWith("e") && !candidate.endsWith("le")) {
    candidate = candidate.slice(0, -1);
  }

  const groups = candidate.match(/[aeiouy]+/g);
  return Math.max(1, groups ? groups.length : 1);
}

function rhymeKey(word) {
  let value = word.toLowerCase().replace(/[^a-z]/g, "");
  if (value.length < 3) return "";

  value = value
    .replace(/ph/g, "f")
    .replace(/ck/g, "k")
    .replace(/ght$/g, "t")
    .replace(/tion$/g, "shun")
    .replace(/sion$/g, "zhun");

  // This is deliberately a spelling-based rhyme candidate key, not a phonetic claim.
  // Prefer a 3-letter tail; 4 letters for longer words helps reduce false positives.
  const size = value.length >= 7 ? 4 : 3;
  return value.slice(-size);
}

function buildLineLikeGroups(text, words) {
  const explicit = text
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean);

  if (explicit.length >= 2) {
    return explicit.map((line) => wordsFrom(line));
  }

  const punctuated = text
    .split(/[.!?;]+/)
    .map((line) => wordsFrom(line))
    .filter((line) => line.length > 0);

  if (punctuated.length >= 2) return punctuated;

  // Speech recognition often returns one paragraph. Eight-word groups give us a
  // repeatable structure for candidate analysis without pretending they are true bars.
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
  for (let i = 0; i < endings.length; i += 1) {
    for (let j = i + 1; j < endings.length; j += 1) {
      if (endings[i].word !== endings[j].word && endings[i].key === endings[j].key) {
        pairs += 1;
        matched.add(endings[i].index);
        matched.add(endings[j].index);
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
  };
}

function internalRhymeCandidates(groups) {
  let count = 0;
  const examples = [];

  for (const group of groups) {
    const buckets = new Map();
    for (const word of group) {
      const key = rhymeKey(word);
      if (!key) continue;
      if (!buckets.has(key)) buckets.set(key, new Set());
      buckets.get(key).add(word);
    }

    for (const bucket of buckets.values()) {
      const unique = [...bucket];
      if (unique.length < 2) continue;
      count += (unique.length * (unique.length - 1)) / 2;
      if (examples.length < 4) examples.push(unique.slice(0, 3));
    }
  }

  return { count, examples };
}

export function analyzeRapText(text) {
  const words = wordsFrom(text);
  const wordCount = words.length;
  const uniqueWords = new Set(words).size;
  const syllables = words.reduce((total, word) => total + estimateSyllables(word), 0);
  const groups = buildLineLikeGroups(text, words);
  const endRhymes = endRhymeStats(groups);
  const internal = internalRhymeCandidates(groups);
  const rhymeCandidateCount = endRhymes.pairs + internal.count;

  return {
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
    rhymeExamples: internal.examples,
    note:
      "Rhyme counts are spelling-based candidates from the transcript. They are useful for pattern spotting, not phonetic proof.",
  };
}
