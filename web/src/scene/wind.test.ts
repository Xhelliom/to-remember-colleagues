import { describe, expect, it } from "vitest";
import * as THREE from "three";
import {
  addWindWeightAttribute,
  applyWind,
  GRASS_WIND_POOL,
  swayFreq,
  swayPhase,
  swayPhaseOffset,
  windLean,
  windOffset,
} from "./wind.ts";

describe("windLean", () => {
  it("est monotone croissante avec la force", () => {
    expect(windLean(0.5)).toBeLessThan(windLean(1));
    expect(windLean(1)).toBeLessThan(windLean(2));
  });

  it("est proportionnelle à force² (ratio lean(2f)/lean(f) ≈ 4)", () => {
    const f = 0.8;
    const ratio = windLean(2 * f) / windLean(f);
    expect(ratio).toBeCloseTo(4, 10);
  });

  it("est nulle à force nulle", () => {
    expect(windLean(0)).toBe(0);
  });
});

describe("swayFreq — amplitude ≠ fréquence", () => {
  it("est indépendante de la force à instance égale (seule l'amplitude dépend de la rafale)", () => {
    const seed = 42;
    expect(swayFreq(seed, 0.1)).toBe(swayFreq(seed, 5));
  });

  it("varie d'une instance à l'autre (décorrélation des graines)", () => {
    expect(swayFreq(1)).not.toBe(swayFreq(2));
  });
});

describe("swayPhase — pas de phase-explosion", () => {
  it("est linéaire en t : dérivée seconde numérique ≈ 0, même à t=10000s", () => {
    const seed = 7;
    const t = 10_000;
    const dt = 0.5;
    const p0 = swayPhase(t, seed);
    const p1 = swayPhase(t + dt, seed);
    const p2 = swayPhase(t + 2 * dt, seed);
    const secondDerivative = p2 - 2 * p1 + p0;
    expect(Math.abs(secondDerivative)).toBeLessThan(1e-9);
  });

  it("ne dérive jamais vers `t * f(t)` : la pente (fréquence) est constante dans le temps", () => {
    const seed = 7;
    const slopeEarly = (swayPhase(1, seed) - swayPhase(0, seed)) / 1;
    const slopeLate = (swayPhase(10_001, seed) - swayPhase(10_000, seed)) / 1;
    expect(slopeLate).toBeCloseTo(slopeEarly, 10);
  });
});

describe("décorrélation entre instances", () => {
  it("deux graines différentes ont des phases distinctes à t fixe", () => {
    const t = 12.34;
    expect(swayPhase(t, 1)).not.toBe(swayPhase(t, 2));
    expect(swayPhaseOffset(1)).not.toBe(swayPhaseOffset(2));
  });
});

describe("windOffset", () => {
  it("est au repos (0) pour une force nulle, quel que soit t", () => {
    expect(windOffset(0, 0, 3)).toBe(0);
    expect(windOffset(100, 0, 3)).toBe(0);
  });

  it("s'écarte du repos dès que la force est non nulle", () => {
    expect(windOffset(0.3, 1, 3)).not.toBe(0);
  });
});

describe("applyWind (API stable pour 04/08)", () => {
  it("clone le matériau, fige la clé de cache sur le pool et prépare l'injection GLSL", () => {
    const src = new THREE.MeshStandardMaterial();
    const mat = applyWind(src, { pool: GRASS_WIND_POOL });
    expect(mat).not.toBe(src);
    expect(mat.customProgramCacheKey?.()).toBe(GRASS_WIND_POOL.cacheKey);
    expect(typeof mat.onBeforeCompile).toBe("function");
  });
});

describe("addWindWeightAttribute", () => {
  it("pose un attribut aWindWeight borné dans [0, 1], nul à la base", () => {
    const geo = new THREE.BoxGeometry(1, 2, 1);
    addWindWeightAttribute(geo, GRASS_WIND_POOL);
    const attr = geo.getAttribute("aWindWeight") as THREE.BufferAttribute;
    expect(attr).toBeDefined();
    for (let i = 0; i < attr.count; i++) {
      expect(attr.getX(i)).toBeGreaterThanOrEqual(0);
      expect(attr.getX(i)).toBeLessThanOrEqual(1);
    }
    expect(Math.min(...attr.array)).toBe(0);
  });
});
