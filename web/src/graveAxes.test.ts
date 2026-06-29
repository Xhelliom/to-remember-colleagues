import { describe, expect, it } from "vitest";
import { ageFromDate, graveAxes, maintenanceAxis, voteAxis } from "./graveAxes.ts";

const NOW = Date.parse("2026-06-29T00:00:00Z");

describe("ageFromDate (axe 1 — vieillissement)", () => {
  it("vaut 0 pour une tombe neuve et sature à 1 pour une très vieille", () => {
    expect(ageFromDate(null, "2026-06-29T00:00:00Z", NOW)).toBe(0);
    expect(ageFromDate("1900-01-01", "2026-01-01", NOW)).toBe(1);
  });

  it("est dérivé de la date et croît avec l'ancienneté", () => {
    expect(ageFromDate("2006-06-29", "2026-01-01", NOW)).toBeGreaterThan(0.49);
    expect(ageFromDate("2000-01-01", "2026-01-01", NOW)).toBeGreaterThan(
      ageFromDate(null, "2026-01-01", NOW),
    );
  });

  it("retombe à 0 sur une date invalide", () => {
    expect(ageFromDate("pas-une-date", "aussi-invalide", NOW)).toBe(0);
  });
});

describe("voteAxis (axe 2 — votes)", () => {
  it("est neutre à 0 et borné dans [-1, 1]", () => {
    expect(voteAxis(0)).toBe(0);
    expect(voteAxis(50)).toBeGreaterThan(0.9);
    expect(voteAxis(50)).toBeLessThan(1);
    expect(voteAxis(-50)).toBeLessThan(-0.9);
  });

  it("est monotone croissant", () => {
    expect(voteAxis(5)).toBeGreaterThan(0);
    expect(voteAxis(5)).toBeLessThan(voteAxis(50));
  });
});

describe("maintenanceAxis (axe 3 — entretien)", () => {
  it("borne la valeur dans [0, 1]", () => {
    expect(maintenanceAxis(-2)).toBe(0);
    expect(maintenanceAxis(5)).toBe(1);
    expect(maintenanceAxis(0.5)).toBe(0.5);
  });
});

describe("graveAxes — les 3 axes sont indépendants", () => {
  it("rend une tombe vieille + paradisiaque + négligée sans qu'un axe en écrase un autre", () => {
    const combo = graveAxes(
      { departedOn: "1980-01-01", createdAt: "2026-01-01", voteScore: 40, maintenance: 0.1, construction: false },
      NOW,
    );
    expect(combo.age).toBe(1);
    expect(combo.vote).toBeGreaterThan(0.9);
    expect(combo.maintenance).toBeLessThan(0.2);
    expect(combo.construction).toBe(false);
  });

  it("propage construction=true depuis les données brutes (issue #21)", () => {
    const axes = graveAxes(
      { departedOn: "2027-01-01", createdAt: "2026-06-01", voteScore: 0, maintenance: 0.8, construction: true },
      NOW,
    );
    expect(axes.construction).toBe(true);
  });
});
