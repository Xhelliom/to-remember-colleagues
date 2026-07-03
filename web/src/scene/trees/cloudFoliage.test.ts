import { describe, expect, it } from "vitest";
import { buildCloudFoliage } from "./cloudFoliage.ts";
import { BEECH_SPECIES, growSkeleton } from "./skeleton.ts";

function anchors(seed: number) {
  return growSkeleton(BEECH_SPECIES, seed).anchors;
}

describe("buildCloudFoliage", () => {
  it("produit une géométrie non vide (un blob par cluster, triangles finis)", () => {
    const cloud = buildCloudFoliage(anchors(1), 1);
    expect(cloud.cloudCount).toBeGreaterThan(0);
    expect(cloud.triangleCount).toBeGreaterThan(0);
    const pos = cloud.mesh.geometry.getAttribute("position").array as ArrayLike<number>;
    expect(pos.length).toBe(cloud.triangleCount * 9);
    for (let i = 0; i < pos.length; i++) expect(Number.isFinite(pos[i])).toBe(true);
    cloud.dispose();
  });

  it("est déterministe : même (ancres, graine) → mêmes positions", () => {
    const a = buildCloudFoliage(anchors(3), 3);
    const b = buildCloudFoliage(anchors(3), 3);
    const pa = a.mesh.geometry.getAttribute("position").array as Float32Array;
    const pb = b.mesh.geometry.getAttribute("position").array as Float32Array;
    expect(Array.from(pa)).toEqual(Array.from(pb));
    a.dispose();
    b.dispose();
  });
});
