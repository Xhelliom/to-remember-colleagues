// Décodeur PNG minimal (8 bits, RGB/RGBA, non entrelacé) via le zlib natif de
// Node — évite une dépendance juste pour lire les captures et le concept.
import zlib from "node:zlib";

const SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

export type DecodedPng = { width: number; height: number; data: Uint8Array }; // RGBA

/** Prédicteur Paeth (filtre PNG type 4). */
function paeth(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  return pb <= pc ? b : c;
}

export function decodePng(buf: Uint8Array): DecodedPng {
  for (let i = 0; i < 8; i++) if (buf[i] !== SIGNATURE[i]) throw new Error("PNG invalide");
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);

  let width = 0, height = 0, colorType = 0, bitDepth = 0, interlace = 0;
  const idat: Uint8Array[] = [];
  let pos = 8;
  while (pos < buf.length) {
    const len = dv.getUint32(pos);
    const type = String.fromCharCode(buf[pos + 4], buf[pos + 5], buf[pos + 6], buf[pos + 7]);
    const body = pos + 8;
    if (type === "IHDR") {
      width = dv.getUint32(body);
      height = dv.getUint32(body + 4);
      bitDepth = buf[body + 8];
      colorType = buf[body + 9];
      interlace = buf[body + 12];
    } else if (type === "IDAT") {
      idat.push(buf.subarray(body, body + len));
    } else if (type === "IEND") {
      break;
    }
    pos = body + len + 4; // +4 CRC
  }

  if (bitDepth !== 8 || interlace !== 0 || (colorType !== 2 && colorType !== 6)) {
    throw new Error(`PNG non supporté (bitDepth=${bitDepth} colorType=${colorType} interlace=${interlace})`);
  }

  const channels = colorType === 6 ? 4 : 3;
  const raw = zlib.inflateSync(Buffer.concat(idat.map((c) => Buffer.from(c))));
  const stride = width * channels;
  const out = new Uint8Array(width * height * 4);
  const prev = new Uint8Array(stride);
  const cur = new Uint8Array(stride);

  let rp = 0;
  for (let y = 0; y < height; y++) {
    const filter = raw[rp++];
    for (let x = 0; x < stride; x++) {
      const rawByte = raw[rp++];
      const a = x >= channels ? cur[x - channels] : 0; // gauche
      const b = prev[x];                                // haut
      const c = x >= channels ? prev[x - channels] : 0; // haut-gauche
      let v: number;
      switch (filter) {
        case 1: v = rawByte + a; break;
        case 2: v = rawByte + b; break;
        case 3: v = rawByte + ((a + b) >> 1); break;
        case 4: v = rawByte + paeth(a, b, c); break;
        default: v = rawByte;
      }
      cur[x] = v & 0xff;
    }
    // Écrit la scanline en RGBA
    for (let x = 0; x < width; x++) {
      const s = x * channels;
      const d = (y * width + x) * 4;
      out[d] = cur[s];
      out[d + 1] = cur[s + 1];
      out[d + 2] = cur[s + 2];
      out[d + 3] = channels === 4 ? cur[s + 3] : 255;
    }
    prev.set(cur);
  }

  return { width, height, data: out };
}
