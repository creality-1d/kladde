// Minimal PDF writer: one JPEG image per page, page size in PDF points.

export interface PdfImagePage {
  jpeg: Uint8Array;
  /** Pixel size of the JPEG. */
  pixelWidth: number;
  pixelHeight: number;
  /** Page size in points (1/72 inch). */
  width: number;
  height: number;
}

export function writePdf(pages: readonly PdfImagePage[]): Uint8Array {
  const chunks: Uint8Array[] = [];
  const offsets: number[] = [];
  let length = 0;
  const encoder = new TextEncoder();
  const emit = (part: string | Uint8Array) => {
    const bytes = typeof part === "string" ? encoder.encode(part) : part;
    chunks.push(bytes);
    length += bytes.length;
  };
  const object = (id: number, body: () => void) => {
    offsets[id] = length;
    emit(`${id} 0 obj\n`);
    body();
    emit("\nendobj\n");
  };

  // Objects: 1 catalog, 2 page tree, then per page: page, content, image.
  const pageId = (i: number) => 3 + i * 3;
  emit("%PDF-1.4\n%\xE2\xE3\xCF\xD3\n");
  object(1, () => emit("<< /Type /Catalog /Pages 2 0 R >>"));
  object(2, () => emit(`<< /Type /Pages /Count ${pages.length} /Kids [${pages.map((_, i) => `${pageId(i)} 0 R`).join(" ")}] >>`));
  pages.forEach((page, i) => {
    const id = pageId(i);
    const w = page.width.toFixed(2);
    const h = page.height.toFixed(2);
    object(id, () =>
      emit(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${w} ${h}] /Resources << /XObject << /Im0 ${id + 2} 0 R >> >> /Contents ${id + 1} 0 R >>`),
    );
    const content = `q ${w} 0 0 ${h} 0 0 cm /Im0 Do Q`;
    object(id + 1, () => emit(`<< /Length ${content.length} >>\nstream\n${content}\nendstream`));
    object(id + 2, () => {
      emit(
        `<< /Type /XObject /Subtype /Image /Width ${page.pixelWidth} /Height ${page.pixelHeight} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${page.jpeg.length} >>\nstream\n`,
      );
      emit(page.jpeg);
      emit("\nendstream");
    });
  });
  const count = pageId(pages.length);
  const xref = length;
  emit(`xref\n0 ${count}\n0000000000 65535 f \n`);
  for (let id = 1; id < count; id++) emit(`${String(offsets[id]).padStart(10, "0")} 00000 n \n`);
  emit(`trailer\n<< /Size ${count} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`);

  const out = new Uint8Array(length);
  let at = 0;
  for (const chunk of chunks) {
    out.set(chunk, at);
    at += chunk.length;
  }
  return out;
}
