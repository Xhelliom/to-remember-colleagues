import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { terrainHeightAt, TerrainChunk } from "./terrain.ts";
import type { Frame } from "../worldLayout.ts";

const SEED = 12345;
const mat = new THREE.MeshStandardMaterial();
const FRAME: Frame = { entrance: { x: 0, z: 0 }, rotY: 0 };

describe("terrainHeightAt (relief invariant à la taille, phase 0)", () => {
  it("est déterministe : même (seed, x, z) → même hauteur", () => {
    expect(terrainHeightAt(SEED, 5.3, -12.1)).toBe(terrainHeightAt(SEED, 5.3, -12.1));
  });

  it("ne dépend pas de la taille du cimetière ni du découpage en chunks (invariance)", () => {
    // Deux cimetières de tailles très différentes, même graine : loin de tout
    // bord réel (fondu à 1 dans les deux cas), la hauteur doit être identique
    // — avant la phase 0, la fréquence d'échantillonnage dépendait de la
    // taille de la parcelle et ce test aurait échoué.
    const small = new TerrainChunk("org-x", FRAME, 30, 60, 0, 60, mat);
    const big = new TerrainChunk("org-x", FRAME, 30, 200, 10, 50, mat);
    expect(small.getHeightAt(2, 30)).toBe(big.getHeightAt(2, 30));
  });

  it("est continue à la jointure entre deux tranches contiguës (pas de saut)", () => {
    const a = terrainHeightAt(SEED, 10, 10);
    const b = terrainHeightAt(SEED, 10, 10.01);
    expect(Math.abs(a - b)).toBeLessThan(0.05);
  });
});

describe("TerrainChunk.getHeightAt (phase 3 : tranche [zStart, zEnd[)", () => {
  it("renvoie un sol plat hors de sa propre tranche", () => {
    const chunk = new TerrainChunk("org-y", FRAME, 30, 120, 40, 80, mat);
    expect(chunk.getHeightAt(2, 20)).toBe(0); // avant zStart
    expect(chunk.getHeightAt(2, 100)).toBe(0); // après zEnd
    expect(chunk.getHeightAt(20, 60)).toBe(0); // hors largeur
  });

  it("aucune couture aux jointures internes : le fondu ne s'applique qu'aux vrais bords", () => {
    // zEnd de la première tranche == zStart de la seconde : la hauteur doit
    // se raccorder sans saut (le fondu de bordure ne s'applique pas ici).
    const first = new TerrainChunk("org-z", FRAME, 30, 120, 0, 60, mat);
    const second = new TerrainChunk("org-z", FRAME, 30, 120, 60, 120, mat);
    const a = first.getHeightAt(0, 59.999);
    const b = second.getHeightAt(0, 60.001);
    expect(Math.abs(a - b)).toBeLessThan(0.01);
  });
});
