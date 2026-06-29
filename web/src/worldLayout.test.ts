import { describe, expect, it } from "vitest";
import { worldLayout } from "./worldLayout.ts";

const companies = (n: number) =>
  Array.from({ length: n }, (_, i) => ({ id: `org-${i}`, graveCount: 10 + i }));

describe("worldLayout (monde continu, évolution #5)", () => {
  it("est déterministe : mêmes entrées → même plan", () => {
    expect(worldLayout(companies(6))).toEqual(worldLayout(companies(6)));
  });

  it("pose une parcelle par cimetière", () => {
    expect(worldLayout(companies(8)).slots).toHaveLength(8);
    expect(worldLayout([]).slots).toHaveLength(0);
  });

  it("alterne les cimetières de part et d'autre de la route", () => {
    const { slots } = worldLayout(companies(4));
    // Côtés opposés : le produit des décalages latéraux consécutifs est négatif.
    for (let i = 1; i < slots.length; i++) {
      expect(slots[i - 1].plotCenter.x * slots[i].plotCenter.x).toBeLessThan(0);
    }
  });

  it("place les parcelles hors de la route (au-delà de sa demi-largeur)", () => {
    for (const slot of worldLayout(companies(5)).slots) {
      expect(Math.hypot(slot.plotCenter.x, 0)).toBeGreaterThan(0);
      // La parcelle entière tient dans les bornes du monde.
      const { bounds } = worldLayout(companies(5));
      expect(slot.plotCenter.x - slot.plotHalf).toBeGreaterThanOrEqual(bounds.minX);
      expect(slot.plotCenter.x + slot.plotHalf).toBeLessThanOrEqual(bounds.maxX);
    }
  });

  it("allonge le monde (vers -Z) avec le nombre de cimetières", () => {
    expect(worldLayout(companies(12)).bounds.minZ).toBeLessThan(worldLayout(companies(3)).bounds.minZ);
  });
});
