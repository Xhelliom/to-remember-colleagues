import { describe, expect, it } from "vitest";
import { buildBarkGeometry } from "./tubeMesh.ts";
import type { SkeletonNode, TreeSkeleton } from "./skeleton.ts";

// Tronc vertical minimal (axe = Y) : un tronçon + un capuchon de bout.
function verticalTrunk(): TreeSkeleton {
  const nodes: SkeletonNode[] = [
    { position: { x: 0, y: 0, z: 0 }, radius: 0.5, parent: -1, depth: 0 },
    { position: { x: 0, y: 2, z: 0 }, radius: 0.3, parent: 0, depth: 0 },
  ];
  return { nodes, anchors: [] };
}

type V3 = { x: number; y: number; z: number };
const sub = (a: V3, b: V3): V3 => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
const cross = (a: V3, b: V3): V3 => ({
  x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x,
});
const dot = (a: V3, b: V3): number => a.x * b.x + a.y * b.y + a.z * b.z;
const len = (a: V3): number => Math.hypot(a.x, a.y, a.z);

/** Régression : sur un tronc vertical, la face AVANT (winding) de chaque triangle
 *  de paroi doit regarder DEHORS (normale géométrique · direction radiale > 0).
 *  Winding inversé → tronc « transparent » (faces extérieures culled). */
describe("buildBarkGeometry — winding sortant (anti-tronc transparent)", () => {
  it("les triangles de paroi ont leur face avant tournée vers l'extérieur", () => {
    const { geometry } = buildBarkGeometry(verticalTrunk(), 0);
    const pos = geometry.getAttribute("position").array as ArrayLike<number>;
    let wallTris = 0;
    for (let t = 0; t < pos.length; t += 9) {
      const a = { x: pos[t], y: pos[t + 1], z: pos[t + 2] };
      const b = { x: pos[t + 3], y: pos[t + 4], z: pos[t + 5] };
      const c = { x: pos[t + 6], y: pos[t + 7], z: pos[t + 8] };
      const geoNormal = cross(sub(b, a), sub(c, a)); // right-hand → normale de la face avant
      const centroid = { x: (a.x + b.x + c.x) / 3, y: (a.y + b.y + c.y) / 3, z: (a.z + b.z + c.z) / 3 };
      const radial = { x: centroid.x, y: 0, z: centroid.z }; // axe = Y
      if (len(radial) < 0.15) continue; // ignore les triangles quasi sur l'axe (apex du capuchon)
      wallTris++;
      expect(dot(geoNormal, radial)).toBeGreaterThan(0);
    }
    expect(wallTris).toBeGreaterThan(0);
  });
});
