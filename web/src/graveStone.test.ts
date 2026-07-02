import { describe, expect, it } from "vitest";
import type { GraveAxes } from "./graveAxes.ts";
import { buildGravestone, weatheringParamsFromAxes } from "./graveStone.ts";

const axes = (overrides: Partial<GraveAxes> = {}): GraveAxes => ({
  age: 0.3,
  vote: 0,
  maintenance: 0.5,
  construction: false,
  ...overrides,
});

describe("buildGravestone — déterminisme", () => {
  it("mêmes (axes, seed) → géométrie et métriques identiques", () => {
    const a = buildGravestone(axes(), 123);
    const b = buildGravestone(axes(), 123);
    expect(Array.from(a.geometry.getAttribute("position").array)).toEqual(
      Array.from(b.geometry.getAttribute("position").array),
    );
    expect(a.fractureCount).toBe(b.fractureCount);
    expect(a.mossOpennessAvg).toBeCloseTo(b.mossOpennessAvg, 12);
    expect(a.hueBias).toBe(b.hueBias);
  });

  it("des graines différentes produisent des géométries différentes", () => {
    const a = buildGravestone(axes(), 123);
    const b = buildGravestone(axes(), 456);
    expect(Array.from(a.geometry.getAttribute("position").array)).not.toEqual(
      Array.from(b.geometry.getAttribute("position").array),
    );
  });
});

describe("buildGravestone — monotonie de l'entretien (mesurée sur le champ)", () => {
  const SEEDS = [1, 7, 99, 2024];

  it("maintenance ↓ ⇒ mossOpennessAvg ↑", () => {
    for (const seed of SEEDS) {
      const clean = buildGravestone(axes({ maintenance: 0.95 }), seed);
      const neglected = buildGravestone(axes({ maintenance: 0.05 }), seed);
      expect(neglected.mossOpennessAvg).toBeGreaterThan(clean.mossOpennessAvg);
    }
  });

  it("maintenance ↓ ⇒ nombre de fractures ↑", () => {
    for (const seed of SEEDS) {
      const clean = buildGravestone(axes({ maintenance: 0.95 }), seed);
      const neglected = buildGravestone(axes({ maintenance: 0.05 }), seed);
      expect(neglected.fractureCount).toBeGreaterThan(clean.fractureCount);
    }
  });
});

describe("weatheringParamsFromAxes — votes extrêmes", () => {
  it("hanté vs paradisiaque → paramètres d'altération distincts", () => {
    const haunted = weatheringParamsFromAxes(axes({ vote: -1 }));
    const blessed = weatheringParamsFromAxes(axes({ vote: 1 }));
    expect(haunted.hueBias).not.toBeCloseTo(blessed.hueBias, 5);
    expect(haunted.params.crackIntensity).not.toBeCloseTo(blessed.params.crackIntensity, 5);
  });

  it("neutre (vote=0) est entre les deux extrêmes en teinte", () => {
    const neutral = weatheringParamsFromAxes(axes({ vote: 0 }));
    const haunted = weatheringParamsFromAxes(axes({ vote: -1 }));
    const blessed = weatheringParamsFromAxes(axes({ vote: 1 }));
    expect(neutral.hueBias).toBeGreaterThan(haunted.hueBias);
    expect(neutral.hueBias).toBeLessThan(blessed.hueBias);
  });
});
