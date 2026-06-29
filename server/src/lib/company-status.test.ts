import { describe, expect, it } from "vitest";
import { companyStatus } from "./company-status.ts";

const NOW = Date.parse("2026-06-29T00:00:00Z");

describe("companyStatus", () => {
  it("est Naissant sans tombe ou sans inhumation", () => {
    expect(companyStatus(0, null, NOW)).toBe("Naissant");
    expect(companyStatus(0, "2026-01-01", NOW)).toBe("Naissant");
    expect(companyStatus(3, null, NOW)).toBe("Naissant");
  });

  it("est Ouvert quand une inhumation est récente (< 2 ans)", () => {
    expect(companyStatus(3, "2026-01-01", NOW)).toBe("Ouvert");
    expect(companyStatus(1, "2025-06-29", NOW)).toBe("Ouvert");
  });

  it("est En sommeil quand la dernière inhumation dépasse 2 ans", () => {
    expect(companyStatus(5, "2023-01-01", NOW)).toBe("En sommeil");
    expect(companyStatus(2, "2020-12-31", NOW)).toBe("En sommeil");
  });

  it("est Fermé quand closedAt est défini, quelle que soit l'activité", () => {
    expect(companyStatus(0, null, NOW, "2026-06-01T10:00:00Z")).toBe("Fermé");
    expect(companyStatus(5, "2026-06-01", NOW, "2026-06-10T00:00:00Z")).toBe("Fermé");
    expect(companyStatus(3, "2020-01-01", NOW, "2025-03-15T08:30:00Z")).toBe("Fermé");
  });
});
