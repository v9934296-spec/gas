import AsyncStorage from "@react-native-async-storage/async-storage";
import { buildBarzPhase0, normalizeBarzEvidence } from "./analyzeRap";

const STORAGE_KEY = "raplab:takes:v1";
let mutationQueue = Promise.resolve();

async function readStoredTakesStrict() {
  const raw = await AsyncStorage.getItem(STORAGE_KEY);
  const parsed = raw ? JSON.parse(raw) : [];

  if (!Array.isArray(parsed)) {
    throw new Error("Stored takes payload is invalid.");
  }

  return parsed.map(sanitizeTakeScoreInvariant);
}

function sanitizeTakeScoreInvariant(take) {
  if (!take || typeof take !== "object") return take;
  const currentBarz = take.analysis?.barz || {};
  const normalizedEvidence = normalizeBarzEvidence(currentBarz.evidence);
  const nextBarz = buildBarzPhase0(take.analysis || {}, normalizedEvidence, currentBarz.blockedReason);

  return {
    ...take,
    analysis: {
      ...(take.analysis || {}),
      barz: nextBarz,
      evidence: normalizedEvidence,
      receipts: normalizedEvidence,
    },
  };
}

export async function loadTakes() {
  try {
    return await readStoredTakesStrict();
  } catch (error) {
    console.error("LOAD_TAKES_FAILED", error);
    return [];
  }
}

export async function saveTake(take) {
  mutationQueue = mutationQueue
    .catch(() => undefined)
    .then(async () => {
      const existing = await readStoredTakesStrict();
      const nextTake = sanitizeTakeScoreInvariant(take);
      const next = [nextTake, ...existing.filter((item) => item.id !== take.id)].slice(0, 100);
      await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      return next;
    });

  return mutationQueue;
}

export async function deleteTake(id) {
  mutationQueue = mutationQueue
    .catch(() => undefined)
    .then(async () => {
      const existing = await readStoredTakesStrict();
      const next = existing.filter((item) => item.id !== id);
      await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      return next;
    });

  return mutationQueue;
}
