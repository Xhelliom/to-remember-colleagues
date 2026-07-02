// Sol multi-texture des cimetières : splat map RGBA + 3 textures PBR Poly Haven.
// L'herbe en touffes est gérée par grassField.ts (InstancedMesh GPU).
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js";
import type { SeasonKey } from "../ambiance.ts";
import { distanceToPath, hashSeed, type PathSegment } from "../procedural.ts";

const TILE_SIZE_M = 1.5;
const GROUND_HEIGHT = 0.01; // décollement minimal pour éviter le z-fighting
const SPLAT_RES = 64;
const TEX_ANISOTROPY = 8; // netteté en vue rasante (permanente en 1ère personne)
export const PATH_HALF_WIDTH = 1.1; // m — sous GRAVE_SPACING (2.4), ne mange pas les tombes
const PATH_FADE = 0.6; // m — largeur du dégradé terre → herbe en bord de chemin

// Cache GLTF partagé avec grassField.ts (touffes d'herbe). Les modèles décimés
// (tools/optimize-models.sh, web/public/models/opt/) sont compressés meshopt.
const gltfLoader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
const gltfCache = new Map<string, Promise<THREE.Group>>();

export function loadGltf(path: string): Promise<THREE.Group> {
  let p = gltfCache.get(path);
  if (!p) {
    p = new Promise<THREE.Group>((resolve, reject) =>
      gltfLoader.load(path, (gltf) => resolve(gltf.scene), undefined, reject),
    );
    gltfCache.set(path, p);
  }
  return p;
}

// TextureLoader avec cache simple pour les JPG de sol.
const texLoader = new THREE.TextureLoader();
const texCache = new Map<string, THREE.Texture>();

function loadTex(path: string): THREE.Texture {
  let t = texCache.get(path);
  if (!t) {
    t = texLoader.load(path);
    t.anisotropy = TEX_ANISOTROPY;
    texCache.set(path, t);
  }
  return t;
}

/** Texture couleur (diffuse) : décodage sRGB, sinon les JPG Poly Haven rendent délavés. */
function loadDiffuseTex(path: string): THREE.Texture {
  const t = loadTex(path);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/**
 * Carte de mélange RGBA 64×64 générée en CPU, propre à CE chunk (dépend de sa
 * portée locale zStart/zEnd/reach, pour y peindre le chemin réel).
 * R = forest_ground (centre), G = rocky_trail (bords + chemin), B = neige (hiver).
 */
function makeSplatTex(
  karma: number,
  seasonKey: SeasonKey,
  pathSegments: PathSegment[],
  reach: number,
  zStart: number,
  zEnd: number,
): THREE.DataTexture {
  const data = new Uint8Array(SPLAT_RES * SPLAT_RES * 4);
  const snow = seasonKey === "winter" ? 255 : 0;
  // ponytail: bande rocheuse plus large si karma très négatif (paysage désolé)
  const borderFrac = karma < -5 ? 0.45 : 0.28;
  const depth = zEnd - zStart;

  for (let iz = 0; iz < SPLAT_RES; iz++) {
    for (let ix = 0; ix < SPLAT_RES; ix++) {
      const u = ix / (SPLAT_RES - 1);
      const v = iz / (SPLAT_RES - 1);
      const fx = u * 2 - 1; // [-1, 1]
      const fz = v * 2 - 1;
      const dist = Math.max(Math.abs(fx), Math.abs(fz)); // distance Chebyshev
      const tEdge = Math.max(0, Math.min(1, (dist - (1 - borderFrac)) / borderFrac));
      const gEdge = tEdge * tEdge * (3 - 2 * tEdge); // smoothstep → courbe en S, pas de bord dur

      // Repère local du cimetière pour ce texel (cf. dérivation UV↔local dans terrain.ts :
      // V=0 correspond à zEnd, V=1 à zStart — le sol tourne de -90° autour de X).
      const localX = (u - 0.5) * 2 * reach;
      const localZ = zStart + (1 - v) * depth;
      const dPath = distanceToPath(pathSegments, localX, localZ);
      const tPath = Math.max(0, Math.min(1, (PATH_HALF_WIDTH - dPath) / PATH_FADE));
      const gPath = tPath * tPath * (3 - 2 * tPath);

      const g = Math.max(gEdge, gPath);
      const r = 1 - g;
      const i = (iz * SPLAT_RES + ix) * 4;
      data[i]     = Math.round(r * 255); // R = herbe
      data[i + 1] = Math.round(g * 255); // G = rocher / chemin
      data[i + 2] = snow;                // B = neige
      data[i + 3] = 255;
    }
  }

  const tex = new THREE.DataTexture(data, SPLAT_RES, SPLAT_RES, THREE.RGBAFormat);
  // DataTexture utilise NearestFilter par défaut → transitions en créneaux ; LinearFilter lisse.
  tex.minFilter = tex.magFilter = THREE.LinearFilter;
  tex.needsUpdate = true;
  return tex;
}

/**
 * Matériau de sol avec mélange de 3 textures PBR via splat map.
 * Textures : forest_ground (herbe/centre) · rocky_trail (bords) · snow (hiver).
 * Les normales ne sont pas blendées (forest_ground uniquement) — ponytail.
 * La splatTex est stockée dans mat.userData.splatTex pour le dispose (cemetery.ts).
 */
export function buildGroundMaterial(
  companyId: string,
  karma: number,
  seasonKey: SeasonKey,
  plotHalf: number,
  pathSegments: PathSegment[],
  zStart: number,
  zEnd: number,
): THREE.MeshStandardMaterial {
  const repeat = Math.ceil((plotHalf * 2) / TILE_SIZE_M);
  const sv = (hashSeed(companyId) % 3) + 1; // variante neige déterministe par cimetière

  // Clone avant de tuiler : `repeat` varie selon la portée du chunk (`plotHalf`), donc
  // ne JAMAIS muter l'instance en cache — partagée par tous les chunks/cimetières, une
  // mutation ici décalerait le tiling des autres, et sa dispose (clearWorld) invaliderait
  // le cache pour la prochaine entrée dans le monde.
  function tile(tex: THREE.Texture): THREE.Texture {
    const t = tex.clone();
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(repeat, repeat);
    return t;
  }

  const fg = "/textures/ground/forest_ground_04_2k/textures/forest_ground_04";
  const rt = "/textures/ground/rocky_trail_2k/textures/rocky_trail";
  const sn = `/textures/ground/snow_0${sv}_2k/textures/snow_0${sv}`;

  const diff0 = tile(loadDiffuseTex(`${fg}_diff_2k.jpg`));
  const nor0  = tile(loadTex(`${fg}_nor_gl_2k.jpg`));
  const diff1 = tile(loadDiffuseTex(`${rt}_diff_2k.jpg`));
  const diff2 = tile(loadDiffuseTex(`${sn}_diff_2k.jpg`));
  const splatTex = makeSplatTex(karma, seasonKey, pathSegments, plotHalf, zStart, zEnd);

  const mat = new THREE.MeshStandardMaterial({ map: diff0, normalMap: nor0, roughness: 0.9 });

  const uniforms = {
    uSplat: { value: splatTex },
    uDiff1: { value: diff1 },
    uDiff2: { value: diff2 },
  };

  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);

    // vUv n'est disponible dans r185 que si USE_UV est actif (pas garanti avec USE_MAP seul).
    // On passe l'UV brut [0,1] via un varying dédié pour la splat map (non tuilé).
    shader.vertexShader = [
      "varying vec2 vSplatUv;",
      shader.vertexShader,
    ].join("\n");
    shader.vertexShader = shader.vertexShader.replace(
      "#include <uv_vertex>",
      "#include <uv_vertex>\nvSplatUv = uv;",
    );

    shader.fragmentShader = [
      "varying vec2 vSplatUv;",
      "uniform sampler2D uSplat;",
      "uniform sampler2D uDiff1;",
      "uniform sampler2D uDiff2;",
      shader.fragmentShader,
    ].join("\n");
    shader.fragmentShader = shader.fragmentShader.replace(
      "#include <map_fragment>",
      `#ifdef USE_MAP
  vec4 splat = texture2D(uSplat, vSplatUv);
  vec4 tex0  = texture2D(map,    vMapUv);
  vec4 tex1  = texture2D(uDiff1, vMapUv);
  vec4 tex2  = texture2D(uDiff2, vMapUv);
  diffuseColor *= mix(mix(tex0, tex1, splat.g), tex2, splat.b);
#endif`,
    );
  };

  // Distingue les variantes de shader compilé selon les paramètres visuels
  mat.customProgramCacheKey = () => `splat_${karma < -5 ? "bad" : "ok"}_${seasonKey}`;
  // Référence pour dispose dans cemetery.ts (DataTexture non couverte par mat.dispose())
  mat.userData.splatTex = splatTex;

  return mat;
}
