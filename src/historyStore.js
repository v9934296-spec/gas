import AsyncStorage from "@react-native-async-storage/async-storage";

const STORAGE_KEY = "raplab:takes:v1";

export async function loadTakes() {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export async function saveTake(take) {
  const existing = await loadTakes();
  const next = [take, ...existing.filter((item) => item.id !== take.id)].slice(0, 100);
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  return next;
}

export async function deleteTake(id) {
  const existing = await loadTakes();
  const next = existing.filter((item) => item.id !== id);
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  return next;
}
