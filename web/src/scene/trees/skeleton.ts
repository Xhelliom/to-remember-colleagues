// Squelette procédural d'un arbre — grammaire de croissance déterministe
// (tronc → branches récursives → ancres de feuilles), inspirée du concept
// LAAS `vegetation/Skeleton.ts` + `Species.ts` (tropismes, enveloppe de
// couronne, phyllotaxie) mais réécrite ici en modèle PUR (pas de Three.js) :
// testable seul, comme `graveAxes.ts`/`procedural.ts`. La mise en maillage
// (tubes + feuilles) vit dans `tubeMesh.ts`/`leafMesh.ts`.
//
// Espèce de départ = FEUILLU type hêtre : tronc qui se ramifie en plusieurs
// niveaux, chaque branche fille est tirée vers la surface d'une enveloppe de
// couronne ELLIPSOÏDALE (tropisme = gradient de l'ellipsoïde, cf.
// `envelopeOutward`) → silhouette arrondie sans avoir à la dessiner à la
// main. Les ancres de feuille sont réparties en spirale (angle d'or), la
// vraie phyllotaxie alterne/spirale d'un feuillu.
import { seededRandom } from "../../graves.ts";
import { hashSeed } from "../../procedural.ts";

export type Vec3 = { readonly x: number; readonly y: number; readonly z: number };

/** Un nœud du squelette : position + rayon (pour le maillage tube), relié à
 *  son parent (-1 = racine du tronc). `depth` = niveau de ramification
 *  (0 = tronc, 1 = branches primaires, 2 = secondaires…). */
export type SkeletonNode = {
  readonly position: Vec3;
  readonly radius: number;
  readonly parent: number;
  readonly depth: number;
};

/** Point d'accroche d'une feuille : position, direction de pousse (`normal`),
 *  repère perpendiculaire (`up`, orientation de la lame) et variance de taille. */
export type LeafAnchor = {
  readonly position: Vec3;
  readonly normal: Vec3;
  readonly up: Vec3;
  readonly scale: number;
};

export type TreeSkeleton = {
  readonly nodes: readonly SkeletonNode[];
  readonly anchors: readonly LeafAnchor[];
};

/** Paramètres d'une espèce — un seul jeu de valeurs pour l'instant (hêtre),
 *  mais le type est déjà générique pour de futures espèces (conifère…). */
export type TreeSpecies = {
  readonly trunkHeight: number;
  readonly trunkSegments: number;
  readonly trunkBaseRadius: number;
  readonly trunkTipRadius: number;
  /** Dérive latérale totale max du tronc (irrégularité organique, pas un arbre au cordeau). */
  readonly trunkLeanMax: number;
  /** Centre de l'enveloppe de couronne, en fraction de `trunkHeight`. */
  readonly crownCenterHeightRatio: number;
  readonly crownRadiusXZ: number;
  readonly crownRadiusY: number;
  /** Nombre de niveaux de ramification après le tronc (1 = primaires seulement, 2 = + secondaires…). */
  readonly branchLevels: number;
  /** Nombre de branches filles par niveau, `branchesPerLevel.length === branchLevels`. */
  readonly branchesPerLevel: readonly number[];
  readonly branchSegments: number;
  /** Longueur d'une branche (relative à `trunkHeight`), élevée à la puissance du niveau. */
  readonly branchLengthRatio: number;
  /** Rayon d'une branche fille / rayon du parent à son point de greffe. */
  readonly branchRadiusTaper: number;
  /** Fraction basse du parent en-deçà de laquelle aucune branche ne démarre. */
  readonly branchStartRatio: number;
  /** Force d'attraction vers la surface de l'enveloppe de couronne (0 = ligne droite, 1 = colle à l'enveloppe). */
  readonly tropismWeight: number;
  /** Irrégularité directionnelle (bruit) à chaque pas de croissance. */
  readonly jitterWeight: number;
  readonly leafAnchorsPerTwig: number;
  /** Rayon de dispersion des feuilles autour du bout de brindille. */
  readonly leafSpread: number;
};

const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5)); // ≈ 137,5° — phyllotaxie spirale
const BRANCH_TILT_ANGLE = 0.55; // rad, inclinaison initiale d'une branche vs l'horizontale
const TIP_RADIUS_RATIO = 0.35; // rayon au bout d'une branche / rayon à sa base
const VEC_EPSILON = 1e-8;
const LEAF_SCALE_MIN = 0.75;
const LEAF_SCALE_RANGE = 0.5;

/** Espèce de départ (#08) : feuillu type hêtre, couronne arrondie et pleine. */
export const BEECH_SPECIES: TreeSpecies = {
  trunkHeight: 6,
  trunkSegments: 8,
  trunkBaseRadius: 0.22,
  trunkTipRadius: 0.09,
  trunkLeanMax: 0.35,
  crownCenterHeightRatio: 0.62,
  crownRadiusXZ: 3.4,
  crownRadiusY: 2.6,
  branchLevels: 2,
  branchesPerLevel: [7, 4],
  branchSegments: 5,
  branchLengthRatio: 0.62,
  branchRadiusTaper: 0.55,
  branchStartRatio: 0.35,
  tropismWeight: 0.55,
  jitterWeight: 0.18,
  leafAnchorsPerTwig: 8,
  leafSpread: 0.35,
};

// --- Petite algèbre vectorielle locale (pas de dépendance Three.js ici) ---

function add(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z };
}
function sub(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}
function scale(a: Vec3, s: number): Vec3 {
  return { x: a.x * s, y: a.y * s, z: a.z * s };
}
function cross(a: Vec3, b: Vec3): Vec3 {
  return { x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x };
}
function length(a: Vec3): number {
  return Math.sqrt(a.x * a.x + a.y * a.y + a.z * a.z);
}
function normalize(a: Vec3): Vec3 {
  const len = length(a);
  return len < VEC_EPSILON ? { x: 0, y: 1, z: 0 } : scale(a, 1 / len);
}
function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}
/** Vecteur perpendiculaire quelconque à `v` (repère local pour l'orientation d'une feuille). */
function perpendicular(v: Vec3): Vec3 {
  const reference = Math.abs(v.y) > 0.9 ? { x: 1, y: 0, z: 0 } : { x: 0, y: 1, z: 0 };
  return normalize(cross(v, reference));
}
function jitter(rand: () => number, weight: number): Vec3 {
  return scale({ x: rand() * 2 - 1, y: rand() * 2 - 1, z: rand() * 2 - 1 }, weight);
}

/** Direction radiale sortante de l'ellipsoïde de couronne au point `pos` — le
 *  gradient de x²/a² + y²/b² + z²/c² = 1, donc la vraie normale de surface :
 *  tirer une branche le long de ce vecteur la fait « épouser » l'enveloppe. */
function envelopeOutward(pos: Vec3, center: Vec3, species: TreeSpecies): Vec3 {
  const d = sub(pos, center);
  const rXZ2 = species.crownRadiusXZ * species.crownRadiusXZ;
  const rY2 = species.crownRadiusY * species.crownRadiusY;
  return normalize({ x: d.x / rXZ2, y: d.y / rY2, z: d.z / rXZ2 });
}

function pushNode(nodes: SkeletonNode[], position: Vec3, radius: number, parent: number, depth: number): number {
  nodes.push({ position, radius, parent, depth });
  return nodes.length - 1;
}

/** Direction initiale d'une branche : inclinée de `BRANCH_TILT_ANGLE` au-dessus
 *  de l'horizontale, tournée de `spinAngle` autour du tronc (phyllotaxie). */
function initialBranchDirection(spinAngle: number): Vec3 {
  const horiz = Math.cos(BRANCH_TILT_ANGLE);
  return { x: Math.cos(spinAngle) * horiz, y: Math.sin(BRANCH_TILT_ANGLE), z: Math.sin(spinAngle) * horiz };
}

/** Tronc : chaîne de `trunkSegments` nœuds, légère dérive latérale aléatoire
 *  (irrégularité organique) mais toujours globalement vertical. */
function growTrunk(species: TreeSpecies, rand: () => number, nodes: SkeletonNode[]): number[] {
  const stepLen = species.trunkHeight / species.trunkSegments;
  const chain = [pushNode(nodes, { x: 0, y: 0, z: 0 }, species.trunkBaseRadius, -1, 0)];
  let pos: Vec3 = { x: 0, y: 0, z: 0 };
  let dir: Vec3 = { x: 0, y: 1, z: 0 };
  for (let i = 1; i <= species.trunkSegments; i++) {
    const wobble = jitter(rand, species.trunkLeanMax / species.trunkSegments);
    dir = normalize(add(dir, { x: wobble.x, y: 0, z: wobble.z }));
    pos = add(pos, scale(dir, stepLen));
    const radius = lerp(species.trunkBaseRadius, species.trunkTipRadius, i / species.trunkSegments);
    chain.push(pushNode(nodes, pos, radius, chain[chain.length - 1], 0));
  }
  return chain;
}

/** Une branche (tronc→bout) : à chaque pas, la direction est tirée vers la
 *  surface de l'enveloppe de couronne (`tropismWeight`) avec un peu de bruit
 *  (`jitterWeight`) — c'est ce tropisme qui arrondit la couronne sans règle
 *  géométrique explicite sur chaque branche. */
function growBranchChain(
  species: TreeSpecies, rand: () => number, nodes: SkeletonNode[],
  startIdx: number, crownCenter: Vec3, spinAngle: number, level: number,
): number[] {
  const start = nodes[startIdx];
  const totalLen = species.trunkHeight * species.branchLengthRatio ** level;
  const stepLen = totalLen / species.branchSegments;
  const baseRadius = start.radius * species.branchRadiusTaper;
  let dir = initialBranchDirection(spinAngle);
  let pos = start.position;
  let parent = startIdx;
  const chain = [startIdx];
  for (let i = 1; i <= species.branchSegments; i++) {
    const outward = envelopeOutward(pos, crownCenter, species);
    dir = normalize(add(
      scale(dir, 1 - species.tropismWeight),
      add(scale(outward, species.tropismWeight), jitter(rand, species.jitterWeight)),
    ));
    pos = add(pos, scale(dir, stepLen));
    const radius = lerp(baseRadius, baseRadius * TIP_RADIUS_RATIO, i / species.branchSegments);
    const idx = pushNode(nodes, pos, radius, parent, level);
    chain.push(idx);
    parent = idx;
  }
  return chain;
}

/** Récursion par niveau : fait pousser `branchesPerLevel[level-1]` branches
 *  filles réparties le long du parent (angle d'or entre elles), jusqu'à
 *  `branchLevels` — au-delà, la chaîne terminale reçoit ses ancres de feuille. */
function growLevel(
  species: TreeSpecies, rand: () => number, nodes: SkeletonNode[], anchors: LeafAnchor[],
  parentChain: number[], crownCenter: Vec3, level: number,
): void {
  if (level > species.branchLevels) {
    placeLeafAnchors(species, rand, nodes, anchors, parentChain);
    return;
  }
  const count = species.branchesPerLevel[level - 1];
  const startMin = Math.max(1, Math.floor(parentChain.length * species.branchStartRatio));
  const span = Math.max(1, parentChain.length - startMin);
  for (let b = 0; b < count; b++) {
    const startIdx = parentChain[startMin + (b % span)];
    const childChain = growBranchChain(species, rand, nodes, startIdx, crownCenter, b * GOLDEN_ANGLE, level);
    growLevel(species, rand, nodes, anchors, childChain, crownCenter, level + 1);
  }
}

/** Ancres de feuille en spirale (angle d'or) autour du bout d'une brindille —
 *  la vraie phyllotaxie alterne/spirale d'un feuillu, pas un motif régulier. */
function placeLeafAnchors(
  species: TreeSpecies, rand: () => number, nodes: SkeletonNode[], anchors: LeafAnchor[], twigChain: number[],
): void {
  const tip = nodes[twigChain[twigChain.length - 1]];
  const prev = twigChain.length > 1 ? nodes[twigChain[twigChain.length - 2]] : undefined;
  const tangent = prev ? normalize(sub(tip.position, prev.position)) : { x: 0, y: 1, z: 0 };
  const side = perpendicular(tangent);
  const side2 = cross(tangent, side);
  for (let i = 0; i < species.leafAnchorsPerTwig; i++) {
    const a = i * GOLDEN_ANGLE;
    const outward = add(scale(side, Math.cos(a)), scale(side2, Math.sin(a)));
    const normal = normalize(add(scale(tangent, 0.35), scale(outward, 0.85)));
    const dist = species.leafSpread * (0.4 + 0.6 * rand());
    anchors.push({
      position: add(tip.position, scale(normal, dist)),
      normal,
      up: perpendicular(normal),
      scale: LEAF_SCALE_MIN + rand() * LEAF_SCALE_RANGE,
    });
  }
}

/**
 * Fait pousser un squelette d'arbre déterministe : même `(species, seed)` →
 * mêmes nœuds/ancres, toujours (aucun `Math.random()`). Deux graines
 * distinctes divergent en position dès le tronc (RÈGLE testée par
 * `skeleton.test.ts`) — jamais deux arbres identiques.
 */
export function growSkeleton(species: TreeSpecies, seed: number): TreeSkeleton {
  const rand = seededRandom(hashSeed(`tree:${seed}`));
  const nodes: SkeletonNode[] = [];
  const anchors: LeafAnchor[] = [];
  const crownCenter: Vec3 = { x: 0, y: species.trunkHeight * species.crownCenterHeightRatio, z: 0 };
  const trunkChain = growTrunk(species, rand, nodes);
  growLevel(species, rand, nodes, anchors, trunkChain, crownCenter, 1);
  return { nodes, anchors };
}
