import { describe, it, expect } from "vitest";
import { diffPixels, ssim, encodePng } from "./compare.ts";
import { decodePng, type DecodedPng } from "../e2e/png.ts";
import { seededRandom } from "../web/src/graves.ts";

const SIZE = 8;

/** Petite image synthétique 8×8 déterministe (dégradé), pour éviter de dépendre de PNG sur disque. */
function makeGradient(): DecodedPng {
  const data = new Uint8Array(SIZE * SIZE * 4);
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const o = (y * SIZE + x) * 4;
      data[o] = (x * 30) % 255;
      data[o + 1] = (y * 30) % 255;
      data[o + 2] = 128;
      data[o + 3] = 255;
    }
  }
  return { width: SIZE, height: SIZE, data };
}

/** Même image que `makeGradient`, bruitée sur le canal rouge (offset ±90 déterministe). */
function makeNoisy(): DecodedPng {
  const base = makeGradient();
  const rand = seededRandom(7); // déterministe (mulberry32), pas de Math.random
  const data = new Uint8Array(base.data);
  for (let i = 0; i < SIZE * SIZE; i++) {
    const o = i * 4;
    const offset = rand() > 0.5 ? 90 : -90;
    data[o] = Math.max(0, Math.min(255, data[o] + offset));
  }
  return { width: SIZE, height: SIZE, data };
}

describe("diffPixels", () => {
  it("image identique à elle-même → diff nul", () => {
    const img = makeGradient();
    expect(diffPixels(img, img).diffRatio).toBe(0);
  });

  it("image bruitée → diff au-dessus du seuil", () => {
    const { diffRatio } = diffPixels(makeGradient(), makeNoisy());
    expect(diffRatio).toBeGreaterThan(0.1);
  });
});

describe("ssim", () => {
  it("image identique à elle-même → ssim = 1", () => {
    const img = makeGradient();
    expect(ssim(img, img)).toBeCloseTo(1, 9);
  });

  it("reste toujours dans [0,1], même pour des images très différentes", () => {
    const a: DecodedPng = { width: SIZE, height: SIZE, data: new Uint8Array(SIZE * SIZE * 4).fill(10) };
    const b: DecodedPng = { width: SIZE, height: SIZE, data: new Uint8Array(SIZE * SIZE * 4) };
    for (let i = 0; i < b.data.length; i += 4) { b.data[i] = 240; b.data[i + 1] = 5; b.data[i + 2] = 200; b.data[i + 3] = 255; }
    const s1 = ssim(makeGradient(), makeNoisy());
    const s2 = ssim(a, b);
    for (const s of [s1, s2]) {
      expect(s).toBeGreaterThanOrEqual(0);
      expect(s).toBeLessThanOrEqual(1);
    }
  });
});

describe("encodePng / decodePng", () => {
  it("round-trip : encoder puis décoder redonne les mêmes pixels", () => {
    const img = makeGradient();
    const decoded = decodePng(encodePng(img));
    expect(decoded.width).toBe(img.width);
    expect(decoded.height).toBe(img.height);
    expect(Array.from(decoded.data)).toEqual(Array.from(img.data));
  });
});
