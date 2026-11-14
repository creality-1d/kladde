import type { Notebook, Page } from "./model";

const DB_NAME = "kladde";
/** Notebook metadata; `pages` is empty and `pageIds` keeps the order. */
const STORE = "notebooks";
/** One record per page, keyed `notebookId:pageId`, so an edit writes only its page. */
const PAGES = "pages";
const ATTACHMENTS = "attachments";
/** Search index: recognised handwriting and PDF text per page, rebuilt on each device, not synced. */
const INDEX = "index";
/** Writing pauses this long before changes are stored, so a burst of strokes costs one write. */
const SAVE_DELAY = 400;

type StoredNotebook = Omit<Notebook, "pages"> & { pages: Page[]; pageIds?: string[] };
interface StoredPage {
  nb: string;
  page: Page;
}

const pageKey = (nb: string, page: string) => `${nb}:${page}`;

/** Splits a notebook into its metadata record and page records. */
export function splitNotebook(nb: Notebook): { meta: StoredNotebook; pages: [string, StoredPage][] } {
  return {
    meta: { ...nb, pages: [], pageIds: nb.pages.map((p) => p.id) },
    pages: nb.pages.map((page) => [pageKey(nb.id, page.id), { nb: nb.id, page }]),
  };
}

/** Puts notebooks back together; also reads the old format with pages inline. */
export function joinNotebooks(metas: StoredNotebook[], pages: StoredPage[]): Notebook[] {
  const byNotebook = new Map<string, Map<string, Page>>();
  for (const { nb, page } of pages) {
    if (!byNotebook.has(nb)) byNotebook.set(nb, new Map());
    byNotebook.get(nb)!.set(page.id, page);
  }
  return metas.map(({ pageIds, ...meta }) => {
    if (!pageIds) return meta as Notebook;
    const own = byNotebook.get(meta.id) ?? new Map<string, Page>();
    const ordered = pageIds.map((id) => own.get(id)).filter((p): p is Page => !!p);
    // Pages without a place in the order (should not happen) are kept at the end rather than lost.
    const listed = new Set(pageIds);
    for (const [id, page] of own) if (!listed.has(id)) ordered.push(page);
    return { ...meta, pages: ordered };
  });
}

let db: Promise<IDBDatabase> | undefined;
function open(): Promise<IDBDatabase> {
  db ??= new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 4);
    request.onupgradeneeded = (event) => {
      const result = request.result;
      if (!result.objectStoreNames.contains(STORE)) result.createObjectStore(STORE, { keyPath: "id" });
      if (!result.objectStoreNames.contains(ATTACHMENTS)) result.createObjectStore(ATTACHMENTS);
      if (!result.objectStoreNames.contains(PAGES)) result.createObjectStore(PAGES);
      if (!result.objectStoreNames.contains(INDEX)) result.createObjectStore(INDEX, { keyPath: "key" });
      if (event.oldVersion > 0 && event.oldVersion < 3) {
        // Move inline pages into their own records.
        const tx = request.transaction!;
        const pages = tx.objectStore(PAGES);
        tx.objectStore(STORE).openCursor().onsuccess = (e) => {
          const cursor = (e.target as IDBRequest<IDBCursorWithValue | null>).result;
          if (!cursor) return;
          const old = cursor.value as StoredNotebook;
          if (!old.pageIds) {
            const split = splitNotebook(old as Notebook);
            for (const [key, value] of split.pages) pages.put(value, key);
            cursor.update(split.meta);
          }
          cursor.continue();
        };
      }
    };
    request.onsuccess = () => {
      const result = request.result;
      // The connection can be closed by the system (e.g. iOS in the background); reopen next time.
      result.onclose = () => (db = undefined);
      result.onversionchange = () => {
        result.close();
        db = undefined;
      };
      resolve(result);
    };
    request.onerror = () => {
      db = undefined;
      reject(request.error);
    };
  });
  return db;
}

function done(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error ?? new Error("aborted"));
  });
}

function request<T>(r: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

/** updatedAt of every page as last written, to skip unchanged pages. */
const written = new Map<string, number>();
const pending = new Map<string, Notebook>();
let timer: ReturnType<typeof setTimeout> | undefined;
let onError: (error: unknown) => void = () => {};
let onSaved: () => void = () => {};

async function write(notebooks: Notebook[], all: boolean): Promise<void> {
  const database = await open();
  const tx = database.transaction([STORE, PAGES], "readwrite");
  const metas = tx.objectStore(STORE);
  const pages = tx.objectStore(PAGES);
  const marks: [string, number][] = [];
  for (const nb of notebooks) {
    const split = splitNotebook(nb);
    metas.put(split.meta);
    for (const [key, value] of split.pages) {
      if (!all && written.get(key) === value.page.updatedAt) continue;
      pages.put(value, key);
      marks.push([key, value.page.updatedAt]);
    }
  }
  await done(tx);
  for (const [key, at] of marks) written.set(key, at);
}

async function flush(): Promise<void> {
  clearTimeout(timer);
  timer = undefined;
  const batch = [...pending.values()];
  pending.clear();
  if (!batch.length) return;
  try {
    await write(batch, false);
    onSaved();
  } catch (error) {
    // Keep them queued so the next change or flush retries.
    for (const nb of batch) if (!pending.has(nb.id)) pending.set(nb.id, nb);
    onError(error);
  }
}

export const storage = {
  async all(): Promise<Notebook[]> {
    const database = await open();
    const tx = database.transaction([STORE, PAGES], "readonly");
    const [metas, keys, pages] = await Promise.all([
      request(tx.objectStore(STORE).getAll() as IDBRequest<StoredNotebook[]>),
      request(tx.objectStore(PAGES).getAllKeys()),
      request(tx.objectStore(PAGES).getAll() as IDBRequest<StoredPage[]>),
    ]);
    keys.forEach((key, i) => written.set(String(key), pages[i].page.updatedAt));
    return joinNotebooks(metas, pages);
  },
  /** Stores right away, every page (for imports, restores and sync results). */
  put(notebook: Notebook): Promise<void> {
    pending.delete(notebook.id);
    return write([notebook], true);
  },
  /** Stores after writing pauses, only pages whose updatedAt changed; use for every edit. */
  save(notebook: Notebook): void {
    pending.set(notebook.id, notebook);
    clearTimeout(timer);
    timer = setTimeout(() => void flush(), SAVE_DELAY);
  },
  flush,
  get unsaved() {
    return pending.size;
  },
  onError(handler: (error: unknown) => void, saved: () => void = () => {}) {
    onError = handler;
    onSaved = saved;
  },
  putAttachment: async (id: string, bytes: Uint8Array) => {
    const tx = (await open()).transaction(ATTACHMENTS, "readwrite");
    tx.objectStore(ATTACHMENTS).put(bytes, id);
    await done(tx);
  },
  allIndex: async <T>() => request((await open()).transaction(INDEX).objectStore(INDEX).getAll() as IDBRequest<T[]>),
  putIndex: async (entry: { key: string }) => {
    const tx = (await open()).transaction(INDEX, "readwrite");
    tx.objectStore(INDEX).put(entry);
    await done(tx);
  },
  getAttachment: async (id: string) => request((await open()).transaction(ATTACHMENTS).objectStore(ATTACHMENTS).get(id) as IDBRequest<Uint8Array | undefined>),
};

/** Asks the browser not to evict our data under storage pressure. */
export async function persistStorage(): Promise<boolean> {
  try {
    if (await navigator.storage?.persisted?.()) return true;
    return (await navigator.storage?.persist?.()) ?? false;
  } catch {
    return false;
  }
}
