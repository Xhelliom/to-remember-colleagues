// Génération procédurale et DÉTERMINISTE du plan d'un cimetière (issue #5,
// évolution vers un chemin en terre ramifié — voir CIMETIERE_LAYOUT_PLAN.md).
// La graine dérive de l'id de l'organisation : un même cimetière a toujours le
// même agencement, et sa longueur est proportionnelle au nombre de tombes.
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

export type ChunkKind = "row" | "cluster";
export type Placement = { x: number; z: number; rotY: number; chunk: number; kind: ChunkKind };
/** Tranche [start, end[ en Z portée par un chunk — contigües, sans trou ni chevauchement. */
export type ChunkRange = { start: number; end: number };
/** Segment de chemin (épine ou bras), repère local du cimetière — peint en
 *  terre battue dans la splat map du sol (scene/grass.ts), pas juste posé en
 *  décor : le visiteur voit où marcher. */
export type PathSegment = { x0: number; z0: number; x1: number; z1: number };
/** Prop caractéristique d'un cluster (mini-biome, phase 4) : méga-arbre, rocher-falaise, ou rien. */
export type ClusterPropKind = "tree" | "rocks" | "flat";
/**
 * Centre d'un rond-point de cluster, pour la clôture (3.2) et le mini-biome (phase 4).
 * `approach` = point d'accroche sur l'épine (là où le visiteur entre) : c'est lui qui
 * définit l'ORIENTATION du biome (ouverture du fer à cheval, sens de l'allée et des
 * tombes), pour un placement correct où qu'il soit dans le cimetière.
 */
export type ClusterInfo = {
  x: number; z: number; chunk: number; propKind: ClusterPropKind;
  approach: { x: number; z: number };
};
/** Paramètres du serpentement de l'allée centrale, tirés de la graine. */
export type Meander = { amp: number; period: number };

export type CemeteryLayout = {
  /** Largeur fixe du couloir (mur d'enceinte), juxtaposable le long de la route. */
  plotWidth: number;
  /** Longueur totale du chemin depuis l'entrée (z = 0). */
  plotDepth: number;
  /** Une position + orientation + chunk d'appartenance par tombe. */
  placements: Placement[];
  /** Nombre de tranches (segment/cluster) — regroupement pour phases 3 et 5. */
  chunkCount: number;
  /** Étendue en Z de chaque chunk, dans l'ordre des index. */
  chunkRanges: ChunkRange[];
  clusters: ClusterInfo[];
  /** Serpentement de l'allée centrale — permet de recalculer `spineXAt` en aval. */
  meander: Meander;
  /** Polyligne de l'allée centrale, de l'entrée au fond : ce que suivent les
   *  lampadaires (lampposts.ts). Les bras s'y accrochent. */
  spinePoints: Vec2[];
  /** Allée centrale découpée + un segment par bras — pour peindre le chemin. */
  pathSegments: PathSegment[];
};

/** Point du repère local d'un cimetière. */
export type Vec2 = { x: number; z: number };

// L'allée serpente : une épine rectiligne donnait un couloir de gare, et
// annulait tout effet de découverte — on voyait le fond depuis l'entrée.
const MEANDER_AMP_BASE = 4.5;   // m — écart de l'allée par rapport à l'axe
const MEANDER_AMP_JITTER = 2.5;
const MEANDER_PERIOD_BASE = 30; // m — longueur d'une oscillation complète
const MEANDER_PERIOD_JITTER = 14;
/** Seconde harmonique : casse la régularité du sinus, sans le rendre illisible. */
const MEANDER_HARMONIC_RATIO = 2.3;
const MEANDER_HARMONIC_WEIGHT = 0.35;
/** Pas d'échantillonnage de l'allée (m) — assez fin pour que le chemin peint
 *  dans la splat map suive la courbe sans facettes visibles. */
const SPINE_SAMPLE_STEP = 2.5;

// Largeur du couloir : il doit contenir le serpentement ET la portée maximale
// d'un bras de chaque côté, sinon les tombes du bord traversent le mur.
const PLOT_WIDTH_JITTER = 6;
const GRAVE_SPACING = 2.4; // distance mini garantie entre deux tombes
const SPINE_STEP_BASE = 4; // pas d'avance de l'épine (chemin principal) en Z
const SPINE_STEP_JITTER = 2;
const STEPS_PER_BRANCH_MIN = 4; // N mini de pas d'épine entre deux ramifications
const STEPS_PER_BRANCH_JITTER = 2;
const BRANCH_ANGLE_MAX = 0.3; // rad, écart max du bras par rapport à la perpendiculaire
const BRANCH_ARM_MIN = 4;
const BRANCH_ARM_MAX = 9; // portée max d'un bras de ramification
const BRANCH_START_GAP = 2; // recul avant la première tombe (dégage l'épine)
export const CLUSTER_RADIUS = 3;
const CLUSTER_SIZE_MIN = 4;
const CLUSTER_SIZE_MAX = 6;
const CLUSTER_RATIO_MIN = 0.25;
const CLUSTER_RATIO_MAX = 0.6;
const CLUSTER_PROP_TREE_CHANCE = 0.35; // reste : rocks jusqu'à ROCKS_CHANCE, puis flat
const CLUSTER_PROP_ROCKS_CHANCE = 0.7;
const BRANCHES_PER_CHUNK = 4; // regroupement en tranches (phases 3 et 5)
const END_MARGIN = 6; // marge d'enceinte en bout de chemin

const PLOT_WIDTH_MARGIN = 4; // dégagement entre la dernière tombe et le mur
const PLOT_WIDTH_BASE = 2 * (MEANDER_AMP_BASE + MEANDER_AMP_JITTER + BRANCH_ARM_MAX + CLUSTER_RADIUS + PLOT_WIDTH_MARGIN);

/** Écart en X de l'allée à la profondeur `z` — nul à l'entrée (z = 0), pour
 *  que l'allée parte bien du milieu de l'arche. */
export function spineXAt(m: Meander, z: number): number {
  const phase = (z / m.period) * Math.PI * 2;
  return m.amp * (Math.sin(phase) + MEANDER_HARMONIC_WEIGHT * Math.sin(phase * MEANDER_HARMONIC_RATIO))
    / (1 + MEANDER_HARMONIC_WEIGHT);
}

/** Polyligne de l'allée, de l'entrée à `depth`. */
function sampleSpine(m: Meander, depth: number): Vec2[] {
  const steps = Math.max(1, Math.ceil(depth / SPINE_SAMPLE_STEP));
  return Array.from({ length: steps + 1 }, (_, i) => {
    const z = (i / steps) * depth;
    return { x: spineXAt(m, z), z };
  });
}

// Écart mini garanti entre deux points de ramification consécutifs sur
// l'épine, dérivé des portées maximales : aucun bras (rangée ou cluster) ne
// peut alors géométriquement en atteindre un autre — par construction, sans
// détection de collision (1.2bis).
const BRANCH_Z_SPREAD_HALF = BRANCH_ARM_MAX * Math.sin(BRANCH_ANGLE_MAX) + CLUSTER_RADIUS;
const MIN_BRANCH_GAP = 2 * BRANCH_Z_SPREAD_HALF + GRAVE_SPACING;

/** Place une rangée de tombes le long du bras, en s'arrêtant à `remaining`. */
function placeRow(
  xBase: number,
  zBase: number,
  dirX: number,
  dirZ: number,
  armLength: number,
  chunk: number,
  remaining: number,
): Placement[] {
  const capacity = Math.max(1, Math.floor((armLength - BRANCH_START_GAP) / GRAVE_SPACING) + 1);
  const n = Math.min(capacity, remaining);
  const rotY = Math.atan2(dirX, dirZ);
  const row: Placement[] = [];
  for (let i = 0; i < n; i++) {
    const d = BRANCH_START_GAP + i * GRAVE_SPACING;
    row.push({ x: xBase + dirX * d, z: zBase + dirZ * d, rotY, chunk, kind: "row" });
  }
  return row;
}

/** Place un rond-point de tombes autour du centre `(cx, cz)`, borné à `remaining`. */
function placeCluster(
  rand: () => number,
  cx: number,
  cz: number,
  chunk: number,
  remaining: number,
): Placement[] {
  const size = CLUSTER_SIZE_MIN + Math.floor(rand() * (CLUSTER_SIZE_MAX - CLUSTER_SIZE_MIN + 1));
  const n = Math.max(1, Math.min(size, remaining));
  const offset = rand() * Math.PI * 2;
  const cluster: Placement[] = [];
  for (let i = 0; i < n; i++) {
    const a = offset + (i / n) * Math.PI * 2;
    const x = cx + Math.cos(a) * CLUSTER_RADIUS;
    const z = cz + Math.sin(a) * CLUSTER_RADIUS;
    cluster.push({ x, z, rotY: Math.atan2(cx - x, cz - z), chunk, kind: "cluster" });
  }
  return cluster;
}

/** Tire le prop caractéristique d'un cluster (mini-biome, phase 4), déterministe. */
function drawPropKind(rand: () => number): ClusterPropKind {
  const r = rand();
  if (r < CLUSTER_PROP_TREE_CHANCE) return "tree";
  if (r < CLUSTER_PROP_ROCKS_CHANCE) return "rocks";
  return "flat";
}

/** Étendues [start, end[ de chaque chunk : milieu entre la dernière branche du
 *  chunk précédent et la première du suivant, couvrant tout [0, plotDepth]. */
function buildChunkRanges(branchZs: number[], chunkCount: number, plotDepth: number): ChunkRange[] {
  const ranges: ChunkRange[] = [];
  for (let c = 0; c < chunkCount; c++) {
    const firstBranch = c * BRANCHES_PER_CHUNK;
    const lastBranch = Math.min((c + 1) * BRANCHES_PER_CHUNK, branchZs.length) - 1;
    const start = c === 0 ? 0 : (branchZs[firstBranch - 1] + branchZs[firstBranch]) / 2;
    const end = lastBranch + 1 < branchZs.length
      ? (branchZs[lastBranch] + branchZs[lastBranch + 1]) / 2
      : plotDepth;
    ranges.push({ start, end });
  }
  return ranges;
}

/**
 * Calcule l'agencement d'un cimetière de `count` tombes, déterministe pour un
 * `companyId` donné : chemin principal (épine) avançant en Z depuis l'entrée,
 * ramifié en rangées ou clusters. La longueur grandit avec le nombre de tombes.
 */
export function cemeteryLayout(companyId: string, count: number): CemeteryLayout {
  const rand = seededRandom(hashSeed(companyId));
  const plotWidth = PLOT_WIDTH_BASE + rand() * PLOT_WIDTH_JITTER;
  const meander: Meander = {
    amp: MEANDER_AMP_BASE + rand() * MEANDER_AMP_JITTER,
    period: MEANDER_PERIOD_BASE + rand() * MEANDER_PERIOD_JITTER,
  };
  if (count === 0) {
    return {
      plotWidth,
      plotDepth: END_MARGIN,
      placements: [],
      chunkCount: 1,
      chunkRanges: [{ start: 0, end: END_MARGIN }],
      clusters: [],
      meander,
      spinePoints: [],
      pathSegments: [],
    };
  }

  const clusterRatio = CLUSTER_RATIO_MIN + rand() * (CLUSTER_RATIO_MAX - CLUSTER_RATIO_MIN);

  const placements: Placement[] = [];
  const clusters: ClusterInfo[] = [];
  const branches: PathSegment[] = [];
  const branchZs: number[] = [];
  let z = 0;
  let branchIndex = 0;

  while (placements.length < count) {
    const steps = STEPS_PER_BRANCH_MIN + Math.floor(rand() * STEPS_PER_BRANCH_JITTER);
    for (let s = 0; s < steps; s++) z += SPINE_STEP_BASE + rand() * SPINE_STEP_JITTER;

    const side = rand() < 0.5 ? -1 : 1;
    const angle = (rand() * 2 - 1) * BRANCH_ANGLE_MAX;
    const dirX = side * Math.cos(angle);
    const dirZ = Math.sin(angle);
    const armLength = BRANCH_ARM_MIN + rand() * (BRANCH_ARM_MAX - BRANCH_ARM_MIN);
    const chunk = Math.floor(branchIndex / BRANCHES_PER_CHUNK);
    const remaining = count - placements.length;
    const isCluster = rand() < clusterRatio;
    // Le bras s'accroche à l'allée là où elle passe à cette profondeur, pas sur
    // un axe fixe : c'est ce qui fait que les sous-allées suivent le serpentement.
    const xBase = spineXAt(meander, z);

    branches.push({ x0: xBase, z0: z, x1: xBase + dirX * armLength, z1: z + dirZ * armLength });

    if (isCluster) {
      const cx = xBase + dirX * armLength;
      const cz = z + dirZ * armLength;
      placements.push(...placeCluster(rand, cx, cz, chunk, remaining));
      clusters.push({ x: cx, z: cz, chunk, propKind: drawPropKind(rand), approach: { x: xBase, z } });
    } else {
      placements.push(...placeRow(xBase, z, dirX, dirZ, armLength, chunk, remaining));
    }
    branchZs.push(z);
    branchIndex++;
  }

  const plotDepth = z + BRANCH_Z_SPREAD_HALF + END_MARGIN;
  const chunkCount = Math.floor((branchIndex - 1) / BRANCHES_PER_CHUNK) + 1;
  const chunkRanges = buildChunkRanges(branchZs, chunkCount, plotDepth);
  // L'allée est échantillonnée puis aplatie en segments : le peintre de sol
  // (grass.ts) et la distance au chemin ne connaissent que des segments droits.
  const spinePoints = sampleSpine(meander, z);
  const spineSegments = spinePoints.slice(1).map((p, i) => ({
    x0: spinePoints[i].x, z0: spinePoints[i].z, x1: p.x, z1: p.z,
  }));
  return {
    plotWidth, plotDepth, placements, chunkCount, chunkRanges, clusters, meander, spinePoints,
    pathSegments: [...spineSegments, ...branches],
  };
}

/** Distance d'un point (repère local) au segment [a,b] — même principe que world.ts. */
function distanceToSegment(x: number, z: number, x0: number, z0: number, x1: number, z1: number): number {
  const dx = x1 - x0;
  const dz = z1 - z0;
  const len2 = dx * dx + dz * dz || 1;
  let t = ((x - x0) * dx + (z - z0) * dz) / len2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(x - (x0 + dx * t), z - (z0 + dz * t));
}

/** Distance d'un point (repère local du cimetière) au chemin (épine + bras) le
 *  plus proche — utilisé pour peindre la terre battue dans la splat map (scene/grass.ts). */
export function distanceToPath(segments: PathSegment[], x: number, z: number): number {
  let min = Infinity;
  for (const s of segments) {
    const d = distanceToSegment(x, z, s.x0, s.z0, s.x1, s.z1);
    if (d < min) min = d;
  }
  return min;
}
