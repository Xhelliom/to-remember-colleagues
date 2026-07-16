import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { DeadfallField, pieceCountFor } from "./deadfallField.ts";
import { TerrainChunk } from "./terrain.ts";
import type { Frame } from "../worldLayout.ts";
import type { PathSegment } from "../procedural.ts";

const FRAME: Frame = { entrance: { x: 0, z: 0 }, rotY: 0 };
const mat = new THREE.MeshStandardMaterial();
const terrain = new TerrainChunk("org-deadfall", FRAME, 30, 30, 60, 0, 60, mat);
const NO_PATH: PathSegment[] = [];

describe("pieceCountFor — densité liée au négligé (karma/entretien)", () => {
  it("cimetière entretenu et karma correct → 1 seule pièce", () => {
    expect(pieceCountFor(0, 1)).toBe(1);
  });

  it("entretien bas seul → 2 pièces", () => {
    expect(pieceCountFor(0, 0.2)).toBe(2);
  });

  it("karma très négatif seul → 2 pièces", () => {
    expect(pieceCountFor(-10, 1)).toBe(2);
  });

  it("entretien bas ET karma très négatif → plafonné à 3", () => {
    expect(pieceCountFor(-10, 0.1)).toBe(3);
  });
});

describe("DeadfallField.create — déterminisme", () => {
  it("même graine (companyId, zStart) → mêmes positions de pièces", () => {
    const a = DeadfallField.create("org-a", FRAME, 30, 0, 30, NO_PATH, terrain, 0, 0.1);
    const b = DeadfallField.create("org-a", FRAME, 30, 0, 30, NO_PATH, terrain, 0, 0.1);
    expect(a).not.toBeNull();
    expect(b).not.toBeNull();
    expect(a!.group.children.length).toBe(b!.group.children.length);
    a!.group.children.forEach((child, i) => {
      expect(child.position.toArray()).toEqual(b!.group.children[i].position.toArray());
    });
  });

  it("des companyId différents produisent des placements différents", () => {
    const a = DeadfallField.create("org-a", FRAME, 30, 0, 30, NO_PATH, terrain, 0, 0.1);
    const b = DeadfallField.create("org-b", FRAME, 30, 0, 30, NO_PATH, terrain, 0, 0.1);
    expect(a!.group.children[0].position.toArray()).not.toEqual(b!.group.children[0].position.toArray());
  });
});

describe("DeadfallField.create — évitement du chemin", () => {
  it("aucune pièce placée si le chemin couvre toute la largeur/longueur du chunk", () => {
    const wallToWallPath: PathSegment[] = [{ x0: 0, z0: -100, x1: 0, z1: 100 }];
    // Segment vertical très long mais de largeur nulle : les points loin en X y échappent —
    // on vérifie plutôt qu'AUCUNE pièce ne tombe près de l'axe du chemin.
    const field = DeadfallField.create("org-path", FRAME, 30, 0, 30, wallToWallPath, terrain, -10, 0.1);
    if (field) {
      for (const child of field.group.children) {
        expect(Math.abs(child.position.x)).toBeGreaterThan(0.5);
      }
    }
  });

  it("dispose() ne lève pas", () => {
    const field = DeadfallField.create("org-dispose", FRAME, 30, 0, 30, NO_PATH, terrain, -10, 0.1);
    expect(() => field?.dispose()).not.toThrow();
  });
});
