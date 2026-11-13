import type { Notebook } from "./model";

const DB_NAME = "kladde";
const STORE = "notebooks";
const ATTACHMENTS = "attachments";

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 2);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: "id" });
      if (!db.objectStoreNames.contains(ATTACHMENTS)) db.createObjectStore(ATTACHMENTS);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function run<T>(mode: IDBTransactionMode, body: (store: IDBObjectStore) => IDBRequest<T>, store = STORE): Promise<T> {
  const db = await open();
  return new Promise((resolve, reject) => {
    const request = body(db.transaction(store, mode).objectStore(store));
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export const storage = {
  all: () => run<Notebook[]>("readonly", (s) => s.getAll()),
  put: (notebook: Notebook) => run("readwrite", (s) => s.put(notebook)),
  putAttachment: (id: string, bytes: Uint8Array) => run("readwrite", (s) => s.put(bytes, id), ATTACHMENTS),
  getAttachment: (id: string) => run<Uint8Array | undefined>("readonly", (s) => s.get(id), ATTACHMENTS),
};
