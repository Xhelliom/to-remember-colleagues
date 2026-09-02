// Arbres et rochers instanciés (InstancedMesh) par TRANCHE [zStart, zEnd[ du
// couloir d'un cimetière (phase 3) — densité proportionnelle à l'aire de la
// tranche. Tout est procédural (trees/ pour les arbres, props.ts pour la
// pierre) : plus aucun GLTF, dont la photogrammétrie jurait avec le reste.
import * as THREE from "three";
import { seededRandom } from "../graves.ts";
import { hashSeed } from "../procedural.ts";
import { toWorld, type Frame } from "../worldLayout.ts";
import { instanceProps, rockSource, ROCK_SQUASH_STANDING, type PropSource } from "./props.ts";
import type { TerrainChunk } from "./terrain.ts";
import { setWindTime } from "./wind.ts";
import { TreeLodField, type TreePlacement } from "./trees/treeLod.ts";

const TREE_DENSITY = 0.004; // arbres par m², calée sur la densité visuelle précédente
const ROCK_DENSITY = 0.0028; // cailloux posés au sol
// Blocs dressés : rares (~1 pour 5 cailloux) mais hauts, ce sont eux qui donnent
// la verticalité au paysage — sans eux, tout se lit à hauteur de genou.
const BOULDER_DENSITY = 0.0006;
const BORDER_MARGIN = 1.5; // retrait des murs latéraux et des bouts de chemin
const TREE_SCALE_MIN = 0.8;
const TREE_SCALE_RANGE = 0.6;
const ROCK_SCALE_MIN = 0.2;
const ROCK_SCALE_RANGE = 0.6;
const BOULDER_SCALE_MIN = 1.4;
const BOULDER_SCALE_RANGE = 1.8;

/** Bornes [zLo, zHi] : dégagées uniquement aux vrais bouts du chemin (jamais aux jointures internes). */
function clampedZRange(zStart: number, zEnd: number, plotDepth: number): [number, number] {
  const zLo = zStart <= 0 ? BORDER_MARGIN : zStart;
  const zHi = zEnd >= plotDepth ? plotDepth - BORDER_MARGIN : zEnd;
  return [zLo, zHi];
}

/** Zone de dispersion d'une tranche : rectangle local + accès au relief. */
type Scatter = {
  frame: Frame;
  halfWidth: number;
  zLo: number;
  zHi: number;
  terrain: TerrainChunk | undefined;
};

/** Matrices de placement (dispersion uniforme dans le rectangle de la tranche). */
function buildPlacementMatrices(
  seed: number, count: number, area: Scatter, scaleMin: number, scaleRange: number,
): THREE.Matrix4[] {
  const rand = seededRandom(seed);
  const dummy = new THREE.Object3D();
  return Array.from({ length: count }, () => {
    const lx = (rand() * 2 - 1) * area.halfWidth;
    const lz = area.zLo + rand() * (area.zHi - area.zLo);
    const { x: wx, z: wz } = toWorld(area.frame, lx, lz);
    dummy.position.set(wx, area.terrain ? area.terrain.getHeightAt(wx, wz) : 0, wz);
    dummy.rotation.y = rand() * Math.PI * 2;
    dummy.scale.setScalar(scaleMin + rand() * scaleRange);
    dummy.updateMatrix();
    return dummy.matrix.clone();
  });
}

/** Placements déterministes pour la chaîne LOD des arbres (trees/treeLod.ts) —
 *  même distribution que `buildPlacementMatrices`, mais position/yaw/échelle/
 *  graine bruts (la matrice seule ne suffit pas : le blend d'impostor a besoin
 *  du yaw, cf. treeLod.ts). */
function buildTreePlacements(companyId: string, count: number, area: Scatter): TreePlacement[] {
  const rand = seededRandom(hashSeed(`${companyId}:treelod:${area.zLo}`));
  return Array.from({ length: count }, (_, i) => {
    const lx = (rand() * 2 - 1) * area.halfWidth;
    const lz = area.zLo + rand() * (area.zHi - area.zLo);
    const { x: wx, z: wz } = toWorld(area.frame, lx, lz);
    return {
      x: wx, y: area.terrain ? area.terrain.getHeightAt(wx, wz) : 0, z: wz,
      yaw: rand() * Math.PI * 2,
      scale: TREE_SCALE_MIN + rand() * TREE_SCALE_RANGE,
      seed: hashSeed(`${companyId}:treelod:${area.zLo}:${i}`),
    };
  });
}

/** Arbres et rochers instanciés d'une tranche de cimetière. */
export class VegetationInstances {
  readonly meshes: THREE.InstancedMesh[];
  readonly center: { x: number; z: number };
  /** Palier de LOD courant (scene/distanceLod.ts) ; 0 = visible au chargement. */
  lodTier = 0;
  /** Chaîne LOD procédurale des arbres (mission 10) — `null` si aucun renderer
   *  n'a été fourni (la capture d'impostor en dépend). Son `.group` doit être
   *  ajouté/retiré de la scène par l'appelant (cf. worldStreamer.ts), au même
   *  titre que `meshes`. */
  readonly treeLod: TreeLodField | null;
  private readonly sources: PropSource[];

  private constructor(
    meshes: THREE.InstancedMesh[], center: { x: number; z: number }, sources: PropSource[], treeLod: TreeLodField | null,
  ) {
    this.meshes = meshes;
    this.center = center;
    this.sources = sources;
    this.treeLod = treeLod;
  }

  /**
   * Forêt/rochers d'AMBIANCE d'une tranche (dispersion uniforme). Le monument
   * central d'un cluster (méga-arbre ou pile de rochers) est du ressort de
   * scene/biomes/clairiere/builder.ts, qui possède déjà toute la mise en scène
   * du biome — pas de doublon ici.
   *
   * `renderer` (optionnel) conditionne les arbres : leur chaîne LOD capture un
   * impostor une fois par session et ne peut pas s'en passer.
   */
  static create(
    companyId: string,
    frame: Frame,
    plotWidth: number,
    plotDepth: number,
    zStart: number,
    zEnd: number,
    terrain?: TerrainChunk,
    renderer?: THREE.WebGLRenderer,
  ): VegetationInstances | null {
    const [zLo, zHi] = clampedZRange(zStart, zEnd, plotDepth);
    const area: Scatter = { frame, halfWidth: plotWidth / 2 - BORDER_MARGIN, zLo, zHi, terrain };
    const surface = plotWidth * (zHi - zLo);
    const meshes: THREE.InstancedMesh[] = [];
    const sources: PropSource[] = [];

    let treeLod: TreeLodField | null = null;
    if (renderer) {
      const placements = buildTreePlacements(companyId, Math.max(1, Math.round(TREE_DENSITY * surface)), area);
      treeLod = TreeLodField.create(hashSeed(`${companyId}:treelod:${zLo}`), placements, renderer);
    }

    for (const [suffix, density, squash, scaleMin, scaleRange] of [
      [":rocks", ROCK_DENSITY, undefined, ROCK_SCALE_MIN, ROCK_SCALE_RANGE],
      [":boulders", BOULDER_DENSITY, ROCK_SQUASH_STANDING, BOULDER_SCALE_MIN, BOULDER_SCALE_RANGE],
    ] as const) {
      const count = Math.max(1, Math.round(density * surface));
      const seed = hashSeed(`${companyId}${suffix}:${zLo}`);
      const source = rockSource(seed, squash);
      sources.push(source);
      meshes.push(...instanceProps(source, buildPlacementMatrices(seed, count, area, scaleMin, scaleRange)));
    }

    if (!meshes.length && !treeLod) return null;
    return new VegetationInstances(meshes, toWorld(frame, 0, (zStart + zEnd) / 2), sources, treeLod);
  }

  /** Avance le champ de vent partagé (cf. wind.ts — une seule horloge pour herbe et arbres). */
  update(time: number) {
    setWindTime(time);
  }

  /** Recalcule les paliers LOD des arbres procéduraux (hero/cards/impostors)
   *  selon la position caméra — no-op si `treeLod` est absent. */
  updateTreeLod(camX: number, camY: number, camZ: number) {
    this.treeLod?.update(camX, camZ, camY);
  }

  dispose() {
    for (const s of this.sources) s.dispose();
    this.treeLod?.dispose();
  }
}
