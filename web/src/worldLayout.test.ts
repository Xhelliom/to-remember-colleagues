import { describe, expect, it } from "vitest";
import { distanceToSlot, slotCorners, worldLayout } from "./worldLayout.ts";

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
    }
  });

  it("allonge le monde (vers -Z) avec le nombre de cimetières", () => {
    expect(worldLayout(companies(12)).bounds.minZ).toBeLessThan(worldLayout(companies(3)).bounds.minZ);
  });

  it("deux cimetières consécutifs se font face à la même station (pas de grand vide en quinconce)", () => {
    const { slots } = worldLayout(companies(2));
    const [a, b] = slots;
    // Même station : distance entrée-à-entrée petite (largeur de route),
    // pas des dizaines de mètres comme avec une station par cimetière.
    expect(Math.hypot(a.entrance.x - b.entrance.x, a.entrance.z - b.entrance.z)).toBeLessThan(20);
  });

  it("les emprises (le long de la route) de deux stations consécutives ne se chevauchent jamais, quelle que soit leur taille (2.2)", () => {
    const varied = [
      { id: "a", graveCount: 3 },
      { id: "b", graveCount: 600 },
      { id: "c", graveCount: 10 },
      { id: "d", graveCount: 900 },
      { id: "e", graveCount: 1 },
    ];
    const { slots, centerline } = worldLayout(varied);
    // Regroupe les cimetières par station (deux au plus, face à face).
    const halfWidthByStation = new Map<number, number>();
    slots.forEach((slot, k) => {
      const s = Math.floor(k / 2) + 1;
      halfWidthByStation.set(s, Math.max(halfWidthByStation.get(s) ?? 0, slot.plotWidth / 2));
    });
    for (let s = 1; s < centerline.length - 1; s++) {
      const gapNeeded = (halfWidthByStation.get(s) ?? 0) + (halfWidthByStation.get(s + 1) ?? 0);
      const gapActual = Math.abs(centerline[s].z - centerline[s + 1].z);
      expect(gapActual).toBeGreaterThanOrEqual(gapNeeded);
    }
  });

  it("distanceToSlot reste nulle n'importe où dans l'emprise, même loin du plotCenter d'un chemin long (régression charge/décharge)", () => {
    // Un cimetière de 900 tombes a un chemin de plusieurs centaines de mètres :
    // son entrée peut être très loin de son plotCenter (milieu du chemin).
    const { slots } = worldLayout([{ id: "long", graveCount: 900 }]);
    const slot = slots[0];
    expect(Math.hypot(slot.entrance.x - slot.plotCenter.x, slot.entrance.z - slot.plotCenter.z)).toBeGreaterThan(50);
    expect(distanceToSlot(slot, slot.entrance)).toBeLessThan(1);
    expect(distanceToSlot(slot, slot.plotCenter)).toBeLessThan(1);
  });

  it("distanceToSlot croît hors de l'emprise", () => {
    const { slots } = worldLayout([{ id: "x", graveCount: 20 }]);
    const slot = slots[0];
    const farAway = { x: slot.entrance.x + 1000, z: slot.entrance.z + 1000 };
    expect(distanceToSlot(slot, farAway)).toBeGreaterThan(500);
  });

  it("les bornes du monde englobent toujours les 4 coins de chaque parcelle (2.3)", () => {
    const varied = [
      { id: "a", graveCount: 5 },
      { id: "b", graveCount: 700 },
      { id: "c", graveCount: 50 },
    ];
    const { slots, bounds } = worldLayout(varied);
    for (const slot of slots) {
      for (const corner of slotCorners(slot)) {
        expect(corner.x).toBeGreaterThanOrEqual(bounds.minX);
        expect(corner.x).toBeLessThanOrEqual(bounds.maxX);
        expect(corner.z).toBeGreaterThanOrEqual(bounds.minZ);
        expect(corner.z).toBeLessThanOrEqual(bounds.maxZ);
      }
    }
  });
});
