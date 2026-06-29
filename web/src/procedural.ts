// Génération procédurale et DÉTERMINISTE du plan d'un cimetière (issue #5).
// La graine dérive de l'id de l'organisation : un même cimetière a toujours le
// même agencement, et sa taille/densité est proportionnelle au nombre de tombes.
import { seededRandom } from "./graves.ts";

/** Hash 32 bits (FNV-1a) d'une chaîne → graine entière. */
export function hashSeed(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export type Placement = { x: number; z: number; rotY: number };
export type CemeteryLayout = {
  /** Demi-côté de la parcelle (mur d'enceinte / limites de déplacement). */
  plotHalf: number;
  /** Une position + orientation de base par tombe, dans l'ordre des collègues. */
  placements: Placement[];
  /** Motif retenu, pour information/débogage. */
  pattern: "grid" | "rows" | "rings";
};

const PATTERNS = ["grid", "rows", "rings"] as const;

/**
 * Calcule l'agencement d'un cimetière de `count` tombes, déterministe pour un
 * `companyId` donné. La parcelle grandit avec le nombre de tombes.
 */
export function cemeteryLayout(companyId: string, count: number): CemeteryLayout {
  const rand = seededRandom(hashSeed(companyId));
  const pattern = PATTERNS[Math.floor(rand() * PATTERNS.length)];
  // Densité (espacement) légèrement variable selon l'organisation.
  const spacing = 3.0 + rand() * 1.4;

  // Rayon de plantation ∝ √count (surface ∝ count) → taille proportionnelle.
  const reach = Math.sqrt(Math.max(count, 1)) * spacing;
  const plotHalf = Math.max(16, reach * 0.75 + 6);

  const placements: Placement[] = [];
  if (count === 0) return { plotHalf, placements, pattern };

  if (pattern === "rings") {
    // Anneaux concentriques ; les tombes regardent vers le centre.
    let placed = 0;
    let ring = 1;
    while (placed < count) {
      const r = ring * spacing * 1.2;
      const onRing = Math.max(4, Math.floor((2 * Math.PI * r) / spacing));
      const offset = rand() * Math.PI * 2;
      for (let k = 0; k < onRing && placed < count; k++, placed++) {
        const a = offset + (k / onRing) * Math.PI * 2;
        const x = Math.cos(a) * r;
        const z = Math.sin(a) * r;
        placements.push({ x, z, rotY: Math.atan2(-x, -z) });
      }
      ring++;
    }
  } else {
    // Grille / rangées : `rows` décale une allée centrale en Z.
    const perRow = Math.max(4, Math.ceil(Math.sqrt(count)));
    const rows = Math.ceil(count / perRow);
    const startX = -((perRow - 1) * spacing) / 2;
    const startZ = -((rows - 1) * spacing) / 2 - 2;
    const aisle = pattern === "rows" ? spacing * 0.9 : 0; // écart de l'allée centrale
    for (let i = 0; i < count; i++) {
      const row = Math.floor(i / perRow);
      const col = i % perRow;
      const side = col < perRow / 2 ? -1 : 1;
      const x = startX + col * spacing + side * aisle + (rand() - 0.5) * 0.4;
      const z = startZ + row * spacing + (rand() - 0.5) * 0.4;
      placements.push({ x, z, rotY: 0 });
    }
  }

  return { plotHalf, placements, pattern };
}
