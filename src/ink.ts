import { PAGE_HEIGHT, PAGE_WIDTH, type Page, type PaperColor, type PenType, type Point, type Stroke, type Template, type TextBox } from "./model";

export const PAPER_COLORS: Record<PaperColor, { fill: string; line: string; dot: string }> = {
  white: { fill: "#ffffff", line: "#c9d6e3", dot: "#b8c4d0" },
  cream: { fill: "#fbf6e6", line: "#ddd2b0", dot: "#cdbf98" },
  dark: { fill: "#23272c", line: "#3c444d", dot: "#4a535d" },
};

export function drawTemplate(ctx: CanvasRenderingContext2D, template: Template, width = ctx.canvas.width, height = ctx.canvas.height, paper: PaperColor = "white"): void {
  const colors = PAPER_COLORS[paper] ?? PAPER_COLORS.white;
  ctx.fillStyle = colors.fill;
  ctx.fillRect(0, 0, width, height);
  const step = template === "smallgrid" ? 26 : template === "wide" ? 72 : 52;
  ctx.strokeStyle = colors.line;
  ctx.fillStyle = colors.dot;
  ctx.lineWidth = 1.5;
  if (template === "lined" || template === "wide" || template === "cornell") {
    for (let y = step * 3; y < height; y += step) line(ctx, 0, y, width, y);
  }
  if (template === "cornell") {
    // Cue column on the left, summary area at the bottom.
    ctx.lineWidth = 3;
    const summary = Math.round((height * 0.8) / step) * step;
    line(ctx, width * 0.28, step * 2, width * 0.28, summary);
    line(ctx, 0, summary, width, summary);
    line(ctx, 0, step * 2, width, step * 2);
  } else if (template === "grid" || template === "smallgrid") {
    for (let x = step; x < width; x += step) line(ctx, x, 0, x, height);
    for (let y = step; y < height; y += step) line(ctx, 0, y, width, y);
  } else if (template === "dotted") {
    for (let x = step; x < width; x += step)
      for (let y = step; y < height; y += step) ctx.fillRect(x - 2, y - 2, 4, 4);
  }
}

function line(ctx: CanvasRenderingContext2D, x1: number, y1: number, x2: number, y2: number): void {
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.stroke();
}

export function drawStroke(ctx: CanvasRenderingContext2D, stroke: Stroke): void {
  const pts = stroke.points;
  if (pts.length === 0) return;
  ctx.save();
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.strokeStyle = stroke.color;
  if (stroke.tool === "highlighter") {
    ctx.globalAlpha = 0.35;
    ctx.globalCompositeOperation = "multiply";
    ctx.lineWidth = stroke.width * 4;
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    for (const pt of pts) ctx.lineTo(pt.x, pt.y);
    ctx.stroke();
  } else {
    drawPenSegments(ctx, stroke, 1);
    if (pts.length === 1) {
      ctx.fillStyle = stroke.color;
      ctx.beginPath();
      ctx.arc(pts[0].x, pts[0].y, stroke.width / 2, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.restore();
}

/** Width multiplier for a pen type at pressure p in [0, 1]. */
export function penFactor(pen: PenType | undefined, p: number): number {
  if (pen === "ball") return 0.9;
  if (pen === "brush") return 0.15 + p * p * 2.6;
  return 0.4 + p * 1.2;
}

/**
 * Draws pen segments from point index `from` on. While writing, only the new
 * segments are drawn on top of the page instead of redrawing everything.
 */
export function drawPenSegments(ctx: CanvasRenderingContext2D, stroke: Stroke, from: number): void {
  const pts = stroke.points;
  ctx.save();
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.strokeStyle = stroke.color;
  {
    // Pen width follows pressure; midpoint quadratics smooth the polyline.
    for (let i = Math.max(1, from); i < pts.length; i++) {
      const a = pts[i - 1];
      const b = pts[i];
      ctx.lineWidth = stroke.width * penFactor(stroke.pen, b.p);
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.quadraticCurveTo(a.x, a.y, (a.x + b.x) / 2, (a.y + b.y) / 2);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
    }
  }
  ctx.restore();
}

export function renderPage(
  ctx: CanvasRenderingContext2D,
  page: Page,
  background?: CanvasImageSource,
  images?: ReadonlyMap<string, CanvasImageSource>,
): void {
  // Drawn in page units; callers scale the context for thumbnails.
  const width = page.width ?? PAGE_WIDTH;
  const height = page.height ?? PAGE_HEIGHT;
  drawTemplate(ctx, page.template, width, height, page.paper);
  if (background) ctx.drawImage(background, 0, 0, width, height);
  for (const image of page.images ?? []) {
    const bitmap = images?.get(image.attachment);
    ctx.save();
    if (image.rotation) {
      ctx.translate(image.x + image.width / 2, image.y + image.height / 2);
      ctx.rotate(image.rotation);
      ctx.translate(-(image.x + image.width / 2), -(image.y + image.height / 2));
    }
    if (bitmap) ctx.drawImage(bitmap, image.x, image.y, image.width, image.height);
    else {
      ctx.strokeStyle = "#9aa5b1";
      ctx.strokeRect(image.x, image.y, image.width, image.height);
    }
    ctx.restore();
  }
  // Highlighter lies under typed text and ink, like a marker on paper.
  for (const stroke of page.strokes) if (stroke.tool === "highlighter") drawStroke(ctx, stroke);
  if (page.flow) {
    let y = page.flow.y;
    for (const paragraph of page.flow.paragraphs) {
      const box = { id: "", x: page.flow.x, y, width: page.flow.width, color: "#000", ...paragraph };
      drawText(ctx, box);
      y += textHeight(ctx, box);
    }
  }
  for (const text of page.texts ?? []) drawText(ctx, text);
  for (const stroke of page.strokes) if (stroke.tool !== "highlighter") drawStroke(ctx, stroke);
}

export const TEXT_FONT = '"Helvetica Neue", Helvetica, Arial, sans-serif';
export const LINE_HEIGHT = 1.25;

/** Greedy word wrap; explicit newlines start new paragraphs. */
export function wrapText(ctx: CanvasRenderingContext2D, text: TextBox): string[] {
  ctx.font = `${text.bold ? "bold " : ""}${text.fontSize}px ${TEXT_FONT}`;
  const lines: string[] = [];
  for (const paragraph of text.text.split("\n")) {
    let line = "";
    for (const word of paragraph.split(/(\s+)/)) {
      const next = line + word;
      if (line.trim() && ctx.measureText(next).width > text.width) {
        lines.push(line.trimEnd());
        line = word.trimStart();
      } else {
        line = next;
      }
    }
    lines.push(line);
  }
  return lines;
}

export function drawText(ctx: CanvasRenderingContext2D, text: TextBox): void {
  ctx.save();
  if (text.rotation) {
    const cx = text.x + text.width / 2;
    const cy = text.y + textHeight(ctx, text) / 2;
    ctx.translate(cx, cy);
    ctx.rotate(text.rotation);
    ctx.translate(-cx, -cy);
  }
  ctx.fillStyle = text.color;
  ctx.textBaseline = "top";
  wrapText(ctx, text).forEach((line, i) => ctx.fillText(line.replace(/\t/g, "    "), text.x, text.y + i * text.fontSize * LINE_HEIGHT));
  ctx.restore();
}

export function textHeight(ctx: CanvasRenderingContext2D, text: TextBox): number {
  return wrapText(ctx, text).length * text.fontSize * LINE_HEIGHT;
}

/** True when the eraser at `at` with `radius` touches the stroke. */
export function hitsStroke(stroke: Stroke, at: Point, radius: number): boolean {
  const reach = radius + stroke.width;
  return stroke.points.some((pt, i) => {
    const prev = stroke.points[i - 1] ?? pt;
    return distanceToSegment(at, prev, pt) <= reach;
  });
}

function distanceToSegment(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = dx * dx + dy * dy;
  const t = len === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}
