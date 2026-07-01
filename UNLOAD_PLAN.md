# Plan — Déchargement des cimetières éloignés

Objectif : libérer la mémoire GPU/CPU des cimetières hors de portée quand le
joueur s'éloigne, et les recharger s'il revient. Zéro perte de qualité visuelle.

---

## Contexte

Aujourd'hui les cimetières se chargent « à vue » mais ne se déchargent jamais.
Avec beaucoup d'entreprises, la mémoire GPU s'accumule indéfiniment :
terrain (128² vertices), herbe (20 000 instances), arbres/rochers (3 InstancedMesh).

**Hysterèse :** charger à 39 m, décharger à 100 m → 61 m de marge, pas de
thrashing si le joueur fait demi-tour à la frontière.

**Rechargement :** en déchargeant on retire le slot de `requested`, ce qui
permet de le recharger si le joueur revient (même comportement que la première
fois).

---

## Ressources à libérer par cimetière

| Ressource | Stockage actuel | Action à l'unload |
|---|---|---|
| `TerrainChunk` | `terrains: Map<id, TerrainChunk>` | `.remove()` + `.dispose()` + `.delete()` |
| `GrassField` | `grassFields: GrassField[]` ← à changer | `.remove()` + `.dispose()` + `.delete()` |
| `VegetationInstances` | `vegetations: VegetationInstances[]` ← à changer | `.remove()` + `.dispose()` + `.delete()` |
| Tombes | `gravesGroup` (userData.companyId) | `removeCemeteryGraves()` existant |
| État | `loaded` + `requested` | `.delete()` pour permettre le rechargement |

---

## Changements

### 1. Convertir les tableaux en Maps (cemetery.ts)

```ts
// Avant
private readonly grassFields: GrassField[] = [];
private readonly vegetations: VegetationInstances[] = [];

// Après — keyed par companyId comme terrains
private readonly grassFields = new Map<string, GrassField>();
private readonly vegetations = new Map<string, VegetationInstances>();
```

Impact en cascade (4 sites) :
- `loadCemetery` : `.push(field)` → `.set(slot.id, field)`
- `clearWorld` : `for (const f of this.grassFields)` → `for (const f of this.grassFields.values())`
- `loop` LOD : `for (const field of this.grassFields)` → `.values()`
- `clearWorld` vegetation : idem

### 2. Ajouter `unloadCemetery(slotId)` (cemetery.ts)

```ts
private unloadCemetery(slotId: string) {
  const terrain = this.terrains.get(slotId);
  if (terrain) {
    this.groundPlanesGroup.remove(terrain.mesh);
    terrain.dispose();
    this.terrains.delete(slotId);
  }
  const field = this.grassFields.get(slotId);
  if (field) {
    this.grassGroup.remove(field.mesh);
    field.dispose();
    this.grassFields.delete(slotId);
  }
  const veg = this.vegetations.get(slotId);
  if (veg) {
    for (const m of veg.meshes) this.vegetationGroup.remove(m);
    veg.dispose();
    this.vegetations.delete(slotId);
  }
  this.removeCemeteryGraves(slotId);
  this.loaded.delete(slotId);
  this.requested.delete(slotId); // ← permet le rechargement au retour
}
```

### 3. Appeler `unloadCemetery` dans `updateStreaming` (cemetery.ts)

```ts
const UNLOAD_RADIUS = 100; // m depuis le centre — bien au-delà du brouillard visible

// Dans la boucle for (const slot of this.slots) :
if (d > UNLOAD_RADIUS && this.loaded.has(slot.id)) {
  this.unloadCemetery(slot.id);
}
```

---

## Fichiers touchés

- `web/src/cemetery.ts` uniquement (~25 lignes modifiées/ajoutées)

---

## État

```
Déchargement cimetières éloignés   [x] terminé
```
