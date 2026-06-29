import { describe, expect, it } from "vitest";
import { getAmbiance, mix, resolveSeasonKey, resolveTimeKey } from "./ambiance.ts";

describe("resolveTimeKey", () => {
  it("respecte le réglage manuel sans regarder l'heure", () => {
    expect(resolveTimeKey("night", 12)).toBe("night");
    expect(resolveTimeKey("dawn", 23)).toBe("dawn");
  });

  it("déduit le moment depuis l'heure en mode auto", () => {
    expect(resolveTimeKey("auto", 6)).toBe("dawn");
    expect(resolveTimeKey("auto", 12)).toBe("day");
    expect(resolveTimeKey("auto", 19)).toBe("dusk");
    expect(resolveTimeKey("auto", 2)).toBe("night");
    expect(resolveTimeKey("auto", 23)).toBe("night");
  });

  it("gère les bornes des plages horaires", () => {
    expect(resolveTimeKey("auto", 5)).toBe("dawn");
    expect(resolveTimeKey("auto", 8)).toBe("day");
    expect(resolveTimeKey("auto", 18)).toBe("dusk");
    expect(resolveTimeKey("auto", 21)).toBe("night");
  });
});

describe("resolveSeasonKey", () => {
  it("respecte le réglage manuel", () => {
    expect(resolveSeasonKey("halloween", 6, 1)).toBe("halloween");
    expect(resolveSeasonKey("summer", 1, 1)).toBe("summer");
  });

  it("déduit la saison depuis le mois (hémisphère Nord)", () => {
    expect(resolveSeasonKey("auto", 4, 15)).toBe("spring");
    expect(resolveSeasonKey("auto", 7, 15)).toBe("summer");
    expect(resolveSeasonKey("auto", 9, 15)).toBe("autumn");
    expect(resolveSeasonKey("auto", 1, 15)).toBe("winter");
  });

  it("bascule en Halloween fin octobre", () => {
    expect(resolveSeasonKey("auto", 10, 23)).toBe("autumn");
    expect(resolveSeasonKey("auto", 10, 24)).toBe("halloween");
    expect(resolveSeasonKey("auto", 10, 31)).toBe("halloween");
  });
});

describe("getAmbiance", () => {
  it("active le mode effrayant pour Halloween, quelle que soit l'heure", () => {
    const a = getAmbiance("day", "halloween");
    expect(a.scary).toBe(true);
    expect(a.celestial).toBe("moon");
    expect(a.particles).toBe("embers");
  });

  it("associe une saison non effrayante à une ambiance normale", () => {
    const a = getAmbiance("day", "summer");
    expect(a.scary).toBe(false);
    expect(a.celestial).toBe("sun");
  });

  it("expose une densité de brouillard plus forte la nuit que le jour", () => {
    expect(getAmbiance("night", "summer").fogDensity).toBeGreaterThan(
      getAmbiance("day", "summer").fogDensity,
    );
  });
});

describe("mix", () => {
  it("renvoie les couleurs extrêmes aux bornes", () => {
    expect(mix(0x000000, 0xffffff, 0)).toBe(0x000000);
    expect(mix(0x000000, 0xffffff, 1)).toBe(0xffffff);
  });

  it("interpole à mi-chemin (arrondi)", () => {
    // Math.round(127.5) = 128 → 0x80 par canal.
    expect(mix(0x000000, 0xffffff, 0.5)).toBe(0x808080);
  });
});
