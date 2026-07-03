import { describe, expect, it } from "vitest";
import { adaptExposure, luminanceToExposure } from "./autoExposure.ts";

describe("luminanceToExposure — mapping monotone", () => {
  it("décroît strictement quand la luminance augmente", () => {
    const low = luminanceToExposure(0.1);
    const mid = luminanceToExposure(0.4);
    const high = luminanceToExposure(0.9);
    expect(low).toBeGreaterThan(mid);
    expect(mid).toBeGreaterThan(high);
  });

  it("reste dans les bornes [minExposure, maxExposure]", () => {
    expect(luminanceToExposure(0, 0.45, 0.4, 2.2)).toBeLessThanOrEqual(2.2);
    expect(luminanceToExposure(1000, 0.45, 0.4, 2.2)).toBeGreaterThanOrEqual(0.4);
  });

  it("ne divise jamais par zéro (scène noire)", () => {
    expect(Number.isFinite(luminanceToExposure(0))).toBe(true);
  });
});

describe("adaptExposure — adaptation temporelle progressive (pas de saut brusque)", () => {
  it("se rapproche de la cible sans la dépasser en un seul pas", () => {
    const next = adaptExposure(1, 2, 0.1);
    expect(next).toBeGreaterThan(1);
    expect(next).toBeLessThan(2);
  });

  it("converge vers la cible après plusieurs pas", () => {
    let exposure = 1;
    for (let i = 0; i < 200; i++) exposure = adaptExposure(exposure, 2, 0.05);
    expect(exposure).toBeCloseTo(2, 2);
  });

  it("dt=0 ne change rien (pas de saut immédiat)", () => {
    expect(adaptExposure(1, 2, 0)).toBe(1);
  });

  it("une vitesse d'adaptation plus grande converge plus vite (même dt)", () => {
    const slow = adaptExposure(1, 2, 0.2, 0.5);
    const fast = adaptExposure(1, 2, 0.2, 5);
    expect(fast).toBeGreaterThan(slow);
  });
});
