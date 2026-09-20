import AsyncStorage from "@react-native-async-storage/async-storage";

const STORAGE_KEY = "raplab:takes:v1";
let mutationQueue = Promise.resolve();

async function readStoredTakesStrict() {
  const raw = await AsyncStorage.getItem(STORAGE_KEY);
  const parsed = raw ? JSON.parse(raw) : [];

  if (!Array.isArray(parsed)) {
    throw new Error("Stored takes payload is invalid.");
  }

  return parsed;
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
      const next = [take, ...existing.filter((item) => item.id !== take.id)].slice(0, 100);
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
