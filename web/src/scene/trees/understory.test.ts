import { describe, expect, it } from "vitest";
import {
  buildBush, buildFern, buildFlower,
  canopyCoverageAt, CANOPY_FERN_MIN, CANOPY_FLOWER_MAX, isFernSpot, isFlowerSpot,
  IVY_MAINTENANCE_MAX, ivyCoverage,
  scatterUnderstory, type CanopyDisc,
} from "./understory.ts";

// Budgets tri généreux (cf. treeBuilder.test.ts) : bornent une explosion accidentelle
// du modèle sans contraindre l'esthétique — ces builders sont pensés pour l'instanciation.
const BUSH_MIN_TRIANGLES = 60, BUSH_MAX_TRIANGLES = 1000;
const FERN_MIN_TRIANGLES = 15, FERN_MAX_TRIANGLES = 300;
const FLOWER_MIN_TRIANGLES = 4, FLOWER_MAX_TRIANGLES = 60;
const COARSE_LOD = 1;

describe("buildBush — déterminisme et budget", () => {
  it("même graine → mêmes statistiques", () => {
    const a = buildBush(1);
    const b = buildBush(1);
    expect(a.stats).toEqual(b.stats);
    a.dispose();
    b.dispose();
  });

  it("tri-count dans le budget attendu", () => {
    const bush = buildBush(1);
    expect(bush.stats.totalTriangles).toBeGreaterThan(BUSH_MIN_TRIANGLES);
    expect(bush.stats.totalTriangles).toBeLessThan(BUSH_MAX_TRIANGLES);
    bush.dispose();
  });

  it("deux graines différentes → tri-counts ou géométrie distincts", () => {
    const a = buildBush(1);
    const b = buildBush(2);
    // Le squelette (croissance seedée) diverge nécessairement en position — au moins un
    // sommet du groupe doit différer même si les tri-counts globaux se recoupent.
    const posA = (a.group.children[0] as import("three").Mesh).geometry.getAttribute("position");
    const posB = (b.group.children[0] as import("three").Mesh).geometry.getAttribute("position");
    expect(posA.array).not.toEqual(posB.array);
    a.dispose();
    b.dispose();
  });

  it("un LOD grossier a strictement moins de triangles qu'un LOD proche", () => {
    const near = buildBush(1, { lod: 0 });
    const far = buildBush(1, { lod: COARSE_LOD });
    expect(far.stats.totalTriangles).toBeLessThan(near.stats.totalTriangles);
    near.dispose();
    far.dispose();
  });

  it("dispose() ne lève pas", () => {
    const bush = buildBush(3);
    expect(() => bush.dispose()).not.toThrow();
  });
});

describe("buildFern — déterminisme et budget", () => {
  it("même graine → mêmes statistiques", () => {
    const a = buildFern(1);
    const b = buildFern(1);
    expect(a.stats).toEqual(b.stats);
    a.dispose();
    b.dispose();
  });

  it("tri-count dans le budget attendu", () => {
    const fern = buildFern(1);
    expect(fern.stats.totalTriangles).toBeGreaterThan(FERN_MIN_TRIANGLES);
    expect(fern.stats.totalTriangles).toBeLessThan(FERN_MAX_TRIANGLES);
    fern.dispose();
  });

  it("un LOD grossier a strictement moins de triangles (moins de frondes)", () => {
    const near = buildFern(1, { lod: 0 });
    const far = buildFern(1, { lod: COARSE_LOD });
    expect(far.stats.totalTriangles).toBeLessThan(near.stats.totalTriangles);
    near.dispose();
    far.dispose();
  });

  it("deux graines différentes → géométrie distincte", () => {
    const a = buildFern(1);
    const b = buildFern(2);
    const posA = (a.group.children[0] as import("three").Mesh).geometry.getAttribute("position");
    const posB = (b.group.children[0] as import("three").Mesh).geometry.getAttribute("position");
    expect(posA.array).not.toEqual(posB.array);
    a.dispose();
    b.dispose();
  });

  it("dispose() ne lève pas", () => {
    const fern = buildFern(4);
    expect(() => fern.dispose()).not.toThrow();
  });
});

describe("buildFlower — déterminisme et budget", () => {
  it("même graine → mêmes statistiques", () => {
    const a = buildFlower(1);
    const b = buildFlower(1);
    expect(a.stats).toEqual(b.stats);
    a.dispose();
    b.dispose();
  });

  it("tri-count dans le budget attendu (très bon marché, pensé pour l'instanciation)", () => {
    const flower = buildFlower(1);
    expect(flower.stats.totalTriangles).toBeGreaterThan(FLOWER_MIN_TRIANGLES);
    expect(flower.stats.totalTriangles).toBeLessThan(FLOWER_MAX_TRIANGLES);
    flower.dispose();
  });

  it("un LOD grossier a strictement moins de triangles (moins de pétales)", () => {
    const near = buildFlower(1, { lod: 0 });
    const far = buildFlower(1, { lod: COARSE_LOD });
    expect(far.stats.totalTriangles).toBeLessThan(near.stats.totalTriangles);
    near.dispose();
    far.dispose();
  });

  it("dispose() ne lève pas", () => {
    const flower = buildFlower(5);
    expect(() => flower.dispose()).not.toThrow();
  });
});

describe("placement — canopyCoverageAt", () => {
  const canopy: CanopyDisc = { cx: 0, cz: 0, radius: 2 };

  it("couverture maximale (1) au centre de la couronne", () => {
    expect(canopyCoverageAt(0, 0, [canopy])).toBe(1);
  });

  it("couverture nulle loin de toute couronne", () => {
    expect(canopyCoverageAt(50, 50, [canopy])).toBe(0);
  });

  it("couverture dégradée entre le rayon de couronne et la marge de transition", () => {
    const atEdge = canopyCoverageAt(2.2, 0, [canopy]);
    expect(atEdge).toBeGreaterThan(0);
    expect(atEdge).toBeLessThan(1);
  });

  it("plusieurs couronnes qui se chevauchent → maximum local", () => {
    // À (2.5, 0) : bord dégradé de `canopy` (coverage < 1) mais sous le tronc de la seconde → 1.
    const overlapping: CanopyDisc[] = [canopy, { cx: 4, cz: 0, radius: 2 }];
    expect(canopyCoverageAt(2.5, 0, overlapping)).toBeGreaterThan(canopyCoverageAt(2.5, 0, [canopy]));
  });
});

describe("placement — prédicats fougère sous couronne / fleur en trouée (cas connus)", () => {
  it("couverture dense → spot fougère, pas spot fleur", () => {
    expect(isFernSpot(0.9)).toBe(true);
    expect(isFlowerSpot(0.9)).toBe(false);
  });

  it("trouée ouverte → spot fleur, pas spot fougère", () => {
    expect(isFernSpot(0.05)).toBe(false);
    expect(isFlowerSpot(0.05)).toBe(true);
  });

  it("mi-ombre (bande entre les deux seuils) → ni fougère ni fleur", () => {
    const midShade = (CANOPY_FERN_MIN + CANOPY_FLOWER_MAX) / 2;
    expect(isFernSpot(midShade)).toBe(false);
    expect(isFlowerSpot(midShade)).toBe(false);
  });

  it("seuils eux-mêmes inclus dans leur prédicat respectif", () => {
    expect(isFernSpot(CANOPY_FERN_MIN)).toBe(true);
    expect(isFlowerSpot(CANOPY_FLOWER_MAX)).toBe(true);
  });
});

describe("placement — ivyCoverage (lien maintenance, cf. mission 07)", () => {
  it("tombe totalement négligée (maintenance 0) → couverture de lierre maximale", () => {
    expect(ivyCoverage(0)).toBe(1);
  });

  it("tombe bien entretenue (au-delà du seuil) → pas de lierre", () => {
    expect(ivyCoverage(IVY_MAINTENANCE_MAX)).toBe(0);
    expect(ivyCoverage(1)).toBe(0);
  });

  it("décroît strictement entre 0 et le seuil", () => {
    const low = ivyCoverage(0.05);
    const high = ivyCoverage(0.25);
    expect(low).toBeGreaterThan(high);
    expect(high).toBeGreaterThan(0);
  });
});

describe("scatterUnderstory — dispersion déterministe", () => {
  const canopies: CanopyDisc[] = [{ cx: 0, cz: 0, radius: 2 }];

  it("même graine → même dispersion (positions, types, rotations)", () => {
    const a = scatterUnderstory(1, 5, 60, canopies);
    const b = scatterUnderstory(1, 5, 60, canopies);
    expect(a).toEqual(b);
  });

  it("deux graines différentes → dispersions distinctes", () => {
    const a = scatterUnderstory(1, 5, 60, canopies);
    const b = scatterUnderstory(2, 5, 60, canopies);
    expect(a).not.toEqual(b);
  });

  it("les placements proches du centre (sous couronne) sont des fougères", () => {
    const placements = scatterUnderstory(1, 5, 200, canopies);
    const nearCenter = placements.filter((p) => Math.hypot(p.x, p.z) < 0.5);
    expect(nearCenter.length).toBeGreaterThan(0);
    for (const p of nearCenter) expect(p.kind).toBe("fern");
  });

  it("toutes les positions restent dans la zone [-halfExtent, halfExtent]", () => {
    const halfExtent = 4;
    const placements = scatterUnderstory(1, halfExtent, 100, canopies);
    for (const p of placements) {
      expect(Math.abs(p.x)).toBeLessThanOrEqual(halfExtent);
      expect(Math.abs(p.z)).toBeLessThanOrEqual(halfExtent);
    }
  });
});
