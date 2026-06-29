import { describe, expect, it } from "vitest";
import { slugify, uniqueSlug } from "./slug.ts";

describe("slugify", () => {
  it("met en minuscules et remplace les espaces par des tirets", () => {
    expect(slugify("Pixel And Co")).toBe("pixel-and-co");
  });

  it("supprime les accents", () => {
    expect(slugify("Crèperie Éléonore")).toBe("creperie-eleonore");
  });

  it("retire les caractères spéciaux et les tirets en bord", () => {
    expect(slugify("  !!Studio @ Test!! ")).toBe("studio-test");
  });

  it("renvoie une valeur par défaut pour une entrée vide après nettoyage", () => {
    expect(slugify("@#$%")).toBe("cimetiere");
    expect(slugify("")).toBe("cimetiere");
  });
});

describe("uniqueSlug", () => {
  it("garde le slug s'il est libre", () => {
    expect(uniqueSlug("studio", ["autre"])).toBe("studio");
  });

  it("suffixe un numéro en cas de collision", () => {
    expect(uniqueSlug("studio", ["studio"])).toBe("studio-2");
    expect(uniqueSlug("studio", ["studio", "studio-2"])).toBe("studio-3");
  });
});
