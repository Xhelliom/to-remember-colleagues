import { describe, expect, it } from "vitest";
import { distanceFogFactor, groundFogOpacity, heightFogFactor } from "./groundFog.ts";

describe("heightFogFactor — brume de hauteur analytique", () => {
  it("décroît strictement en s'élevant au-dessus du sol", () => {
    const ground = heightFogFactor(0.2, 2);
    const mid = heightFogFactor(2, 2);
    const high = heightFogFactor(10, 2);
    expect(ground).toBeGreaterThan(mid);
    expect(mid).toBeGreaterThan(high);
  });

  it("reste dans [0, 1] (jamais de fog-as-cover au-delà de 100%)", () => {
    expect(heightFogFactor(-5, 2)).toBeLessThanOrEqual(1);
    expect(heightFogFactor(1000, 2)).toBeGreaterThanOrEqual(0);
  });

  it("est proche de 1 au ras du sol", () => {
    expect(heightFogFactor(0, 2)).toBeCloseTo(1, 5);
  });
});

describe("distanceFogFactor — sélective (proche = clair)", () => {
  it("croît avec la distance", () => {
    expect(distanceFogFactor(0, 0.05)).toBeLessThan(distanceFogFactor(50, 0.05));
  });

  it("est nulle à distance nulle", () => {
    expect(distanceFogFactor(0, 0.05)).toBe(0);
  });
});

describe("groundFogOpacity — combinaison plafonnée", () => {
  it("ne dépasse jamais MAX_FOG_OPACITY même très près du sol et très loin", () => {
    expect(groundFogOpacity(0, 10_000)).toBeLessThanOrEqual(0.75);
  });

  it("est quasi nulle en altitude, même très loin (sélective)", () => {
    expect(groundFogOpacity(200, 10_000)).toBeLessThan(0.01);
  });
});
