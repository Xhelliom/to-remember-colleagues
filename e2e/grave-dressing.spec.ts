import { test, expect, type Page } from "@playwright/test";
import { sampleShadowChroma } from "./helpers/harness.ts";
import { compare } from "../tools/compare.ts";
import { decodePng, type DecodedPng } from "./png.ts";

// Isole `buildGravestone` (web/src/graveStone.ts, mission 06 + habillage mission
// 07 via scene/dressing.ts) dans un canvas dédié, comme e2e/gravestone.spec.ts —
// SANS passer par main.ts/l'auth/la DB (câblage du placement en scène réelle
// différé, hors partition de cette mission). `THREE` est ré-exporté par
// graveStone.ts pour garantir la MÊME instance que celle utilisée en interne.
const VIEWPORT = { width: 320, height: 320 };
// Ratio de pixels différents mini entre une tombe entretenue et négligée —
// l'habillage (mousse/lichen/coulures) doit se voir, pas juste exister en données.
const DRESSING_DIFF_THRESHOLD = 0.02;
// Chroma mini dans l'ombre d'un « arbre » (occulteur) — règle anti-ombre-noire
// (Pillar B LAAS) : une ombre correctement éclairée par rebond (ambiant +
// hémisphère) garde un peu de couleur, jamais un noir/gris plat.
const SHADOW_CHROMA_THRESHOLD = 0.02;

type Axes = { age: number; vote: number; maintenance: number };

async function bootBlankPage(page: Page): Promise<void> {
  // "/" est la seule page HTML servie (SPA) : on ne dépend d'aucun de ses effets
  // de bord (auth/API), on ne fait qu'utiliser le dev server Vite pour résoudre nos ESM.
  await page.setViewportSize(VIEWPORT);
  await page.goto("/");
}

function dataUrlToDecodedPng(dataUrl: string): DecodedPng {
  return decodePng(new Uint8Array(Buffer.from(dataUrl.split(",")[1], "base64")));
}

/** Sous-rectangle centré (fraction de la largeur/hauteur), aplati en RGBA —
 *  isole le sujet du fond avant `sampleShadowChroma` (voir helpers/harness.ts). */
function centerCrop(png: DecodedPng, fraction: number): Uint8Array {
  const cw = Math.round(png.width * fraction);
  const ch = Math.round(png.height * fraction);
  const x0 = Math.floor((png.width - cw) / 2);
  const y0 = Math.floor((png.height - ch) / 2);
  const out = new Uint8Array(cw * ch * 4);
  for (let y = 0; y < ch; y++) {
    const srcStart = ((y0 + y) * png.width + x0) * 4;
    out.set(png.data.subarray(srcStart, srcStart + cw * 4), y * cw * 4);
  }
  return out;
}

/** Rend une stèle isolée (fond neutre, une lumière) avec une couleur de base
 *  BLANCHE : le pixel rendu reflète directement la couleur de vertex
 *  (weathering + habillage mission 07), sans teinte de pierre qui viendrait
 *  brouiller le diff. */
async function renderGravestone(page: Page, axes: Axes, seed: number): Promise<string> {
  return page.evaluate(async ({ axes, seed }) => {
    const { buildGravestone, THREE } = await import("/src/graveStone.ts");

    const canvas = document.createElement("canvas");
    canvas.width = 320;
    canvas.height = 320;
    document.body.appendChild(canvas);
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
    renderer.setPixelRatio(1);
    renderer.setSize(320, 320, false);

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x1c1c22);
    const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 10);
    camera.position.set(0, 0.65, 2.1);
    camera.lookAt(0, 0.65, 0);
    scene.add(new THREE.AmbientLight(0xffffff, 0.7));
    const sun = new THREE.DirectionalLight(0xffffff, 1.4);
    sun.position.set(2, 3, 2);
    scene.add(sun);

    const { geometry } = buildGravestone(
      { age: axes.age, vote: axes.vote, maintenance: axes.maintenance, construction: false },
      seed,
    );
    const material = new THREE.MeshStandardMaterial({ color: 0xffffff, vertexColors: true, roughness: 0.92 });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.scale.set(0.9, 1.3, 1);
    scene.add(mesh);

    renderer.render(scene, camera);
    return canvas.toDataURL("image/png");
  }, { axes, seed });
}

test.describe("habillage des tombes — issue #25 (mousse/lichen/coulures, mission 07)", () => {
  test("maintenance haute vs basse → différence de mousse/coulures visible > seuil", async ({ page }) => {
    await bootBlankPage(page);
    const kept = await renderGravestone(page, { age: 0.3, vote: 0, maintenance: 1 }, 7);
    const neglected = await renderGravestone(page, { age: 0.3, vote: 0, maintenance: 0 }, 7);
    const { diffRatio } = compare(dataUrlToDecodedPng(kept), dataUrlToDecodedPng(neglected));
    expect(diffRatio).toBeGreaterThan(DRESSING_DIFF_THRESHOLD);
  });

  test("déterminisme : mêmes (axes, seed) → PNG identiques", async ({ page }) => {
    await bootBlankPage(page);
    const a = await renderGravestone(page, { age: 0.4, vote: -0.6, maintenance: 0.2 }, 11);
    const b = await renderGravestone(page, { age: 0.4, vote: -0.6, maintenance: 0.2 }, 11);
    expect(a).toBe(b);
  });
});

test.describe("règle anti-ombre-noire (Pillar B LAAS)", () => {
  test("une tombe à l'ombre d'un arbre reste lisible (chroma de rebond > seuil)", async ({ page }) => {
    await bootBlankPage(page);
    const dataUrl = await page.evaluate(async () => {
      const { buildGravestone, THREE } = await import("/src/graveStone.ts");

      const canvas = document.createElement("canvas");
      canvas.width = 320;
      canvas.height = 320;
      document.body.appendChild(canvas);
      const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
      renderer.setPixelRatio(1);
      renderer.setSize(320, 320, false);
      renderer.shadowMap.enabled = true;

      const scene = new THREE.Scene();
      scene.background = new THREE.Color(0x000000); // noir pur : chroma nulle, ne pollue pas la mesure

      // Lumière du ciel + ambiante colorées : assurent un rebond même à l'ombre
      // directe (Pillar B LAAS) — sans elles, l'ombre serait un noir plat.
      scene.add(new THREE.HemisphereLight(0x8fb0d8, 0x3a3226, 0.6));
      scene.add(new THREE.AmbientLight(0x445566, 0.3));
      const sun = new THREE.DirectionalLight(0xfff2d8, 2.2);
      sun.position.set(0, 5, 4);
      sun.castShadow = true;
      sun.shadow.mapSize.set(512, 512);
      const shadowCam = sun.shadow.camera as THREE.OrthographicCamera;
      shadowCam.left = -3; shadowCam.right = 3; shadowCam.top = 3; shadowCam.bottom = -3;
      shadowCam.near = 0.1; shadowCam.far = 15;
      scene.add(sun);

      // Occulteur (« canopée d'arbre ») entre le soleil et la stèle : bloque
      // TOUTE la lumière directe sur la tombe (ombre complète, pas partielle).
      const canopy = new THREE.Mesh(
        new THREE.BoxGeometry(4, 0.6, 4),
        new THREE.MeshStandardMaterial({ color: 0x1c2a16 }),
      );
      canopy.position.set(0, 2.6, 1.2);
      canopy.castShadow = true;
      scene.add(canopy);

      const { geometry } = buildGravestone({ age: 0.5, vote: 0, maintenance: 0.5, construction: false }, 3);
      const material = new THREE.MeshStandardMaterial({ color: 0x9a9a92, vertexColors: true, roughness: 0.92 });
      const mesh = new THREE.Mesh(geometry, material);
      mesh.scale.set(0.9, 1.3, 1); // base au sol (y=0), sommet à y≈1.3 — cf. e2e/gravestone.spec.ts
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      scene.add(mesh);

      // Même cadrage que `renderGravestone` : caméra centrée sur le milieu
      // vertical de la stèle (0.65 ≈ 1.3 / 2), qui remplit l'essentiel du cadre.
      const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 20);
      camera.position.set(0, 0.65, 2.1);
      camera.lookAt(0, 0.65, 0);

      renderer.render(scene, camera);
      return canvas.toDataURL("image/png");
    });

    // Recadre au centre (la stèle y remplit le cadre, cf. cadrage ci-dessus) pour
    // ne pas diluer la mesure avec le fond noir (chroma nulle par construction).
    const png = dataUrlToDecodedPng(dataUrl);
    expect(sampleShadowChroma(centerCrop(png, 0.5))).toBeGreaterThan(SHADOW_CHROMA_THRESHOLD);
  });
});
