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

describe("buildGravestone — habillage (mission 07 : mousse/lichen/coulures)", () => {
  const averageGreenness = (a: ReturnType<typeof buildGravestone>): number => {
    const colors = a.geometry.getAttribute("color").array;
    let g = 0, rb = 0;
    for (let i = 0; i < colors.length; i += 3) {
      g += colors[i + 1];
      rb += colors[i] + colors[i + 2];
    }
    return g / (rb || 1);
  };

  it("maintenance ↓ ⇒ la stèle est visiblement plus verte (mousse/lichen)", () => {
    for (const seed of [1, 7, 99]) {
      const clean = buildGravestone(axes({ maintenance: 0.95 }), seed);
      const neglected = buildGravestone(axes({ maintenance: 0.05 }), seed);
      expect(averageGreenness(neglected)).toBeGreaterThan(averageGreenness(clean));
    }
  });

  it("mêmes (axes, seed) → habillage identique (déterminisme déjà couvert par la géométrie)", () => {
    const a = buildGravestone(axes({ maintenance: 0.1 }), 5);
    const b = buildGravestone(axes({ maintenance: 0.1 }), 5);
    expect(Array.from(a.geometry.getAttribute("color").array)).toEqual(
      Array.from(b.geometry.getAttribute("color").array),
    );
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
