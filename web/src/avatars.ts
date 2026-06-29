// Avatars des autres visiteurs (issue #4) : fantômes translucides flottants
// avec étiquette de nom, et bulle d'emote temporaire.
import * as THREE from "three";

/** Petite étiquette texte affichée en sprite (nom du visiteur, emote…). */
function makeLabelSprite(text: string, opts: { size: number; bg?: string; color?: string }): THREE.Sprite {
  const pad = 12;
  const font = `${Math.round(opts.size * 0.6)}px 'Cinzel', Georgia, serif`;
  const measure = document.createElement("canvas").getContext("2d")!;
  measure.font = font;
  const w = Math.ceil(measure.measureText(text).width) + pad * 2;
  const h = opts.size + pad * 2;
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d")!;
  if (opts.bg) {
    ctx.fillStyle = opts.bg;
    ctx.beginPath();
    ctx.roundRect(0, 0, w, h, 12);
    ctx.fill();
  }
  ctx.font = font;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = opts.color ?? "#f2ecd8";
  ctx.fillText(text, w / 2, h / 2);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false }));
  sprite.scale.set((w / h) * 0.5, 0.5, 1);
  return sprite;
}

export type Avatar = {
  group: THREE.Group;
  emote: THREE.Sprite | null;
  emoteUntil: number;
};

/** Construit le fantôme d'un visiteur (corps translucide + nom flottant). */
export function makeAvatar(name: string): Avatar {
  const group = new THREE.Group();

  const bodyMat = new THREE.MeshBasicMaterial({
    color: 0xbcd0ff,
    transparent: true,
    opacity: 0.45,
    depthWrite: false,
  });
  // Corps : capsule (drapé fantomatique).
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.32, 0.9, 6, 12), bodyMat);
  body.position.y = 1.0;
  group.add(body);

  // Deux yeux sombres pour l'orientation (regard vers +Z local).
  const eyeMat = new THREE.MeshBasicMaterial({ color: 0x101018 });
  for (const ex of [-0.12, 0.12]) {
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.05, 8, 8), eyeMat);
    eye.position.set(ex, 1.35, 0.28);
    group.add(eye);
  }

  const label = makeLabelSprite(name, { size: 26, bg: "rgba(8,9,14,0.7)" });
  label.position.set(0, 2.05, 0);
  group.add(label);

  return { group, emote: null, emoteUntil: 0 };
}

const EMOTE_GLYPH: Record<string, string> = {
  wave: "👋",
  pray: "🙏",
  flower: "💐",
};

/** Affiche/renouvelle la bulle d'emote au-dessus d'un avatar (durée ~2,5 s). */
export function showEmote(avatar: Avatar, emote: string, now: number) {
  if (avatar.emote) {
    avatar.group.remove(avatar.emote);
    avatar.emote.material.map?.dispose();
    avatar.emote.material.dispose();
  }
  const glyph = EMOTE_GLYPH[emote] ?? "❔";
  const sprite = makeLabelSprite(glyph, { size: 48 });
  sprite.position.set(0, 2.6, 0);
  avatar.group.add(sprite);
  avatar.emote = sprite;
  avatar.emoteUntil = now + 2500;
}

/** Retire la bulle d'emote si son temps est écoulé. */
export function tickEmote(avatar: Avatar, now: number) {
  if (avatar.emote && now > avatar.emoteUntil) {
    avatar.group.remove(avatar.emote);
    avatar.emote.material.map?.dispose();
    avatar.emote.material.dispose();
    avatar.emote = null;
  }
}
