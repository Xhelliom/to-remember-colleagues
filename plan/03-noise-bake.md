# Mission 03 — Bruit baké en textures (util perf partagé)

```yaml
id: 03-noise-bake
depends_on: []
blocks: [06-pierre-tombes, 08-arbres-grammaire]
parallel_with: [01-harness, 02-vent]
owns:
  - web/src/scene/noiseBake.ts
  - web/src/scene/noiseBake.test.ts
reads: []
size: S
```

## Objectif
Précalculer bruit (value/fbm/ridged/worley) **et canaux gradient** dans des textures, pour que
les matériaux procéduraux (pierre 06, écorce 08, dressing 07, sol) fassent des **fetches** au
lieu d'évaluer du bruit live par pixel.

## Référence LAAS
`gpu/passes/NoiseBake.ts` : ~35 évals de bruit/px ≈ **52 ms/frame** → 2 textures. Canaux
gradient pré-dérivés = 1 fetch au lieu de 4 différences finies. `MirroredRepeatWrapping`.

## Spécification technique
1. `noiseBake.ts` : génère des `DataTexture` tuilables — canaux : value noise, fbm 3-oct,
   d(fbm)/dx, d(fbm)/dz, ridged, d(ridged)/dx/dz, worley F1 (cf. mapping LAAS).
2. Génération **CPU déterministe** (pas de compute WebGPU) à partir des bruits existants
   (`procedural.ts`/`seededRandom`) — c'est un préprocess au boot, pas par frame.
3. `MirroredRepeatWrapping` + filtrage linéaire → seamless sans réseau périodique visible.
4. Helper GLSL d'échantillonnage (`sampleBakedFbm(uv)`, `sampleBakedGradient(uv)`) pour injection.

## Critères d'acceptation MESURABLES
### Unitaires (Vitest)
- [ ] `noiseBake.test.ts` : la texture bakée échantillonnée ≈ le bruit direct sur N points
      (erreur < tolérance).
- [ ] canaux gradient ≈ différences finies du canal fbm (erreur < tolérance).
- [ ] déterminisme : même graine → mêmes octets de texture.
- [ ] tuilable : continuité aux bords sous `MirroredRepeat` (valeur(bord) ≈ valeur(bord miroir)).
### e2e (Playwright)
- [ ] Micro-bench optionnel via la mission **06** (pierre) : matériau baké vs live → **même image**
      (diff < petit seuil) mais `__perf.fps` ≥ live (gain mesurable). Reporté à 06 si besoin.
### Definition of done
- Gate commun vert ; util consommé par 06 (et prêt pour 07/08).

## Contraintes
Préprocess au boot uniquement. `dispose()` des textures si régénérées. Const nommées pour les
`PERIOD_*`. Français.
