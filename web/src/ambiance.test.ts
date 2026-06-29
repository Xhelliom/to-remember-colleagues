import { describe, expect, it } from "vitest";
import { applyKarmaTheme, applyWeather, getAmbiance, mix, resolveSeasonKey, resolveTimeKey } from "./ambiance.ts";

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

describe("applyKarmaTheme (issue #3)", () => {
  const base = getAmbiance("day", "summer");

  it("retourne l'ambiance inchangée en zone neutre (|karma| < 10)", () => {
    expect(applyKarmaTheme(base, 0)).toBe(base);
    expect(applyKarmaTheme(base, 9)).toBe(base);
    expect(applyKarmaTheme(base, -9)).toBe(base);
  });

  it("modifie le ciel pour un karma positif (Paradis)", () => {
    const a = applyKarmaTheme(base, 30);
    // Le ciel doit être plus clair/bleuté que la base.
    expect(a.skyTop).not.toBe(base.skyTop);
    expect(a.fogDensity).toBeLessThan(base.fogDensity);
  });

  it("modifie le ciel pour un karma négatif (Enfer)", () => {
    const a = applyKarmaTheme(base, -30);
    // Le brouillard doit être plus dense.
    expect(a.fogDensity).toBeGreaterThan(base.fogDensity);
    expect(a.skyTop).not.toBe(base.skyTop);
  });

  it("active les particules pollen en Paradis fort et braises en Enfer fort", () => {
    expect(applyKarmaTheme(base, 50).particles).toBe("pollen");
    expect(applyKarmaTheme(base, -50).particles).toBe("embers");
  });

  it("respecte l'ambiance Halloween (scary) sans la modifier", () => {
    const halloween = getAmbiance("night", "halloween");
    expect(applyKarmaTheme(halloween, 50)).toBe(halloween);
    expect(applyKarmaTheme(halloween, -50)).toBe(halloween);
  });
});

describe("applyWeather (issue #8)", () => {
  it("ne modifie pas l'ambiance en temps clair", () => {
    const base = getAmbiance("day", "summer");
    expect(applyWeather(base, "clear")).toBe(base);
  });

  it("augmente la densité de brouillard en temps brumeux", () => {
    const base = getAmbiance("day", "summer");
    expect(applyWeather(base, "brumeux").fogDensity).toBeGreaterThan(base.fogDensity);
  });

  it("ajoute des particules de pluie en temps orageux", () => {
    expect(applyWeather(getAmbiance("day", "summer"), "orageux").particles).toBe("rain");
  });

  it("réduit davantage la lumière par temps orageux que brumeux", () => {
    const base = getAmbiance("day", "summer");
    const misty = applyWeather(base, "brumeux");
    const storm = applyWeather(base, "orageux");
    expect(storm.fogDensity).toBeGreaterThan(misty.fogDensity);
    expect(storm.hemiIntensity).toBeLessThan(misty.hemiIntensity);
  });

  it("ne remplace pas les particules de saison par pluie fine en brumeux", () => {
    const base = getAmbiance("night", "winter"); // snow
    expect(applyWeather(base, "brumeux").particles).toBe("snow");
  });

  it("écrase les particules de saison par la pluie en orageux", () => {
    const base = getAmbiance("day", "winter"); // snow
    expect(applyWeather(base, "orageux").particles).toBe("rain");
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
