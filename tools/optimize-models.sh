#!/usr/bin/env bash
# Décime + compresse les GLTF Poly Haven bruts (photogrammétrie, plusieurs
# millions de triangles) vers web/public/models/opt/ (glb, meshopt + WebP).
# Voir REVUE_3D_PERF_RENDU.md §2 "Pipeline d'assets". Source jamais modifiée ;
# seule la copie optimisée est référencée par le code (web/src/scene/*.ts).
#
# Usage : tools/optimize-models.sh (depuis la racine du repo)
set -euo pipefail

SRC=web/public/models
DST=web/public/models/opt
mkdir -p "$DST/tree" "$DST/rock" "$DST/bush" "$DST/grass"

# src ; dst ; simplify-ratio ; texture-size
MODELS=(
  "$SRC/tree/jacaranda_tree_1k/jacaranda_tree_1k.gltf;$DST/tree/jacaranda_tree_1k.glb;0.008;512"
  "$SRC/tree/island_tree_02_2k/island_tree_02_2k.gltf;$DST/tree/island_tree_02_2k.glb;0.02;512"
  "$SRC/tree/tree_small_02_4k/tree_small_02_4k.gltf;$DST/tree/tree_small_02_4k.glb;0.01;512"
  "$SRC/rock/rock_01_2k/rock_01_2k.gltf;$DST/rock/rock_01_2k.glb;0.025;512"
  "$SRC/Bush/didelta_spinosa_2k/didelta_spinosa_2k.gltf;$DST/bush/didelta_spinosa_2k.glb;0.02;512"
  "$SRC/Bush/othonna_cerarioides_2k/othonna_cerarioides_2k.gltf;$DST/bush/othonna_cerarioides_2k.glb;0.07;512"
  "$SRC/Bush/wild_rooibos_bush_1k/wild_rooibos_bush_1k.gltf;$DST/bush/wild_rooibos_bush_1k.glb;0.3;512"
  "$SRC/grass/grass_medium_01_2k/grass_medium_01_2k.gltf;$DST/grass/grass_medium_01_2k.glb;0.08;256"
  "$SRC/grass/grass_medium_02_2k/grass_medium_02_2k.gltf;$DST/grass/grass_medium_02_2k.glb;0.2;256"
)

for entry in "${MODELS[@]}"; do
  IFS=';' read -r src dst ratio texsize <<< "$entry"
  echo "── $src → $dst (ratio=$ratio, tex=${texsize}px)"
  pnpm exec gltf-transform optimize "$src" "$dst" \
    --simplify true --simplify-ratio "$ratio" --simplify-error 0.02 \
    --texture-compress webp --texture-size "$texsize" \
    --compress meshopt
done

echo "Terminé. Vérifier les tailles :"
du -sh "$DST"/**/*.glb
