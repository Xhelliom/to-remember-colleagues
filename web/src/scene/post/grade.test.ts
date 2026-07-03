import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { getFilmGrade } from "../../ambiance.ts";
import { applyFilmGrade, createGoldenGradePass } from "./grade.ts";

describe("getFilmGrade — courbes distinctes par moment de la journée", () => {
  it("aube ≠ midi (teintes ombres/hautes-lumières et contraste distincts)", () => {
    const dawn = getFilmGrade("dawn");
    const day = getFilmGrade("day");
    expect(dawn.shadowTint).not.toEqual(day.shadowTint);
    expect(dawn.highlightTint).not.toEqual(day.highlightTint);
    expect(dawn.contrast).not.toBe(day.contrast);
  });

  it("chacun des 4 moments a une courbe propre (pas de doublon accidentel)", () => {
    const keys = ["dawn", "day", "dusk", "night"] as const;
    const grades = keys.map((k) => JSON.stringify(getFilmGrade(k)));
    expect(new Set(grades).size).toBe(keys.length);
  });
});

describe("applyFilmGrade — pousse des valeurs distinctes dans les uniforms du pass", () => {
  it("aube et midi produisent des uniforms de teinte différents", () => {
    const pass = createGoldenGradePass();
    applyFilmGrade(pass, getFilmGrade("dawn"));
    const dawnHighlight = (pass.uniforms.uHighlightTint.value as THREE.Vector3).clone();
    const dawnContrast = pass.uniforms.uContrast.value as number;

    applyFilmGrade(pass, getFilmGrade("day"));
    const dayHighlight = pass.uniforms.uHighlightTint.value as THREE.Vector3;
    const dayContrast = pass.uniforms.uContrast.value as number;

    expect(dawnHighlight.equals(dayHighlight)).toBe(false);
    expect(dawnContrast).not.toBe(dayContrast);
  });
});
