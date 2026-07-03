# Mission 02 — Champ de vent partagé

```yaml
id: 02-vent
depends_on: []
blocks: [04-herbe-geo-shader, 08-arbres-grammaire]
parallel_with: [01-harness, 03-noise-bake]
owns:
  - web/src/scene/wind.ts
  - web/src/scene/wind.test.ts
reads: []
size: S
```

## Objectif
Un **seul** champ de vent, module pur + injection shader, consommé par l'herbe (04) ET les
arbres (08). Construit une fois, DRY.

## Référence LAAS
`render/Wind.ts` — hiérarchie fake-skeletal : lean ∝ force², sway autour du lean à
**fréquence propre par instance**, branches en retard (gust échantillonnée en aval),
micro-flutter apériodique.

## Spécification technique
1. `wind.ts` expose : un **uniform partagé** (`uTime`, direction, force) et des **snippets GLSL**
   à injecter via `onBeforeCompile` (helper `applyWind(mat, opts)`).
2. Modèle : direction uniforme + rafales (2 octaves de bruit advecté). `lean = f(force²)`.
   Sway = oscillateur à **fréquence constante dans le temps**, amplitude pilotée par la rafale.
3. **RÈGLE D'OR** (à tester) : jamais `time * f(time)`. La phase doit être `t * f_instance`
   avec `f_instance` constant → pas de dérive/jitter. Décorréler par instance (phase hash).
4. Paramétrable par pool (arbre rigide/souple, herbe cantilever tip²).

## Critères d'acceptation MESURABLES
### Unitaires (Vitest)
- [ ] `wind.test.ts` : `windLean(force)` monotone croissante, ∝ force² (ratio lean(2f)/lean(f) ≈ 4).
- [ ] **amplitude ≠ fréquence** : la fréquence de sway est indépendante de la force
      (`swayFreq(force_faible) === swayFreq(force_forte)` à instance égale).
- [ ] **pas de phase-explosion** : `phase(t)` linéaire en `t` (dérivée seconde numérique ≈ 0
      sur un large `t`, ex. t=10000 s).
- [ ] décorrélation : deux instances (seeds différents) ont des phases distinctes à t fixe.
- [ ] `offset(t=0)` = repos (0) pour force nulle.
### e2e (Playwright)
- [ ] Pas d'e2e propre (module sans rendu). Le mouvement visuel est validé par la mission **04**
      (spec grass : diff non nul entre deux frames dans la zone herbe, borné = pas de jitter fou).
### Definition of done
- Gate commun vert ; `applyWind` documenté ; API stable pour 04 et 08.

## Contraintes
Déterminisme (phase dérivée de la graine d'instance). Pas de magic number (const nommées :
`GUST_PERIOD`, `SWAY_FREQ_MIN/MAX`…). Français.
