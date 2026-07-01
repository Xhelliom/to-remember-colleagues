// Arche d'entrée d'un cimetière (issue #5) : portique de pierre + enseigne
// gravée (nom / karma / statut). Posée le long de l'allée par world.ts, elle
// marque l'entrée — on y pénètre « à vue », sans interaction.
import * as THREE from "three";
import type { Company } from "./types.ts";

/** Enseigne d'entrée : nom de l'organisation, jauge de karma, statut. */
function makeSignTexture(company: Company): THREE.CanvasTexture {
  const closed = company.status === "Fermé";
  const w = 512;
  const h = 256;
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d")!;

  // Plaque sombre gravée (rouge sombre si fermé).
  ctx.fillStyle = closed ? "#1f0c0c" : "#1c1a22";
  ctx.fillRect(0, 0, w, h);
  ctx.strokeStyle = closed ? "rgba(200,80,60,0.7)" : "rgba(210,200,170,0.55)";
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

  // Statut (« FERMÉ » mis en valeur pour les cimetières fermés).
  ctx.font = closed ? "700 28px 'Cinzel', Georgia, serif" : "italic 26px 'EB Garamond', Georgia, serif";
  ctx.fillStyle = closed ? "#e06050" : "#b9b3a0";
  ctx.fillText(
    closed
      ? `⛔ FERMÉ · ${company.graveCount} tombe${company.graveCount > 1 ? "s" : ""}`
      : `${company.status} · ${company.graveCount} tombe${company.graveCount > 1 ? "s" : ""}`,
    w / 2,
    168,
  );

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
  const closed = company.status === "Fermé";
  const g = new THREE.Group();
  g.rotation.y = rotY;

  const stoneColor = closed ? 0x3a2f2f : 0x4a4640;
  const stoneMat = new THREE.MeshStandardMaterial({ color: stoneColor, roughness: 0.9, metalness: 0.05 });
  const pillarGeo = new THREE.CylinderGeometry(0.32, 0.4, 3.4, 8);

  // Pilier gauche : légèrement incliné si fermé (barrière cassée).
  const leftPillar = new THREE.Mesh(pillarGeo, stoneMat);
  leftPillar.position.set(-1.6, closed ? 1.5 : 1.7, 0);
  if (closed) leftPillar.rotation.z = 0.18;
  leftPillar.castShadow = true;
  g.add(leftPillar);

  // Pilier droit : normal.
  const rightPillar = new THREE.Mesh(pillarGeo, stoneMat);
  rightPillar.position.set(1.6, 1.7, 0);
  rightPillar.castShadow = true;
  g.add(rightPillar);

  // Linteau : tombé si fermé (abaissé et incliné).
  const lintel = new THREE.Mesh(new THREE.BoxGeometry(4, 0.5, 0.6), stoneMat);
  lintel.position.set(closed ? -0.3 : 0, closed ? 2.4 : 3.5, 0);
  if (closed) lintel.rotation.z = -0.22;
  lintel.castShadow = true;
  g.add(lintel);

  // Fragment de débris au sol si fermé.
  if (closed) {
    const debris = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.35, 0.55), stoneMat);
    debris.position.set(-1.2, 0.18, 0.3);
    debris.rotation.set(0.1, 0.4, 0.15);
    debris.castShadow = true;
    g.add(debris);
  }

  // Enseigne (lisible de nuit : matériau non éclairé), face à la route.
  const signMat = new THREE.MeshBasicMaterial({ map: makeSignTexture(company), transparent: false });
  const sign = new THREE.Mesh(new THREE.PlaneGeometry(3.4, 1.7), signMat);
  sign.position.set(0, 2.6, 0.32);
  g.add(sign);

  return g;
}
