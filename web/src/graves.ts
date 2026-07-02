import * as THREE from "three";
import type { Colleague, OfferingCounts } from "./types.ts";
import type { GraveAxes } from "./graveAxes.ts";

/** Générateur pseudo-aléatoire déterministe (mulberry32) à partir d'une graine. */
export function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Marque une géométrie/un matériau comme mutualisé : `disposeObject` (scene/disposeObject.ts)
 *  ne le libère jamais, puisqu'il est référencé par de nombreuses tombes à la fois. */
function shared<T extends THREE.BufferGeometry | THREE.Material>(x: T): T {
  x.userData.shared = true;
  return x;
}

/**
 * Texture gravée (nom du collègue) appliquée sur l'avant de la pierre.
 * `wear` (axe 1, vieillissement) estompe la gravure ; `haunt` (axe 2, votes
 * négatifs) assombrit l'encre vers un ton sépulcral.
 */
function makeNameTexture(name: string, stoneHex: number, wear: number, haunt: number, rand: () => number): THREE.CanvasTexture {
  // Plus la tombe est vieille, plus la gravure est usée (moins contrastée).
  const ink = (base: number) => Math.max(0.12, base * (1 - 0.7 * wear));
  const w = 256;
  const h = 320;
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d")!;
  const stone = new THREE.Color(stoneHex);

  // Fond pierre.
  ctx.fillStyle = `#${stone.getHexString()}`;
  ctx.fillRect(0, 0, w, h);

  // Grain léger (déterministe : graine du collègue, pas Math.random).
  for (let i = 0; i < 1600; i++) {
    const x = rand() * w;
    const y = rand() * h;
    const shade = rand() * 0.18 - 0.09;
    ctx.fillStyle = `rgba(0,0,0,${Math.max(0, shade)})`;
    ctx.fillRect(x, y, 1.5, 1.5);
  }

  // Cartouche / liseré.
  ctx.strokeStyle = `rgba(0,0,0,${ink(0.35)})`;
  ctx.lineWidth = 4;
  ctx.strokeRect(18, 22, w - 36, h - 44);

  // Croix gravée discrète en haut.
  ctx.strokeStyle = `rgba(0,0,0,${ink(0.3)})`;
  ctx.lineWidth = 5;
  ctx.beginPath();
  ctx.moveTo(w / 2, 44);
  ctx.lineTo(w / 2, 92);
  ctx.moveTo(w / 2 - 18, 60);
  ctx.lineTo(w / 2 + 18, 60);
  ctx.stroke();

  // « Ci-gît » + nom, gravés en creux. Encre plus sombre/violacée si hanté.
  const inkRGB = haunt > 0.3 ? `14,6,18` : `28,25,23`;
  ctx.textAlign = "center";
  ctx.fillStyle = `rgba(${inkRGB},${ink(0.8)})`;
  ctx.font = "italic 22px 'EB Garamond', Georgia, serif";
  ctx.fillText("Ci-gît", w / 2, 132);

  ctx.fillStyle = `rgba(${inkRGB},${ink(0.92)})`;
  const words = name.split(" ");
  const lines: string[] = [];
  let line = "";
  ctx.font = "600 30px 'Cinzel', Georgia, serif";
  for (const word of words) {
    const test = line ? `${line} ${word}` : word;
    if (ctx.measureText(test).width > w - 60 && line) {
      lines.push(line);
      line = word;
    } else {
      line = test;
    }
  }
  if (line) lines.push(line);
  let y = 180;
  for (const l of lines) {
    ctx.fillText(l, w / 2, y);
    y += 36;
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

// --- Géométries unitaires partagées (mise à l'échelle par mesh, cf. `shared`) ---
// Les dimensions qui varient par tombe (largeur/hauteur/taille d'accessoire)
// passent en `mesh.scale` plutôt que d'être recréées dans le constructeur :
// même rendu, une seule allocation GPU pour toutes les tombes du monde.

const TYPES = ["round", "rect", "cross"] as const;
const BASE_GEO = shared(new THREE.BoxGeometry(1.3, 0.25, 0.7)); // socle (dimensions fixes)
const CROSS_VERT_UNIT_GEO = shared(new THREE.BoxGeometry(0.26, 1, 0.18)); // hauteur : scale.y
const CROSS_HORIZ_UNIT_GEO = shared(new THREE.BoxGeometry(1, 0.26, 0.18)); // largeur : scale.x
const PLANE_UNIT_GEO = shared(new THREE.PlaneGeometry(1, 1)); // face/plaque gravée : scale.xy
function roundRectShape(rounded: boolean): THREE.Shape {
  // hw=0.5, height=1 : les courbes de Bézier sont affines-invariantes, donc
  // `mesh.scale.set(width, height, 1)` reproduit exactement la même silhouette
  // que si le profil avait été tracé directement à ces dimensions.
  const shape = new THREE.Shape();
  shape.moveTo(-0.5, 0);
  shape.lineTo(-0.5, 0.7);
  if (rounded) {
    shape.quadraticCurveTo(-0.5, 1, 0, 1);
    shape.quadraticCurveTo(0.5, 1, 0.5, 0.7);
  } else {
    shape.lineTo(-0.5, 1);
    shape.lineTo(0.5, 1);
  }
  shape.lineTo(0.5, 0);
  shape.lineTo(-0.5, 0);
  return shape;
}
const STELE_DEPTH = 0.18;
const ROUND_UNIT_GEO = shared(makeSteleGeo(roundRectShape(true)));
const RECT_UNIT_GEO = shared(makeSteleGeo(roundRectShape(false)));
function makeSteleGeo(shape: THREE.Shape): THREE.ExtrudeGeometry {
  const geo = new THREE.ExtrudeGeometry(shape, { depth: STELE_DEPTH, bevelEnabled: false });
  geo.translate(0, 0, -STELE_DEPTH / 2);
  return geo;
}

// Offrandes (issue #7) : géométrie/couleur fixes par accessoire, seule la
// taille varie (scale) ; palette de pétales bornée → matériaux partagés.
const STONE_OFFERING_UNIT_GEO = shared(new THREE.SphereGeometry(1, 5, 4));
const CANDLE_UNIT_GEO = shared(new THREE.CylinderGeometry(0.015, 0.015, 1, 5));
const FLAME_GEO = shared(new THREE.SphereGeometry(0.022, 4, 4)); // taille fixe : pas de scale
const OFFERING_STEM_UNIT_GEO = shared(new THREE.CylinderGeometry(0.01, 0.01, 1, 4));
const OFFERING_FLOWER_GEO = shared(new THREE.IcosahedronGeometry(0.045, 0)); // taille fixe

// Décor d'entretien (axe 3) : mêmes principes, dimensions propres à ce layer.
const MAINT_STEM_UNIT_GEO = shared(new THREE.CylinderGeometry(0.012, 0.012, 1, 4));
const MAINT_FLOWER_GEO = shared(new THREE.IcosahedronGeometry(0.05, 0)); // taille fixe
const WEED_UNIT_GEO = shared(new THREE.CylinderGeometry(0.005, 0.03, 1, 4));

// Tombe en construction (issue #21) : couleurs et formes fixes (pas d'axes).
const WOOD_COLOR = 0x8b6340;
const TARP_COLOR = 0x4a7a6b;
const CONSTRUCTION_STONE_COLOR = 0xb0a898;
const DIRT_COLOR = 0x6b4e2e;
const CONSTRUCTION_DIRT_GEO = shared(new THREE.BoxGeometry(1.1, 0.06, 0.7));
const CONSTRUCTION_BASE_GEO = shared(new THREE.BoxGeometry(1.3, 0.22, 0.7));
const CONSTRUCTION_STELE_UNIT_GEO = shared(new THREE.BoxGeometry(1, 1, 0.18)); // scale.xy
const CONSTRUCTION_POLE_UNIT_GEO = shared(new THREE.CylinderGeometry(0.025, 0.025, 1, 5)); // scale.y
const CONSTRUCTION_CROSSBAR_GEO = shared(new THREE.BoxGeometry(1.4, 0.04, 0.04));
const CONSTRUCTION_TARP_GEO = shared(new THREE.PlaneGeometry(1.5, 0.9));

// Matériaux à couleur fixe (palette bornée) : une seule instance au monde.
const STONE_OFFERING_COLOR = 0x8a8a8a;
const CANDLE_COLOR = 0xf5e6c8;
const FLAME_COLOR = 0xff7700;
const STEM_COLOR = 0x3f6b32; // tiges de fleurs — offrandes ET bouquet d'entretien
const WEED_COLOR = 0x5d6b32;
const PETAL_PALETTE = [0xe8556d, 0xf2c14e, 0xffffff, 0xc77dff, 0xff8fab];
const MAX_VISIBLE_OFFERINGS = 5;
const OFFERING_SEED_SALT = 0xdeadbeef;

const stoneOfferingMat = shared(new THREE.MeshStandardMaterial({ color: STONE_OFFERING_COLOR, roughness: 0.8 }));
const candleMat = shared(new THREE.MeshStandardMaterial({ color: CANDLE_COLOR, roughness: 0.6 }));
const flameMat = shared(new THREE.MeshStandardMaterial({ color: FLAME_COLOR, emissive: FLAME_COLOR, emissiveIntensity: 1.2, roughness: 0.1 }));
const stemMat = shared(new THREE.MeshStandardMaterial({ color: STEM_COLOR, roughness: 1 }));
const weedMat = shared(new THREE.MeshStandardMaterial({ color: WEED_COLOR, roughness: 1 }));
const petalMats = PETAL_PALETTE.map((hex) => shared(new THREE.MeshStandardMaterial({ color: hex, roughness: 0.7 })));

const constructionWoodMat = shared(new THREE.MeshStandardMaterial({ color: WOOD_COLOR, roughness: 0.9 }));
const constructionTarpMat = shared(new THREE.MeshStandardMaterial({ color: TARP_COLOR, roughness: 0.8, side: THREE.DoubleSide }));
const constructionStoneMat = shared(new THREE.MeshStandardMaterial({ color: CONSTRUCTION_STONE_COLOR, roughness: 0.95 }));
const constructionDirtMat = shared(new THREE.MeshStandardMaterial({ color: DIRT_COLOR, roughness: 1 }));

/**
 * Construit un chantier futur : stèle brute non gravée, terre fraîche,
 * échafaudage en bois et bâche (issue #21).
 */
function createConstructionGrave(colleague: Colleague, rand: () => number): THREE.Group {
  const group = new THREE.Group();

  // Terre fraîche (monticule plat).
  const dirt = new THREE.Mesh(CONSTRUCTION_DIRT_GEO, constructionDirtMat);
  dirt.position.y = 0.03;
  group.add(dirt);

  // Socle brut non taillé.
  const base = new THREE.Mesh(CONSTRUCTION_BASE_GEO, constructionStoneMat);
  base.position.y = 0.11;
  base.castShadow = true;
  group.add(base);

  // Stèle brute — aucun texte, juste la forme rectangulaire.
  const width = 0.9 + rand() * 0.2;
  const height = 1.1 + rand() * 0.5;
  const stele = new THREE.Mesh(CONSTRUCTION_STELE_UNIT_GEO, constructionStoneMat);
  stele.scale.set(width, height, 1);
  stele.position.y = 0.22 + height / 2;
  stele.castShadow = true;
  group.add(stele);

  // Poteaux d'échafaudage (4 coins).
  const poleH = height + 0.8;
  for (const [sx, sz] of [[-0.6, 0.25], [0.6, 0.25], [-0.6, -0.25], [0.6, -0.25]] as [number, number][]) {
    const pole = new THREE.Mesh(CONSTRUCTION_POLE_UNIT_GEO, constructionWoodMat);
    pole.scale.y = poleH;
    pole.position.set(sx, poleH / 2, sz);
    group.add(pole);
  }

  // Traverse horizontale.
  const crossbar = new THREE.Mesh(CONSTRUCTION_CROSSBAR_GEO, constructionWoodMat);
  crossbar.position.set(0, poleH - 0.1, 0);
  group.add(crossbar);

  // Bâche inclinée par-dessus la stèle.
  const tarp = new THREE.Mesh(CONSTRUCTION_TARP_GEO, constructionTarpMat);
  tarp.rotation.x = -0.25;
  tarp.position.set(0, poleH - 0.15, 0.1);
  group.add(tarp);

  // Panneau « En construction » sur la stèle (texte unique : matériau propre).
  const signCanvas = document.createElement("canvas");
  signCanvas.width = 256;
  signCanvas.height = 128;
  const ctx = signCanvas.getContext("2d")!;
  ctx.fillStyle = "#f5e6c8";
  ctx.fillRect(0, 0, 256, 128);
  ctx.strokeStyle = "#8b6340";
  ctx.lineWidth = 6;
  ctx.strokeRect(4, 4, 248, 120);
  ctx.fillStyle = "#3a2a14";
  ctx.font = "bold 22px 'Cinzel', serif";
  ctx.textAlign = "center";
  ctx.fillText("En construction", 128, 55);
  ctx.font = "italic 18px 'EB Garamond', serif";
  ctx.fillText(colleague.name, 128, 90);
  const signTex = new THREE.CanvasTexture(signCanvas);
  signTex.colorSpace = THREE.SRGBColorSpace;
  const sign = new THREE.Mesh(PLANE_UNIT_GEO, new THREE.MeshStandardMaterial({ map: signTex, roughness: 0.8 }));
  sign.scale.set(width * 0.85, height * 0.3, 1);
  sign.position.set(0, 0.22 + height * 0.35, 0.1);
  group.add(sign);

  group.rotation.y = (rand() - 0.5) * 0.2;
  group.userData.colleague = colleague;
  return group;
}

/**
 * Construit une tombe (socle + pierre gravée) pour un collègue.
 *
 * Trois axes INDÉPENDANTS (issue #25) se combinent sur la même pierre :
 *   - axe 1 `age`         → patine : pierre désaturée/assombrie, gravure usée,
 *                            affaissement (érosion). Irréversible.
 *   - axe 2 `vote`        → glissement chromatique chaud/doré (paradisiaque) ou
 *                            froid/violacé + émissif spectral (hanté).
 *   - axe 3 `maintenance` → décor : bouquet fleuri (soigné) ou herbes folles +
 *                            teinte mousse (négligé).
 * La forme et les variations restent déterministes (graveSeed).
 */
export function createGrave(colleague: Colleague, graveHex: number, axes: GraveAxes): THREE.Group {
  const rand = seededRandom(colleague.graveSeed);

  // Tombe en construction : rendu chantier différent (issue #21).
  if (axes.construction) return createConstructionGrave(colleague, rand);

  const group = new THREE.Group();

  const { age, vote, maintenance } = axes;
  const haunt = Math.max(0, -vote); // intensité hantée
  const bless = Math.max(0, vote); // intensité paradisiaque

  // --- Pipeline couleur : chaque axe applique son propre delta HSL ---
  const stoneColor = new THREE.Color(graveHex).offsetHSL(0, 0, (rand() - 0.5) * 0.08);
  // Axe 1 — vieillissement : désature et assombrit la pierre.
  stoneColor.offsetHSL(0, -0.28 * age, -0.16 * age);
  // Axe 2 — votes : décalage de teinte (chaud doré ↔ froid violacé).
  stoneColor.offsetHSL(0.09 * bless - 0.16 * haunt, 0.12 * bless, 0.05 * bless - 0.05 * haunt);
  // Axe 3 — entretien négligé : la pierre verdit légèrement (mousse).
  if (maintenance < 0.5) stoneColor.offsetHSL(0.18 * (0.5 - maintenance), 0.1 * (0.5 - maintenance), -0.06 * (0.5 - maintenance));

  // Axe 2 — émissif : halo doré (paradis) ou lueur spectrale froide (hanté).
  const emissive = new THREE.Color(0x000000);
  if (bless > 0) emissive.lerp(new THREE.Color(0xffcf6a), bless * 0.5);
  if (haunt > 0) emissive.lerp(new THREE.Color(0x4a2f6b), haunt * 0.45);

  // Couleur/texture propres à cette tombe : matériaux NON partagés (voir `shared`).
  const stoneMat = new THREE.MeshStandardMaterial({
    color: stoneColor,
    roughness: 0.9 + 0.08 * age, // axe 1 : pierre plus mate en vieillissant
    metalness: 0.02,
    emissive,
    emissiveIntensity: Math.max(bless * 0.6, haunt * 0.5),
  });
  const frontMat = new THREE.MeshStandardMaterial({
    map: makeNameTexture(colleague.name, stoneColor.getHex(), age, haunt, rand),
    roughness: 0.92,
    metalness: 0.02,
    emissive,
    emissiveIntensity: Math.max(bless * 0.4, haunt * 0.35),
  });

  // Socle.
  const base = new THREE.Mesh(BASE_GEO, stoneMat);
  base.position.y = 0.125;
  base.castShadow = true;
  base.receiveShadow = true;
  group.add(base);

  const type = TYPES[Math.floor(rand() * TYPES.length)];
  const width = 0.9 + rand() * 0.2;
  const height = 1.1 + rand() * 0.5;

  if (type === "cross") {
    const vert = new THREE.Mesh(CROSS_VERT_UNIT_GEO, stoneMat);
    vert.scale.y = height;
    vert.position.y = 0.25 + height / 2;
    const horiz = new THREE.Mesh(CROSS_HORIZ_UNIT_GEO, stoneMat);
    horiz.scale.x = width;
    horiz.position.y = 0.25 + height * 0.72;
    for (const m of [vert, horiz]) {
      m.castShadow = true;
      m.receiveShadow = true;
      group.add(m);
    }
    // Plaque gravée au pied de la croix.
    const plaque = new THREE.Mesh(PLANE_UNIT_GEO, frontMat);
    plaque.scale.set(width * 0.9, 0.55, 1);
    plaque.position.set(0, 0.55, STELE_DEPTH / 2 + 0.01);
    group.add(plaque);
  } else {
    const stone = new THREE.Mesh(type === "round" ? ROUND_UNIT_GEO : RECT_UNIT_GEO, stoneMat);
    stone.scale.set(width, height, 1);
    stone.position.y = 0.25;
    stone.castShadow = true;
    stone.receiveShadow = true;
    group.add(stone);

    const face = new THREE.Mesh(PLANE_UNIT_GEO, frontMat);
    face.scale.set(width * 0.92, height * 0.92, 1);
    face.position.set(0, 0.25 + height * 0.5, STELE_DEPTH / 2 + 0.011);
    group.add(face);
  }

  // Axe 1 — affaissement/érosion : l'inclinaison croît avec l'âge.
  const tiltAmp = 0.06 + 0.26 * age;
  group.rotation.z = (rand() - 0.5) * tiltAmp;
  group.rotation.x = (rand() - 0.5) * tiltAmp * 0.6;
  group.rotation.y = (rand() - 0.5) * 0.25;

  // Axe 3 — décor d'entretien, indépendant des deux autres axes.
  decorateMaintenance(group, maintenance, width, STELE_DEPTH, rand);

  // Offrandes déposées sur la tombe (issue #7).
  if (colleague.offeringCounts) {
    decorateOfferings(group, colleague.offeringCounts, colleague.graveSeed);
  }

  group.userData.colleague = colleague;
  return group;
}

/**
 * Dépose les offrandes (bougies, fleurs, cailloux) en arc devant la tombe (issue #7).
 * Graine indépendante de l'axe entretien pour ne pas interférer.
 */
function decorateOfferings(group: THREE.Group, counts: OfferingCounts, graveSeed: number): void {
  const rand = seededRandom(graveSeed ^ OFFERING_SEED_SALT);
  const z = 0.45; // devant le socle

  const n = (c: number) => Math.min(c, MAX_VISIBLE_OFFERINGS);
  const x = (i: number, total: number) => (total <= 1 ? 0 : -0.35 + (i / (total - 1)) * 0.7);

  // Cailloux : petits galets plats alignés.
  const stoneTotal = n(counts.stone);
  for (let i = 0; i < stoneTotal; i++) {
    const r = 0.04 + rand() * 0.025;
    const s = new THREE.Mesh(STONE_OFFERING_UNIT_GEO, stoneOfferingMat);
    s.scale.set(r, r * 0.45, r);
    s.position.set(x(i, stoneTotal), 0.02, z + rand() * 0.08);
    group.add(s);
  }

  // Bougies : cylindres blancs-crème avec flamme émissive.
  const candleTotal = n(counts.candle);
  for (let i = 0; i < candleTotal; i++) {
    const h = 0.12 + rand() * 0.06;
    const cx = x(i, candleTotal) + (rand() - 0.5) * 0.08;
    const cz = z + 0.12 + rand() * 0.08;
    const candle = new THREE.Mesh(CANDLE_UNIT_GEO, candleMat);
    candle.scale.y = h;
    candle.position.set(cx, h / 2, cz);
    group.add(candle);
    const flame = new THREE.Mesh(FLAME_GEO, flameMat);
    flame.position.set(cx, h + 0.02, cz);
    group.add(flame);
  }

  // Fleurs : petites icosphères colorées sur tiges fines.
  const flowerTotal = n(counts.flower);
  for (let i = 0; i < flowerTotal; i++) {
    const fh = 0.14 + rand() * 0.1;
    const fx = x(i, flowerTotal) + (rand() - 0.5) * 0.1;
    const fz = z + 0.22 + rand() * 0.1;
    const stem = new THREE.Mesh(OFFERING_STEM_UNIT_GEO, stemMat);
    stem.scale.y = fh;
    stem.position.set(fx, fh / 2, fz);
    group.add(stem);
    const flower = new THREE.Mesh(OFFERING_FLOWER_GEO, petalMats[Math.floor(rand() * petalMats.length)]);
    flower.position.set(fx, fh + 0.01, fz);
    group.add(flower);
  }
}

/**
 * Décor de l'axe 3 (entretien) déposé au pied de la tombe.
 * `maintenance` élevé → bouquet fleuri ; bas → herbes folles.
 */
function decorateMaintenance(
  group: THREE.Group,
  maintenance: number,
  width: number,
  depth: number,
  rand: () => number,
): void {
  const z = depth / 2 + 0.18; // devant la pierre

  if (maintenance > 0.6) {
    // Bouquet : quelques fleurs vives sur tiges vertes.
    const n = 3 + Math.floor((maintenance - 0.6) / 0.1);
    for (let i = 0; i < n; i++) {
      const fx = (rand() - 0.5) * width * 0.7;
      const fh = 0.18 + rand() * 0.16;
      const stem = new THREE.Mesh(MAINT_STEM_UNIT_GEO, stemMat);
      stem.scale.y = fh;
      stem.position.set(fx, fh / 2, z + (rand() - 0.5) * 0.12);
      group.add(stem);
      const flower = new THREE.Mesh(MAINT_FLOWER_GEO, petalMats[Math.floor(rand() * petalMats.length)]);
      flower.position.set(stem.position.x, fh, stem.position.z);
      group.add(flower);
    }
  } else if (maintenance < 0.4) {
    // Négligé : touffes d'herbes folles qui poussent autour du socle.
    const n = 3 + Math.floor((0.4 - maintenance) / 0.1);
    for (let i = 0; i < n; i++) {
      const wh = 0.22 + rand() * 0.3;
      const weed = new THREE.Mesh(WEED_UNIT_GEO, weedMat);
      weed.scale.y = wh;
      const angle = rand() * Math.PI * 2;
      const dist = width * 0.4 + rand() * 0.25;
      weed.position.set(Math.cos(angle) * dist, wh / 2, Math.sin(angle) * dist);
      weed.rotation.z = (rand() - 0.5) * 0.5;
      group.add(weed);
    }
  }
}
