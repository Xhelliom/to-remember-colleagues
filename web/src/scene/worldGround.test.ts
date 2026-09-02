import { describe, expect, it } from "vitest";
import { buildWorldGroundGeometry, worldGroundHeightAt } from "./worldGround.ts";
import type { Vec2, WorldSlot } from "../worldLayout.ts";

const NO_ROAD: Vec2[] = [];
const NO_SLOTS: WorldSlot[] = [];
const slot = (x: number, z: number): WorldSlot => ({
  entrance: { x, z }, rotY: 0, id: "s", plotCenter: { x, z: z + 10 }, plotWidth: 10, plotDepth: 20,
});

describe("worldGroundHeightAt — relief du sol extérieur (2.3)", () => {
  it("est déterministe : même point → même hauteur", () => {
    expect(worldGroundHeightAt(50, -50, NO_ROAD, NO_SLOTS)).toBe(worldGroundHeightAt(50, -50, NO_ROAD, NO_SLOTS));
  });

  it("passe juste sous le terrain intérieur près d'une parcelle, sans creuser un fossé", () => {
    const slots = [slot(20, -20)];
    const h = worldGroundHeightAt(20, -20, NO_ROAD, slots);
    // Sous zéro : la frange non découpée ne peut pas être coplanaire avec le
    // terrain intérieur. Mais franchissable — la caméra suit ce sol désormais.
    expect(h).toBeLessThan(0);
    expect(h).toBeGreaterThan(-1);
  });

  it("est exactement plate (0) tout près de la route (loin de toute parcelle)", () => {
    const road: Vec2[] = [{ x: 0, z: 0 }, { x: 0, z: -100 }];
    expect(worldGroundHeightAt(0, -50, road, NO_SLOTS)).toBe(0);
  });

  it("retrouve du relief loin des parcelles et de la route", () => {
    const slots = [slot(20, -20)];
    const road: Vec2[] = [{ x: 0, z: 0 }, { x: 0, z: -100 }];
    // Loin de tout (route en x=0, parcelle en (20,-20)) : la hauteur ne doit
    // plus être bridée à 0 par le fondu (peut ponctuellement valoir ~0 par le
    // bruit lui-même, donc on teste sur plusieurs points qu'au moins un s'écarte).
    const far = [
      worldGroundHeightAt(80, -80, road, slots),
      worldGroundHeightAt(-80, -80, road, slots),
      worldGroundHeightAt(80, -20, road, slots),
      worldGroundHeightAt(-80, -150, road, slots),
    ];
    expect(far.some((h) => Math.abs(h) > 1e-6)).toBe(true);
  });

  it("loin de toute parcelle, le relief reste dans l'amplitude brute de terrainHeightAt (pas d'enfoncement parasite)", () => {
    const slots = [slot(20, -20)];
    const road: Vec2[] = [{ x: 0, z: 0 }, { x: 0, z: -100 }];
    for (const [x, z] of [[80, -80], [-80, -80], [80, -20], [-80, -150], [0, -50]]) {
      expect(Math.abs(worldGroundHeightAt(x, z, road, slots))).toBeLessThanOrEqual(2);
    }
  });
});

describe("buildWorldGroundGeometry — découpe sous les parcelles", () => {
  const bounds = { minX: -40, maxX: 40, minZ: -60, maxZ: 20 };
  /** Centroïdes XZ monde de tous les triangles de la géométrie. */
  function centroids(slots: WorldSlot[]) {
    const geo = buildWorldGroundGeometry(bounds, NO_ROAD, slots);
    const index = geo.getIndex()!;
    const pos = geo.getAttribute("position");
    const cx = (bounds.minX + bounds.maxX) / 2;
    const cz = (bounds.minZ + bounds.maxZ) / 2;
    const out: Vec2[] = [];
    for (let t = 0; t < index.count; t += 3) {
      let sx = 0;
      let sy = 0;
      for (let k = 0; k < 3; k++) {
        const v = index.getX(t + k);
        sx += pos.getX(v);
        sy += pos.getY(v);
      }
      out.push({ x: cx + sx / 3, z: cz - sy / 3 });
    }
    return out;
  }

  it("ne maille plus l'intérieur d'une parcelle : c'est le terrain du cimetière qui l'occupe", () => {
    // Parcelle de 10 de large sur 20 de long, entrée en (0, -10), orientée +Z.
    const inside = centroids([slot(0, -10)]).filter((p) => Math.abs(p.x) < 3 && p.z > -6 && p.z < 6);
    expect(inside).toHaveLength(0);
  });

  it("laisse le reste du monde intact (la découpe ne mange pas tout)", () => {
    expect(centroids([slot(0, -10)]).length).toBeGreaterThan(0);
    expect(centroids([slot(0, -10)]).length).toBeLessThan(centroids([]).length);
  });

  it("sans parcelle, aucun triangle n'est retiré", () => {
    const geo = buildWorldGroundGeometry(bounds, NO_ROAD, []);
    const plain = buildWorldGroundGeometry(bounds, NO_ROAD, NO_SLOTS);
    expect(geo.getIndex()!.count).toBe(plain.getIndex()!.count);
  });
});
