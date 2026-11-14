export type Tool = "pen" | "highlighter" | "eraser" | "text" | "lasso" | "shape" | "laser";
export type Template = "blank" | "lined" | "grid" | "dotted" | "smallgrid" | "cornell" | "wide";
export type PaperColor = "white" | "cream" | "dark";
export type PenType = "fountain" | "ball" | "brush";

export interface Point {
  x: number;
  y: number;
  /** Stylus pressure in [0, 1]; 0.5 for devices that report none. */
  p: number;
}

export interface Stroke {
  id: string;
  tool: "pen" | "highlighter";
  color: string;
  width: number;
  points: Point[];
  /** Ink style of pen strokes; fountain when missing. */
  pen?: PenType;
}

export interface TextBox {
  id: string;
  x: number;
  y: number;
  /** Wrapping width in page units. */
  width: number;
  text: string;
  fontSize: number;
  color: string;
  bold?: boolean;
  /** Clockwise rotation in radians around the box centre. */
  rotation?: number;
}

export interface PageImage {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  /** Image bytes are stored and synced as an attachment. */
  attachment: string;
  /** Clockwise rotation in radians around the image centre. */
  rotation?: number;
}

export interface Page {
  id: string;
  template: Template;
  paper?: PaperColor;
  strokes: Stroke[];
  updatedAt: number;
  deleted?: boolean;
  /** Page size in page units; defaults to PAGE_WIDTH × PAGE_HEIGHT. */
  width?: number;
  height?: number;
  texts?: TextBox[];
  images?: PageImage[];
  /** Paragraphs laid out top to bottom from (x, y), as in a document page. */
  flow?: { x: number; y: number; width: number; paragraphs: { text: string; fontSize: number; bold: boolean }[] };
  /** A PDF page drawn under the ink, referenced by attachment id. */
  background?: { attachment: string; page: number };
  /** Marked with a bookmark in the page sidebar. */
  bookmark?: boolean;
  /** Entry in the notebook outline (table of contents). */
  title?: string;
}

export interface Notebook {
  id: string;
  title: string;
  /** Folder path like "Uni/Physik"; empty for the top level. */
  folder?: string;
  pages: Page[];
  updatedAt: number;
  deleted?: boolean;
  favorite?: boolean;
  /** Cover colour shown in the library; the first page is shown when missing. */
  cover?: string;
}

export const PAGE_WIDTH = 1404;
export const PAGE_HEIGHT = 1872;

export function newId(): string {
  return crypto.randomUUID();
}

export function newPage(template: Template, now = Date.now()): Page {
  return { id: newId(), template, strokes: [], updatedAt: now };
}

export function newNotebook(title: string, now = Date.now()): Notebook {
  return { id: newId(), title, pages: [newPage("lined", now)], updatedAt: now };
}

function newer<T extends { updatedAt: number }>(a: T, b: T): T {
  return b.updatedAt > a.updatedAt ? b : a;
}

/**
 * Merges two replicas of one notebook. Pages merge independently by id with
 * last-writer-wins, so edits to different pages on different devices both
 * survive. Deleted pages stay as tombstones so deletions propagate.
 */
export function mergeNotebook(local: Notebook, remote: Notebook): Notebook {
  const meta = newer(local, remote);
  const order: string[] = [];
  const pages = new Map<string, Page>();
  for (const page of [...meta.pages, ...(meta === local ? remote : local).pages]) {
    const seen = pages.get(page.id);
    if (!seen) order.push(page.id);
    pages.set(page.id, seen ? newer(seen, page) : page);
  }
  return {
    ...meta,
    updatedAt: Math.max(local.updatedAt, remote.updatedAt),
    pages: order.map((id) => pages.get(id)!),
  };
}

export function visiblePages(notebook: Notebook): Page[] {
  return notebook.pages.filter((page) => !page.deleted);
}

/** Attachment ids a page depends on (PDF background and images). */
export function pageAttachments(page: Page): string[] {
  return [...(page.background ? [page.background.attachment] : []), ...(page.images ?? []).map((image) => image.attachment)];
}
