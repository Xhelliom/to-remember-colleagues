import { describe, expect, it } from "vitest";
import { effectiveMaintenance, MAINTAIN_BOOST } from "./maintenance.ts";

const DAY_MS = 24 * 3600 * 1000;
const FULL_DECAY_DAYS = 270;

describe("effectiveMaintenance (issue #14)", () => {
  it("retourne la valeur de base pour un entretien tout juste effectué", () => {
    const now = new Date(2026, 5, 1);
    expect(effectiveMaintenance(0.8, now, now)).toBeCloseTo(0.8);
  });

  it("décroît proportionnellement au temps écoulé", () => {
    const ref = new Date(2026, 0, 1);
    const after90 = new Date(ref.getTime() + 90 * DAY_MS);
    const expected = 0.8 - 90 / FULL_DECAY_DAYS;
    expect(effectiveMaintenance(0.8, ref, after90)).toBeCloseTo(expected, 5);
  });

  it("est borné à 0 (pas de valeur négative)", () => {
    const ref = new Date(2026, 0, 1);
    const farFuture = new Date(ref.getTime() + 1000 * DAY_MS);
    expect(effectiveMaintenance(0.8, ref, farFuture)).toBe(0);
  });

  it("reflète un boost après entretien : boost + décroissance partielle", () => {
    const ref = new Date(2026, 0, 1);
    const after30 = new Date(ref.getTime() + 30 * DAY_MS);
    const decayed = effectiveMaintenance(0.8, ref, after30);
    // Simule un entretien : nouvelle base = decayed + BOOST
    const newBase = Math.min(1, decayed + MAINTAIN_BOOST);
    expect(newBase).toBeGreaterThan(decayed);
    expect(newBase).toBeLessThanOrEqual(1);
  });
});
