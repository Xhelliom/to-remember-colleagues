import { describe, expect, it } from "vitest";
import { CHUNK_LOAD_RADIUS, CHUNK_UNLOAD_RADIUS, chunksToLoad, chunksToUnload } from "./chunkStreaming.ts";
import type { WorldSlot } from "./worldLayout.ts";
import type { ChunkRange } from "./procedural.ts";

// Slot simple (entrée à l'origine, non tourné) pour des assertions géométriques
// directes : coordonnées locales == coordonnées monde.
const slot: WorldSlot = {
  id: "x",
  entrance: { x: 0, z: 0 },
  rotY: 0,
  plotCenter: { x: 0, z: 100 },
  plotWidth: 20,
  plotDepth: 200,
};
const chunkRanges: ChunkRange[] = [
  { start: 0, end: 60 },
  { start: 60, end: 140 },
  { start: 140, end: 200 },
];
const NONE = new Set<number>();

describe("chunksToLoad / chunksToUnload (streaming intra-cimetière, phase 5)", () => {
  it("hors CHUNK_LOAD_RADIUS de l'emprise → aucun chunk", () => {
    expect(chunksToLoad({ x: 100, z: -50 }, slot, chunkRanges, NONE)).toEqual([]);
  });

  it("dans CHUNK_LOAD_RADIUS mais hors emprise → seulement le chunk d'entrée (0)", () => {
    // À 15m avant l'entrée (z = -15), en dehors du rectangle [0, plotDepth].
    expect(chunksToLoad({ x: 0, z: -15 }, slot, chunkRanges, NONE)).toEqual([0]);
  });

  it("dans l'emprise, un chunk charge à sa propre portée, sans les autres", () => {
    // z = 100 : dans le chunk 1 [60,140), à 40m du chunk 2 [140,200) (hors portée).
    const loaded = chunksToLoad({ x: 0, z: 100 }, slot, chunkRanges, NONE);
    expect(loaded).toContain(0); // toujours proposé une fois dans l'emprise
    expect(loaded).toContain(1); // à sa propre portée
    expect(loaded).not.toContain(2); // hors de sa propre portée
  });

  it("ne propose pas un chunk déjà chargé", () => {
    const loaded = chunksToLoad({ x: 0, z: 100 }, slot, chunkRanges, new Set([0, 1]));
    expect(loaded).toEqual([]);
  });

  it("décharge un chunk quitté au-delà de CHUNK_UNLOAD_RADIUS (hystérèse)", () => {
    // Chunk 1 [60,140) chargé, caméra à z = 190 → distance au chunk = 50 > 40.
    expect(chunksToUnload({ x: 0, z: 190 }, slot, chunkRanges, new Set([1]))).toEqual([1]);
  });

  it("n'oscille jamais entre CHUNK_LOAD_RADIUS et CHUNK_UNLOAD_RADIUS (aller-retour à la frontière)", () => {
    expect(CHUNK_UNLOAD_RADIUS).toBeGreaterThan(CHUNK_LOAD_RADIUS);
    // Positions juste après la fin du chunk 1 (z=140), oscillant entre 5m et 30m
    // au-delà — toujours < CHUNK_UNLOAD_RADIUS (40) : jamais déchargé.
    const positions = [145, 160, 150, 170, 155, 165];
    for (const z of positions) {
      expect(chunksToUnload({ x: 0, z }, slot, chunkRanges, new Set([1]))).toEqual([]);
    }
  });

  it("recharger un chunk précédemment déchargé donne un résultat identique (déterminisme)", () => {
    const cam = { x: 0, z: 100 };
    const first = chunksToLoad(cam, slot, chunkRanges, NONE);
    const second = chunksToLoad(cam, slot, chunkRanges, NONE);
    expect(first).toEqual(second);
  });
});
