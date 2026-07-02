// Canopy shell (mission 10) : forêt lointaine agrégée en surface bosselée,
// derrière les impostors — le PLUS lointain de la chaîne LOD (hero→cards→
// impostor→canopy), jamais individualisée en arbres. Statique (construite une
// fois, pas de mise à jour par frame) : un mur circulaire bas-poly dont la
// hauteur/le rayon/la teinte varient via `noiseBake.ts` (bruit CPU pur,
// déterministe — pas de nouvelle texture, pas de shader custom).
//
// Référence de concept : LAAS `world/CanopyShell.ts` — portée ici en simple
// géométrie vertex-colorée Three.js WebGLRenderer, aucun code copié.
import * as THREE from "three";
import { evalNoiseAt } from "../noiseBake.ts";

const CANOPY_SEGMENTS = 28; // pas de subdivision angulaire du mur (bas-poly, un seul draw call)
const CANOPY_NOISE_RESOLUTION = 64;
const CANOPY_RADIUS_JITTER = 3; // m — irrégularité du rayon (silhouette non parfaitement circulaire)
const CANOPY_ROUGHNESS = 1;
const CANOPY_COLOR_DARK = 0x1f3016;
const CANOPY_COLOR_LIGHT = 0x3f6b28;

/** Géométrie + matériau du mur bosselé — 2 triangles par segment angulaire. */
function buildCanopyShellGeometry(
  seed: number, centerX: number, centerZ: number, radius: number, baseHeight: number, heightVariance: number,
): THREE.BufferGeometry {
  const positions: number[] = [];
  const colors: number[] = [];
  const indices: number[] = [];
  const dark = new THREE.Color(CANOPY_COLOR_DARK);
  const light = new THREE.Color(CANOPY_COLOR_LIGHT);

  for (let i = 0; i <= CANOPY_SEGMENTS; i++) {
    const angle = (i / CANOPY_SEGMENTS) * Math.PI * 2;
    const sample = evalNoiseAt(seed, i / CANOPY_SEGMENTS, 0, CANOPY_NOISE_RESOLUTION);
    const r = radius + sample.worley * CANOPY_RADIUS_JITTER;
    const height = Math.max(0, baseHeight + sample.ridged * heightVariance);
    const x = centerX + Math.cos(angle) * r;
    const z = centerZ + Math.sin(angle) * r;
    const color = dark.clone().lerp(light, sample.ridged);
    positions.push(x, 0, z, x, height, z);
    colors.push(color.r, color.g, color.b, color.r, color.g, color.b);
    if (i > 0) {
      const a = (i - 1) * 2, b = a + 1, c = a + 2, d = a + 3;
      indices.push(a, b, c, b, d, c);
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

export type CanopyShellBuild = { readonly mesh: THREE.Mesh; dispose(): void };

/**
 * Mur circulaire bosselé, centré sur (centerX, centerZ), au rayon `radius` —
 * dresser ce rayon juste au-delà de la portée des impostors (cf. treeLod.ts)
 * pour qu'il apparaisse « derrière » eux (dither-in implicite : les impostors
 * couvrent le premier plan, le mur comble l'horizon sans jamais se toucher
 * ni scintiller — pas de logique de fondu nécessaire ici, contrairement aux
 * paliers de LOD des arbres individuels).
 */
export function buildCanopyShell(
  seed: number, centerX: number, centerZ: number, radius: number, baseHeight: number, heightVariance: number,
): CanopyShellBuild {
  const geometry = buildCanopyShellGeometry(seed, centerX, centerZ, radius, baseHeight, heightVariance);
  const material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: CANOPY_ROUGHNESS, side: THREE.DoubleSide });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.castShadow = false;
  mesh.receiveShadow = false;
  return {
    mesh,
    dispose() {
      geometry.dispose();
      material.dispose();
    },
  };
}
