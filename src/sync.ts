import { mergeNotebook, pageAttachments, type Notebook } from "./model";

export interface RemoteStore {
  ensureFolder(): Promise<void>;
  /** All file names in the folder. */
  list(): Promise<string[]>;
  get(name: string): Promise<string>;
  put(name: string, body: string): Promise<void>;
  getBinary(name: string): Promise<Uint8Array>;
  putBinary(name: string, body: Uint8Array): Promise<void>;
}

export interface AttachmentStore {
  get(id: string): Promise<Uint8Array | undefined>;
  put(id: string, bytes: Uint8Array): Promise<unknown>;
}

const fileName = (id: string) => `${id}.kladde.json`;
const attachmentName = (id: string) => `${id}.attachment`;

/**
 * Two-way sync: every notebook is one JSON file in the remote folder. Each side
 * is merged with mergeNotebook and the result is written back where it changed.
 */
export async function syncNotebooks(local: Notebook[], remote: RemoteStore, attachments?: AttachmentStore): Promise<Notebook[]> {
  await remote.ensureFolder();
  const listed = await remote.list();
  const remoteNames = new Set(listed.filter((name) => name.endsWith(".kladde.json")));
  const byId = new Map(local.map((notebook) => [notebook.id, notebook]));

  for (const name of remoteNames) {
    const theirs = JSON.parse(await remote.get(name)) as Notebook;
    const ours = byId.get(theirs.id);
    const merged = ours ? mergeNotebook(ours, theirs) : theirs;
    byId.set(merged.id, merged);
    if (JSON.stringify(merged) !== JSON.stringify(theirs)) {
      await remote.put(name, JSON.stringify(merged));
    }
  }
  for (const notebook of byId.values()) {
    if (!remoteNames.has(fileName(notebook.id))) {
      await remote.put(fileName(notebook.id), JSON.stringify(notebook));
    }
  }
  if (attachments) await syncAttachments([...byId.values()], new Set(listed), remote, attachments);
  return [...byId.values()];
}

/** Attachments are immutable and named by id, so copying missing ones both ways suffices. */
async function syncAttachments(notebooks: Notebook[], listed: Set<string>, remote: RemoteStore, local: AttachmentStore): Promise<void> {
  const ids = new Set(notebooks.flatMap((nb) => nb.pages.flatMap(pageAttachments)));
  for (const id of ids) {
    const name = attachmentName(id);
    const bytes = await local.get(id);
    if (bytes && !listed.has(name)) await remote.putBinary(name, bytes);
    else if (!bytes && listed.has(name)) await local.put(id, await remote.getBinary(name));
  }
}

/**
 * Sync works on a copy so drawing can continue meanwhile. This folds the sync
 * result back into the live notebooks: edits made during the sync are newer
 * and win per page, and notebooks created meanwhile are kept.
 */
export function mergeBack(live: Notebook[], synced: Notebook[]): Notebook[] {
  const byId = new Map(live.map((nb) => [nb.id, nb]));
  const ids = new Set(synced.map((nb) => nb.id));
  return [...synced.map((nb) => (byId.has(nb.id) ? mergeNotebook(byId.get(nb.id)!, nb) : nb)), ...live.filter((nb) => !ids.has(nb.id))];
}
