// Low-level decoders for the Goodnotes 6 archive: protobuf wire format without
// a schema, varint-length-delimited message streams, and Apple's LZ4 frame.

export type Field =
  | { f: number; wt: 0; v: number }
  | { f: number; wt: 1 | 5; v: number }
  | { f: number; wt: 2; v: Uint8Array };

function varint(b: Uint8Array, o: number): [number, number] {
  let r = 0;
  let s = 1;
  for (let i = o; i < b.length; i++) {
    const c = b[i];
    r += (c & 0x7f) * s;
    if (!(c & 0x80)) return [r, i + 1];
    s *= 128;
  }
  throw new Error("truncated varint");
}

export function fields(b: Uint8Array): Field[] {
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const out: Field[] = [];
  let o = 0;
  while (o < b.length) {
    const [key, o1] = varint(b, o);
    const f = Math.floor(key / 8);
    const wt = key % 8;
    o = o1;
    if (wt === 0) {
      const [v, o2] = varint(b, o);
      out.push({ f, wt, v });
      o = o2;
    } else if (wt === 1) {
      out.push({ f, wt, v: dv.getFloat64(o, true) });
      o += 8;
    } else if (wt === 5) {
      out.push({ f, wt, v: dv.getFloat32(o, true) });
      o += 4;
    } else if (wt === 2) {
      const [len, o2] = varint(b, o);
      if (o2 + len > b.length) throw new Error("truncated field");
      out.push({ f, wt, v: b.subarray(o2, o2 + len) });
      o = o2 + len;
    } else {
      throw new Error(`unsupported wire type ${wt}`);
    }
  }
  return out;
}

export function messages(b: Uint8Array): Uint8Array[] {
  const out: Uint8Array[] = [];
  let o = 0;
  while (o < b.length) {
    const [len, o1] = varint(b, o);
    out.push(b.subarray(o1, o1 + len));
    o = o1 + len;
  }
  return out;
}

const text = new TextDecoder();

export const pick = {
  bytes: (fs: Field[], n: number) => (fs.find((x) => x.f === n && x.wt === 2)?.v as Uint8Array | undefined),
  message: (fs: Field[], n: number) => {
    const v = pick.bytes(fs, n);
    return v ? fields(v) : undefined;
  },
  string: (fs: Field[], n: number) => {
    const v = pick.bytes(fs, n);
    return v ? text.decode(v) : undefined;
  },
  number: (fs: Field[], n: number) => fs.find((x) => x.f === n && x.wt !== 2)?.v as number | undefined,
};

function lz4Block(src: Uint8Array, rawSize: number): Uint8Array {
  const out = new Uint8Array(rawSize);
  let i = 0;
  let o = 0;
  while (i < src.length) {
    const token = src[i++];
    let literals = token >> 4;
    if (literals === 15) {
      let b;
      do literals += b = src[i++];
      while (b === 255);
    }
    out.set(src.subarray(i, i + literals), o);
    i += literals;
    o += literals;
    if (i >= src.length) break;
    const offset = src[i] | (src[i + 1] << 8);
    i += 2;
    let match = token & 15;
    if (match === 15) {
      let b;
      do match += b = src[i++];
      while (b === 255);
    }
    match += 4;
    for (let k = 0; k < match; k++, o++) out[o] = out[o - offset];
  }
  return out.subarray(0, o);
}

/** Apple compression_lz4 frame: 'bv41' raw comp data | 'bv4-' raw data, ended by 'bv4$'. */
export function appleLz4(buf: Uint8Array): Uint8Array {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const parts: Uint8Array[] = [];
  let i = 0;
  for (;;) {
    const magic = text.decode(buf.subarray(i, i + 4));
    if (magic === "bv4$") break;
    if (magic === "bv41") {
      const raw = dv.getUint32(i + 4, true);
      const comp = dv.getUint32(i + 8, true);
      parts.push(lz4Block(buf.subarray(i + 12, i + 12 + comp), raw));
      i += 12 + comp;
    } else if (magic === "bv4-") {
      const raw = dv.getUint32(i + 4, true);
      parts.push(buf.subarray(i + 8, i + 8 + raw));
      i += 8 + raw;
    } else {
      throw new Error(`unknown LZ4 frame block "${magic}" at ${i}`);
    }
  }
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}
