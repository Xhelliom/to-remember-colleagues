import { describe, expect, it } from "vitest";
import { buildForestPlacements } from "./forestDemo.ts";

describe("buildForestPlacements", () => {
  it("même graine → placements identiques (déterminisme)", () => {
    const a = buildForestPlacements(42, 50, 100);
    const b = buildForestPlacements(42, 50, 100);
    expect(a).toEqual(b);
  });

  it("graines différentes → placements différents", () => {
    const a = buildForestPlacements(1, 20, 100);
    const b = buildForestPlacements(2, 20, 100);
    expect(a).not.toEqual(b);
  });

  it("nombre de placements = treeCount demandé", () => {
    expect(buildForestPlacements(1, 37, 100)).toHaveLength(37);
  });

  it("tous les placements restent dans le disque de rayon `radius`", () => {
    const radius = 80;
    for (const p of buildForestPlacements(7, 200, radius)) {
      expect(Math.hypot(p.x, p.z)).toBeLessThanOrEqual(radius);
    }
  });

  it("graines par instance distinctes (pas de doublon de silhouette)", () => {
    const placements = buildForestPlacements(3, 30, 100);
    expect(new Set(placements.map((p) => p.seed)).size).toBe(placements.length);
  });
});
