import { describe, expect, it } from "vitest";
import { newGraveSeed } from "./random.ts";

describe("newGraveSeed", () => {
  it("produit un entier positif dans la plage attendue", () => {
    for (let i = 0; i < 1000; i++) {
      const seed = newGraveSeed();
      expect(Number.isInteger(seed)).toBe(true);
      expect(seed).toBeGreaterThanOrEqual(0);
      expect(seed).toBeLessThan(1_000_000_000);
    }
  });
});
