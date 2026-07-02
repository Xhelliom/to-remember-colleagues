import { test, expect, type Page } from "@playwright/test";
import { assertPerf } from "./helpers/harness.ts";

// Isole `buildGravestone` (web/src/graveStone.ts, mission 06) dans un canvas dédié via
// import ESM direct servi par le dev server Vite — SANS passer par main.ts/l'auth/la
// DB (câblage dans le pipeline complet de tombes déféré à l'intégration, voir
// plan/06-pierre-tombes.md). `THREE` est ré-exporté par graveStone.ts pour garantir la
// MÊME instance que celle utilisée en interne (Vite résout "three" vers un chemin de
// dépendances pré-bundlées versionné).
const VIEWPORT = { width: 320, height: 320 };
const MAX_TRIS_PER_STELE = 400; // budget perf (mission 06) — ExtrudeGeometry curveSegments réduit
const CEMETERY_STELE_COUNT = 60; // "cimetière peuplé de stèles procédurales"
const PERF_FRAME_SAMPLES = 30;

type Axes = { age: number; vote: number; maintenance: number };

async function bootBlankPage(page: Page): Promise<void> {
  await page.setViewportSize(VIEWPORT);
  // "/" est la seule page HTML servie (SPA) : on ne dépend d'aucun de ses effets de
  // bord (auth/API), on ne fait qu'utiliser le dev server Vite pour résoudre nos ESM.
  await page.goto("/");
}

/** Rend une stèle isolée (fond neutre, une lumière) et renvoie son PNG + son tri-count. */
async function renderGravestone(page: Page, axes: Axes, seed: number): Promise<{ dataUrl: string; triCount: number }> {
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
    scene.add(new THREE.AmbientLight(0xffffff, 0.55));
    const sun = new THREE.DirectionalLight(0xffffff, 1.6);
    sun.position.set(2, 3, 2);
    scene.add(sun);

    const { geometry } = buildGravestone(
      { age: axes.age, vote: axes.vote, maintenance: axes.maintenance, construction: false },
      seed,
    );
    const material = new THREE.MeshStandardMaterial({ color: 0x9a9a92, vertexColors: true, roughness: 0.92 });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.scale.set(0.9, 1.3, 1);
    scene.add(mesh);

    renderer.render(scene, camera);
    const triCount = (geometry.index ? geometry.index.count : geometry.attributes.position.count) / 3;
    return { dataUrl: canvas.toDataURL("image/png"), triCount };
  }, { axes, seed });
}

test.describe("stèle procédurale — issue #25 (pierre usée/fissurée/moussue)", () => {
  test("l'entretien change visiblement le rendu (maintenance=1 vs maintenance=0)", async ({ page }) => {
    await bootBlankPage(page);
    const kept = await renderGravestone(page, { age: 0.4, vote: 0, maintenance: 1 }, 7);
    const neglected = await renderGravestone(page, { age: 0.4, vote: 0, maintenance: 0 }, 7);
    expect(kept.dataUrl).not.toBe(neglected.dataUrl);
  });

  test("déterminisme : mêmes (axes, seed) → PNG identiques", async ({ page }) => {
    await bootBlankPage(page);
    const a = await renderGravestone(page, { age: 0.5, vote: 0.3, maintenance: 0.6 }, 11);
    const b = await renderGravestone(page, { age: 0.5, vote: 0.3, maintenance: 0.6 }, 11);
    expect(a.dataUrl).toBe(b.dataUrl);
  });

  test("perf : budget triangles par stèle + fps sur un mini-cimetière peuplé de stèles", async ({ page }) => {
    test.setTimeout(30_000);
    await bootBlankPage(page);

    const triCount = (await renderGravestone(page, { age: 0.3, vote: 0, maintenance: 0.5 }, 1)).triCount;
    expect(triCount).toBeLessThanOrEqual(MAX_TRIS_PER_STELE);

    await page.evaluate(async ({ count, frames }) => {
      const { buildGravestone, THREE } = await import("/src/graveStone.ts");

      const canvas = document.createElement("canvas");
      canvas.width = 800;
      canvas.height = 600;
      document.body.appendChild(canvas);
      const renderer = new THREE.WebGLRenderer({ canvas, antialias: false });
      renderer.setSize(800, 600, false);

      const scene = new THREE.Scene();
      scene.add(new THREE.AmbientLight(0xffffff, 0.6));
      const sun = new THREE.DirectionalLight(0xffffff, 1.2);
      sun.position.set(3, 6, 3);
      scene.add(sun);
      const camera = new THREE.PerspectiveCamera(60, 800 / 600, 0.1, 200);
      camera.position.set(0, 8, 24);
      camera.lookAt(0, 0, 0);

      const cols = Math.ceil(Math.sqrt(count));
      for (let i = 0; i < count; i++) {
        const axes = { age: (i * 0.037) % 1, vote: ((i * 0.091) % 2) - 1, maintenance: (i * 0.053) % 1, construction: false };
        const { geometry } = buildGravestone(axes, 1000 + i);
        const material = new THREE.MeshStandardMaterial({ color: 0x9a9a92, vertexColors: true, roughness: 0.92 });
        const mesh = new THREE.Mesh(geometry, material);
        mesh.position.set((i % cols) * 1.6 - (cols * 1.6) / 2, 0.6, Math.floor(i / cols) * 1.6);
        scene.add(mesh);
      }

      const deltas: number[] = [];
      let last = performance.now();
      for (let f = 0; f < frames; f++) {
        renderer.render(scene, camera);
        const now = performance.now();
        deltas.push(now - last);
        last = now;
      }
      const avgMs = deltas.reduce((s, d) => s + d, 0) / deltas.length;
      // `window.__perf` : même contrat que le harnais (mission 01, e2e/helpers/harness.ts)
      // — alimenté ici manuellement puisque ce spec ne passe pas par main.ts.
      (window as unknown as { __perf: unknown }).__perf = {
        drawCalls: renderer.info.render.calls,
        triangles: renderer.info.render.triangles,
        programs: renderer.info.programs?.length ?? 0,
        fps: avgMs > 0 ? 1000 / avgMs : 0,
      };
    }, { count: CEMETERY_STELE_COUNT, frames: PERF_FRAME_SAMPLES });

    await assertPerf(page, { minFps: 55 });
  });
});
