import { describe, expect, it } from "vitest";
import {
  bakeNoiseData,
  decodeSigned,
  decodeUnit,
  evalNoiseAt,
  foldMirrored,
  GRADIENT_RANGE,
  NOISE_TEX_A_CHANNELS,
  NOISE_TEX_B_CHANNELS,
} from "./noiseBake.ts";

const SEED = 424242;
const RES = 48;

/** Offset (dans le tableau RGBA plat) du texel (ix, iz) d'une texture bakée. */
function texelIndex(resolution: number, ix: number, iz: number): number {
  return (iz * resolution + ix) * 4;
}

describe("bakeNoiseData (préprocess CPU déterministe)", () => {
  it("est déterministe : même graine → mêmes octets", () => {
    const a = bakeNoiseData(SEED, RES);
    const b = bakeNoiseData(SEED, RES);
    expect(a.texA).toEqual(b.texA);
    expect(a.texB).toEqual(b.texB);
  });

  it("des graines différentes produisent des octets différents", () => {
    const a = bakeNoiseData(SEED, RES);
    const b = bakeNoiseData(SEED + 1, RES);
    expect(a.texA).not.toEqual(b.texA);
  });

  it("la texture bakée ≈ le bruit direct (evalNoiseAt) sur N points de grille", () => {
    const baked = bakeNoiseData(SEED, RES);
    const points = [3, 7, 11, 19, 23, 29, 31, 37, 41, 44];
    for (const ix of points) {
      for (const iz of points.slice(0, 3)) {
        const live = evalNoiseAt(SEED, ix / RES, iz / RES, RES);
        const i = texelIndex(RES, ix, iz);
        expect(decodeUnit(baked.texA[i + NOISE_TEX_A_CHANNELS.value])).toBeCloseTo(live.value, 2);
        expect(decodeSigned(baked.texA[i + NOISE_TEX_A_CHANNELS.fbm], 1)).toBeCloseTo(live.fbm, 2);
        expect(decodeUnit(baked.texB[i + NOISE_TEX_B_CHANNELS.ridged])).toBeCloseTo(live.ridged, 2);
        expect(decodeUnit(baked.texB[i + NOISE_TEX_B_CHANNELS.worley])).toBeCloseTo(live.worley, 2);
      }
    }
  });

  it("les canaux gradient ≈ différences finies du canal fbm/ridged (même pas qu'au bake)", () => {
    const baked = bakeNoiseData(SEED, RES);
    const h = 1 / RES;
    // Points intérieurs (loin des bords) pour éviter tout effet de repli du fold.
    for (const [ix, iz] of [[10, 10], [20, 15], [30, 22], [15, 33]]) {
      const iCenter = texelIndex(RES, ix, iz);
      const iRight = texelIndex(RES, ix + 1, iz);
      const iLeft = texelIndex(RES, ix - 1, iz);
      const iUp = texelIndex(RES, ix, iz + 1);
      const iDown = texelIndex(RES, ix, iz - 1);

      const fbmRight = decodeSigned(baked.texA[iRight + NOISE_TEX_A_CHANNELS.fbm], 1);
      const fbmLeft = decodeSigned(baked.texA[iLeft + NOISE_TEX_A_CHANNELS.fbm], 1);
      const fbmUp = decodeSigned(baked.texA[iUp + NOISE_TEX_A_CHANNELS.fbm], 1);
      const fbmDown = decodeSigned(baked.texA[iDown + NOISE_TEX_A_CHANNELS.fbm], 1);
      const finiteDx = (fbmRight - fbmLeft) / (2 * h);
      const finiteDz = (fbmUp - fbmDown) / (2 * h);

      const bakedDx = decodeSigned(baked.texA[iCenter + NOISE_TEX_A_CHANNELS.dFbmDx], GRADIENT_RANGE);
      const bakedDz = decodeSigned(baked.texA[iCenter + NOISE_TEX_A_CHANNELS.dFbmDz], GRADIENT_RANGE);
      expect(bakedDx).toBeCloseTo(finiteDx, 0);
      expect(bakedDz).toBeCloseTo(finiteDz, 0);

      const ridgedRight = decodeUnit(baked.texB[iRight + NOISE_TEX_B_CHANNELS.ridged]);
      const ridgedLeft = decodeUnit(baked.texB[iLeft + NOISE_TEX_B_CHANNELS.ridged]);
      const finiteRidgedDx = (ridgedRight - ridgedLeft) / (2 * h);
      const bakedRidgedDx = decodeSigned(baked.texB[iCenter + NOISE_TEX_B_CHANNELS.dRidgedDx], GRADIENT_RANGE);
      expect(bakedRidgedDx).toBeCloseTo(finiteRidgedDx, 0);
    }
  });

  it("tuilable : continuité aux bords sous MirroredRepeat (valeur(bord) ≈ valeur(bord miroir))", () => {
    // foldMirrored doit RÉFLÉCHIR au bord (pas un simple modulo qui téléporterait
    // vers l'autre extrémité) : les deux côtés d'un bord se rejoignent en miroir.
    expect(foldMirrored(-0.002)).toBeCloseTo(foldMirrored(0.002), 5);
    expect(foldMirrored(1.002)).toBeCloseTo(foldMirrored(0.998), 5);
    expect(foldMirrored(-1.002)).toBeCloseTo(foldMirrored(1.002), 5);

    // Conséquence concrète sur la donnée bakée : un point juste avant le bord u=1
    // et son reflet juste après (replié par MirroredRepeat) tombent sur le même
    // texel → valeurs identiques, sans saut ni couture visible.
    const baked = bakeNoiseData(SEED, RES);
    const beforeEdge = foldMirrored(0.999);
    const afterEdge = foldMirrored(1.001);
    const ixBefore = Math.round(beforeEdge * (RES - 1));
    const ixAfter = Math.round(afterEdge * (RES - 1));
    const iBefore = texelIndex(RES, ixBefore, 5);
    const iAfter = texelIndex(RES, ixAfter, 5);
    expect(baked.texA[iBefore + NOISE_TEX_A_CHANNELS.fbm]).toBe(baked.texA[iAfter + NOISE_TEX_A_CHANNELS.fbm]);
  });
});

describe("evalNoiseAt (référence live)", () => {
  it("est déterministe : même (seed, u, v) → même échantillon", () => {
    const a = evalNoiseAt(SEED, 0.37, 0.61, RES);
    const b = evalNoiseAt(SEED, 0.37, 0.61, RES);
    expect(a).toEqual(b);
  });

  it("value/ridged/worley restent dans [0,1], fbm dans [-1,1]", () => {
    for (let i = 0; i < 20; i++) {
      const u = (i * 0.137) % 1;
      const v = (i * 0.271) % 1;
      const s = evalNoiseAt(SEED, u, v, RES);
      expect(s.value).toBeGreaterThanOrEqual(0);
      expect(s.value).toBeLessThanOrEqual(1);
      expect(s.ridged).toBeGreaterThanOrEqual(0);
      expect(s.ridged).toBeLessThanOrEqual(1);
      expect(s.worley).toBeGreaterThanOrEqual(0);
      expect(s.worley).toBeLessThanOrEqual(1);
      expect(s.fbm).toBeGreaterThanOrEqual(-1);
      expect(s.fbm).toBeLessThanOrEqual(1);
    }
  });
});
