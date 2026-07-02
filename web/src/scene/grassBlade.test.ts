import { describe, expect, it } from "vitest";
import { bladeClump, terrainNormalFromHeights, vertsPerBlade, BLADE_SEGS } from "./grassBlade.ts";

describe("bladeClump — nombre de sommets", () => {
  it("a blades·vertsPerBlade(segs) sommets", () => {
    const blades = 5;
    const segs = 4;
    const geo = bladeClump(blades, segs, 1);
    expect(geo.getAttribute("position").count).toBe(blades * vertsPerBlade(segs));
  });

  it("vertsPerBlade = (segs+1)·2 (2 colonnes par étage)", () => {
    expect(vertsPerBlade(3)).toBe(8);
    expect(vertsPerBlade(BLADE_SEGS)).toBe((BLADE_SEGS + 1) * 2);
  });
});

describe("bladeClump — normales", () => {
  it("les normales sont normalisées (norme ≈ 1)", () => {
    const geo = bladeClump(6, BLADE_SEGS, 7);
    const normal = geo.getAttribute("normal");
    for (let i = 0; i < normal.count; i++) {
      const len = Math.hypot(normal.getX(i), normal.getY(i), normal.getZ(i));
      expect(len).toBeCloseTo(1, 5);
    }
  });
});

describe("bladeClump — déterminisme", () => {
  it("même seed → mêmes sommets", () => {
    const a = bladeClump(4, BLADE_SEGS, 42);
    const b = bladeClump(4, BLADE_SEGS, 42);
    expect(Array.from(a.getAttribute("position").array)).toEqual(
      Array.from(b.getAttribute("position").array),
    );
  });

  it("deux seeds différentes → layouts différents", () => {
    const a = bladeClump(4, BLADE_SEGS, 1);
    const b = bladeClump(4, BLADE_SEGS, 2);
    expect(Array.from(a.getAttribute("position").array)).not.toEqual(
      Array.from(b.getAttribute("position").array),
    );
  });
});

describe("terrainNormalFromHeights — pente connue", () => {
  it("≈ la normale analytique sur une pente linéaire selon X (erreur < tol)", () => {
    const slope = 0.3; // hauteur = slope · x → normale analytique = normalize(-slope, 1, 0)
    const heightAt = (x: number) => slope * x;
    const n = terrainNormalFromHeights(heightAt, 5, 2);

    const norm = Math.hypot(-slope, 1, 0);
    expect(n.x).toBeCloseTo(-slope / norm, 6);
    expect(n.y).toBeCloseTo(1 / norm, 6);
    expect(n.z).toBeCloseTo(0, 6);
  });

  it("≈ la normale analytique sur une pente linéaire selon Z", () => {
    const slope = -0.6;
    const heightAt = (_x: number, z: number) => slope * z;
    const n = terrainNormalFromHeights(heightAt, 1, -3);

    const norm = Math.hypot(0, 1, -slope);
    expect(n.x).toBeCloseTo(0, 6);
    expect(n.y).toBeCloseTo(1 / norm, 6);
    expect(n.z).toBeCloseTo(-slope / norm, 6);
  });

  it("terrain plat → normale (0,1,0)", () => {
    const n = terrainNormalFromHeights(() => 0, 3, 4);
    expect(n.x).toBeCloseTo(0, 9);
    expect(n.y).toBeCloseTo(1, 9);
    expect(n.z).toBeCloseTo(0, 9);
  });
});
