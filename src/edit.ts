// Page editing geometry: lasso selection, moving and deleting, shape recognition.
import type { Page, PageImage, Point, Stroke, TextBox } from "./model";

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

export type EraserMode = "stroke" | "partial" | "highlighter";

/** Inserts points so no two neighbours are further apart than `step`. */
function densify(points: readonly Point[], step: number): Point[] {
  const out: Point[] = [];
  points.forEach((b, i) => {
    const a = points[i - 1];
    if (a) {
      const n = Math.floor(dist(a, b) / step);
      for (let k = 1; k <= n; k++) {
        const t = k / (n + 1);
        out.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, p: a.p + (b.p - a.p) * t });
      }
    }
    out.push(b);
  });
  return out;
}

/**
 * Applies the eraser at `at`. "stroke" removes every touched stroke, "highlighter" only
 * touched highlighter strokes, "partial" cuts the touched part out and keeps the rest
 * as separate strokes. Returns the new stroke list, or undefined when nothing changed.
 */
export function eraseAt(strokes: readonly Stroke[], at: Point, radius: number, mode: EraserMode, newId: () => string): Stroke[] | undefined {
  let changed = false;
  const out: Stroke[] = [];
  for (const stroke of strokes) {
    const reach = radius + stroke.width / 2;
    const touched = stroke.points.some((q, i) => segmentDistance(at, stroke.points[i - 1] ?? q, q) <= reach);
    if (!touched || (mode === "highlighter" && stroke.tool !== "highlighter")) {
      out.push(stroke);
      continue;
    }
    changed = true;
    if (mode !== "partial") continue;
    let run: Point[] = [];
    const flush = () => {
      if (run.length > 1) out.push({ ...stroke, id: newId(), points: run });
      run = [];
    };
    for (const q of densify(stroke.points, Math.max(1, radius / 3))) {
      if (dist(q, at) <= reach) flush();
      else run.push(q);
    }
    flush();
  }
  return changed ? out : undefined;
}

export function segmentDistance(p: { x: number; y: number }, a: { x: number; y: number }, b: { x: number; y: number }): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = dx * dx + dy * dy;
  const t = len === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

/** Rotates the selection by `angle` radians around `origin`; texts and images turn around their own centres. */
export function rotateSelection(page: Page, selection: Selection, origin: { x: number; y: number }, angle: number, textHeight: (id: string) => number): void {
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const turn = (x: number, y: number) => ({ x: origin.x + (x - origin.x) * cos - (y - origin.y) * sin, y: origin.y + (x - origin.x) * sin + (y - origin.y) * cos });
  for (const s of page.strokes) if (selection.strokes.has(s.id)) s.points = s.points.map((p) => ({ ...p, ...turn(p.x, p.y) }));
  for (const t of page.texts ?? []) {
    if (!selection.texts.has(t.id)) continue;
    const h = textHeight(t.id);
    const c = turn(t.x + t.width / 2, t.y + h / 2);
    Object.assign(t, { x: c.x - t.width / 2, y: c.y - h / 2, rotation: (t.rotation ?? 0) + angle });
  }
  for (const i of page.images ?? []) {
    if (!selection.images.has(i.id)) continue;
    const c = turn(i.x + i.width / 2, i.y + i.height / 2);
    Object.assign(i, { x: c.x - i.width / 2, y: c.y - i.height / 2, rotation: (i.rotation ?? 0) + angle });
  }
}

export function recolorSelection(page: Page, selection: Selection, color: string): void {
  for (const s of page.strokes) if (selection.strokes.has(s.id)) s.color = color;
  for (const t of page.texts ?? []) if (selection.texts.has(t.id)) t.color = color;
}

/** Copied page content, independent of the page it came from. */
export interface Clip {
  strokes: Stroke[];
  texts: TextBox[];
  images: PageImage[];
}

export function copySelection(page: Page, selection: Selection): Clip {
  return structuredClone({
    strokes: page.strokes.filter((s) => selection.strokes.has(s.id)),
    texts: (page.texts ?? []).filter((t) => selection.texts.has(t.id)),
    images: (page.images ?? []).filter((i) => selection.images.has(i.id)),
  });
}

/** Adds a copy of the clip to the page, shifted by (dx, dy), and returns the selection of the new elements. */
export function pasteClip(page: Page, clip: Clip, dx: number, dy: number, newId: () => string): Selection {
  const copy = structuredClone(clip);
  const selection: Selection = { strokes: new Set(), texts: new Set(), images: new Set() };
  for (const s of copy.strokes) {
    s.id = newId();
    s.points = s.points.map((p) => ({ ...p, x: p.x + dx, y: p.y + dy }));
    page.strokes.push(s);
    selection.strokes.add(s.id);
  }
  for (const t of copy.texts) {
    Object.assign(t, { id: newId(), x: t.x + dx, y: t.y + dy });
    (page.texts ??= []).push(t);
    selection.texts.add(t.id);
  }
  for (const i of copy.images) {
    Object.assign(i, { id: newId(), x: i.x + dx, y: i.y + dy });
    (page.images ??= []).push(i);
    selection.images.add(i.id);
  }
  return selection;
}

/**
 * Scribble to erase: a quick zig-zag over existing ink. Returns the ids of the
 * strokes it covers, or undefined when the stroke is not a scribble.
 */
export function scribbleTargets(scribble: readonly Point[], strokes: readonly Stroke[]): string[] | undefined {
  if (scribble.length < 12) return undefined;
  // Count direction reversals along the main axis of the scribble.
  const xs = scribble.map((p) => p.x);
  const ys = scribble.map((p) => p.y);
  const w = Math.max(...xs) - Math.min(...xs);
  const h = Math.max(...ys) - Math.min(...ys);
  const axis = w >= h ? xs : ys;
  const span = Math.max(w, h);
  if (span < 20) return undefined;
  let reversals = 0;
  let dir = 0;
  let anchor = axis[0];
  for (const v of axis) {
    const d = v - anchor;
    if (Math.abs(d) < span * 0.15) continue;
    const s = Math.sign(d);
    if (dir && s !== dir) reversals++;
    dir = s;
    anchor = v;
  }
  if (reversals < 4 || pathLength(scribble) < span * 3) return undefined;
  const box = { x: Math.min(...xs) - 6, y: Math.min(...ys) - 6, width: w + 12, height: h + 12 };
  const inBox = (p: Point) => p.x >= box.x && p.x <= box.x + box.width && p.y >= box.y && p.y <= box.y + box.height;
  // A stroke goes when most of it lies under the scribble and the scribble actually crosses it.
  const hits = strokes.filter(
    (s) =>
      s.points.filter(inBox).length >= s.points.length * 0.6 &&
      s.points.some((q) => scribble.some((p, i) => segmentDistance(q, scribble[i - 1] ?? p, p) <= s.width + 8)),
  );
  return hits.length ? hits.map((s) => s.id) : undefined;
}
