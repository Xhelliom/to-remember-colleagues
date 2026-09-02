import { describe, expect, it } from "vitest";
import { buildHedgeGeometry, HEDGE_HEIGHT } from "./hedge.ts";
import { WALL_HEIGHT } from "./fence.ts";

/** Bornes verticales des sommets d'une géométrie. */
function yRange(geo: { getAttribute(name: string): { array: ArrayLike<number>; count: number } }) {
  const pos = geo.getAttribute("position");
  let min = Infinity;
  let max = -Infinity;
  for (let i = 0; i < pos.count; i++) {
    const y = pos.array[i * 3 + 1];
    min = Math.min(min, y);
    max = Math.max(max, y);
  }
  return { min, max };
}

describe("buildHedgeGeometry — haie d'enceinte", () => {
  it("dépasse le mur : c'est la verdure qui ferme l'horizon, pas la pierre", () => {
    const { max } = yRange(buildHedgeGeometry(8, 42));
    expect(max).toBeGreaterThan(WALL_HEIGHT);
  });

  it("garde le pied sous le sol, pour ne pas laisser de jour sur terrain vallonné", () => {
    expect(yRange(buildHedgeGeometry(8, 42)).min).toBeLessThan(0);
  });

  it("reste dans son gabarit malgré le bruit (pas de bosse qui perce le ciel)", () => {
    for (const seed of [1, 7, 99, 12345]) {
      expect(yRange(buildHedgeGeometry(6, seed)).max).toBeLessThan(HEDGE_HEIGHT * 1.3);
    }
  });

  it("est déterministe : même graine et même longueur → mêmes sommets", () => {
    const a = buildHedgeGeometry(7, 2024).getAttribute("position").array;
    const b = buildHedgeGeometry(7, 2024).getAttribute("position").array;
    expect(Array.from(a)).toEqual(Array.from(b));
  });

  it("varie avec la graine : deux tronçons voisins ne sont pas le même bloc", () => {
    const a = buildHedgeGeometry(7, 1).getAttribute("position").array;
    const b = buildHedgeGeometry(7, 2).getAttribute("position").array;
    expect(Array.from(a)).not.toEqual(Array.from(b));
  });

  it("densifie ses stations avec la longueur (pas d'étirement d'un gabarit fixe)", () => {
    const court = buildHedgeGeometry(4, 3).getAttribute("position").count;
    const long = buildHedgeGeometry(16, 3).getAttribute("position").count;
    expect(long).toBeGreaterThan(court);
  });
});
