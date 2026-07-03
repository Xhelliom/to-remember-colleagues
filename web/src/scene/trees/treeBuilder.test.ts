import { describe, expect, it } from "vitest";
import { buildTree } from "./treeBuilder.ts";

// Budget triangles d'un hero UNIQUE (un seul visible à la fois, cf. plan) :
// large marge, mais borne quand même une explosion accidentelle du modèle.
// Relevé après montée en fidélité : tronc à 10 côtés (tubeMesh, anti-couture)
// + feuille de hêtre ovale (leafMesh) → ~22,5 k tris pour un seul arbre, OK.
const MIN_HERO_TRIANGLES = 500;
const MAX_HERO_TRIANGLES = 26_000;
const COARSE_LOD = 3;

describe("buildTree — budget hero (lod 0)", () => {
  it("tri-count hero dans le budget attendu", () => {
    const tree = buildTree(1);
    expect(tree.stats.totalTriangles).toBeGreaterThan(MIN_HERO_TRIANGLES);
    expect(tree.stats.totalTriangles).toBeLessThan(MAX_HERO_TRIANGLES);
    tree.dispose();
  });

  it("écorce et feuillage sont tous deux non vides", () => {
    const tree = buildTree(1);
    expect(tree.bark.geometry.getAttribute("position").count).toBeGreaterThan(0);
    expect(tree.foliageMesh.geometry.getAttribute("position").count).toBeGreaterThan(0);
    expect(tree.stats.barkTriangles).toBeGreaterThan(0);
    expect(tree.stats.foliageTriangles).toBeGreaterThan(0);
    tree.dispose();
  });
});

describe("buildTree — LOD", () => {
  it("un LOD bas (grossier) a strictement moins de triangles qu'un LOD haut (hero détaillé)", () => {
    const hero = buildTree(1, { lod: 0 });
    const coarse = buildTree(1, { lod: COARSE_LOD });
    expect(coarse.stats.totalTriangles).toBeLessThan(hero.stats.totalTriangles);
    hero.dispose();
    coarse.dispose();
  });
});

describe("buildTree — déterminisme (API stable pour la mission 09)", () => {
  it("même graine → mêmes statistiques (tri-counts, nb de nœuds/feuilles)", () => {
    const a = buildTree(7);
    const b = buildTree(7);
    expect(a.stats).toEqual(b.stats);
    a.dispose();
    b.dispose();
  });

  it("dispose() ne lève pas (géométries et matériaux/textures libérés)", () => {
    const tree = buildTree(2);
    expect(() => tree.dispose()).not.toThrow();
  });
});
