// Haie taillée courant le long du mur d'enceinte, côté intérieur, et le
// dépassant : depuis l'allée on voit un bandeau de verdure au-dessus de la
// pierre, pas une ligne d'horizon nue.
//
// Géométrie : demi-tube couché sur le sol (profil en arche) dont le rayon est
// perturbé par le bruit partagé de `noiseBake.ts` — la même source que la
// pierre de `stone.ts`, donc déterministe et sans texture. Facettes non
// lissées : parti pris low-poly assumé, cohérent avec le feuillage « cloud ».
import * as THREE from "three";
import { DEFAULT_RESOLUTION, evalNoiseAt } from "./noiseBake.ts";

/** Hauteur du sommet de la haie au repos (m) — au-delà du mur, cf. fence.ts. */
export const HEDGE_HEIGHT = 3.1;
const HEDGE_HALF_WIDTH = 0.55;
/** Stations le long de la haie, par mètre : sous 1, les bosses du bruit sont coupées. */
const STATIONS_PER_M = 1.2;
/** Arcs du profil : 5 suffit à lire une arche, au-delà on paie sans rien gagner. */
const PROFILE_STEPS = 5;
/** Amplitude du bruit sur le rayon, en fraction — au-delà de ~0.2 la haie se troue. */
const NOISE_AMPLITUDE = 0.16;
const NOISE_TILE_ALONG = 6; // périodes de bruit sur toute la longueur d'un segment
const HEDGE_HUE = 0.28;     // vert franc
const HEDGE_SATURATION = 0.34;
const HEDGE_LIGHTNESS_MIN = 0.13; // dans les creux, au pied
const HEDGE_LIGHTNESS_RANGE = 0.17;
/** Enfoncement du pied sous le sol (m) : masque les jours quand le terrain ondule. */
const HEDGE_FOOT_SINK = 0.25;

/**
 * Géométrie d'un tronçon de haie de longueur `length`, orientée le long de +Z
 * et centrée en X — mêmes conventions que `buildWallSegment` (fence.ts), pour
 * pouvoir la poser avec la même transformée.
 */
export function buildHedgeGeometry(length: number, seed: number): THREE.BufferGeometry {
  const stations = Math.max(2, Math.round(length * STATIONS_PER_M));
  const positions: number[] = [];
  const colors: number[] = [];
  const color = new THREE.Color();

  // Grille (station × profil) des sommets, puis triangulation par quads.
  const grid: THREE.Vector3[][] = [];
  const shades: number[][] = [];
  for (let s = 0; s <= stations; s++) {
    const t = s / stations;
    const row: THREE.Vector3[] = [];
    const shadeRow: number[] = [];
    for (let a = 0; a <= PROFILE_STEPS; a++) {
      const angle = (a / PROFILE_STEPS) * Math.PI;
      const n = evalNoiseAt(seed, (t * NOISE_TILE_ALONG) % 1, a / PROFILE_STEPS, DEFAULT_RESOLUTION);
      const swell = 1 + (n.fbm - 0.5) * 2 * NOISE_AMPLITUDE;
      // sin(angle) = 0 aux deux pieds : ils restent plaqués au sol et enfoncés.
      const rise = Math.sin(angle);
      row.push(new THREE.Vector3(
        Math.cos(angle) * HEDGE_HALF_WIDTH * swell,
        rise * HEDGE_HEIGHT * swell - (1 - rise) * HEDGE_FOOT_SINK,
        (t - 0.5) * length,
      ));
      shadeRow.push(n.value);
    }
    grid.push(row);
    shades.push(shadeRow);
  }

  const push = (s: number, a: number) => {
    const p = grid[s][a];
    positions.push(p.x, p.y, p.z);
    // Plus clair vers le sommet (lumière du ciel), plus sombre au pied.
    const height = Math.max(0, p.y) / HEDGE_HEIGHT;
    color.setHSL(HEDGE_HUE, HEDGE_SATURATION, HEDGE_LIGHTNESS_MIN + (height * 0.7 + shades[s][a] * 0.3) * HEDGE_LIGHTNESS_RANGE);
    colors.push(color.r, color.g, color.b);
  };

  for (let s = 0; s < stations; s++) {
    for (let a = 0; a < PROFILE_STEPS; a++) {
      push(s, a); push(s + 1, a); push(s + 1, a + 1);
      push(s, a); push(s + 1, a + 1); push(s, a + 1);
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
  geo.computeVertexNormals(); // sommets dupliqués par triangle → facettes franches
  return geo;
}

/** Matériau partagé d'une haie (couleur portée par les sommets). */
export function buildHedgeMaterial(): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, side: THREE.DoubleSide });
}
