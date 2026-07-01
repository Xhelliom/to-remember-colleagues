// Streaming du monde continu : charge/décharge les chunks d'un cimetière à
// l'approche (#5) — extrait de cemetery.ts pour rester sous la limite de 500
// lignes par fichier. Décisions pures dans chunkStreaming.ts, testées séparément.
import type * as THREE from "three";
import type { Ambiance } from "../ambiance.ts";
import type { Colleague, Company, CompanyDetail } from "../types.ts";
import { createGrave } from "../graves.ts";
import { graveAxes } from "../graveAxes.ts";
import { cemeteryLayout, type CemeteryLayout } from "../procedural.ts";
import type { WorldSlotWithCompany } from "../world.ts";
import { distanceToSlot, toWorld, type Vec2 } from "../worldLayout.ts";
import { CHUNK_LOAD_RADIUS, chunksToLoad, chunksToUnload } from "../chunkStreaming.ts";
import { buildChunkMeshes, disposeChunkMeshes, type ChunkMeshes } from "./chunkMeshes.ts";
import { disposeObject } from "./disposeObject.ts";

const NEAR_MARGIN = 3; // tolérance pour se considérer « à » un cimetière (HUD, ajout)
const MAX_CONCURRENT_CHUNK_LOADS = 2; // plafond global de builds de chunk simultanés (anti à-coups)

type ColleagueLoader = (companyId: string) => Promise<CompanyDetail>;

/** Groupes de scène alimentés par le streamer (possédés et ajoutés à la scène par Cemetery). */
export type StreamerGroups = {
  gravesGroup: THREE.Group;
  grassGroup: THREE.Group;
  groundPlanesGroup: THREE.Group;
  vegetationGroup: THREE.Group;
  worldGroup: THREE.Group;
};

/**
 * Charge/décharge les chunks d'un cimetière à l'approche : seul le chunk
 * d'entrée se construit tant que l'emprise n'est pas franchie, puis les
 * suivants par proximité individuelle (`chunksToLoad`/`chunksToUnload`,
 * fonctions pures testées séparément). Aucun appel réseau au-delà de la
 * première récupération des collègues — ils restent en mémoire ensuite.
 */
export class WorldStreamer {
  private slots: WorldSlotWithCompany[] = [];
  private loader: ColleagueLoader = async () => ({ company: {} as CompanyDetail["company"], colleagues: [], karma: 0, anonymized: false });
  private readonly loaded = new Map<string, Colleague[]>(); // collègues récupérés (jamais invalidé)
  private readonly layouts = new Map<string, CemeteryLayout>(); // agencement calculé (idem)
  private readonly fetching = new Set<string>(); // récupération des collègues en cours ou tentée
  private readonly pendingChunks = new Set<string>(); // construction de chunk en cours (anti-doublon)
  /** Maillages (terrain, herbe, végétation, clôture) chargés, clé `${companyId}:${chunkIndex}`. */
  readonly loadedChunks = new Map<string, ChunkMeshes>();
  private nearestId: string | null = null;
  private nearestCb: (c: Company | null) => void = () => {};

  constructor(
    private readonly groups: StreamerGroups,
    private readonly getAmbiance: () => Ambiance,
  ) {}

  setLoader(loader: ColleagueLoader) {
    this.loader = loader;
  }

  /** Cimetière le plus proche (où l'on se tient) ou null si l'on est sur la route. */
  onNearestCemetery(cb: (c: Company | null) => void) {
    this.nearestCb = cb;
  }

  enter(slots: WorldSlotWithCompany[]) {
    this.slots = slots;
  }

  update(cam: Vec2) {
    for (const slot of this.slots) this.updateSlot(slot, cam);
    const nearestId = this.findNearestSlotId(cam);
    if (nearestId !== this.nearestId) {
      this.nearestId = nearestId;
      this.nearestCb(nearestId ? this.slots.find((s) => s.id === nearestId)!.company : null);
    }
  }

  /** Ajoute un collègue au cimetière où l'on se tient et reconstruit ses tombes. */
  addColleague(companyId: string, colleague: Colleague) {
    const list = this.loaded.get(companyId);
    if (!list) return; // pas encore chargé : apparaîtra à l'approche
    list.push(colleague);
    const layout = cemeteryLayout(companyId, list.length);
    this.layouts.set(companyId, layout);
    const slot = this.slots.find((s) => s.id === companyId);
    if (!slot) return;
    this.syncSlotDims(slot, layout);
    // Le nouvel agencement change portées et tranches : on décharge les chunks
    // déjà chargés (terrain, clôture, tombes) ; le streaming les reconstruit à la
    // frame suivante, cohérents avec le nouveau layout.
    for (const index of this.loadedChunkIndices(companyId)) this.unloadChunk(companyId, index);
  }

  /**
   * Aligne l'emprise du slot (largeur/longueur/centre) sur l'agencement réel
   * (nombre de collègues) : sinon `distanceToSlot`/`chunksToLoad` s'appuient sur
   * le `graveCount` figé à la construction du monde et divergent (chunks lointains
   * jamais chargés, tombes désalignées du terrain).
   */
  private syncSlotDims(slot: WorldSlotWithCompany, layout: CemeteryLayout) {
    slot.plotWidth = layout.plotWidth;
    slot.plotDepth = layout.plotDepth;
    slot.plotCenter = toWorld(slot, 0, layout.plotDepth / 2);
  }

  updateColleague(colleague: Colleague) {
    for (const [companyId, list] of this.loaded) {
      const idx = list.findIndex((c) => c.id === colleague.id);
      if (idx < 0) continue;
      list[idx] = colleague;
      // Longueur de liste inchangée → l'agencement ne bouge pas.
      const slot = this.slots.find((s) => s.id === companyId);
      if (slot) this.rebuildLoadedGraves(slot);
      break;
    }
  }

  /** Reconstruit les tombes déjà chargées de tous les cimetières (couleur de pierre modifiée). */
  rebuildAllLoadedGraves() {
    for (const slot of this.slots) this.rebuildLoadedGraves(slot);
  }

  clear() {
    for (const chunk of this.loadedChunks.values()) disposeChunkMeshes(chunk);
    this.loadedChunks.clear();
    this.slots = [];
    this.loaded.clear();
    this.layouts.clear();
    this.fetching.clear();
    this.pendingChunks.clear();
    this.nearestId = null;
  }

  private updateSlot(slot: WorldSlotWithCompany, cam: Vec2) {
    const layout = this.layouts.get(slot.id);
    if (!layout) {
      if (!this.fetching.has(slot.id) && distanceToSlot(slot, cam) < CHUNK_LOAD_RADIUS) {
        void this.fetchCemetery(slot);
      }
      return;
    }
    const loadedIndices = this.loadedChunkIndices(slot.id);
    for (const i of chunksToLoad(cam, slot, layout.chunkRanges, loadedIndices)) {
      // Plafond global : `pendingChunks` (partagé entre tous les slots) borne les
      // builds simultanés ; le reste est repris à la frame suivante.
      if (this.pendingChunks.size >= MAX_CONCURRENT_CHUNK_LOADS) break;
      void this.loadChunk(slot, layout, i);
    }
    for (const i of chunksToUnload(cam, slot, layout.chunkRanges, loadedIndices)) {
      this.unloadChunk(slot.id, i);
    }
  }

  private loadedChunkIndices(companyId: string): Set<number> {
    const prefix = `${companyId}:`;
    const indices = new Set<number>();
    for (const key of this.loadedChunks.keys()) {
      if (key.startsWith(prefix)) indices.add(Number(key.slice(prefix.length)));
    }
    return indices;
  }

  /** Cimetière dont on foule l'emprise réelle (rectangle largeur × longueur), à `NEAR_MARGIN` près. */
  private findNearestSlotId(cam: Vec2): string | null {
    let nearest: string | null = null;
    let min = Infinity;
    for (const slot of this.slots) {
      const d = distanceToSlot(slot, cam);
      if (d <= NEAR_MARGIN && d < min) {
        min = d;
        nearest = slot.id;
      }
    }
    return nearest;
  }

  /** Récupère les collègues d'un cimetière (une seule fois, jamais réinvalidé ensuite). */
  private async fetchCemetery(slot: WorldSlotWithCompany) {
    this.fetching.add(slot.id);
    try {
      const detail = await this.loader(slot.id);
      if (!this.slots.includes(slot)) return; // on a quitté le monde entre-temps
      const layout = cemeteryLayout(slot.id, detail.colleagues.length);
      this.loaded.set(slot.id, detail.colleagues);
      this.layouts.set(slot.id, layout);
      this.syncSlotDims(slot, layout);
    } catch {
      // ponytail: pas de backoff ; le cimetière reste vide jusqu'au prochain enterWorld.
    }
  }

  private addChunkToScene(companyId: string, index: number, chunk: ChunkMeshes) {
    this.groups.groundPlanesGroup.add(chunk.terrain.mesh);
    if (chunk.grass) this.groups.grassGroup.add(chunk.grass.mesh);
    if (chunk.veg) for (const m of chunk.veg.meshes) this.groups.vegetationGroup.add(m);
    this.groups.worldGroup.add(chunk.fence);
    this.loadedChunks.set(`${companyId}:${index}`, chunk);
  }

  private removeChunkFromScene(chunk: ChunkMeshes) {
    this.groups.groundPlanesGroup.remove(chunk.terrain.mesh);
    if (chunk.grass) this.groups.grassGroup.remove(chunk.grass.mesh);
    if (chunk.veg) for (const m of chunk.veg.meshes) this.groups.vegetationGroup.remove(m);
    this.groups.worldGroup.remove(chunk.fence);
  }

  private async loadChunk(slot: WorldSlotWithCompany, layout: CemeteryLayout, index: number) {
    const key = `${slot.id}:${index}`;
    if (this.pendingChunks.has(key) || this.loadedChunks.has(key)) return;
    this.pendingChunks.add(key);
    try {
      const chunk = await buildChunkMeshes(slot.id, slot, layout, index, layout.chunkRanges[index], slot.company.karma, this.getAmbiance());
      if (!this.slots.includes(slot)) {
        disposeChunkMeshes(chunk);
        return; // on a quitté le monde entre-temps
      }
      this.addChunkToScene(slot.id, index, chunk);
      this.buildChunkGraves(slot, layout, index);
    } catch {
      // ponytail: build de chunk échoué (GLTF/terrain) — évite une unhandled
      // rejection retentée chaque frame ; repris à la prochaine approche.
    } finally {
      this.pendingChunks.delete(key);
    }
  }

  private unloadChunk(companyId: string, index: number) {
    const key = `${companyId}:${index}`;
    const chunk = this.loadedChunks.get(key);
    if (!chunk) return;
    this.removeChunkFromScene(chunk);
    disposeChunkMeshes(chunk);
    this.loadedChunks.delete(key);
    this.removeChunkGraves(companyId, index);
  }

  /** Reconstruit les tombes des seuls chunks déjà chargés (couleur/effectif modifié). */
  private rebuildLoadedGraves(slot: WorldSlotWithCompany) {
    const layout = this.layouts.get(slot.id);
    if (!layout) return;
    for (const index of this.loadedChunkIndices(slot.id)) {
      this.removeChunkGraves(slot.id, index);
      this.buildChunkGraves(slot, layout, index);
    }
  }

  private buildChunkGraves(slot: WorldSlotWithCompany, layout: CemeteryLayout, chunkIndex: number) {
    const colleagues = this.loaded.get(slot.id)!;
    const terrain = this.loadedChunks.get(`${slot.id}:${chunkIndex}`)?.terrain;
    const now = Date.now();
    const graveColor = this.getAmbiance().graveColor;
    layout.placements.forEach((place, i) => {
      if (place.chunk !== chunkIndex) return;
      const colleague = colleagues[i];
      const grave = createGrave(colleague, graveColor, graveAxes(colleague, now));
      // Origine locale = l'entrée (z = 0 sur le chemin), pas le centre du rectangle.
      const { x: wx, z: wz } = toWorld(slot, place.x, place.z);
      grave.position.set(wx, terrain ? terrain.getHeightAt(wx, wz) : 0, wz);
      grave.rotation.y += place.rotY + slot.rotY;
      grave.userData.companyId = slot.id;
      grave.userData.chunk = chunkIndex;
      this.groups.gravesGroup.add(grave);
    });
  }

  private removeChunkGraves(companyId: string, chunkIndex: number) {
    const stale = this.groups.gravesGroup.children.filter(
      (g) => g.userData.companyId === companyId && g.userData.chunk === chunkIndex,
    );
    for (const g of stale) {
      this.groups.gravesGroup.remove(g);
      disposeObject(g);
    }
  }
}
