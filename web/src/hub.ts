// Arche d'entrée d'un cimetière (issue #5) : portique de pierre + enseigne
// gravée (nom / karma / statut). Posée le long de l'allée par world.ts, elle
// marque l'entrée — on y pénètre « à vue », sans interaction.
import * as THREE from "three";
import type { Company } from "./types.ts";

/** Enseigne d'entrée : nom de l'organisation, jauge de karma, statut. */
function makeSignTexture(company: Company): THREE.CanvasTexture {
  const w = 512;
  const h = 256;
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d")!;

  // Plaque sombre gravée.
  ctx.fillStyle = "#1c1a22";
  ctx.fillRect(0, 0, w, h);
  ctx.strokeStyle = "rgba(210,200,170,0.55)";
  ctx.lineWidth = 6;
  ctx.strokeRect(12, 12, w - 24, h - 24);

  // Nom (sur deux lignes si besoin).
  ctx.fillStyle = "#ece3c8";
  ctx.textAlign = "center";
  ctx.font = "700 44px 'Cinzel', Georgia, serif";
  const words = company.name.split(" ");
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    const test = line ? `${line} ${word}` : word;
    if (ctx.measureText(test).width > w - 60 && line) {
      lines.push(line);
      line = word;
    } else line = test;
  }
  if (line) lines.push(line);
  let y = lines.length > 1 ? 74 : 92;
  for (const l of lines.slice(0, 2)) {
    ctx.fillText(l, w / 2, y);
    y += 50;
  }

  // Statut.
  ctx.font = "italic 26px 'EB Garamond', Georgia, serif";
  ctx.fillStyle = "#b9b3a0";
  ctx.fillText(`${company.status} · ${company.graveCount} tombe${company.graveCount > 1 ? "s" : ""}`, w / 2, 168);

  // Jauge de karma : barre centrée, verte si positif, rouge si négatif.
  const karma = company.karma;
  const norm = Math.max(-1, Math.min(1, karma / 30));
  const barW = 200;
  const cx = w / 2;
  const by = 200;
  ctx.fillStyle = "rgba(255,255,255,0.12)";
  ctx.fillRect(cx - barW / 2, by, barW, 16);
  ctx.fillStyle = norm >= 0 ? "#7bd88f" : "#e0727a";
  const fill = (barW / 2) * Math.abs(norm);
  if (norm >= 0) ctx.fillRect(cx, by, fill, 16);
  else ctx.fillRect(cx - fill, by, fill, 16);
  ctx.fillStyle = "#ece3c8";
  ctx.font = "600 22px 'Cinzel', Georgia, serif";
  ctx.fillText(`Karma ${karma >= 0 ? "+" : ""}${karma}`, cx, by + 44);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

/**
 * Arche d'entrée d'un cimetière, à poser à `entrance` (le caller règle la
 * position) et orientée `rotY` pour faire face à la route.
 */
export function buildEntranceArch(company: Company, rotY: number): THREE.Group {
  const g = new THREE.Group();
  g.rotation.y = rotY;

  const stoneMat = new THREE.MeshStandardMaterial({ color: 0x4a4640, roughness: 0.85, metalness: 0.05 });
  const pillarGeo = new THREE.CylinderGeometry(0.32, 0.4, 3.4, 8);
  for (const px of [-1.6, 1.6]) {
    const pillar = new THREE.Mesh(pillarGeo, stoneMat);
    pillar.position.set(px, 1.7, 0);
    pillar.castShadow = true;
    g.add(pillar);
  }
  const lintel = new THREE.Mesh(new THREE.BoxGeometry(4, 0.5, 0.6), stoneMat);
  lintel.position.set(0, 3.5, 0);
  lintel.castShadow = true;
  g.add(lintel);

  // Enseigne (lisible de nuit : matériau non éclairé), face à la route.
  const signMat = new THREE.MeshBasicMaterial({ map: makeSignTexture(company), transparent: false });
  const sign = new THREE.Mesh(new THREE.PlaneGeometry(3.4, 1.7), signMat);
  sign.position.set(0, 2.6, 0.32);
  g.add(sign);

  return g;
}
