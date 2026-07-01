import { describe, expect, it } from "vitest";
import { chunkReach } from "./fence.ts";
import type { Placement } from "../procedural.ts";

const P = (x: number, chunk: number): Placement => ({ x, z: 0, rotY: 0, chunk, kind: "row" });

describe("chunkReach (demi-largeur de clôture d'un chunk)", () => {
  it("renvoie le fallback si le chunk n'a aucune tombe (chunk d'entrée vide)", () => {
    expect(chunkReach([], 0, 7)).toBe(7);
    expect(chunkReach([P(3, 1)], 0, 7)).toBe(7); // tombe présente mais dans un autre chunk
  });

  it("englobe la tombe la plus latérale du chunk plus la marge de mur", () => {
    // maxAbsX = 5 (|-5| l'emporte sur 3) → 5 + WALL_MARGIN(2) = 7, quel que soit le côté.
    expect(chunkReach([P(3, 0), P(-5, 0)], 0, 1)).toBe(7);
  });
});
