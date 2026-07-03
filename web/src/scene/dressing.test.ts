import { describe, expect, it } from "vitest";
import { dressingFor, type DressingInputs } from "./dressing.ts";

const inputs = (overrides: Partial<DressingInputs> = {}): DressingInputs => ({
  upness: 0.5,
  cavity: 0.5,
  maintenance: 0.5,
  votes: 0,
  ...overrides,
});

describe("dressingFor — mousse (cavity haut & upness bas)", () => {
  it("est maximale à cavity=1/upness=0 sur un balayage de points", () => {
    const max = dressingFor(inputs({ cavity: 1, upness: 0 })).mossIntensity;
    for (const cavity of [0, 0.3, 0.6, 1]) {
      for (const upness of [0, 0.3, 0.6, 1]) {
        expect(dressingFor(inputs({ cavity, upness })).mossIntensity).toBeLessThanOrEqual(max);
      }
    }
  });

  it("croît avec cavity à upness fixe", () => {
    const low = dressingFor(inputs({ cavity: 0.2 })).mossIntensity;
    const high = dressingFor(inputs({ cavity: 0.9 })).mossIntensity;
    expect(high).toBeGreaterThan(low);
  });

  it("décroît avec upness à cavity fixe", () => {
    const low = dressingFor(inputs({ upness: 0.9 })).mossIntensity;
    const high = dressingFor(inputs({ upness: 0.1 })).mossIntensity;
    expect(high).toBeGreaterThan(low);
  });
});

describe("dressingFor — lichen (upness haut)", () => {
  it("croît avec upness à cavity fixe", () => {
    const low = dressingFor(inputs({ upness: 0.1 })).lichenIntensity;
    const high = dressingFor(inputs({ upness: 0.9 })).lichenIntensity;
    expect(high).toBeGreaterThan(low);
  });

  it("est nul quand la surface est entièrement en creux (cavity=1)", () => {
    expect(dressingFor(inputs({ cavity: 1, upness: 1 })).lichenIntensity).toBe(0);
  });
});

describe("dressingFor — intensité globale monotone décroissante avec l'entretien", () => {
  it("décroît strictement quand maintenance augmente", () => {
    const levels = [0, 0.25, 0.5, 0.75, 1].map(
      (maintenance) => dressingFor(inputs({ maintenance })).intensity,
    );
    for (let i = 1; i < levels.length; i++) {
      expect(levels[i]).toBeLessThan(levels[i - 1]);
    }
  });

  it("est nulle quand la pierre est impeccable (maintenance=1)", () => {
    expect(dressingFor(inputs({ maintenance: 1 })).intensity).toBe(0);
  });
});

describe("dressingFor — déterminisme", () => {
  it("mêmes entrées → même sortie", () => {
    expect(dressingFor(inputs())).toEqual(dressingFor(inputs()));
  });
});

describe("dressingFor — votes (karma lisible via la teinte)", () => {
  it("hanté vs paradisiaque → décalages de teinte opposés", () => {
    const haunted = dressingFor(inputs({ votes: -1 })).hueBias;
    const blessed = dressingFor(inputs({ votes: 1 })).hueBias;
    expect(haunted).toBeLessThan(0);
    expect(blessed).toBeGreaterThan(0);
  });

  it("neutre (votes=0) est entre les deux extrêmes", () => {
    const neutral = dressingFor(inputs({ votes: 0 })).hueBias;
    const haunted = dressingFor(inputs({ votes: -1 })).hueBias;
    const blessed = dressingFor(inputs({ votes: 1 })).hueBias;
    expect(neutral).toBeGreaterThan(haunted);
    expect(neutral).toBeLessThan(blessed);
  });
});
