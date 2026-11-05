export const KEEP_OPEN_KEY = "keepOpen";
export const BOUNDS_KEY = "managerBounds";

export async function keepOpenPreference() {
  const stored = await chrome.storage.local.get(KEEP_OPEN_KEY);
  return stored[KEEP_OPEN_KEY] === true;
}

export async function saveKeepOpen(value) {
  await chrome.storage.local.set({ [KEEP_OPEN_KEY]: Boolean(value) });
}

export async function readBounds() {
  const stored = await chrome.storage.local.get(BOUNDS_KEY);
  return stored[BOUNDS_KEY] || null;
}

export async function saveBounds(bounds) {
  await chrome.storage.local.set({ [BOUNDS_KEY]: bounds });
}
