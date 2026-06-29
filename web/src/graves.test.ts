import { describe, expect, it } from "vitest";
import { seededRandom } from "./graves.ts";

describe("seededRandom", () => {
  it("est déterministe pour une même graine", () => {
    const a = seededRandom(42);
    const b = seededRandom(42);
    const seqA = [a(), a(), a(), a()];
    const seqB = [b(), b(), b(), b()];
    expect(seqA).toEqual(seqB);
  });

  it("produit des séquences différentes pour des graines différentes", () => {
    const a = seededRandom(1);
    const b = seededRandom(2);
    expect(a()).not.toBe(b());
  });

  it("reste dans l'intervalle [0, 1)", () => {
    const rand = seededRandom(12345);
    for (let i = 0; i < 1000; i++) {
      const v = rand();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });
});
