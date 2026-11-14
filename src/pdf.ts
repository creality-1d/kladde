import * as pdfjs from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

const documents = new Map<string, Promise<pdfjs.PDFDocumentProxy>>();
const pages = new Map<string, Promise<HTMLCanvasElement>>();
const MAX_CACHED_PAGES = 16;

/**
 * Renders one PDF page at the given pixel width. Results are cached per
 * attachment, page and width, so redraws while writing stay cheap.
 */
export function renderPdfPage(
  attachment: string,
  load: () => Promise<Uint8Array | undefined>,
  pageIndex: number,
  width: number,
): Promise<HTMLCanvasElement> {
  const key = `${attachment}:${pageIndex}:${width}`;
  let page = pages.get(key);
  if (page) {
    // Most recently used last, so eviction drops the oldest.
    pages.delete(key);
    pages.set(key, page);
  } else {
    page = (async () => {
      let doc = documents.get(attachment);
      if (!doc) {
        doc = load().then((bytes) => {
          if (!bytes) throw new Error(`attachment ${attachment} is missing`);
          // pdf.js transfers the buffer to its worker; keep the caller's copy intact.
          return pdfjs.getDocument({ data: bytes.slice() }).promise;
        });
        documents.set(attachment, doc);
      }
      const pdfPage = await (await doc).getPage(pageIndex + 1);
      const base = pdfPage.getViewport({ scale: 1 });
      const viewport = pdfPage.getViewport({ scale: width / base.width });
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(viewport.width);
      canvas.height = Math.round(viewport.height);
      await pdfPage.render({ canvasContext: canvas.getContext("2d")!, viewport }).promise;
      return canvas;
    })();
    pages.set(key, page);
    page.catch(() => pages.delete(key));
    // Rendered pages are large bitmaps; keep only the ones near the reader.
    while (pages.size > MAX_CACHED_PAGES) pages.delete(pages.keys().next().value!);
  }
  return page;
}

export async function pdfPageCount(bytes: Uint8Array): Promise<number> {
  return (await pdfjs.getDocument({ data: bytes.slice() }).promise).numPages;
}

/** Page sizes of a PDF in points. */
export async function pdfPageSizes(bytes: Uint8Array): Promise<{ width: number; height: number }[]> {
  const doc = await pdfjs.getDocument({ data: bytes.slice() }).promise;
  const sizes: { width: number; height: number }[] = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const { width, height } = (await doc.getPage(i)).getViewport({ scale: 1 });
    sizes.push({ width, height });
  }
  void doc.destroy();
  return sizes;
}
