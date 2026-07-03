import { describe, expect, it } from "vitest";
import {
  alphaCoverageRatio,
  ATLAS_GRID,
  dilateBackground,
  minLuminanceOfTransparentEdge,
  sqrtDecodeUnit,
  sqrtEncodeUnit,
} from "./atlasCapture.ts";
import { buildFoliageCardsGeometry, clusterFoliageAnchors, type CardCluster } from "./foliageCards.ts";
import { BEECH_SPECIES, growSkeleton, type LeafAnchor } from "./skeleton.ts";

const ROUND_TRIP_TOLERANCE = 1e-9;
const BYTE_ROUND_TRIP_TOLERANCE = 1 / 255; // quantization 8 bits

// --- Encodage sqrt : round-trip ---

describe("sqrtEncodeUnit / sqrtDecodeUnit — round-trip", () => {
  it("décode(encode(v)) ≈ v pour tout v ∈ [0,1] (précision flottante)", () => {
    for (const v of [0, 0.01, 0.02, 0.05, 0.1, 0.25, 0.5, 0.75, 1]) {
      expect(sqrtDecodeUnit(sqrtEncodeUnit(v))).toBeCloseTo(v, 9);
      expect(Math.abs(sqrtDecodeUnit(sqrtEncodeUnit(v)) - v)).toBeLessThan(ROUND_TRIP_TOLERANCE);
    }
  });

  it("round-trip via quantization 8 bits reste dans la tolérance (encodage réellement stocké)", () => {
    for (const v of [0.02, 0.08, 0.15, 0.4, 0.9]) {
      const byte = Math.round(sqrtEncodeUnit(v) * 255);
      const decoded = sqrtDecodeUnit(byte / 255);
      expect(Math.abs(decoded - v)).toBeLessThan(BYTE_ROUND_TRIP_TOLERANCE * 2);
    }
  });

  it("préserve plus de codes 8 bits distincts qu'un encodage linéaire dans les tons sombres", () => {
    // Sur [0, 0.1] linéaire ne distingue que ~25 codes (0.1*255) ; sqrt-encodé
    // en distingue davantage car sqrt(0.1) ≈ 0.316 → plage utilisée bien plus large.
    const linearCodes = new Set<number>();
    const sqrtCodes = new Set<number>();
    for (let i = 0; i <= 1000; i++) {
      const v = (i / 1000) * 0.1;
      linearCodes.add(Math.round(v * 255));
      sqrtCodes.add(Math.round(sqrtEncodeUnit(v) * 255));
    }
    expect(sqrtCodes.size).toBeGreaterThan(linearCodes.size);
  });
});

// --- Couverture alpha (atlas non vide) ---

function makeRgba(width: number, height: number, isOpaque: (x: number, y: number) => boolean): Uint8ClampedArray {
  const px = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      if (isOpaque(x, y)) { px[i] = 40; px[i + 1] = 120; px[i + 2] = 40; px[i + 3] = 255; }
    }
  }
  return px;
}

describe("alphaCoverageRatio", () => {
  it("buffer entièrement transparent → couverture 0", () => {
    expect(alphaCoverageRatio(makeRgba(4, 4, () => false))).toBe(0);
  });

  it("buffer entièrement opaque → couverture 1", () => {
    expect(alphaCoverageRatio(makeRgba(4, 4, () => true))).toBe(1);
  });

  it("bouquet de feuilles capté → couverture strictement entre 0 et 1 (silhouette, pas un carré plein)", () => {
    // Simule une tuile d'atlas : un disque opaque (silhouette de feuilles) sur fond transparent.
    const size = 16, center = size / 2, radius = size / 3;
    const px = makeRgba(size, size, (x, y) => Math.hypot(x - center, y - center) < radius);
    const ratio = alphaCoverageRatio(px);
    expect(ratio).toBeGreaterThan(0);
    expect(ratio).toBeLessThan(1);
  });
});

// --- Dilatation du fond (anti-halo) ---

describe("dilateBackground — anti-halo", () => {
  it("avant dilatation, le fond transparent adjacent à l'opaque est noir (luminance ≈ 0)", () => {
    const px = makeRgba(6, 6, (x, y) => x >= 2 && x < 4 && y >= 2 && y < 4);
    const minLum = minLuminanceOfTransparentEdge(px, 6, 6);
    expect(minLum).not.toBeNull();
    expect(minLum!).toBeLessThan(0.05);
  });

  it("après dilatation, aucun texel transparent adjacent à de l'opaque ne reste sombre", () => {
    const px = makeRgba(6, 6, (x, y) => x >= 2 && x < 4 && y >= 2 && y < 4);
    const dilated = dilateBackground(px, 6, 6);
    const minLum = minLuminanceOfTransparentEdge(dilated, 6, 6);
    expect(minLum).not.toBeNull();
    // Couleur propagée (~40,120,40 -> luminance ≈ 0.31), bien au-dessus du noir.
    expect(minLum!).toBeGreaterThan(0.15);
  });

  it("l'alpha reste inchangé (le fond dilaté reste transparent, seule sa couleur change)", () => {
    const px = makeRgba(6, 6, (x, y) => x >= 2 && x < 4 && y >= 2 && y < 4);
    const dilated = dilateBackground(px, 6, 6);
    for (let i = 3; i < px.length; i += 4) expect(dilated[i]).toBe(px[i]);
  });

  it("un buffer sans aucun texel opaque reste inchangé (rien à propager)", () => {
    const px = makeRgba(4, 4, () => false);
    const dilated = dilateBackground(px, 4, 4);
    expect(Array.from(dilated)).toEqual(Array.from(px));
  });
});

// --- Nb de cartes déterministe par (espèce, seed) ---

describe("clusterFoliageAnchors — déterminisme", () => {
  const syntheticAnchors: LeafAnchor[] = Array.from({ length: 40 }, (_, i) => ({
    position: { x: (i % 5) * 0.1, y: Math.floor(i / 5) * 0.1, z: 0 },
    normal: { x: 0, y: 0, z: 1 },
    up: { x: 0, y: 1, z: 0 },
    scale: 1,
  }));

  it("même (ancres, seed) → même nombre de cartes ET mêmes clusters", () => {
    const a = clusterFoliageAnchors(syntheticAnchors, 7);
    const b = clusterFoliageAnchors(syntheticAnchors, 7);
    expect(b.length).toBe(a.length);
    expect(b).toEqual(a);
  });

  it("nombre de clusters strictement inférieur au nombre d'ancres (regroupement effectif)", () => {
    const clusters = clusterFoliageAnchors(syntheticAnchors, 1);
    expect(clusters.length).toBeGreaterThan(0);
    expect(clusters.length).toBeLessThan(syntheticAnchors.length);
  });

  it("un arbre réel (espèce hêtre, mission 08) donne un nb de cartes déterministe pour une graine", () => {
    const { anchors } = growSkeleton(BEECH_SPECIES, 3);
    const countA = clusterFoliageAnchors(anchors, 3).length;
    const countB = clusterFoliageAnchors(anchors, 3).length;
    expect(countB).toBe(countA);
    expect(countA).toBeGreaterThan(0);
    expect(countA).toBeLessThan(anchors.length); // clustering réduit bien le nombre d'éléments
  });

  it("chaque cluster tire une tuile d'atlas valide (0..ATLAS_GRID²-1)", () => {
    const clusters = clusterFoliageAnchors(syntheticAnchors, 5);
    for (const c of clusters) {
      expect(c.tile).toBeGreaterThanOrEqual(0);
      expect(c.tile).toBeLessThan(ATLAS_GRID * ATLAS_GRID);
    }
  });
});

// --- Géométrie des cartes ---

describe("buildFoliageCardsGeometry", () => {
  it("chaque carte pousse exactement 4 triangles (2 quads croisés)", () => {
    const clusters: CardCluster[] = [
      { center: { x: 0, y: 1, z: 0 }, normal: { x: 0, y: 0, z: 1 }, radius: 0.2, memberCount: 5, tile: 0 },
      { center: { x: 1, y: 1, z: 0 }, normal: { x: 1, y: 0, z: 0 }, radius: 0.1, memberCount: 2, tile: 3 },
    ];
    const result = buildFoliageCardsGeometry(clusters);
    expect(result.cardCount).toBe(2);
    expect(result.triangleCount).toBe(2 * 4);
    expect(result.geometry.getAttribute("position").count).toBe(2 * 4 * 3);
    result.geometry.dispose();
  });

  it("géométrie vide pour zéro cluster (pas d'erreur)", () => {
    const result = buildFoliageCardsGeometry([]);
    expect(result.cardCount).toBe(0);
    expect(result.triangleCount).toBe(0);
    result.geometry.dispose();
  });
});
