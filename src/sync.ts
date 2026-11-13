import { mergeNotebook, type Notebook } from "./model";

export interface RemoteStore {
  ensureFolder(): Promise<void>;
  list(): Promise<string[]>;
  get(name: string): Promise<string>;
  put(name: string, body: string): Promise<void>;
}

const fileName = (id: string) => `${id}.inknote.json`;

/**
 * Two-way sync: every notebook is one JSON file in the remote folder. Each side
 * is merged with mergeNotebook and the result is written back where it changed.
 */
export async function syncNotebooks(local: Notebook[], remote: RemoteStore): Promise<Notebook[]> {
  await remote.ensureFolder();
  const remoteNames = new Set(await remote.list());
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
  return [...byId.values()];
}
