// Tiny IndexedDB queue for "add item" actions made while offline. Each queued
// action carries a clientId so we can match it against the sync response and
// drop it once the server confirms it was applied.
const DB_NAME = "bazar-offline";
const STORE = "pending-items";

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      req.result.createObjectStore(STORE, { keyPath: "clientId" });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function queueItem(action) {
  const clientId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const db = await openDB();
  await new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put({ ...action, clientId, queuedAt: Date.now() });
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
  return clientId;
}

export async function getQueuedItems() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readonly");
    const req = tx.objectStore(STORE).getAll();
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function removeQueuedItems(clientIds) {
  const db = await openDB();
  await new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    const store = tx.objectStore(STORE);
    clientIds.forEach((id) => store.delete(id));
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
}

// Sends all queued items to the server in one batch; removes the ones that
// succeeded. Returns { synced, failed } counts. Safe to call repeatedly —
// does nothing if the queue is empty or the request fails outright (offline).
export async function syncQueuedItems(API, headers) {
  const queued = await getQueuedItems();
  if (queued.length === 0) return { synced: 0, failed: 0 };

  try {
    const res = await fetch(`${API}/sync-items`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers },
      body: JSON.stringify({
        actions: queued.map((q) => ({
          clientId: q.clientId,
          subcategoryId: q.subcategoryId,
          name: q.name,
          price: q.price,
          desc: q.desc,
          img: q.img,
        })),
      }),
    });
    if (!res.ok) return { synced: 0, failed: 0 };
    const { results } = await res.json();
    const succeededIds = results.filter((r) => r.ok).map((r) => r.clientId);
    await removeQueuedItems(succeededIds);
    return { synced: succeededIds.length, failed: results.length - succeededIds.length };
  } catch {
    return { synced: 0, failed: 0 }; // still offline or server unreachable
  }
}
