import { describe, expect, it } from "vitest";
import { cemeteryPonds, pondDepth, pondRelief, pondsInRange, WATER_LEVEL, type Pond } from "./pond.ts";
import { cemeteryLayout } from "../procedural.ts";

const POND: Pond[] = [{ x: 0, z: 20, radius: 5 }];

describe("cemeteryPonds — placement", () => {
  it("est déterministe : même cimetière → mêmes étangs", () => {
    const layout = cemeteryLayout("org-etang", 300);
    expect(cemeteryPonds("org-etang", layout)).toEqual(cemeteryPonds("org-etang", layout));
  });

  it("ne coupe jamais une allée : chaque étang garde une berge avec le chemin", () => {
    for (const id of ["a", "b", "c", "org-42"]) {
      const layout = cemeteryLayout(id, 400);
      for (const p of cemeteryPonds(id, layout)) {
        const d = Math.min(...layout.pathSegments.map((s) => {
          const dx = s.x1 - s.x0;
          const dz = s.z1 - s.z0;
          const len2 = dx * dx + dz * dz || 1;
          const t = Math.max(0, Math.min(1, ((p.x - s.x0) * dx + (p.z - s.z0) * dz) / len2));
          return Math.hypot(p.x - (s.x0 + dx * t), p.z - (s.z0 + dz * t));
        }));
        expect(d).toBeGreaterThan(p.radius);
      }
    }
  });

  it("tient dans le couloir, murs compris", () => {
    const layout = cemeteryLayout("bornes", 400);
    for (const p of cemeteryPonds("bornes", layout)) {
      expect(Math.abs(p.x) + p.radius).toBeLessThan(layout.plotWidth / 2);
    }
  });

  it("ne se chevauchent pas entre eux", () => {
    const layout = cemeteryLayout("multi", 600);
    const ponds = cemeteryPonds("multi", layout);
    for (let i = 0; i < ponds.length; i++) {
      for (let j = i + 1; j < ponds.length; j++) {
        const d = Math.hypot(ponds[i].x - ponds[j].x, ponds[i].z - ponds[j].z);
        expect(d).toBeGreaterThan(ponds[i].radius + ponds[j].radius);
      }
    }
  });

  it("laisse les petits cimetières sans étang (un mouchoir de poche n'en porte pas)", () => {
    const layout = cemeteryLayout("minuscule", 4);
    expect(layout.plotDepth).toBeLessThan(60);
    expect(cemeteryPonds("minuscule", layout)).toEqual([]);
  });

  it("en donne un dès qu'un cimetière est assez profond, même s'il tient en une seule tranche", () => {
    const layout = cemeteryLayout("une-tranche", 12);
    expect(layout.chunkCount).toBe(1);
    expect(layout.plotDepth).toBeGreaterThan(60);
    expect(cemeteryPonds("une-tranche", layout).length).toBeGreaterThan(0);
  });
});

describe("pondDepth / pondRelief — cuvette", () => {
  it("creuse au centre et rejoint le terrain au bord", () => {
    expect(pondDepth(0, 20, POND)).toBeGreaterThan(1);
    expect(pondDepth(5, 20, POND)).toBeCloseTo(0);
    expect(pondDepth(30, 20, POND)).toBe(0);
  });

  it("garde le fond sous le niveau de l'eau (sinon l'étang est à sec)", () => {
    expect(-pondDepth(0, 20, POND)).toBeLessThan(WATER_LEVEL);
  });

  it("aplanit les abords : la cuvette repose à plat, l'eau ne déborde pas", () => {
    expect(pondRelief(0, 20, POND)).toBe(0);
    expect(pondRelief(5, 20, POND)).toBe(0);
    expect(pondRelief(30, 20, POND)).toBe(1);
  });

  it("sans étang, ne touche à rien", () => {
    expect(pondDepth(3, 3, [])).toBe(0);
    expect(pondRelief(3, 3, [])).toBe(1);
  });
});

describe("pondsInRange", () => {
  it("retient un étang à cheval sur deux tranches, pour que les deux le posent", () => {
    expect(pondsInRange(POND, 0, 16)).toHaveLength(1);
    expect(pondsInRange(POND, 24, 40)).toHaveLength(1);
    expect(pondsInRange(POND, 40, 60)).toHaveLength(0);
  });
});
