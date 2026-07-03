import { describe, expect, it } from "vitest";
import {
  cellCenter,
  cellIndex,
  cellSeed,
  cellsInRing,
  GRASS_CELL,
  GrassRing,
  keepInHomeBand,
  RING_BAND_THRESHOLDS,
  RING_FAR_RADIUS,
  ringCoverage,
  thinningKeep,
  transitionProgress,
} from "./grassRing.ts";

// --- Sélection de cellule toroïdale (déterministe) --------------------------

describe("cellIndex — grille toroïdale", () => {
  it("est déterministe : même position → même cellule", () => {
    expect(cellIndex(13.7, -4.2)).toEqual(cellIndex(13.7, -4.2));
  });

  it("reste dans la même cellule sous la demi-taille de cellule (congruence)", () => {
    const a = cellIndex(0, 0);
    const b = cellIndex(GRASS_CELL * 0.4, 0);
    expect(b).toEqual(a);
  });

  it("change de cellule (de 1) en franchissant la frontière", () => {
    const a = cellIndex(GRASS_CELL / 2 - 0.01, 0);
    const b = cellIndex(GRASS_CELL / 2 + 0.01, 0);
    expect(b.cx).toBe(a.cx + 1);
  });

  it("cellCenter est l'inverse exact (coordonnées entières → mètres)", () => {
    const cell = cellIndex(21, -9);
    const center = cellCenter(cell);
    expect(center.x).toBe(cell.cx * GRASS_CELL);
    expect(center.z).toBe(cell.cz * GRASS_CELL);
  });
});

describe("cellSeed — contenu dérivé UNIQUEMENT de la cellule absolue", () => {
  it("est déterministe : même cellule → même graine (recyclage sans couture)", () => {
    const cell = { cx: 3, cz: -7 };
    expect(cellSeed(cell)).toBe(cellSeed({ cx: 3, cz: -7 }));
  });

  it("deux cellules distinctes ont (presque toujours) des graines différentes", () => {
    expect(cellSeed({ cx: 3, cz: -7 })).not.toBe(cellSeed({ cx: 4, cz: -7 }));
    expect(cellSeed({ cx: 3, cz: -7 })).not.toBe(cellSeed({ cx: 3, cz: -6 }));
  });
});

describe("cellsInRing — énumération déterministe", () => {
  it("est déterministe et triée du plus proche au plus lointain", () => {
    const a = cellsInRing(10, 5);
    const b = cellsInRing(10, 5);
    expect(a).toEqual(b);
    for (let i = 1; i < a.length; i++) {
      expect(a[i].distance).toBeGreaterThanOrEqual(a[i - 1].distance);
    }
  });

  it("ne renvoie que des cellules à portée (distance ≤ RING_FAR_RADIUS)", () => {
    for (const cell of cellsInRing(0, 0)) {
      expect(cell.distance).toBeLessThanOrEqual(RING_FAR_RADIUS);
    }
  });

  it("suit la caméra : se déplacer change l'ensemble des cellules retournées", () => {
    const near = new Set(cellsInRing(0, 0).map((c) => `${c.cx}:${c.cz}`));
    const far = new Set(cellsInRing(200, 200).map((c) => `${c.cx}:${c.cz}`));
    expect([...near].some((k) => far.has(k))).toBe(false);
  });
});

// --- Amincissement continu : monotone décroissant + jamais chauve ----------

describe("thinningKeep — monotone décroissante avec la distance", () => {
  it("vaut 1 (densité pleine) près de la caméra", () => {
    expect(thinningKeep(0)).toBe(1);
  });

  it("décroît strictement au-delà de la zone de densité pleine", () => {
    const samples = [10, 15, 20, 25, 30, 35, 40, 60];
    for (let i = 1; i < samples.length; i++) {
      expect(thinningKeep(samples[i])).toBeLessThanOrEqual(thinningKeep(samples[i - 1]));
    }
    // Strictement décroissante entre deux points bien à l'intérieur de la rampe.
    expect(thinningKeep(20)).toBeLessThan(thinningKeep(10));
  });

  it("ne descend jamais sous le plancher, même très loin (jamais chauve)", () => {
    expect(thinningKeep(1000)).toBeGreaterThan(0);
    expect(thinningKeep(1000)).toBe(thinningKeep(RING_FAR_RADIUS));
  });
});

// --- Couverture constante (densité × largeur² stable) -----------------------

describe("ringCoverage — couverture ≈ constante malgré l'amincissement", () => {
  it("reste stable (à tolérance flottante près) sur toute la plage de distance", () => {
    const distances = [0, 5, 10, 12, 14, 18, 20, 26, 30, 35, 40, 55];
    const coverages = distances.map(ringCoverage);
    for (const c of coverages) {
      expect(c).toBeCloseTo(coverages[0], 6);
    }
  });
});

// --- Crossfade dither complémentaire (anti-pop) ------------------------------

describe("transitionProgress — rampe continue autour d'un seuil", () => {
  it("vaut 0 avant la fenêtre et 1 après", () => {
    const threshold = RING_BAND_THRESHOLDS[0];
    expect(transitionProgress(threshold - 10, threshold, 1.5)).toBe(0);
    expect(transitionProgress(threshold + 10, threshold, 1.5)).toBe(1);
  });

  it("est monotone croissante à l'intérieur de la fenêtre", () => {
    const threshold = RING_BAND_THRESHOLDS[0];
    const a = transitionProgress(threshold - 1, threshold, 1.5);
    const b = transitionProgress(threshold, threshold, 1.5);
    const c = transitionProgress(threshold + 1, threshold, 1.5);
    expect(a).toBeLessThan(b);
    expect(b).toBeLessThan(c);
  });
});

describe("keepInHomeBand — complémentarité (jamais dans les deux bandes à la fois)", () => {
  it("à progress=0, toutes les touffes restent dans la bande d'origine", () => {
    expect(keepInHomeBand(0, 0)).toBe(true);
    expect(keepInHomeBand(0.99, 0)).toBe(true);
  });

  it("à progress=1, aucune touffe (dither < 1) ne reste dans la bande d'origine", () => {
    expect(keepInHomeBand(0.5, 1)).toBe(false);
    expect(keepInHomeBand(0.99, 1)).toBe(false);
  });

  it("la fraction gardée décroît avec progress, pour une même touffe", () => {
    const dither = 0.5;
    expect(keepInHomeBand(dither, 0.2)).toBe(true);
    expect(keepInHomeBand(dither, 0.6)).toBe(false);
  });
});

// --- GrassRing : intégration légère (pas de rendu, pas de contexte WebGL) ---

describe("GrassRing", () => {
  const flatHeight = () => 0;

  it("se construit avec 3 bandes (3 InstancedMesh = 3 draw calls max)", () => {
    const ring = GrassRing.create();
    expect(ring.group.children.length).toBe(3);
    ring.dispose();
  });

  it("update() peuple les bandes sans dépasser leur capacité", () => {
    const ring = GrassRing.create();
    ring.update(0, 0, flatHeight);
    for (const mesh of ring.group.children as import("three").InstancedMesh[]) {
      expect(mesh.count).toBeGreaterThan(0);
      expect(mesh.count).toBeLessThanOrEqual(mesh.instanceMatrix.count);
    }
    ring.dispose();
  });

  it("est déterministe : même position caméra → même population de bandes", () => {
    const a = GrassRing.create();
    const b = GrassRing.create();
    a.update(3, -8, flatHeight);
    b.update(3, -8, flatHeight);
    const countsA = (a.group.children as import("three").InstancedMesh[]).map((m) => m.count);
    const countsB = (b.group.children as import("three").InstancedMesh[]).map((m) => m.count);
    expect(countsA).toEqual(countsB);
    a.dispose();
    b.dispose();
  });

  it("suit la caméra : bouger reconstruit la population sans erreur", () => {
    const ring = GrassRing.create();
    ring.update(0, 0, flatHeight);
    const before = (ring.group.children as import("three").InstancedMesh[]).map((m) => m.count);
    ring.update(50, 50, flatHeight);
    const after = (ring.group.children as import("three").InstancedMesh[]).map((m) => m.count);
    // La position a radicalement changé : la population totale reste cohérente
    // (bornée par les mêmes capacités), même si la répartition par bande diffère.
    expect(after.reduce((s, n) => s + n, 0)).toBeGreaterThan(0);
    expect(before.length).toBe(after.length);
    ring.dispose();
  });

  it("respecte exclude() : aucune touffe placée dans la zone exclue", () => {
    const ring = GrassRing.create();
    const excludeEverything = () => true;
    ring.update(0, 0, flatHeight, excludeEverything);
    const total = (ring.group.children as import("three").InstancedMesh[]).reduce((s, m) => s + m.count, 0);
    expect(total).toBe(0);
    ring.dispose();
  });

  it("dispose() libère géométries et matériaux sans lever", () => {
    const ring = GrassRing.create();
    ring.update(0, 0, flatHeight);
    expect(() => ring.dispose()).not.toThrow();
  });
});
