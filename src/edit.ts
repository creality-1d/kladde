// Page editing geometry: lasso selection, moving and deleting, shape recognition.
import type { Page, Point } from "./model";

export interface Selection {
  strokes: Set<string>;
  texts: Set<string>;
  images: Set<string>;
}

export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

export function isEmpty(selection: Selection): boolean {
  return selection.strokes.size + selection.texts.size + selection.images.size === 0;
}

/** Even-odd ray casting. */
export function insidePolygon(p: { x: number; y: number }, polygon: readonly Point[]): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i];
    const b = polygon[j];
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

/** A stroke is selected when most of its points lie inside the lasso. */
export function lassoSelect(page: Page, lasso: readonly Point[], textHeight: (id: string) => number): Selection {
  const strokes = page.strokes.filter((s) => s.points.filter((p) => insidePolygon(p, lasso)).length > s.points.length / 2);
  const center = (b: Box) => ({ x: b.x + b.width / 2, y: b.y + b.height / 2 });
  const texts = (page.texts ?? []).filter((t) => insidePolygon(center({ x: t.x, y: t.y, width: Math.min(t.width, 2000), height: textHeight(t.id) }), lasso));
  const images = (page.images ?? []).filter((i) => insidePolygon(center(i), lasso));
  return { strokes: new Set(strokes.map((s) => s.id)), texts: new Set(texts.map((t) => t.id)), images: new Set(images.map((i) => i.id)) };
}

export function selectionBounds(page: Page, selection: Selection, textHeight: (id: string) => number): Box | undefined {
  const xs: number[] = [];
  const ys: number[] = [];
  for (const s of page.strokes) {
    if (!selection.strokes.has(s.id)) continue;
    for (const p of s.points) {
      xs.push(p.x - s.width, p.x + s.width);
      ys.push(p.y - s.width, p.y + s.width);
    }
  }
  for (const t of page.texts ?? []) {
    if (!selection.texts.has(t.id)) continue;
    xs.push(t.x, t.x + Math.min(t.width, 2000));
    ys.push(t.y, t.y + textHeight(t.id));
  }
  for (const i of page.images ?? []) {
    if (!selection.images.has(i.id)) continue;
    xs.push(i.x, i.x + i.width);
    ys.push(i.y, i.y + i.height);
  }
  if (xs.length === 0) return undefined;
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y };
}

export function moveSelection(page: Page, selection: Selection, dx: number, dy: number): void {
  for (const s of page.strokes) if (selection.strokes.has(s.id)) s.points = s.points.map((p) => ({ ...p, x: p.x + dx, y: p.y + dy }));
  for (const t of page.texts ?? []) if (selection.texts.has(t.id)) Object.assign(t, { x: t.x + dx, y: t.y + dy });
  for (const i of page.images ?? []) if (selection.images.has(i.id)) Object.assign(i, { x: i.x + dx, y: i.y + dy });
}

/** Scales the selection by factor around origin; stroke widths and font sizes scale too. */
export function scaleSelection(page: Page, selection: Selection, origin: { x: number; y: number }, factor: number): void {
  const at = (x: number, y: number) => ({ x: origin.x + (x - origin.x) * factor, y: origin.y + (y - origin.y) * factor });
  for (const s of page.strokes) {
    if (!selection.strokes.has(s.id)) continue;
    s.points = s.points.map((p) => ({ ...p, ...at(p.x, p.y) }));
    s.width *= factor;
  }
  for (const t of page.texts ?? []) {
    if (selection.texts.has(t.id)) Object.assign(t, at(t.x, t.y), { width: t.width * factor, fontSize: t.fontSize * factor });
  }
  for (const i of page.images ?? []) {
    if (selection.images.has(i.id)) Object.assign(i, at(i.x, i.y), { width: i.width * factor, height: i.height * factor });
  }
}

export function deleteSelection(page: Page, selection: Selection): void {
  page.strokes = page.strokes.filter((s) => !selection.strokes.has(s.id));
  page.texts = page.texts?.filter((t) => !selection.texts.has(t.id));
  page.images = page.images?.filter((i) => !selection.images.has(i.id));
}

const dist = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);

function pathLength(points: readonly Point[]): number {
  let length = 0;
  for (let i = 1; i < points.length; i++) length += dist(points[i - 1], points[i]);
  return length;
}

/**
 * Replaces a hand-drawn stroke by the shape it resembles: a straight line, a
 * rectangle or an ellipse. Returns undefined when nothing fits well.
 */
export function recognizeShape(points: readonly Point[]): Point[] | undefined {
  if (points.length < 3) return undefined;
  const first = points[0];
  const last = points[points.length - 1];
  const length = pathLength(points);
  if (length < 20) return undefined;
  const p = 0.5;

  // Line: the path is barely longer than its chord.
  if (dist(first, last) / length > 0.95) return [{ ...first, p }, { ...last, p }];

  // Closed shapes: the end returns near the start.
  if (dist(first, last) > length * 0.2) return undefined;
  const xs = points.map((q) => q.x);
  const ys = points.map((q) => q.y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const w = maxX - minX;
  const h = maxY - minY;
  if (w < 10 || h < 10) return undefined;
  const cx = minX + w / 2;
  const cy = minY + h / 2;

  // Mean relative distance of the samples from each candidate outline.
  const ellipseError = points.reduce((sum, q) => sum + Math.abs(Math.hypot((q.x - cx) / (w / 2), (q.y - cy) / (h / 2)) - 1), 0) / points.length;
  const rectError =
    points.reduce((sum, q) => sum + Math.min(Math.abs(q.x - minX), Math.abs(q.x - maxX), Math.abs(q.y - minY), Math.abs(q.y - maxY)) / Math.min(w, h), 0) /
    points.length;
  if (Math.min(ellipseError, rectError) > 0.12) return undefined;
  if (rectError < ellipseError) {
    return [
      { x: minX, y: minY, p },
      { x: maxX, y: minY, p },
      { x: maxX, y: maxY, p },
      { x: minX, y: maxY, p },
      { x: minX, y: minY, p },
    ];
  }
  return Array.from({ length: 65 }, (_, i) => {
    const a = (i / 64) * Math.PI * 2;
    return { x: cx + (w / 2) * Math.cos(a), y: cy + (h / 2) * Math.sin(a), p };
  });
}
