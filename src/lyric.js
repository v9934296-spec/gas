export const STOP_WORDS = new Set([
  "a", "an", "and", "are", "as", "at", "be", "but", "by", "for", "from", "had", "has",
  "have", "he", "her", "his", "i", "if", "in", "is", "it", "its", "me", "my", "of", "on",
  "or", "our", "she", "so", "that", "the", "their", "them", "they", "this", "to", "was", "we",
  "were", "with", "you", "your",
]);

export const FILLER_WORDS = new Set(["like", "uh", "um", "uhh", "basically", "kinda", "literally"]);

export function normalizeText(text) {
  return typeof text === "string" ? text : "";
}

export function wordsFrom(text) {
  return (normalizeText(text).toLowerCase().match(/[a-z0-9']+/g) || []).filter(Boolean);
}

export function estimateSyllables(word) {
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

export function rhymeKey(word) {
  let value = word.toLowerCase().replace(/[^a-z]/g, "");
  if (value.length < 3) return "";

  value = value
    .replace(/ph/g, "f")
    .replace(/ck/g, "k")
    .replace(/ght$/g, "t")
    .replace(/tion$/g, "shun")
    .replace(/sion$/g, "zhun");

  const size = value.length >= 7 ? 4 : 3;
  return value.slice(-size);
}

export function clampScore(value) {
  return Math.max(0, Math.min(100, Math.round(value)));
}

export function clampTen(value) {
  if (value == null || Number.isNaN(value)) return null;
  return Math.max(0, Math.min(10, Math.round(value * 10) / 10));
}

export function normalizeWhitespace(text) {
  return normalizeText(text).toLowerCase().replace(/\s+/g, " ").trim();
}
