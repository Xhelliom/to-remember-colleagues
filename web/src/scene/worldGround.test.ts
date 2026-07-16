import { describe, expect, it } from "vitest";
import { worldGroundHeightAt } from "./worldGround.ts";
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

  it("est exactement plate (0) tout près d'une entrée de parcelle", () => {
    const slots = [slot(20, -20)];
    expect(worldGroundHeightAt(20, -20, NO_ROAD, slots)).toBe(0);
  });

  it("est exactement plate (0) tout près de la route", () => {
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

  it("reste dans l'amplitude brute de terrainHeightAt (le fondu ne peut jamais amplifier)", () => {
    const slots = [slot(20, -20)];
    const road: Vec2[] = [{ x: 0, z: 0 }, { x: 0, z: -100 }];
    for (const [x, z] of [[80, -80], [-80, -80], [80, -20], [-80, -150], [0, -50], [20, -20]]) {
      expect(Math.abs(worldGroundHeightAt(x, z, road, slots))).toBeLessThanOrEqual(2);
    }
  });
});
