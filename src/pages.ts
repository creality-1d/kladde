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

/** How close (page units) ink may come to a whiteboard edge before it grows. */
const GROW_MARGIN = 350;
const MAX_BOARD = 14040;

/**
 * Grows a whiteboard page when content comes near an edge. Growing left or up
 * shifts the content; the returned offset lets the caller keep the view still.
 */
export function growWhiteboard(page: Page): { dx: number; dy: number } | undefined {
  const xs: number[] = [];
  const ys: number[] = [];
  for (const s of page.strokes) for (const q of s.points) xs.push(q.x), ys.push(q.y);
  for (const t of page.texts ?? []) xs.push(t.x, t.x + t.width), ys.push(t.y, t.y + t.fontSize * 1.4);
  for (const i of page.images ?? []) xs.push(i.x, i.x + i.width), ys.push(i.y, i.y + i.height);
  if (!xs.length) return undefined;
  const w = page.width ?? 1404;
  const h = page.height ?? 1872;
  const [minX, maxX, minY, maxY] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  const stepX = 1404;
  const stepY = 1053;
  const left = minX < GROW_MARGIN && w + stepX <= MAX_BOARD ? stepX : 0;
  const top = minY < GROW_MARGIN && h + stepY <= MAX_BOARD ? stepY : 0;
  const right = maxX > w - GROW_MARGIN && w + left + stepX <= MAX_BOARD ? stepX : 0;
  const bottom = maxY > h - GROW_MARGIN && h + top + stepY <= MAX_BOARD ? stepY : 0;
  if (!left && !top && !right && !bottom) return undefined;
  page.width = w + left + right;
  page.height = h + top + bottom;
  if (left || top) {
    for (const s of page.strokes) s.points = s.points.map((q) => ({ ...q, x: q.x + left, y: q.y + top }));
    for (const t of page.texts ?? []) Object.assign(t, { x: t.x + left, y: t.y + top });
    for (const i of page.images ?? []) Object.assign(i, { x: i.x + left, y: i.y + top });
  }
  return { dx: left, dy: top };
}
