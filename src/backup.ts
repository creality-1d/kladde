import { unzipSync, zipSync } from "fflate";
import { mergeNotebook, notebookAttachments, type Notebook } from "./model";

const MANIFEST = "kladde-backup.json";

interface Manifest {
  app: "kladde";
  version: 1;
  createdAt: number;
  notebooks: Notebook[];
}

/** One ZIP with every notebook (also the ones in the trash) and the PDFs and images they use. */
export async function createBackup(notebooks: Notebook[], getAttachment: (id: string) => Promise<Uint8Array | undefined>, now = Date.now()): Promise<Uint8Array> {
  const files: Record<string, Uint8Array> = {};
  const manifest: Manifest = { app: "kladde", version: 1, createdAt: now, notebooks };
  files[MANIFEST] = new TextEncoder().encode(JSON.stringify(manifest));
  const ids = new Set(notebooks.flatMap(notebookAttachments));
  for (const id of ids) {
    const bytes = await getAttachment(id);
    // PDFs and JPEGs are already compressed.
    if (bytes) files[`attachments/${id}`] = bytes;
  }
  return zipSync(Object.fromEntries(Object.entries(files).map(([name, bytes]) => [name, [bytes, { level: name === MANIFEST ? 6 : 0 }]])));
}

export function isBackup(bytes: Uint8Array): boolean {
  if (bytes[0] !== 0x50 || bytes[1] !== 0x4b) return false;
  try {
    return MANIFEST in unzipSync(bytes, { filter: (file) => file.name === MANIFEST });
  } catch {
    return false;
  }
}

export interface Restored {
  notebooks: Notebook[];
  attachments: Map<string, Uint8Array>;
  added: number;
  updated: number;
}

/**
 * Reads a backup and merges it into the current notebooks. Nothing is lost:
 * pages merge like a sync, so newer local edits win over an old backup.
 */
export function restoreBackup(bytes: Uint8Array, current: Notebook[]): Restored {
  const files = unzipSync(bytes);
  if (!files[MANIFEST]) throw new Error("Keine Kladde-Sicherung");
  const manifest = JSON.parse(new TextDecoder().decode(files[MANIFEST])) as Manifest;
  if (manifest.app !== "kladde" || !Array.isArray(manifest.notebooks)) throw new Error("Keine Kladde-Sicherung");
  const byId = new Map(current.map((nb) => [nb.id, nb]));
  let added = 0;
  let updated = 0;
  const notebooks: Notebook[] = [];
  for (const nb of manifest.notebooks) {
    const ours = byId.get(nb.id);
    if (!ours) {
      added++;
      notebooks.push(nb);
      continue;
    }
    const merged = mergeNotebook(ours, nb);
    if (JSON.stringify(merged) !== JSON.stringify(ours)) {
      updated++;
      notebooks.push(merged);
    }
  }
  const attachments = new Map<string, Uint8Array>();
  for (const [name, data] of Object.entries(files)) if (name.startsWith("attachments/")) attachments.set(name.slice("attachments/".length), data);
  return { notebooks, attachments, added, updated };
}
