import { describe, expect, it } from "vitest";
import { lanternPlacements } from "./roadLanterns.ts";
import type { Vec2 } from "../worldLayout.ts";

/** Ligne droite le long de Z — distance curviligne = simple différence de z. */
function straightLine(length: number, step = 1): Vec2[] {
  const pts: Vec2[] = [];
  for (let z = 0; z >= -length; z -= step) pts.push({ x: 0, z });
  return pts;
}

describe("lanternPlacements — dispersion le long de la route (2.2)", () => {
  it("est déterministe : mêmes points → mêmes placements", () => {
    const pts = straightLine(80);
    expect(lanternPlacements(pts)).toEqual(lanternPlacements(pts));
  });

  it("aucun placement sur moins de 2 points", () => {
    expect(lanternPlacements([])).toEqual([]);
    expect(lanternPlacements([{ x: 0, z: 0 }])).toEqual([]);
  });

  it("alterne le côté (side) à chaque placement", () => {
    const placements = lanternPlacements(straightLine(120));
    expect(placements.length).toBeGreaterThan(2);
    for (let i = 1; i < placements.length; i++) {
      expect(placements[i].side).toBe(placements[i - 1].side * -1);
    }
  });

  it("espace les placements d'au moins LANTERN_SPACING_M (16 m) en distance curviligne", () => {
    const placements = lanternPlacements(straightLine(100));
    for (let i = 1; i < placements.length; i++) {
      const d = Math.hypot(placements[i].x - placements[i - 1].x, placements[i].z - placements[i - 1].z);
      expect(d).toBeGreaterThanOrEqual(16 - 1e-9);
    }
  });

  it("pose une lanterne dès le début du tracé (pas d'attente avant la première)", () => {
    const placements = lanternPlacements(straightLine(20));
    expect(placements.length).toBeGreaterThanOrEqual(1);
    expect(Math.abs(placements[0].z)).toBeLessThan(2);
  });

  it("décale la lanterne hors de la chaussée (ROAD_HALF)", () => {
    const placements = lanternPlacements(straightLine(20));
    for (const p of placements) expect(Math.abs(p.x)).toBeGreaterThan(3); // > ROAD_HALF (3)
  });
});
