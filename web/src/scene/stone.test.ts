import { describe, expect, it } from "vitest";
import { buildRock, crackThreshold, defaultRockParams, sampleWeathering } from "./stone.ts";

const SEED = 4242;

describe("buildRock — tri-count", () => {
  it("detail=1 → 80 triangles (20 · 2²), borné dans une plage attendue", () => {
    const { geometry } = buildRock(defaultRockParams(1, 1), SEED);
    const triCount = geometry.index!.count / 3;
    expect(triCount).toBeGreaterThanOrEqual(60);
    expect(triCount).toBeLessThanOrEqual(100);
    expect(triCount).toBe(80);
  });

  it("le tri-count suit 20 · (detail+1)² à chaque niveau de LOD (subdivision d'icosphère)", () => {
    for (const detail of [0, 1, 2]) {
      const { geometry } = buildRock(defaultRockParams(1, detail), SEED);
      expect(geometry.index!.count / 3).toBe(20 * (detail + 1) ** 2);
    }
  });
});

describe("buildRock — déterminisme", () => {
  it("même seed/params → géométrie identique", () => {
    const a = buildRock(defaultRockParams(1, 1), SEED);
    const b = buildRock(defaultRockParams(1, 1), SEED);
    expect(Array.from(a.geometry.getAttribute("position").array)).toEqual(
      Array.from(b.geometry.getAttribute("position").array),
    );
  });

  it("des graines différentes produisent des géométries différentes", () => {
    const a = buildRock(defaultRockParams(1, 1), SEED);
    const b = buildRock(defaultRockParams(1, 1), SEED + 1);
    expect(Array.from(a.geometry.getAttribute("position").array)).not.toEqual(
      Array.from(b.geometry.getAttribute("position").array),
    );
  });
});

describe("buildRock — vdata borné", () => {
  it("hue/strataT/cavityAO/mossOpenness/crackStrength ∈ [0,1] sur tous les sommets", () => {
    const { vdata } = buildRock(defaultRockParams(1, 2), SEED);
    for (const channel of [vdata.hue, vdata.strataT, vdata.cavityAO, vdata.mossOpenness, vdata.crackStrength]) {
      for (const v of channel) {
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(1);
      }
    }
  });
});

describe("buildRock — cohérence de silhouette entre LODs (même champ)", () => {
  it("la bbox du LOD bas reste proche de celle du LOD haut, à tolérance près", () => {
    const high = buildRock(defaultRockParams(1, 3), SEED);
    const low = buildRock(defaultRockParams(1, 0), SEED);
    high.geometry.computeBoundingBox();
    low.geometry.computeBoundingBox();
    const bbH = high.geometry.boundingBox!;
    const bbL = low.geometry.boundingBox!;
    const tolerance = 0.3; // LOD bas = 12 sommets seulement : silhouette grossière par nature
    for (const axis of ["x", "y", "z"] as const) {
      expect(Math.abs(bbH.max[axis] - bbL.max[axis])).toBeLessThan(tolerance);
      expect(Math.abs(bbH.min[axis] - bbL.min[axis])).toBeLessThan(tolerance);
    }
  });
});

describe("crackThreshold", () => {
  it("décroît quand l'intensité augmente (plus de sommets qualifiés de fissurés)", () => {
    expect(crackThreshold(1)).toBeLessThan(crackThreshold(0));
  });
});

describe("sampleWeathering", () => {
  const params = defaultRockParams(1, 1).weathering;

  it("est déterministe : même (u,v,seed,params) → même échantillon", () => {
    const a = sampleWeathering(0.31, 0.62, SEED, params);
    const b = sampleWeathering(0.31, 0.62, SEED, params);
    expect(a).toEqual(b);
  });

  it("les canaux [0,1] restent bornés sur un balayage de points", () => {
    for (let i = 0; i < 25; i++) {
      const u = (i * 0.083) % 1;
      const v = (i * 0.137) % 1;
      const s = sampleWeathering(u, v, SEED, params);
      expect(s.hue).toBeGreaterThanOrEqual(0);
      expect(s.hue).toBeLessThanOrEqual(1);
      expect(s.strataT).toBeGreaterThanOrEqual(0);
      expect(s.strataT).toBeLessThan(1);
      expect(s.cavityAO).toBeGreaterThanOrEqual(0);
      expect(s.cavityAO).toBeLessThanOrEqual(1);
      expect(s.mossOpenness).toBeGreaterThanOrEqual(0);
      expect(s.mossOpenness).toBeLessThanOrEqual(1);
      expect(s.crackStrength).toBeGreaterThanOrEqual(0);
      expect(s.crackStrength).toBeLessThanOrEqual(1);
    }
  });
});
