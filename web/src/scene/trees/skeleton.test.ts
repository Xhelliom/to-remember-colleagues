import { describe, expect, it } from "vitest";
import { BEECH_SPECIES, growSkeleton, type TreeSkeleton } from "./skeleton.ts";

const MIN_EXPECTED_ANCHORS = 50;
const MAX_EXPECTED_ANCHORS = 400;
// Somme des distances nœud-à-nœud entre deux graines : au-delà, on est sûr
// que ce ne sont pas deux clones (une seule coordonnée qui bouge suffirait
// largement à dépasser ce seuil, il est volontairement bas).
const DIVERGENCE_THRESHOLD = 0.5;

/** Somme des distances euclidiennes nœud-à-nœud (même structure attendue, cf. test). */
function totalNodeDistance(a: TreeSkeleton, b: TreeSkeleton): number {
  let sum = 0;
  for (let i = 0; i < a.nodes.length; i++) {
    const na = a.nodes[i].position;
    const nb = b.nodes[i].position;
    sum += Math.hypot(na.x - nb.x, na.y - nb.y, na.z - nb.z);
  }
  return sum;
}

describe("growSkeleton — déterminisme", () => {
  it("même graine → squelette structurellement identique", () => {
    const a = growSkeleton(BEECH_SPECIES, 1);
    const b = growSkeleton(BEECH_SPECIES, 1);
    expect(a.nodes).toEqual(b.nodes);
    expect(a.anchors).toEqual(b.anchors);
  });
});

describe("growSkeleton — unicité (pas de clone)", () => {
  it("deux graines différentes divergent en position", () => {
    const a = growSkeleton(BEECH_SPECIES, 1);
    const b = growSkeleton(BEECH_SPECIES, 2);
    expect(a.nodes.length).toBe(b.nodes.length); // même espèce → même structure (nb de nœuds)
    expect(totalNodeDistance(a, b)).toBeGreaterThan(DIVERGENCE_THRESHOLD);
  });

  it("dix graines produisent dix silhouettes toutes distinctes deux à deux", () => {
    const skeletons = Array.from({ length: 10 }, (_, i) => growSkeleton(BEECH_SPECIES, i + 1));
    for (let i = 0; i < skeletons.length; i++) {
      for (let j = i + 1; j < skeletons.length; j++) {
        expect(totalNodeDistance(skeletons[i], skeletons[j])).toBeGreaterThan(DIVERGENCE_THRESHOLD);
      }
    }
  });
});

describe("growSkeleton — ancres de feuilles", () => {
  it("nombre d'ancres dans la plage attendue", () => {
    const { anchors } = growSkeleton(BEECH_SPECIES, 1);
    expect(anchors.length).toBeGreaterThanOrEqual(MIN_EXPECTED_ANCHORS);
    expect(anchors.length).toBeLessThanOrEqual(MAX_EXPECTED_ANCHORS);
  });

  it("correspond exactement au nombre de brindilles terminales × feuilles par brindille", () => {
    const twigCount = BEECH_SPECIES.branchesPerLevel.reduce((p, n) => p * n, 1);
    const { anchors } = growSkeleton(BEECH_SPECIES, 1);
    expect(anchors.length).toBe(twigCount * BEECH_SPECIES.leafAnchorsPerTwig);
  });

  it("chaque ancre a une normale unitaire (feuille orientée)", () => {
    const { anchors } = growSkeleton(BEECH_SPECIES, 3);
    for (const a of anchors) {
      expect(Math.hypot(a.normal.x, a.normal.y, a.normal.z)).toBeCloseTo(1, 5);
    }
  });
});

describe("growSkeleton — structure du squelette", () => {
  it("tous les nœuds (sauf la racine) référencent un parent valide et antérieur", () => {
    const { nodes } = growSkeleton(BEECH_SPECIES, 5);
    nodes.forEach((n, i) => {
      if (i === 0) {
        expect(n.parent).toBe(-1);
        return;
      }
      expect(n.parent).toBeGreaterThanOrEqual(0);
      expect(n.parent).toBeLessThan(i);
      expect(n.radius).toBeGreaterThan(0);
    });
  });
});
