import { describe, expect, it } from "vitest";
import * as THREE from "three";
import {
  alphaTestDiscards,
  attachDepthPrepass,
  buildDepthTwinMaterial,
  isPrepassEnabled,
  PREPASS_QUERY_PARAM,
} from "./vegPrepass.ts";
import { GRASS_WIND_POOL } from "./wind.ts";

describe("isPrepassEnabled — flag additif, défaut inchangé", () => {
  it("false quand le paramètre est absent (comportement actuel préservé)", () => {
    expect(isPrepassEnabled("")).toBe(false);
    expect(isPrepassEnabled("?seed=1")).toBe(false);
  });

  it("false quand explicitement à 0 ou à une valeur non reconnue", () => {
    expect(isPrepassEnabled(`?${PREPASS_QUERY_PARAM}=0`)).toBe(false);
    expect(isPrepassEnabled(`?${PREPASS_QUERY_PARAM}=yes`)).toBe(false);
  });

  it("true seulement pour ?prepass=1", () => {
    expect(isPrepassEnabled(`?${PREPASS_QUERY_PARAM}=1`)).toBe(true);
    expect(isPrepassEnabled(`?seed=1&${PREPASS_QUERY_PARAM}=1`)).toBe(true);
  });
});

describe("alphaTestDiscards — miroir de la formule Three.js alphatest_fragment.glsl.js", () => {
  it("aucun discard quand alphaTest <= 0 (USE_ALPHATEST non défini), quel que soit alpha", () => {
    expect(alphaTestDiscards(0, 0)).toBe(false);
    expect(alphaTestDiscards(1, 0)).toBe(false);
  });

  it("discarde sous le seuil, garde au seuil et au-dessus (a < alphaTest, pas <=)", () => {
    expect(alphaTestDiscards(0.4, 0.5)).toBe(true);
    expect(alphaTestDiscards(0.5, 0.5)).toBe(false);
    expect(alphaTestDiscards(0.6, 0.5)).toBe(false);
  });
});

describe("buildDepthTwinMaterial — même entrée → même décision de discard que la passe couleur", () => {
  const CARD_ALPHA_TEST = 0.5;
  const map = new THREE.Texture();

  it("partage exactement map et alphaTest avec un matériau couleur équivalent", () => {
    const colorMat = new THREE.MeshStandardMaterial({ map, alphaTest: CARD_ALPHA_TEST });
    const depthMat = buildDepthTwinMaterial({ pool: GRASS_WIND_POOL, map, alphaTest: CARD_ALPHA_TEST });

    expect(depthMat.map).toBe(colorMat.map);
    expect(depthMat.alphaTest).toBe(colorMat.alphaTest);

    // Même config (map, alphaTest) ⇒ Three.js applique la MÊME formule de
    // discard (alphatest_fragment.glsl.js) quel que soit le type de matériau :
    // pour tout échantillon d'alpha, les deux passes décident pareil.
    for (const alpha of [0, 0.1, 0.49, 0.5, 0.51, 0.9, 1]) {
      expect(alphaTestDiscards(alpha, depthMat.alphaTest)).toBe(alphaTestDiscards(alpha, colorMat.alphaTest));
    }
  });

  it("herbe sans mask (pas de map/alphaTest côté couleur) : jumeau aussi sans discard", () => {
    // grassField.ts ne passe ni map ni alphaTest à son matériau couleur — le
    // jumeau construit avec les valeurs par défaut doit rester cohérent.
    const depthMat = buildDepthTwinMaterial({ pool: GRASS_WIND_POOL });
    expect(depthMat.map).toBeNull();
    expect(depthMat.alphaTest).toBe(0);
    expect(alphaTestDiscards(0, depthMat.alphaTest)).toBe(false);
  });

  it("colorWrite désactivé (sécurité : jamais de couleur visible depuis le prepass)", () => {
    const depthMat = buildDepthTwinMaterial({ pool: GRASS_WIND_POOL });
    expect(depthMat.colorWrite).toBe(false);
    expect(depthMat.depthPacking).toBe(THREE.BasicDepthPacking);
  });
});

describe("attachDepthPrepass — jumeau enfant du mesh couleur, rendu avant, depthFunc=EQUAL", () => {
  it("attache le jumeau, le rend avant (renderOrder négatif) et bascule la passe couleur en EQUAL", () => {
    const colorMat = new THREE.MeshStandardMaterial();
    const colorMesh = new THREE.Mesh(new THREE.BoxGeometry(), colorMat);
    colorMesh.frustumCulled = false; // valeur non-défaut : vérifie que attachDepthPrepass la propage
    const depthMesh = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshDepthMaterial());

    expect(colorMat.depthFunc).toBe(THREE.LessEqualDepth); // défaut Three.js avant attache

    attachDepthPrepass(colorMesh, depthMesh);

    expect(colorMesh.children).toContain(depthMesh);
    expect(depthMesh.renderOrder).toBeLessThan(0);
    expect(depthMesh.frustumCulled).toBe(false);
    expect(colorMat.depthFunc).toBe(THREE.EqualDepth);
    expect(colorMat.depthWrite).toBe(false);
  });
});
