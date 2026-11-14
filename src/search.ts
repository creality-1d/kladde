import type { Notebook, Page } from "./model";
import { visiblePages } from "./model";

/** A piece of text on a page with its box in page units (w = 0: position unknown). */
export interface TextRun {
  text: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Index record: handwriting (`ink:<pageId>`) or PDF text (`pdf:<attachment>:<page>:<width>`). */
export interface IndexEntry {
  key: string;
  /** Page updatedAt the handwriting was recognised at; PDFs never change. */
  at: number;
  runs: TextRun[];
}

export const inkKey = (p: Page) => `ink:${p.id}`;
export const pdfKey = (p: Page) => p.background && `pdf:${p.background.attachment}:${p.background.page}:${Math.round(p.width ?? 1404)}`;

/** Case- and accent-insensitive form used for matching. */
export function normalize(s: string): string {
  return s.toLowerCase().normalize("NFKD").replace(/\p{M}/gu, "").replace(/ß/g, "ss").replace(/\s+/g, " ");
}

/** All text runs of a page: typed text, imported text flow, PDF text and recognised handwriting. */
export function pageRuns(p: Page, index: ReadonlyMap<string, IndexEntry>): TextRun[] {
  const runs: TextRun[] = [];
  for (const t of p.texts ?? []) {
    // Rough height; only used to place the highlight.
    const lines = t.text.split("\n").reduce((n, line) => n + Math.max(1, Math.ceil((line.length * t.fontSize * 0.5) / Math.max(40, t.width))), 0);
    runs.push({ text: t.text, x: t.x, y: t.y, w: t.width, h: lines * t.fontSize * 1.3 });
  }
  for (const para of p.flow?.paragraphs ?? []) runs.push({ text: para.text, x: 0, y: 0, w: 0, h: 0 });
  if (p.title) runs.push({ text: p.title, x: 0, y: 0, w: 0, h: 0 });
  const pdf = pdfKey(p);
  if (pdf) runs.push(...(index.get(pdf)?.runs ?? []));
  runs.push(...(index.get(inkKey(p))?.runs ?? []));
  return runs;
}

export interface PageHit {
  page: Page;
  /** Position among the visible pages. */
  index: number;
  boxes: TextRun[];
  snippet: string;
}

/** Pages of a notebook that contain the query, with the boxes to highlight. */
export function searchNotebook(nb: Notebook, query: string, index: ReadonlyMap<string, IndexEntry>): PageHit[] {
  const q = normalize(query.trim());
  if (!q) return [];
  const hits: PageHit[] = [];
  visiblePages(nb).forEach((page, i) => {
    const runs = pageRuns(page, index);
    const matching = runs.filter((r) => normalize(r.text).includes(q));
    // PDF text often comes in fragments; also match across neighbouring runs.
    const raw = runs.map((r) => r.text).join(" ").replace(/\s+/g, " ");
    const joined = normalize(raw);
    if (!matching.length && !joined.includes(q)) return;
    const first = q.split(" ")[0];
    const boxes = (matching.length ? matching : runs.filter((r) => normalize(r.text).includes(first))).filter((r) => r.w > 0);
    const at = joined.indexOf(q);
    const start = Math.max(0, at - 30);
    // Normalising keeps positions for ordinary text, so the snippet can show the original spelling.
    const from = raw.length === joined.length ? raw : joined;
    const snippet = at < 0 ? "" : (start > 0 ? "…" : "") + from.slice(start, at + q.length + 40).trim() + (at + q.length + 40 < from.length ? "…" : "");
    hits.push({ page, index: i, boxes, snippet });
  });
  return hits;
}
