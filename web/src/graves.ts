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

/**
 * Texture gravée (nom du collègue) appliquée sur l'avant de la pierre.
 * `wear` (axe 1, vieillissement) estompe la gravure ; `haunt` (axe 2, votes
 * négatifs) assombrit l'encre vers un ton sépulcral.
 */
function makeNameTexture(name: string, stoneHex: number, wear: number, haunt: number): THREE.CanvasTexture {
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

  // Grain léger.
  for (let i = 0; i < 1600; i++) {
    const x = Math.random() * w;
    const y = Math.random() * h;
    const shade = Math.random() * 0.18 - 0.09;
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

const TYPES = ["round", "rect", "cross"] as const;

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

  const stoneMat = new THREE.MeshStandardMaterial({
    color: stoneColor,
    roughness: 0.9 + 0.08 * age, // axe 1 : pierre plus mate en vieillissant
    metalness: 0.02,
    emissive,
    emissiveIntensity: Math.max(bless * 0.6, haunt * 0.5),
  });
  const frontMat = new THREE.MeshStandardMaterial({
    map: makeNameTexture(colleague.name, stoneColor.getHex(), age, haunt),
    roughness: 0.92,
    metalness: 0.02,
    emissive,
    emissiveIntensity: Math.max(bless * 0.4, haunt * 0.35),
  });

  // Socle.
  const baseGeo = new THREE.BoxGeometry(1.3, 0.25, 0.7);
  const base = new THREE.Mesh(baseGeo, stoneMat);
  base.position.y = 0.125;
  base.castShadow = true;
  base.receiveShadow = true;
  group.add(base);

  const type = TYPES[Math.floor(rand() * TYPES.length)];
  const width = 0.9 + rand() * 0.2;
  const height = 1.1 + rand() * 0.5;
  const depth = 0.18;

  if (type === "cross") {
    const vert = new THREE.Mesh(new THREE.BoxGeometry(0.26, height, depth), stoneMat);
    vert.position.y = 0.25 + height / 2;
    const horiz = new THREE.Mesh(new THREE.BoxGeometry(width, 0.26, depth), stoneMat);
    horiz.position.y = 0.25 + height * 0.72;
    for (const m of [vert, horiz]) {
      m.castShadow = true;
      m.receiveShadow = true;
      group.add(m);
    }
    // Plaque gravée au pied de la croix.
    const plaque = new THREE.Mesh(new THREE.PlaneGeometry(width * 0.9, 0.55), frontMat);
    plaque.position.set(0, 0.55, depth / 2 + 0.01);
    group.add(plaque);
  } else {
    const shape = new THREE.Shape();
    const hw = width / 2;
    shape.moveTo(-hw, 0);
    shape.lineTo(-hw, height * 0.7);
    if (type === "round") {
      shape.quadraticCurveTo(-hw, height, 0, height);
      shape.quadraticCurveTo(hw, height, hw, height * 0.7);
    } else {
      shape.lineTo(-hw, height);
      shape.lineTo(hw, height);
    }
    shape.lineTo(hw, 0);
    shape.lineTo(-hw, 0);
    const geo = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false });
    geo.translate(0, 0, -depth / 2);
    const stone = new THREE.Mesh(geo, stoneMat);
    stone.position.y = 0.25;
    stone.castShadow = true;
    stone.receiveShadow = true;
    group.add(stone);

    const face = new THREE.Mesh(new THREE.PlaneGeometry(width * 0.92, height * 0.92), frontMat);
    face.position.set(0, 0.25 + height * 0.5, depth / 2 + 0.011);
    group.add(face);
  }

  // Axe 1 — affaissement/érosion : l'inclinaison croît avec l'âge.
  const tiltAmp = 0.06 + 0.26 * age;
  group.rotation.z = (rand() - 0.5) * tiltAmp;
  group.rotation.x = (rand() - 0.5) * tiltAmp * 0.6;
  group.rotation.y = (rand() - 0.5) * 0.25;

  // Axe 3 — décor d'entretien, indépendant des deux autres axes.
  decorateMaintenance(group, maintenance, width, depth, rand);

  // Offrandes déposées sur la tombe (issue #7).
  if (colleague.offeringCounts) {
    decorateOfferings(group, colleague.offeringCounts, colleague.graveSeed);
  }

  group.userData.colleague = colleague;
  return group;
}

const CANDLE_COLOR = 0xf5e6c8;
const FLAME_COLOR = 0xff7700;
const STONE_OFFERING_COLOR = 0x8a8a8a;
const PETAL_PALETTE = [0xe8556d, 0xf2c14e, 0xffffff, 0xc77dff, 0xff8fab];
const MAX_VISIBLE_OFFERINGS = 5;
const OFFERING_SEED_SALT = 0xdeadbeef;

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
  const stoneMat = new THREE.MeshStandardMaterial({ color: STONE_OFFERING_COLOR, roughness: 0.8 });
  for (let i = 0; i < stoneTotal; i++) {
    const s = new THREE.Mesh(new THREE.SphereGeometry(0.04 + rand() * 0.025, 5, 4), stoneMat);
    s.scale.y = 0.45;
    s.position.set(x(i, stoneTotal), 0.02, z + rand() * 0.08);
    group.add(s);
  }

  // Bougies : cylindres blancs-crème avec flamme émissive.
  const candleTotal = n(counts.candle);
  const candleMat = new THREE.MeshStandardMaterial({ color: CANDLE_COLOR, roughness: 0.6 });
  const flameMat = new THREE.MeshStandardMaterial({ color: FLAME_COLOR, emissive: FLAME_COLOR, emissiveIntensity: 1.2, roughness: 0.1 });
  for (let i = 0; i < candleTotal; i++) {
    const h = 0.12 + rand() * 0.06;
    const cx = x(i, candleTotal) + (rand() - 0.5) * 0.08;
    const cz = z + 0.12 + rand() * 0.08;
    const candle = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, h, 5), candleMat);
    candle.position.set(cx, h / 2, cz);
    group.add(candle);
    const flame = new THREE.Mesh(new THREE.SphereGeometry(0.022, 4, 4), flameMat);
    flame.position.set(cx, h + 0.02, cz);
    group.add(flame);
  }

  // Fleurs : petites icosphères colorées sur tiges fines.
  const flowerTotal = n(counts.flower);
  const stemMat = new THREE.MeshStandardMaterial({ color: 0x3f6b32, roughness: 1 });
  for (let i = 0; i < flowerTotal; i++) {
    const fh = 0.14 + rand() * 0.1;
    const fx = x(i, flowerTotal) + (rand() - 0.5) * 0.1;
    const fz = z + 0.22 + rand() * 0.1;
    const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.01, 0.01, fh, 4), stemMat);
    stem.position.set(fx, fh / 2, fz);
    group.add(stem);
    const petalMat = new THREE.MeshStandardMaterial({
      color: PETAL_PALETTE[Math.floor(rand() * PETAL_PALETTE.length)],
      roughness: 0.7,
    });
    const flower = new THREE.Mesh(new THREE.IcosahedronGeometry(0.045, 0), petalMat);
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
    const stemMat = new THREE.MeshStandardMaterial({ color: 0x3f6b32, roughness: 1 });
    const palette = [0xe8556d, 0xf2c14e, 0xffffff, 0xc77dff, 0xff8fab];
    const n = 3 + Math.floor((maintenance - 0.6) / 0.1);
    for (let i = 0; i < n; i++) {
      const fx = (rand() - 0.5) * width * 0.7;
      const fh = 0.18 + rand() * 0.16;
      const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, fh, 4), stemMat);
      stem.position.set(fx, fh / 2, z + (rand() - 0.5) * 0.12);
      group.add(stem);
      const petalMat = new THREE.MeshStandardMaterial({
        color: palette[Math.floor(rand() * palette.length)],
        roughness: 0.7,
        emissiveIntensity: 0,
      });
      const flower = new THREE.Mesh(new THREE.IcosahedronGeometry(0.05, 0), petalMat);
      flower.position.set(stem.position.x, fh, stem.position.z);
      group.add(flower);
    }
  } else if (maintenance < 0.4) {
    // Négligé : touffes d'herbes folles qui poussent autour du socle.
    const weedMat = new THREE.MeshStandardMaterial({ color: 0x5d6b32, roughness: 1 });
    const n = 3 + Math.floor((0.4 - maintenance) / 0.1);
    for (let i = 0; i < n; i++) {
      const wh = 0.22 + rand() * 0.3;
      const weed = new THREE.Mesh(new THREE.CylinderGeometry(0.005, 0.03, wh, 4), weedMat);
      const angle = rand() * Math.PI * 2;
      const dist = width * 0.4 + rand() * 0.25;
      weed.position.set(Math.cos(angle) * dist, wh / 2, Math.sin(angle) * dist);
      weed.rotation.z = (rand() - 0.5) * 0.5;
      group.add(weed);
    }
  }
}
