import { describe, expect, it } from "vitest";
import { BOOKMARKS, Flythrough, FLYTHROUGH_DURATION_S, getBookmark, parseShotParam } from "./bookmarks.ts";

describe("parseShotParam — parsing/round-trip de ?shot=", () => {
  it("accepte chaque id de bookmark (1..N) et retrouve le même bookmark", () => {
    for (const b of BOOKMARKS) {
      const parsed = parseShotParam(String(b.id));
      expect(parsed).toBe(b.id);
      expect(getBookmark(parsed as number)?.id).toBe(b.id);
    }
  });

  it("reconnaît le tour (\"fly\")", () => {
    expect(parseShotParam("fly")).toBe("fly");
  });

  it("rejette les valeurs absentes, hors bornes ou non entières", () => {
    expect(parseShotParam(null)).toBeNull();
    expect(parseShotParam("0")).toBeNull();
    expect(parseShotParam(String(BOOKMARKS.length + 1))).toBeNull();
    expect(parseShotParam("2.5")).toBeNull();
    expect(parseShotParam("abc")).toBeNull();
  });

  it("getBookmark renvoie undefined pour un id inconnu", () => {
    expect(getBookmark(0)).toBeUndefined();
    expect(getBookmark(BOOKMARKS.length + 1)).toBeUndefined();
  });
});

describe("Flythrough — continuité de la spline Catmull-Rom (pas de saut)", () => {
  // Bornes choisies très au-dessus du pas moyen attendu (poses réparties sur
  // quelques mètres à quelques dizaines de mètres) mais assez strictes pour
  // détecter un vrai saut (ex. retour brutal en début de tableau, mauvais
  // paramétrage temporel) — voir bug qu'un `t / N` non-modulo introduirait.
  const MAX_STEP_METERS = 2.5;
  const SAMPLE_COUNT = 400;

  it("les positions successives restent à distance bornée (échantillonnage fin)", () => {
    const fly = new Flythrough();
    const dt = FLYTHROUGH_DURATION_S / SAMPLE_COUNT;
    let prev = fly.samplePose(0);
    let maxStep = 0;
    for (let i = 1; i <= SAMPLE_COUNT; i++) {
      const pose = fly.samplePose(i * dt);
      const dist = Math.hypot(pose.x - prev.x, pose.y - prev.y, pose.z - prev.z);
      maxStep = Math.max(maxStep, dist);
      prev = pose;
    }
    expect(maxStep).toBeLessThan(MAX_STEP_METERS);
  });

  it("boucle proprement : la pose se répète après une période complète", () => {
    const fly = new Flythrough();
    const a = fly.samplePose(0);
    const b = fly.samplePose(FLYTHROUGH_DURATION_S);
    expect(b.x).toBeCloseTo(a.x, 5);
    expect(b.y).toBeCloseTo(a.y, 5);
    expect(b.z).toBeCloseTo(a.z, 5);
  });

  it("accepte un temps écoulé négatif ou très supérieur à la durée (modulo robuste)", () => {
    const fly = new Flythrough();
    expect(() => fly.samplePose(-5)).not.toThrow();
    expect(() => fly.samplePose(FLYTHROUGH_DURATION_S * 10 + 3)).not.toThrow();
  });
});
