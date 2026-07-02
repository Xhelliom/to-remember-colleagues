import { describe, expect, it } from "vitest";
import { selectLodTier } from "./distanceLod.ts";

describe("selectLodTier", () => {
  it("choisit le palier le plus détaillé quand la distance est nulle", () => {
    expect(selectLodTier(0, [30, 50], 0, 2)).toBe(0);
  });

  it("descend d'un palier une fois le premier seuil franchi", () => {
    expect(selectLodTier(35, [30, 50], 0, 2)).toBe(1);
  });

  it("descend jusqu'au dernier palier au-delà de tous les seuils", () => {
    expect(selectLodTier(100, [30, 50], 0, 2)).toBe(2);
  });

  it("ne change pas de palier dans la marge d'hystérésis (zone morte)", () => {
    // À 31 (juste au-dessus du seuil 30 mais sous 30+2), reste au palier courant.
    expect(selectLodTier(31, [30, 50], 0, 2)).toBe(0);
  });

  it("ne remonte pas tant qu'on ne repasse pas sous seuil - hystérésis", () => {
    // Palier 1 déjà actif ; distance 29 est sous 30 mais pas sous 30-2=28 → reste.
    expect(selectLodTier(29, [30, 50], 1, 2)).toBe(1);
  });

  it("remonte d'un palier une fois clairement sous le seuil précédent", () => {
    expect(selectLodTier(27, [30, 50], 1, 2)).toBe(0);
  });

  it("gère un seul seuil (visible/masqué binaire)", () => {
    expect(selectLodTier(10, [40], 0, 2)).toBe(0);
    expect(selectLodTier(45, [40], 0, 2)).toBe(1);
    expect(selectLodTier(41, [40], 1, 2)).toBe(1); // hystérésis : reste masqué
    expect(selectLodTier(37, [40], 1, 2)).toBe(0); // sous 40-2 : redevient visible
  });
});
