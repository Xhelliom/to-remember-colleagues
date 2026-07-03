import { describe, expect, it } from "vitest";
import { Vector3 } from "three";
import { pickNearestColleague } from "./graveFocus.ts";
import type { Colleague } from "../types.ts";

function grave(x: number, z: number, colleague: Colleague | null) {
  return { position: { x, y: 0, z }, userData: colleague ? { colleague } : {} } as never;
}
const alice = { id: "a" } as Colleague;
const bob = { id: "b" } as Colleague;

describe("pickNearestColleague", () => {
  it("retourne le collègue de la tombe la plus proche dans le rayon", () => {
    const graves = [grave(5, 0, bob), grave(1, 0, alice)];
    expect(pickNearestColleague(graves, new Vector3(0, 0, 0), 3.2)).toBe(alice);
  });

  it("null si aucune tombe dans le rayon", () => {
    expect(pickNearestColleague([grave(10, 0, alice)], new Vector3(0, 0, 0), 3.2)).toBeNull();
  });

  it("ignore la distance verticale (2D au sol)", () => {
    // caméra haute : seule la distance x/z compte
    expect(pickNearestColleague([grave(1, 0, alice)], new Vector3(0, 100, 0), 3.2)).toBe(alice);
  });

  it("null si la tombe la plus proche n'a pas de collègue", () => {
    expect(pickNearestColleague([grave(1, 0, null)], new Vector3(0, 0, 0), 3.2)).toBeNull();
  });
});
