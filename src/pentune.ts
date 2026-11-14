// Fine pen settings applied while writing: pressure sensitivity, stroke
// stabilisation and tip sharpness (tapered stroke ends).
import type { Point } from "./model";

export interface PenTuning {
  /** 0–100: how pointed the stroke ends are. */
  sharpness: number;
  /** 0–100: how strongly the width follows pressure; 50 is the stylus as is. */
  pressure: number;
  /** 0–100: how much small shakes are smoothed out. */
  stabilization: number;
}

/** Scales pressure around the middle; 0 makes it nearly even, 100 doubles the swing. */
export function tunePressure(p: number, sensitivity: number): number {
  return Math.min(1, Math.max(0.05, 0.5 + (p - 0.5) * (sensitivity / 50)));
}

/** Moves the new point only part of the way from the previous one, which smooths jitter. */
export function stabilize(previous: Point, raw: Point, amount: number): Point {
  const follow = 1 - Math.min(100, Math.max(0, amount)) * 0.0085;
  return { x: previous.x + (raw.x - previous.x) * follow, y: previous.y + (raw.y - previous.y) * follow, p: raw.p };
}

/** Thins the first and last part of a stroke towards a point; 0 leaves it round. */
export function taper(points: Point[], sharpness: number): Point[] {
  if (sharpness <= 0 || points.length < 4) return points;
  // Taper over a share of the stroke length, at most about one letter.
  const lengths = [0];
  for (let i = 1; i < points.length; i++) lengths.push(lengths[i - 1] + Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y));
  const total = lengths[lengths.length - 1];
  if (total < 4) return points;
  const span = Math.min(total * 0.25, 40);
  const thinnest = 1 - (Math.min(100, sharpness) / 100) * 0.85;
  return points.map((q, i) => {
    const fromEnd = Math.min(lengths[i], total - lengths[i]);
    if (fromEnd >= span) return q;
    const t = fromEnd / span;
    return { ...q, p: q.p * (thinnest + (1 - thinnest) * Math.sin((t * Math.PI) / 2)) };
  });
}

/** A highlighter stroke drawn as a straight line from its start to its end. */
export function straighten(points: Point[]): Point[] {
  if (points.length < 2) return points;
  const a = points[0];
  const b = points[points.length - 1];
  const n = Math.max(2, Math.round(Math.hypot(b.x - a.x, b.y - a.y) / 8));
  // Mostly horizontal lines snap level, as text lines are.
  const level = Math.abs(b.y - a.y) < Math.abs(b.x - a.x) * 0.15;
  const end = level ? { ...b, y: a.y } : b;
  return Array.from({ length: n + 1 }, (_, i) => ({ x: a.x + ((end.x - a.x) * i) / n, y: a.y + ((end.y - a.y) * i) / n, p: a.p }));
}
