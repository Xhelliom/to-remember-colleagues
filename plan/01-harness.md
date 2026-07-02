# Mission 01 — Harness de vérification & budgets perf

```yaml
id: 01-harness
depends_on: []
blocks: [04-herbe-geo-shader, 06-pierre-tombes, 08-arbres-grammaire, 13-ombres]
parallel_with: [02-vent, 03-noise-bake]
owns:
  - tools/shot.ts
  - tools/compare.ts
  - e2e/helpers/harness.ts
  - e2e/harness.spec.ts
reads:
  - web/src/main.ts
  - web/src/cemetery.ts
size: S
```

## Objectif
Fournir à toutes les missions suivantes un moyen **déterministe** de prendre un screenshot,
le **diffuser vs référence**, et **asserter un budget perf** — sans quoi le rework vole à l'aveugle.

## Référence LAAS
`tools/shoot.ts`, `tools/compare.ts`, `?cam=`/`?seed=`/`?shot=`, HUD per-pass. Règle
« pas d'ombre noire » (Pillar B) par échantillonnage pixel.

## Spécification technique
1. Exposer sur `window` (dev/e2e uniquement) : `__perf` = `{ drawCalls, triangles, programs, fps }`
   dérivé de `renderer.info.render` + delta `performance.now` glissant (moyenne 30 frames) ;
   `__ready` = promesse résolue après N frames stables.
2. Câbler les paramètres d'URL dans `main.ts`/`cemetery.ts` : `?cam`, `?seed`, `?T`, `?preset`
   (défaut = comportement actuel ; `?preset=low` = filet retombant sur l'ancien chemin GLTF).
3. `tools/shot.ts` : lance Playwright headless, navigue avec les params, attend `__ready`, écrit le PNG.
4. `tools/compare.ts` : diff pixel + SSIM entre deux PNG, sortie image de diff, exit ≠ 0 si > seuil.
5. `e2e/helpers/harness.ts` : `shotAndDiff(cam, seed, baseline, seuil)`, `assertPerf({maxDrawCalls, minFps})`,
   `sampleShadowChroma(px[])` (règle anti-ombre-noire). `e2e/baselines/` versionné.

## Critères d'acceptation MESURABLES
### Unitaires (Vitest)
- [ ] `tools/compare.test.ts` : diff(img, img) = 0 ; diff(img, img_bruitée) > seuil ; SSIM ∈ [0,1].
- [ ] parsing `?cam=` : chaîne → pose, round-trip `poseToString(parse(s)) === s`.
### e2e (Playwright)
- [ ] `harness.spec.ts` : boot `?cam=…&seed=1&T=12` ; **deux runs → PNG identiques** (déterminisme).
- [ ] `window.__perf` expose `drawCalls`, `triangles`, `fps` (valeurs > 0).
- [ ] `assertPerf` échoue correctement quand on baisse artificiellement le seuil (test négatif).
### Definition of done
- Gate commun vert. `tools/shot.ts` + `tools/compare.ts` documentés dans `plan/README.md` (déjà décrit).

## Contraintes
Hooks `window.*` gardés derrière un flag dev (jamais en prod). Pas de dépendance nouvelle
(Playwright déjà présent). Français.
