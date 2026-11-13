import { describe, expect, it } from "vitest";
import { deleteSelection, insidePolygon, lassoSelect, moveSelection, recognizeShape } from "./edit";
import { newPage, type Point, type Stroke } from "./model";

const pt = (x: number, y: number): Point => ({ x, y, p: 0.5 });
const stroke = (id: string, points: Point[]): Stroke => ({ id, tool: "pen", color: "#000", width: 2, points });
const square = [pt(0, 0), pt(100, 0), pt(100, 100), pt(0, 100)];

describe("lasso", () => {
  it("tests points against the polygon", () => {
    expect(insidePolygon(pt(50, 50), square)).toBe(true);
    expect(insidePolygon(pt(150, 50), square)).toBe(false);
  });

  it("selects, moves and deletes enclosed strokes, texts and images", () => {
    const page = newPage("blank");
    page.strokes = [stroke("in", [pt(10, 10), pt(20, 20)]), stroke("out", [pt(200, 200), pt(210, 210)])];
    page.texts = [{ id: "t", x: 30, y: 30, width: 20, text: "a", fontSize: 10, color: "#000" }];
    page.images = [{ id: "i", x: 300, y: 300, width: 10, height: 10, attachment: "a" }];
    const selection = lassoSelect(page, square, () => 10);
    expect([...selection.strokes, ...selection.texts, ...selection.images]).toEqual(["in", "t"]);

    moveSelection(page, selection, 5, 7);
    expect(page.strokes[0].points[0]).toMatchObject({ x: 15, y: 17 });
    expect(page.texts[0]).toMatchObject({ x: 35, y: 37 });
    expect(page.strokes[1].points[0]).toMatchObject({ x: 200, y: 200 });

    deleteSelection(page, selection);
    expect(page.strokes.map((s) => s.id)).toEqual(["out"]);
    expect(page.texts).toEqual([]);
  });
});

describe("shape recognition", () => {
  it("straightens an almost straight stroke", () => {
    const wobbly = Array.from({ length: 20 }, (_, i) => pt(i * 10, (i % 2) * 2));
    expect(recognizeShape(wobbly)).toEqual([wobbly[0], wobbly[19]]);
  });

  it("turns a closed boxy stroke into a rectangle", () => {
    const box = [
      ...Array.from({ length: 10 }, (_, i) => pt(i * 10, 0)),
      ...Array.from({ length: 10 }, (_, i) => pt(100, i * 6)),
      ...Array.from({ length: 10 }, (_, i) => pt(100 - i * 10, 60)),
      ...Array.from({ length: 10 }, (_, i) => pt(0, 60 - i * 6)),
    ];
    const shape = recognizeShape(box)!;
    expect(shape).toHaveLength(5);
    expect(shape[2]).toMatchObject({ x: 100, y: 60 });
  });

  it("turns a closed round stroke into an ellipse", () => {
    const circle = Array.from({ length: 40 }, (_, i) => pt(50 + 40 * Math.cos((i / 39) * 2 * Math.PI), 50 + 30 * Math.sin((i / 39) * 2 * Math.PI)));
    expect(recognizeShape(circle)).toHaveLength(65);
  });

  it("leaves handwriting alone", () => {
    const scribble = [pt(0, 0), pt(30, 40), pt(10, 80), pt(60, 20), pt(90, 90), pt(120, 10)];
    expect(recognizeShape(scribble)).toBeUndefined();
  });
});
