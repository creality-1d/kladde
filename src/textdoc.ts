// Text documents: typed notes with headings, lists and checklists.
// Stored as a small, sanitised subset of HTML so they sync and render safely.
import { PAGE_HEIGHT, PAGE_WIDTH } from "./model";

const BLOCKS = new Set(["H1", "H2", "H3", "P", "DIV", "UL", "OL", "LI", "HR", "BLOCKQUOTE", "BR"]);
const INLINE = new Set(["B", "STRONG", "I", "EM", "U", "S", "SPAN"]);

/** Keeps only the tags the editor makes; drops scripts, styles, links and attributes. */
export function sanitizeHtml(html: string): string {
  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, "text/html");
  const clean = (node: Node): Node[] => {
    if (node.nodeType === Node.TEXT_NODE) return [document.createTextNode(node.textContent ?? "")];
    if (node.nodeType !== Node.ELEMENT_NODE) return [];
    const el = node as Element;
    const children = [...el.childNodes].flatMap(clean);
    if (["SCRIPT", "STYLE", "IFRAME", "OBJECT", "EMBED", "TEMPLATE"].includes(el.tagName)) return [];
    if (!BLOCKS.has(el.tagName) && !INLINE.has(el.tagName)) return children;
    const out = document.createElement(el.tagName === "DIV" ? "p" : el.tagName.toLowerCase());
    if (el.tagName === "UL" && el.classList.contains("check")) out.className = "check";
    if (el.tagName === "LI" && el.getAttribute("data-checked") === "true") out.setAttribute("data-checked", "true");
    out.append(...children);
    return [out];
  };
  const box = document.createElement("div");
  box.append(...[...doc.body.childNodes].flatMap(clean));
  return box.innerHTML || "<p><br></p>";
}

/** Plain text of a document, for search and covers. */
export function plainText(html: string): string {
  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, "text/html");
  doc.querySelectorAll("p,h1,h2,h3,li,div,br").forEach((el) => el.append(" "));
  return (doc.body.textContent ?? "").replace(/\s+/g, " ").trim();
}

interface Block {
  kind: "h1" | "h2" | "h3" | "p" | "li" | "hr" | "quote";
  text: string;
  marker?: string;
}

function blocksOf(html: string): Block[] {
  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, "text/html");
  const blocks: Block[] = [];
  const walk = (el: Element) => {
    for (const child of el.children) {
      const tag = child.tagName;
      if (tag === "UL" || tag === "OL") {
        let n = 0;
        for (const li of child.children) {
          n++;
          const marker = child.classList.contains("check") ? (li.getAttribute("data-checked") === "true" ? "☑" : "☐") : tag === "OL" ? `${n}.` : "•";
          blocks.push({ kind: "li", text: li.textContent ?? "", marker });
        }
      } else if (tag === "HR") blocks.push({ kind: "hr", text: "" });
      else if (tag === "H1" || tag === "H2" || tag === "H3") blocks.push({ kind: tag.toLowerCase() as Block["kind"], text: child.textContent ?? "" });
      else if (tag === "BLOCKQUOTE") blocks.push({ kind: "quote", text: child.textContent ?? "" });
      else blocks.push({ kind: "p", text: child.textContent ?? "" });
    }
  };
  walk(doc.body);
  return blocks;
}

/** Lays the document out on A4 pages (page units) for PDF export. */
export function renderTextPages(title: string, html: string, scale = 1): HTMLCanvasElement[] {
  const margin = 130;
  const width = PAGE_WIDTH - margin * 2;
  const pages: HTMLCanvasElement[] = [];
  let ctx!: CanvasRenderingContext2D;
  let y = 0;
  const newPage = () => {
    const c = document.createElement("canvas");
    c.width = Math.round(PAGE_WIDTH * scale);
    c.height = Math.round(PAGE_HEIGHT * scale);
    ctx = c.getContext("2d")!;
    ctx.scale(scale, scale);
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, PAGE_WIDTH, PAGE_HEIGHT);
    ctx.fillStyle = "#1d2733";
    ctx.textBaseline = "top";
    pages.push(c);
    y = margin;
  };
  const style: Record<Block["kind"], { size: number; weight: number; before: number }> = {
    h1: { size: 64, weight: 700, before: 40 },
    h2: { size: 46, weight: 700, before: 34 },
    h3: { size: 38, weight: 600, before: 26 },
    p: { size: 32, weight: 400, before: 16 },
    li: { size: 32, weight: 400, before: 8 },
    quote: { size: 32, weight: 400, before: 16 },
    hr: { size: 32, weight: 400, before: 24 },
  };
  newPage();
  const blocks: Block[] = [{ kind: "h1", text: title }, ...blocksOf(html)];
  for (const block of blocks) {
    const st = style[block.kind];
    const line = st.size * 1.4;
    if (block.kind === "hr") {
      y += st.before;
      if (y > PAGE_HEIGHT - margin) newPage();
      ctx.fillRect(margin, y, width, 2);
      y += 24;
      continue;
    }
    ctx.font = `${st.weight} ${st.size}px system-ui, -apple-system, sans-serif`;
    const indent = block.kind === "li" ? 56 : block.kind === "quote" ? 40 : 0;
    const lines: string[] = [];
    for (const para of block.text.split("\n")) {
      let current = "";
      for (const word of para.split(/\s+/)) {
        const next = current ? `${current} ${word}` : word;
        if (ctx.measureText(next).width > width - indent && current) {
          lines.push(current);
          current = word;
        } else current = next;
      }
      lines.push(current);
    }
    y += y === margin ? 0 : st.before;
    lines.forEach((text, i) => {
      if (y + line > PAGE_HEIGHT - margin) newPage();
      if (i === 0 && block.marker) ctx.fillText(block.marker, margin + 8, y);
      if (block.kind === "quote") ctx.fillRect(margin, y, 4, line);
      ctx.fillText(text, margin + indent, y);
      y += line;
    });
  }
  return pages;
}
