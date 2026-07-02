# Mission 14 — Post/ambiance : auto-exposure, grade par heure, brume, bookmarks + flythrough

```yaml
id: 14-post-ambiance-bookmarks
depends_on: [10-arbres-lod-impostors]
blocks: []
parallel_with: [12-depth-prepass, 13-ombres]
owns:
  - web/src/scene/post/autoExposure.ts
  - web/src/scene/post/grade.ts
  - web/src/scene/post/groundFog.ts
  - web/src/scene/bookmarks.ts
  - web/src/scene/bookmarks.test.ts
  - e2e/ambiance.spec.ts
reads:
  - web/src/main.ts
  - web/src/ambiance.ts
size: M
```

## Objectif
La garniture qui vend l'ambiance de cimetière : exposition auto, grade filmique par heure, brume
au sol, + **bookmarks/flythrough** à double usage (QA **et** visite guidée mémorielle).

## Référence LAAS
GPU auto-exposure · per-ToD filmic grade (split teal/orange) · froxel valley fog (→ ici : brume
au sol **fake** en post, WebGL) · `?shot=1..9` bookmarks + tour 90 s Catmull-Rom · `?preset=`.

## Spécification technique
1. `autoExposure.ts` : luminance moyenne (downsample → 1×1) + adaptation temporelle → exposition ;
   s'insère dans l'`EffectComposer` existant (`main.ts`).
2. `grade.ts` : LUT/courbe de grade **couplée à l'heure** via `ambiance.ts` (split teal/orange golden).
3. `groundFog.ts` : brume de hauteur analytique en fragment (PAS de froxels) — sélective, sans « fog-as-cover ».
4. `bookmarks.ts` : poses nommées (`?shot=N`) + flythrough Catmull-Rom (feature « visite guidée »).

## Critères d'acceptation MESURABLES
### Unitaires (Vitest)
- [ ] `bookmarks.test.ts` : parsing/round-trip des poses `?shot=N` ; spline Catmull-Rom continue
      (positions successives à écart borné, pas de saut).
- [ ] auto-exposure : mapping luminance→exposition **monotone** ; grade dawn ≠ noon (courbes distinctes).
### e2e (Playwright)
- [ ] `ambiance.spec.ts` : `?shot=1..9` rendent chacun **déterministement** (deux runs identiques).
- [ ] flythrough : lance sans erreur console pendant T s ; **grade** — décalage colorimétrique
      mesurable entre `?T=6` (aube) et `?T=12` (midi).
- [ ] **perf** : `assertPerf({ minFps: 55 })` avec post activé.
### Definition of done
- Gate commun vert ; aube/midi/coucher lisibles ; visite guidée jouable ; budget tenu.

## Contraintes
Réutiliser l'`EffectComposer` déjà présent (pas de dépendance nouvelle). `dispose()` des RT.
Const nommées. Français.
