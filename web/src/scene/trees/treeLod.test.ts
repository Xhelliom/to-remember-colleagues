import { describe, expect, it } from "vitest";
import {
  pickTreeLodTier,
  placementBoundsRadius,
  placementCentroid,
  TREE_LOD_THRESHOLDS,
  TREE_LOD_TIER_CARDS_R1,
  TREE_LOD_TIER_CARDS_R2,
  TREE_LOD_TIER_HERO,
  TREE_LOD_TIER_IMPOSTOR,
  type TreePlacement,
} from "./treeLod.ts";

// --- Sélection de palier de LOD par distance : monotone ---------------------

describe("pickTreeLodTier", () => {
  it("hero au plus près", () => {
    expect(pickTreeLodTier(0, TREE_LOD_TIER_HERO)).toBe(TREE_LOD_TIER_HERO);
  });

  it("passe par les 4 paliers en s'éloignant, jamais en sautant vers l'arrière", () => {
    let tier = TREE_LOD_TIER_HERO;
    const distances = [0, 10, 25, 40, 60, 80, 100, 130, 200];
    const seen: number[] = [];
    for (const d of distances) {
      tier = pickTreeLodTier(d, tier);
      seen.push(tier);
    }
    for (let i = 1; i < seen.length; i++) expect(seen[i]).toBeGreaterThanOrEqual(seen[i - 1]);
    expect(seen[seen.length - 1]).toBe(TREE_LOD_TIER_IMPOSTOR);
  });

  it("au-delà du dernier seuil → impostor", () => {
    expect(pickTreeLodTier(1000, TREE_LOD_TIER_HERO)).toBe(TREE_LOD_TIER_IMPOSTOR);
  });

  it("hystérésis : ne redescend pas tant qu'on n'est pas clairement repassé sous le seuil précédent", () => {
    const justAbove = TREE_LOD_THRESHOLDS[0] + 1; // dans la fenêtre d'hystérésis
    expect(pickTreeLodTier(justAbove, TREE_LOD_TIER_HERO)).toBe(TREE_LOD_TIER_HERO);
  });

  it("remonte en se rapprochant, jamais en sautant plusieurs paliers d'un coup", () => {
    let tier = TREE_LOD_TIER_IMPOSTOR;
    const distances = [200, 100, 60, 40, 25, 10, 0];
    let prev = tier;
    for (const d of distances) {
      tier = pickTreeLodTier(d, tier);
      expect(tier).toBeLessThanOrEqual(prev);
      prev = tier;
    }
    expect(tier).toBe(TREE_LOD_TIER_HERO);
  });

  it("les 4 paliers correspondent bien à HERO/CARDS_R1/CARDS_R2/IMPOSTOR", () => {
    expect(TREE_LOD_TIER_HERO).toBe(0);
    expect(TREE_LOD_TIER_CARDS_R1).toBe(1);
    expect(TREE_LOD_TIER_CARDS_R2).toBe(2);
    expect(TREE_LOD_TIER_IMPOSTOR).toBe(3);
  });
});

// --- Bornes de placement (centroïde, rayon) — utilisées par le canopy shell -

function placement(x: number, z: number): TreePlacement {
  return { x, y: 0, z, yaw: 0, scale: 1, seed: 1 };
}

describe("placementCentroid", () => {
  it("liste vide → {0,0}", () => {
    expect(placementCentroid([])).toEqual({ x: 0, z: 0 });
  });

  it("moyenne des positions", () => {
    expect(placementCentroid([placement(0, 0), placement(10, 0), placement(5, 10)])).toEqual({ x: 5, z: 10 / 3 });
  });
});

describe("placementBoundsRadius", () => {
  it("liste vide → 0", () => {
    expect(placementBoundsRadius([], 0, 0)).toBe(0);
  });

  it("distance max au centre parmi les placements", () => {
    const placements = [placement(3, 0), placement(0, 4), placement(1, 1)];
    expect(placementBoundsRadius(placements, 0, 0)).toBe(4);
  });
});
