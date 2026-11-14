// Page operations on a notebook. Deleted pages stay in `pages` as tombstones for sync,
// so positions here refer to the visible pages.
import { newId, newPage, visiblePages, type Notebook, type Page } from "./model";

/** A new empty page like `like`: same paper and size, but no PDF background or content. */
export function pageLike(like: Page | undefined, now = Date.now()): Page {
  const page = newPage(like?.template ?? "lined", now);
  if (like?.width) page.width = like.width;
  if (like?.height) page.height = like.height;
  if (like?.paper) page.paper = like.paper;
  return page;
}

/** Inserts `page` after the visible page `after` (or at the end) and returns its visible index. */
export function insertPage(notebook: Notebook, page: Page, after?: Page): number {
  const at = after ? notebook.pages.indexOf(after) + 1 : notebook.pages.length;
  notebook.pages.splice(at, 0, page);
  return visiblePages(notebook).indexOf(page);
}

/** Inserts `page` so it becomes the visible page at `index`. */
export function insertPageAt(notebook: Notebook, page: Page, index: number): void {
  const anchor = visiblePages(notebook)[index];
  notebook.pages.splice(anchor ? notebook.pages.indexOf(anchor) : notebook.pages.length, 0, page);
}

export function duplicatePage(notebook: Notebook, page: Page, now = Date.now()): Page {
  const copy: Page = { ...structuredClone(page), id: newId(), updatedAt: now };
  for (const s of copy.strokes) s.id = newId();
  for (const t of copy.texts ?? []) t.id = newId();
  for (const i of copy.images ?? []) i.id = newId();
  insertPage(notebook, copy, page);
  return copy;
}

/** Moves the visible page at index `from` to visible index `to`. */
export function movePage(notebook: Notebook, from: number, to: number): void {
  const visible = visiblePages(notebook);
  const page = visible[from];
  if (!page || from === to || to < 0 || to >= visible.length) return;
  notebook.pages.splice(notebook.pages.indexOf(page), 1);
  const rest = visiblePages(notebook);
  const anchor = rest[to];
  notebook.pages.splice(anchor ? notebook.pages.indexOf(anchor) : notebook.pages.length, 0, page);
  // Another device only adopts the new order when the notebook itself is newer.
  notebook.updatedAt = Date.now();
}
