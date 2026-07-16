import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { UnderstoryField } from "./understoryField.ts";
import { TerrainChunk } from "../terrain.ts";
import { toWorld, type Frame } from "../../worldLayout.ts";
import type { PathSegment } from "../../procedural.ts";
import type { TreePlacement } from "./treeLod.ts";

const FRAME: Frame = { entrance: { x: 0, z: 0 }, rotY: 0 };
const mat = new THREE.MeshStandardMaterial();
const terrain = new TerrainChunk("org-understory", FRAME, 30, 30, 60, 0, 30, mat);
const NO_PATH: PathSegment[] = [];

function treeAt(lx: number, lz: number, scale = 1): TreePlacement {
  const world = toWorld(FRAME, lx, lz);
  return { x: world.x, y: 0, z: world.z, yaw: 0, scale, seed: 1 };
}

describe("UnderstoryField.create — sans arbre, pas de sous-bois", () => {
  it("renvoie null si aucun placement d'arbre n'est fourni", () => {
    const field = UnderstoryField.create("org-empty", FRAME, 30, 0, 30, NO_PATH, terrain, []);
    expect(field).toBeNull();
  });
});

describe("UnderstoryField.create — déterminisme", () => {
  it("même graine (companyId, zStart) et mêmes arbres → mêmes placements", () => {
    const trees = [treeAt(0, 15)];
    const a = UnderstoryField.create("org-a", FRAME, 30, 0, 30, NO_PATH, terrain, trees);
    const b = UnderstoryField.create("org-a", FRAME, 30, 0, 30, NO_PATH, terrain, trees);
    expect(a).not.toBeNull();
    expect(b).not.toBeNull();
    expect(a!.group.children.length).toBe(b!.group.children.length);
    a!.group.children.forEach((child, i) => {
      expect(child.position.toArray()).toEqual(b!.group.children[i].position.toArray());
    });
  });

  it("des companyId différents produisent des placements différents", () => {
    const trees = [treeAt(0, 15)];
    const a = UnderstoryField.create("org-a", FRAME, 30, 0, 30, NO_PATH, terrain, trees);
    const b = UnderstoryField.create("org-b", FRAME, 30, 0, 30, NO_PATH, terrain, trees);
    expect(a!.group.children[0].position.toArray()).not.toEqual(b!.group.children[0].position.toArray());
  });
});

describe("UnderstoryField.create — bornes et chemin", () => {
  it("toutes les pièces restent dans la tranche [zStart, zEnd[ et le couloir", () => {
    const trees = [treeAt(0, 15), treeAt(-8, 5), treeAt(8, 25)];
    const field = UnderstoryField.create("org-bounds", FRAME, 30, 0, 30, NO_PATH, terrain, trees);
    expect(field).not.toBeNull();
    for (const child of field!.group.children) {
      const local = { x: child.position.x, z: child.position.z }; // frame identité (entrance 0,0, rotY 0)
      expect(local.z).toBeGreaterThanOrEqual(0);
      expect(local.z).toBeLessThan(30);
      expect(Math.abs(local.x)).toBeLessThanOrEqual(15);
    }
  });

  it("aucune pièce si le chemin couvre tout l'axe des arbres", () => {
    const wallToWallPath: PathSegment[] = [{ x0: 0, z0: -100, x1: 0, z1: 100 }];
    const trees = [treeAt(0, 15)];
    const field = UnderstoryField.create("org-path", FRAME, 30, 0, 30, wallToWallPath, terrain, trees);
    if (field) {
      for (const child of field.group.children) {
        expect(Math.abs(child.position.x)).toBeGreaterThan(0.5);
      }
    }
  });

  it("dispose() ne lève pas", () => {
    const field = UnderstoryField.create("org-dispose", FRAME, 30, 0, 30, NO_PATH, terrain, [treeAt(0, 15)]);
    expect(() => field?.dispose()).not.toThrow();
  });
});
