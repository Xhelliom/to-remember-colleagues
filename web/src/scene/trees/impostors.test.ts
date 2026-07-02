import { describe, expect, it } from "vitest";
import {
  directionToTile,
  hemiOctDecode,
  hemiOctEncode,
  IMPOSTOR_GRID,
  nearestViewsBlend,
  tileCenterDirection,
  tileForUv,
  tileIndex,
} from "./impostors.ts";

const WEIGHT_SUM_TOLERANCE = 1e-9;

// --- Mapping direction → tuile : directions cardinales ---------------------

describe("directionToTile — directions cardinales", () => {
  it("zénith (0,1,0) → tuile centrale de la grille", () => {
    const tile = directionToTile(0, 1, 0);
    const center = (IMPOSTOR_GRID - 1) / 2;
    expect(Math.abs(tile.col - center)).toBeLessThanOrEqual(1);
    expect(Math.abs(tile.row - center)).toBeLessThanOrEqual(1);
  });

  it("+X horizontal → dernière colonne (bord droit de la grille)", () => {
    expect(directionToTile(1, 0, 0).col).toBe(IMPOSTOR_GRID - 1);
  });

  it("-X horizontal → première colonne (bord gauche)", () => {
    expect(directionToTile(-1, 0, 0).col).toBe(0);
  });

  it("+Z horizontal → dernière ligne", () => {
    expect(directionToTile(0, 0, 1).row).toBe(IMPOSTOR_GRID - 1);
  });

  it("-Z horizontal → première ligne", () => {
    expect(directionToTile(0, 0, -1).row).toBe(0);
  });

  it("direction sous l'horizon (dy < 0) reste dans la grille (saturée au zénith)", () => {
    const tile = directionToTile(0, -1, 0);
    expect(tile.col).toBeGreaterThanOrEqual(0);
    expect(tile.col).toBeLessThan(IMPOSTOR_GRID);
    expect(tile.row).toBeGreaterThanOrEqual(0);
    expect(tile.row).toBeLessThan(IMPOSTOR_GRID);
  });

  it("directions horizontales opposées → tuiles distinctes", () => {
    const east = tileIndex(directionToTile(1, 0, 0));
    const west = tileIndex(directionToTile(-1, 0, 0));
    expect(east).not.toBe(west);
  });
});

// --- tileForUv : bornes de la grille -----------------------------------

describe("tileForUv", () => {
  it("sature aux tuiles limites pour u/v hors de [-1,1]", () => {
    expect(tileForUv(-5, -5)).toEqual({ col: 0, row: 0 });
    expect(tileForUv(5, 5)).toEqual({ col: IMPOSTOR_GRID - 1, row: IMPOSTOR_GRID - 1 });
  });
});

// --- Poids du blend des 3 vues : somment à 1 --------------------------------

describe("nearestViewsBlend — poids somment à 1", () => {
  const directions: readonly [number, number, number][] = [
    [0, 1, 0],
    [1, 0.2, 0.3],
    [-1, 0.5, -0.4],
    [0.3, 0.1, 1],
    [0.3, 0.1, -1],
    [0.7, 0.7, 0.1],
    [-0.6, 0.9, 0.6],
    [1, 1, 1],
    [0, 0, 0.001],
  ];

  it.each(directions)("direction (%d, %d, %d)", (x, y, z) => {
    const { weights } = nearestViewsBlend(x, y, z);
    const sum = weights[0] + weights[1] + weights[2];
    expect(Math.abs(sum - 1)).toBeLessThan(WEIGHT_SUM_TOLERANCE);
    for (const w of weights) {
      expect(w).toBeGreaterThanOrEqual(-WEIGHT_SUM_TOLERANCE);
      expect(w).toBeLessThanOrEqual(1 + WEIGHT_SUM_TOLERANCE);
    }
  });

  it("les 3 tuiles retournées sont distinctes (triangle non dégénéré)", () => {
    const { tiles } = nearestViewsBlend(0.6, 0.4, 0.2);
    expect(new Set(tiles).size).toBe(3);
  });
});

// --- Round-trip encode/decode et tuile ↔ direction --------------------------

describe("hemiOctEncode / hemiOctDecode — round-trip", () => {
  it("décode(encode(d)) revient à d pour une direction dans le losange valide", () => {
    const d = hemiOctDecode(0.3, -0.4);
    const back = hemiOctEncode(d.x, d.y, d.z);
    expect(back.u).toBeCloseTo(0.3, 6);
    expect(back.v).toBeCloseTo(-0.4, 6);
  });

  it("toute direction décodée est bien dans l'hémisphère supérieur (y ≥ 0)", () => {
    for (const [u, v] of [[0, 0], [1, 1], [-1, 1], [1, -1], [-1, -1], [0.5, 0.9]] as const) {
      const d = hemiOctDecode(u, v);
      expect(d.y).toBeGreaterThanOrEqual(0);
      // Direction normalisée (utilisée telle quelle par la capture caméra).
      expect(Math.hypot(d.x, d.y, d.z)).toBeCloseTo(1, 6);
    }
  });
});

describe("tileCenterDirection ↔ directionToTile — round-trip par tuile", () => {
  it("les tuiles dans le losange valide (|u|+|v|≤1, sans repli) redonnent la même tuile", () => {
    // Le losange occupe la moitié de la grille carrée : au-delà (coins), `hemiOctDecode`
    // replie vers une direction proche du zénith (cf. son en-tête) — round-trip non garanti
    // là, par construction (plusieurs tuiles hors-losange se replient vers la même zone).
    for (let row = 0; row < IMPOSTOR_GRID; row++) {
      for (let col = 0; col < IMPOSTOR_GRID; col++) {
        const u = ((col + 0.5) / IMPOSTOR_GRID) * 2 - 1;
        const v = ((row + 0.5) / IMPOSTOR_GRID) * 2 - 1;
        if (Math.abs(u) + Math.abs(v) > 1) continue;
        const dir = tileCenterDirection({ col, row });
        expect(directionToTile(dir.x, dir.y, dir.z)).toEqual({ col, row });
      }
    }
  });
});

// --- Sélection de bande par distance : voir treeLod.test.ts (mission 10) ---
