const DB_NAME = "bazar-offline";
const STORE_NAME = "mutations";
const DB_VERSION = 1;

const openDb = () => new Promise((resolve, reject) => {
  if (!window.indexedDB) return reject(new Error("Offline storage is unavailable in this browser."));
  const request = window.indexedDB.open(DB_NAME, DB_VERSION);
  request.onupgradeneeded = () => {
    const db = request.result;
    if (!db.objectStoreNames.contains(STORE_NAME)) {
      db.createObjectStore(STORE_NAME, { keyPath: "id", autoIncrement: true });
    }
  };
  request.onsuccess = () => resolve(request.result);
  request.onerror = () => reject(request.error);
});

const requestFromStore = async (mode, value) => {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, mode === "getAll" ? "readonly" : "readwrite");
    const store = transaction.objectStore(STORE_NAME);
    const request = mode === "add" ? store.add(value) : mode === "delete" ? store.delete(value) : store.getAll();
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    transaction.oncomplete = () => db.close();
    transaction.onerror = () => reject(transaction.error);
  });
};

export const queueItemMutation = (mutation) => requestFromStore("add", {
  ...mutation,
  createdAt: new Date().toISOString(),
});

export const getQueuedItemMutations = async () => {
  const mutations = await requestFromStore("getAll");
  return mutations.sort((a, b) => a.id - b.id);
};

export const queuedItemMutationCount = async () => (await getQueuedItemMutations()).length;

// Passwords are deliberately never persisted.  The current signed-in admin
// session supplies it when connectivity returns, so queued mutations remain
// on the device but cannot be replayed by anyone who opens its IndexedDB.
export const replayItemMutations = async ({ api, password, onApplied }) => {
  const queued = await getQueuedItemMutations();
  let applied = 0;
  for (const mutation of queued) {
    try {
      const response = await fetch(`${api}${mutation.path}`, {
        method: mutation.method,
        headers: { "Content-Type": "application/json", "x-admin-password": password },
        body: mutation.body ? JSON.stringify(mutation.body) : undefined,
      });
      // A network/server failure can recover later, so leave the remaining
      // mutations in their original order.  Validation/auth failures remain
      // visible in the queue instead of silently throwing away user data.
      if (!response.ok) break;
      await requestFromStore("delete", mutation.id);
      applied += 1;
      onApplied?.(mutation);
    } catch {
      break;
    }
  }
  return { applied, remaining: await queuedItemMutationCount() };
};
