// Renders each imported page as SVG for visual comparison with the archive's thumbnail.
// Usage: npx vite-node scripts/render-goodnotes.ts <file.goodnotes> <outDir>
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { importGoodnotes } from "../src/goodnotes/import";

const [file, outDir] = process.argv.slice(2);
const { notebook, report } = importGoodnotes(new Uint8Array(readFileSync(file)), { fallbackTitle: basename(file) });
mkdirSync(outDir, { recursive: true });
notebook.pages.forEach((page, i) => {
  const w = page.width ?? 1404;
  const h = page.height ?? 1872;
  const paths = page.strokes.map((s) => {
    const d = s.points.map((p, j) => `${j ? "L" : "M"}${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join("");
    const width = s.tool === "highlighter" ? s.width * 4 : s.width;
    return `<path d="${d}" fill="none" stroke="${s.color}" stroke-width="${width.toFixed(2)}" stroke-linecap="round" stroke-linejoin="round"${s.tool === "highlighter" ? ' stroke-opacity="0.35"' : ""}/>`;
  });
  writeFileSync(join(outDir, `page${i + 1}.svg`), `<svg xmlns="http://www.w3.org/2000/svg" width="${w / 2}" height="${h / 2}" viewBox="0 0 ${w} ${h}"><rect width="100%" height="100%" fill="#fff" stroke="#999"/>${paths.join("")}</svg>`);
});
console.log(JSON.stringify({ title: notebook.title, ...report, perPage: notebook.pages.map((p) => p.strokes.length) }));
