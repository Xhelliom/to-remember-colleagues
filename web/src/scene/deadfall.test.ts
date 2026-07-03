import { describe, expect, it } from "vitest";
import type * as THREE from "three";
import {
  buildFallenTrunk,
  buildMushroomCluster,
  buildStump,
  DECAY_STATES,
  decayStateForSeed,
} from "./deadfall.ts";

describe("DECAY_STATES — 3 états énumérés (LAAS)", () => {
  it("expose exactement 3 états distincts", () => {
    expect(DECAY_STATES).toHaveLength(3);
    expect(new Set(DECAY_STATES).size).toBe(3);
  });
});

describe("decayStateForSeed — déterminisme par graine", () => {
  it("même graine → même état, toujours", () => {
    for (const seed of [1, 7, 99, 2024]) {
      expect(decayStateForSeed(seed)).toBe(decayStateForSeed(seed));
    }
  });

  it("ne renvoie jamais autre chose qu'un état énuméré", () => {
    for (let seed = 0; seed < 50; seed++) {
      expect(DECAY_STATES).toContain(decayStateForSeed(seed));
    }
  });

  it("balaie les 3 états sur un échantillon de graines (pas de biais constant)", () => {
    const seen = new Set(Array.from({ length: 50 }, (_, seed) => decayStateForSeed(seed)));
    expect(seen.size).toBe(3);
  });
});

describe("buildFallenTrunk — déterminisme", () => {
  it("même graine → même géométrie et même état de décomposition", () => {
    const a = buildFallenTrunk(123);
    const b = buildFallenTrunk(123);
    const meshA = a.group.children[0] as THREE.Mesh;
    const meshB = b.group.children[0] as THREE.Mesh;
    expect(Array.from(meshA.geometry.getAttribute("position").array)).toEqual(
      Array.from(meshB.geometry.getAttribute("position").array),
    );
    expect(a.decayState).toBe(b.decayState);
    expect(a.decayState).toBe(decayStateForSeed(123));
  });

  it("des graines différentes produisent des géométries différentes", () => {
    const a = buildFallenTrunk(1);
    const b = buildFallenTrunk(2);
    const meshA = a.group.children[0] as THREE.Mesh;
    const meshB = b.group.children[0] as THREE.Mesh;
    expect(Array.from(meshA.geometry.getAttribute("position").array)).not.toEqual(
      Array.from(meshB.geometry.getAttribute("position").array),
    );
  });

  it("les couleurs de vertex restent bornées dans [0,1]", () => {
    const trunk = buildFallenTrunk(42);
    const mesh = trunk.group.children[0] as THREE.Mesh;
    const colors = mesh.geometry.getAttribute("color").array;
    for (const c of colors) {
      expect(c).toBeGreaterThanOrEqual(0);
      expect(c).toBeLessThanOrEqual(1);
    }
  });

  it("dispose() ne lève pas", () => {
    const trunk = buildFallenTrunk(5);
    expect(() => trunk.dispose()).not.toThrow();
  });
});

describe("buildStump — déterminisme", () => {
  it("même graine → même géométrie et même état", () => {
    const a = buildStump(77);
    const b = buildStump(77);
    const meshA = a.group.children[0] as THREE.Mesh;
    const meshB = b.group.children[0] as THREE.Mesh;
    expect(Array.from(meshA.geometry.getAttribute("position").array)).toEqual(
      Array.from(meshB.geometry.getAttribute("position").array),
    );
    expect(a.decayState).toBe(b.decayState);
  });

  it("des graines différentes produisent des géométries différentes", () => {
    const a = buildStump(10);
    const b = buildStump(11);
    const meshA = a.group.children[0] as THREE.Mesh;
    const meshB = b.group.children[0] as THREE.Mesh;
    expect(Array.from(meshA.geometry.getAttribute("position").array)).not.toEqual(
      Array.from(meshB.geometry.getAttribute("position").array),
    );
  });
});

describe("buildMushroomCluster — déterminisme", () => {
  it("même graine → même nombre d'enfants et mêmes positions", () => {
    const a = buildMushroomCluster(9);
    const b = buildMushroomCluster(9);
    expect(a.group.children.length).toBe(b.group.children.length);
    a.group.children.forEach((child, i) => {
      expect(child.position.toArray()).toEqual(b.group.children[i].position.toArray());
    });
  });

  it("2 mailles (tige + chapeau) par champignon, count configurable", () => {
    const cluster = buildMushroomCluster(3, { count: 4 });
    expect(cluster.group.children.length).toBe(8);
  });

  it("dispose() ne lève pas", () => {
    const cluster = buildMushroomCluster(3);
    expect(() => cluster.dispose()).not.toThrow();
  });
});
