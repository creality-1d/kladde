// Recognises what a picked file is and unpacks ZIP archives of many documents,
// so a whole exported Goodnotes library can be imported in one step.
import { unzipSync } from "fflate";
import { newId, newPage, PAGE_WIDTH, type Notebook } from "./model";

export interface ImportItem {
  kind: "goodnotes" | "pdf";
  /** Title derived from the file name. */
  title: string;
  /** Folder path inside the archive, "" at the top level. */
  folder: string;
  bytes: Uint8Array;
}

const isPdf = (bytes: Uint8Array) => bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46; // %PDF
const isZip = (bytes: Uint8Array) => bytes[0] === 0x50 && bytes[1] === 0x4b; // PK
const baseTitle = (name: string) => name.split("/").pop()!.replace(/\.(goodnotes|pdf)$/i, "");

/** Splits a picked file into importable documents. Unknown files yield nothing. */
export function expandImport(name: string, bytes: Uint8Array): ImportItem[] {
  if (isPdf(bytes)) return [{ kind: "pdf", title: baseTitle(name), folder: "", bytes }];
  if (!isZip(bytes)) return [];
  let entries: Record<string, Uint8Array>;
  try {
    entries = unzipSync(bytes);
  } catch {
    return [];
  }
  // A .goodnotes file is itself a ZIP with an event log at its root.
  if (entries["index.events.pb"]) return [{ kind: "goodnotes", title: baseTitle(name), folder: "", bytes }];
  const items: ImportItem[] = [];
  for (const [path, data] of Object.entries(entries)) {
    const parts = path.split("/");
    const file = parts.pop()!;
    if (!file || file.startsWith(".") || parts.some((p) => p === "__MACOSX" || p.startsWith("."))) continue;
    // A single top-level folder is usually the archive's own name, not a user folder.
    const folder = parts.join("/");
    if (/\.goodnotes$/i.test(file)) items.push({ kind: "goodnotes", title: baseTitle(file), folder, bytes: data });
    else if (/\.pdf$/i.test(file) && isPdf(data)) items.push({ kind: "pdf", title: baseTitle(file), folder, bytes: data });
  }
  const roots = new Set(items.map((i) => i.folder.split("/")[0]));
  if (roots.size === 1 && items.every((i) => i.folder)) {
    for (const item of items) item.folder = item.folder.split("/").slice(1).join("/");
  }
  return items;
}

/** Joins folder paths, skipping empty parts. */
export const joinFolder = (...parts: (string | undefined)[]) => parts.filter(Boolean).join("/") || undefined;

/** A notebook whose pages are the pages of a PDF, sized like the PDF (in page units). */
export function notebookFromPdf(title: string, attachment: string, sizes: readonly { width: number; height: number }[], now = Date.now()): Notebook {
  return {
    id: newId(),
    title,
    updatedAt: now,
    pages: sizes.map((size, page) => ({
      ...newPage("blank", now),
      width: PAGE_WIDTH,
      height: (PAGE_WIDTH * size.height) / size.width,
      background: { attachment, page },
    })),
  };
}
