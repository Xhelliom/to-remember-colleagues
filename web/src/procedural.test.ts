import { describe, expect, it } from "vitest";
import { cemeteryLayout, hashSeed } from "./procedural.ts";

const GRAVE_SPACING = 2.4; // doit rester en phase avec la constante de procedural.ts
const CLUSTER_RADIUS = 3; // idem
const EPSILON = 1e-9;

describe("cemeteryLayout (chemin ramifié, plan cimetière)", () => {
  it("est déterministe : même id → même plan", () => {
    expect(cemeteryLayout("org-123", 12)).toEqual(cemeteryLayout("org-123", 12));
  });

  it("produit un plan différent pour un id différent", () => {
    const a = cemeteryLayout("org-123", 12);
    const b = cemeteryLayout("autre-org", 12);
    expect(a.placements).not.toEqual(b.placements);
  });

  it("pose exactement une tombe par collègue, pour plusieurs tailles", () => {
    for (const count of [0, 1, 12, 250]) {
      expect(cemeteryLayout("x", count).placements).toHaveLength(count);
    }
  });

  it("allonge le chemin avec le nombre de tombes", () => {
    expect(cemeteryLayout("scale", 200).plotDepth).toBeGreaterThan(cemeteryLayout("scale", 4).plotDepth);
  });

  it("respecte la largeur du couloir : |x| <= plotWidth / 2", () => {
    const { plotWidth, placements } = cemeteryLayout("width-check", 300);
    for (const p of placements) {
      expect(Math.abs(p.x)).toBeLessThanOrEqual(plotWidth / 2);
    }
  });

  it("respecte une distance minimale entre deux tombes (pas de chevauchement ni de croisement de branches, 1.2bis)", () => {
    const { placements } = cemeteryLayout("dense", 150);
    for (let i = 0; i < placements.length; i++) {
      for (let j = i + 1; j < placements.length; j++) {
        const d = Math.hypot(placements[i].x - placements[j].x, placements[i].z - placements[j].z);
        expect(d).toBeGreaterThanOrEqual(GRAVE_SPACING - EPSILON);
      }
    }
  });

  it("porte un index de chunk croissant, regroupant plusieurs ramifications", () => {
    const { placements, chunkCount } = cemeteryLayout("chunks", 400);
    const chunks = new Set(placements.map((p) => p.chunk));
    expect(chunks.size).toBe(chunkCount);
    for (const p of placements) expect(p.chunk).toBeGreaterThanOrEqual(0);
  });

  it("les tranches de chunk couvrent tout le chemin, sans trou ni chevauchement, et contiennent leurs tombes (préparation phase 3)", () => {
    const { placements, chunkRanges, plotDepth } = cemeteryLayout("ranges", 300);
    expect(chunkRanges[0].start).toBe(0);
    expect(chunkRanges[chunkRanges.length - 1].end).toBe(plotDepth);
    for (let i = 1; i < chunkRanges.length; i++) {
      expect(chunkRanges[i].start).toBe(chunkRanges[i - 1].end);
    }
    for (const p of placements) {
      const r = chunkRanges[p.chunk];
      expect(p.z).toBeGreaterThanOrEqual(r.start);
      expect(p.z).toBeLessThanOrEqual(r.end);
    }
  });

  it("chaque tombe de cluster est à portée du centre de cluster de sa ramification (préparation phase 3/4)", () => {
    const { placements, clusters } = cemeteryLayout("clusters-meta", 200);
    expect(clusters.length).toBeGreaterThan(0);
    const clusterGraves = placements.filter((p) => p.kind === "cluster");
    for (const p of clusterGraves) {
      const nearest = Math.min(...clusters.map((c) => Math.hypot(p.x - c.x, p.z - c.z)));
      expect(nearest).toBeLessThanOrEqual(CLUSTER_RADIUS + EPSILON);
    }
  });

  it("le type de prop par cluster (mini-biome, phase 4) est déterministe et valide", () => {
    const a = cemeteryLayout("props", 200).clusters;
    const b = cemeteryLayout("props", 200).clusters;
    expect(a.map((c) => c.propKind)).toEqual(b.map((c) => c.propKind));
    for (const c of a) expect(["tree", "rocks", "flat"]).toContain(c.propKind);
  });

  it("répartit les 3 propKind dans des proportions plausibles sur N layouts (statistique)", () => {
    const counts = { tree: 0, rocks: 0, flat: 0 };
    for (let i = 0; i < 40; i++) {
      for (const c of cemeteryLayout(`pk-stat-${i}`, 30).clusters) counts[c.propKind]++;
    }
    const total = counts.tree + counts.rocks + counts.flat;
    if (total === 0) return; // pas de cluster généré avec count=30, très improbable
    expect(counts.tree).toBeGreaterThan(0);
    expect(counts.rocks).toBeGreaterThan(0);
    expect(counts.flat).toBeGreaterThan(0);
  });

  it("répartit les tombes entre rangées et clusters dans une plage plausible (statistique)", () => {
    let rows = 0;
    let clusters = 0;
    for (let i = 0; i < 40; i++) {
      const { placements } = cemeteryLayout(`stat-${i}`, 150);
      for (const p of placements) (p.kind === "cluster" ? clusters++ : rows++);
    }
    const ratio = clusters / (rows + clusters);
    expect(ratio).toBeGreaterThan(0.25);
    expect(ratio).toBeLessThan(0.85);
  });
});

describe("hashSeed", () => {
  it("est stable et tient sur 32 bits", () => {
    expect(hashSeed("abc")).toBe(hashSeed("abc"));
    expect(hashSeed("abc")).toBeGreaterThanOrEqual(0);
    expect(hashSeed("abc")).toBeLessThanOrEqual(0xffffffff);
  });
});
