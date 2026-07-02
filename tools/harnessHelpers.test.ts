// Tests des fonctions PURES de e2e/helpers/harness.ts. Volontairement hors de e2e/ :
// Playwright scanne aussi `*.test.ts` par défaut dans testDir (`./e2e`), et
// importer "vitest" y échoue à la collecte — voir e2e/*.ts (captureBiome.ts,
// imageDescriptor.ts…) qui n'ont jamais de `.test.ts` colocalisé pour la même raison.
import { describe, it, expect } from "vitest";
import { harnessUrl, parseCamPose, poseToString, sampleShadowChroma, type CamPose } from "../e2e/helpers/harness.ts";

describe("parseCamPose / poseToString", () => {
  it("round-trip sans fov : poseToString(parse(s)) === s", () => {
    const s = "0,1.7,5,0.3,-0.1";
    expect(poseToString(parseCamPose(s))).toBe(s);
  });

  it("round-trip avec fov : poseToString(parse(s)) === s", () => {
    const s = "12,1.6,-4.5,3.14,0.2,75";
    expect(poseToString(parseCamPose(s))).toBe(s);
  });

  it("parse correctement les champs", () => {
    const pose = parseCamPose("1,2,3,4,5,6");
    const expected: CamPose = { x: 1, y: 2, z: 3, yaw: 4, pitch: 5, fov: 6 };
    expect(pose).toEqual(expected);
  });

  it("lève une erreur sur un format invalide", () => {
    expect(() => parseCamPose("pas,une,pose")).toThrow();
    expect(() => parseCamPose("1,2,3,x,5")).toThrow();
  });
});

describe("harnessUrl", () => {
  it("n'ajoute rien sans options", () => {
    expect(harnessUrl("/?testCluster=42", {})).toBe("/?testCluster=42");
  });

  it("ajoute les params avec & si la base a déjà une query", () => {
    const url = harnessUrl("/?testCluster=42", { seed: 1, T: 12, preset: "high" });
    expect(url).toBe("/?testCluster=42&seed=1&T=12&preset=high");
  });

  it("ajoute les params avec ? si la base n'a pas de query", () => {
    const url = harnessUrl("http://localhost:5173/", { cam: { x: 0, y: 1.7, z: 5, yaw: 0, pitch: 0 } });
    expect(url).toBe("http://localhost:5173/?cam=0%2C1.7%2C5%2C0%2C0");
  });
});

describe("sampleShadowChroma", () => {
  it("chroma nulle pour des pixels gris/noirs plats (ombre noire)", () => {
    const pixels = [0, 0, 0, 255, 40, 40, 40, 255, 10, 10, 10, 255];
    expect(sampleShadowChroma(pixels)).toBe(0);
  });

  it("chroma positive pour des pixels colorés (bounce light)", () => {
    const pixels = [60, 40, 20, 255, 30, 50, 70, 255];
    expect(sampleShadowChroma(pixels)).toBeGreaterThan(0);
  });

  it("lève sur un échantillon vide", () => {
    expect(() => sampleShadowChroma([])).toThrow();
  });
});
