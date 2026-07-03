import { describe, expect, it } from "vitest";
import {
  CascadeShadowCache,
  clampAmbientFloor,
  computeCascadePcssRadius,
  computeCascadeSplits,
  resolveShadowPreset,
  shouldInvalidateCascadeCache,
  type SunDirection,
} from "./shadows.ts";

describe("computeCascadeSplits", () => {
  it("renvoie `cascades` frontières, la dernière valant toujours 1", () => {
    for (const cascades of [1, 2, 3, 4]) {
      const splits = computeCascadeSplits(cascades, 1, 100, "practical");
      expect(splits).toHaveLength(cascades);
      expect(splits[splits.length - 1]).toBe(1);
    }
  });

  it("est strictement croissante (cascades non chevauchantes, non vides)", () => {
    const splits = computeCascadeSplits(4, 0.1, 120, "practical");
    for (let i = 1; i < splits.length; i++) expect(splits[i]).toBeGreaterThan(splits[i - 1]);
  });

  it("mode uniform : répartition linéaire exacte (calcul à la main)", () => {
    // near=0, far=100, 4 cascades → frontières à 25/50/75/100 (fractions de far).
    const splits = computeCascadeSplits(4, 0, 100, "uniform");
    expect(splits[0]).toBeCloseTo(0.25, 10);
    expect(splits[1]).toBeCloseTo(0.5, 10);
    expect(splits[2]).toBeCloseTo(0.75, 10);
    expect(splits[3]).toBe(1);
  });

  it("mode logarithmic : cascades resserrées près de la caméra, larges au loin", () => {
    const splits = computeCascadeSplits(4, 1, 100, "logarithmic");
    const widths = splits.map((s, i) => s - (i === 0 ? 0 : splits[i - 1]));
    // Chaque tranche (en fraction de far) est plus large que la précédente.
    for (let i = 1; i < widths.length; i++) expect(widths[i]).toBeGreaterThan(widths[i - 1]);
  });

  it("mode practical (lambda=0.5) est entre uniform et logarithmic à chaque frontière", () => {
    const u = computeCascadeSplits(3, 1, 100, "uniform");
    const l = computeCascadeSplits(3, 1, 100, "logarithmic");
    const p = computeCascadeSplits(3, 1, 100, "practical");
    for (let i = 0; i < p.length; i++) {
      expect(p[i]).toBeGreaterThanOrEqual(Math.min(u[i], l[i]));
      expect(p[i]).toBeLessThanOrEqual(Math.max(u[i], l[i]));
    }
  });

  it("lève si cascades < 1", () => {
    expect(() => computeCascadeSplits(0, 1, 100)).toThrow();
  });
});

describe("computeCascadePcssRadius", () => {
  it("la cascade la plus proche (index 0) utilise le rayon de base", () => {
    expect(computeCascadePcssRadius(0, 4, 2, 3)).toBe(2);
  });

  it("la cascade la plus lointaine atteint le rayon max (baseRadius × farScale)", () => {
    expect(computeCascadePcssRadius(3, 4, 2, 3)).toBeCloseTo(6, 10);
  });

  it("croît strictement monotone avec l'indice (pénombre plus large au loin)", () => {
    const radii = [0, 1, 2, 3].map((i) => computeCascadePcssRadius(i, 4));
    for (let i = 1; i < radii.length; i++) expect(radii[i]).toBeGreaterThan(radii[i - 1]);
  });

  it("une seule cascade renvoie le rayon de base (rien à échelonner)", () => {
    expect(computeCascadePcssRadius(0, 1, 5, 3)).toBe(5);
  });
});

describe("shouldInvalidateCascadeCache", () => {
  const UP: SunDirection = [0, 1, 0];

  it("ne déclenche pas quand la direction est inchangée", () => {
    expect(shouldInvalidateCascadeCache(UP, UP)).toBe(false);
  });

  it("ne déclenche pas pour un micro-mouvement sous le seuil", () => {
    const almostUp: SunDirection = [0.001, 0.9999995, 0];
    expect(shouldInvalidateCascadeCache(UP, almostUp, 0.01)).toBe(false);
  });

  it("déclenche pour une rotation franche du soleil (ex. avance rapide de l'heure)", () => {
    const n = Math.SQRT1_2;
    const tilted: SunDirection = [n, n, 0]; // 45° depuis UP, déjà normalisé
    expect(shouldInvalidateCascadeCache(UP, tilted, 0.01)).toBe(true);
  });
});

describe("CascadeShadowCache", () => {
  const UP: SunDirection = [0, 1, 0];
  const TILTED: SunDirection = [1, 0, 0];

  it("rafraîchit dès la première demande (pas d'historique)", () => {
    const cache = new CascadeShadowCache(6, 0.01);
    expect(cache.shouldRefresh(true, UP)).toBe(true);
  });

  it("ne rafraîchit pas sans demande ni mouvement du soleil", () => {
    const cache = new CascadeShadowCache(6, 0.01);
    cache.shouldRefresh(true, UP); // établit la référence
    expect(cache.shouldRefresh(false, UP)).toBe(false);
  });

  it("retarde un rafraîchissement demandé jusqu'à la fenêtre de cadence", () => {
    const cache = new CascadeShadowCache(3, 0.01);
    expect(cache.shouldRefresh(true, UP)).toBe(true); // frame 1 : premier refresh
    expect(cache.shouldRefresh(true, UP)).toBe(false); // frame 2
    expect(cache.shouldRefresh(true, UP)).toBe(false); // frame 3
    expect(cache.shouldRefresh(true, UP)).toBe(true); // frame 4 : fenêtre de 3 écoulée
  });

  it("force un rafraîchissement immédiat quand le soleil bouge, même hors fenêtre", () => {
    const cache = new CascadeShadowCache(100, 0.01); // fenêtre large : ne devrait jamais se déclencher seule
    expect(cache.shouldRefresh(true, UP)).toBe(true);
    expect(cache.shouldRefresh(true, UP)).toBe(false);
    expect(cache.shouldRefresh(true, TILTED)).toBe(true); // soleil a tourné → forcé
  });

  it("un mouvement du soleil réinitialise la fenêtre de cadence", () => {
    const cache = new CascadeShadowCache(3, 0.01);
    cache.shouldRefresh(true, UP);
    cache.shouldRefresh(true, TILTED); // forcé par le mouvement, reset la fenêtre
    expect(cache.shouldRefresh(true, TILTED)).toBe(false); // immédiatement après : encore dans la fenêtre
  });
});

describe("clampAmbientFloor", () => {
  it("laisse une intensité déjà au-dessus du plancher inchangée", () => {
    expect(clampAmbientFloor(0.5, 0.18)).toBe(0.5);
  });

  it("relève une intensité sous le plancher jusqu'au plancher", () => {
    expect(clampAmbientFloor(0.05, 0.18)).toBe(0.18);
  });

  it("n'affecte aucune ambiance existante (toutes ≥ 0.3, cf. ambiance.ts)", () => {
    for (const intensity of [0.3, 0.35, 0.45, 0.5, 0.65]) {
      expect(clampAmbientFloor(intensity)).toBe(intensity);
    }
  });
});

describe("resolveShadowPreset", () => {
  it("retombe sur high par défaut si absent ou inconnu", () => {
    const dflt = resolveShadowPreset(null);
    expect(resolveShadowPreset("bogus")).toEqual(dflt);
    expect(dflt.cascades).toBeGreaterThan(0);
  });

  it("low a moins de cascades/résolution que high (budget perf réduit)", () => {
    const low = resolveShadowPreset("low");
    const high = resolveShadowPreset("high");
    expect(low.cascades).toBeLessThanOrEqual(high.cascades);
    expect(low.shadowMapSize).toBeLessThanOrEqual(high.shadowMapSize);
  });

  it("ultra n'est jamais moins détaillé que high", () => {
    const ultra = resolveShadowPreset("ultra");
    const high = resolveShadowPreset("high");
    expect(ultra.shadowMapSize).toBeGreaterThanOrEqual(high.shadowMapSize);
  });
});
