import * as THREE from "three";
import type { Colleague } from "./types.ts";

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

/** Texture gravée (nom du collègue) appliquée sur l'avant de la pierre. */
function makeNameTexture(name: string, stoneHex: number, scary: boolean): THREE.CanvasTexture {
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
  ctx.strokeStyle = "rgba(0,0,0,0.35)";
  ctx.lineWidth = 4;
  ctx.strokeRect(18, 22, w - 36, h - 44);

  // Croix gravée discrète en haut.
  ctx.strokeStyle = "rgba(0,0,0,0.3)";
  ctx.lineWidth = 5;
  ctx.beginPath();
  ctx.moveTo(w / 2, 44);
  ctx.lineTo(w / 2, 92);
  ctx.moveTo(w / 2 - 18, 60);
  ctx.lineTo(w / 2 + 18, 60);
  ctx.stroke();

  // « Ci-gît » + nom, gravés en creux.
  ctx.textAlign = "center";
  ctx.fillStyle = scary ? "rgba(20,8,24,0.85)" : "rgba(30,28,26,0.8)";
  ctx.font = "italic 22px 'EB Garamond', Georgia, serif";
  ctx.fillText("Ci-gît", w / 2, 132);

  ctx.fillStyle = scary ? "rgba(10,4,14,0.92)" : "rgba(25,22,20,0.92)";
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
 * La forme et les petites variations sont déterministes (graveSeed).
 */
export function createGrave(colleague: Colleague, graveHex: number, scary: boolean): THREE.Group {
  const rand = seededRandom(colleague.graveSeed);
  const group = new THREE.Group();

  const stoneColor = new THREE.Color(graveHex).offsetHSL(0, 0, (rand() - 0.5) * 0.08);
  const stoneMat = new THREE.MeshStandardMaterial({
    color: stoneColor,
    roughness: 0.9,
    metalness: 0.02,
  });
  const frontMat = new THREE.MeshStandardMaterial({
    map: makeNameTexture(colleague.name, stoneColor.getHex(), scary),
    roughness: 0.92,
    metalness: 0.02,
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

  // Légère inclinaison/affaissement — plus marquée en mode effrayant.
  const tilt = (rand() - 0.5) * (scary ? 0.22 : 0.08);
  group.rotation.z = tilt;
  group.rotation.x = (rand() - 0.5) * (scary ? 0.12 : 0.04);
  group.rotation.y = (rand() - 0.5) * 0.25;

  group.userData.colleague = colleague;
  return group;
}
