import { describe, expect, it } from "vitest";
import { cemeteryLayout, hashSeed } from "./procedural.ts";

describe("cemeteryLayout (plan procédural #5)", () => {
  it("est déterministe : même id → même plan", () => {
    expect(cemeteryLayout("org-123", 12)).toEqual(cemeteryLayout("org-123", 12));
  });

  it("produit un plan différent pour un id différent", () => {
    const a = cemeteryLayout("org-123", 12);
    const b = cemeteryLayout("autre-org", 12);
    expect(a.placements).not.toEqual(b.placements);
  });

  it("pose une tombe par collègue (0 inclus)", () => {
    expect(cemeteryLayout("x", 12).placements).toHaveLength(12);
    expect(cemeteryLayout("x", 0).placements).toHaveLength(0);
  });

  it("agrandit la parcelle avec le nombre de tombes", () => {
    expect(cemeteryLayout("scale", 200).plotHalf).toBeGreaterThan(cemeteryLayout("scale", 4).plotHalf);
  });
});

describe("hashSeed", () => {
  it("est stable et tient sur 32 bits", () => {
    expect(hashSeed("abc")).toBe(hashSeed("abc"));
    expect(hashSeed("abc")).toBeGreaterThanOrEqual(0);
    expect(hashSeed("abc")).toBeLessThanOrEqual(0xffffffff);
  });
});
