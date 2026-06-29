import { describe, expect, it } from "vitest";
import { deterministicAnagram } from "./anagram.ts";

describe("deterministicAnagram (issue #22)", () => {
  it("est déterministe : même nom → même résultat", () => {
    const a = deterministicAnagram("Jean Dupont");
    const b = deterministicAnagram("Jean Dupont");
    expect(a).toBe(b);
  });

  it("préserve les mêmes lettres dans chaque mot", () => {
    const name = "Jean Dupont";
    const anagram = deterministicAnagram(name);
    const words = name.split(" ");
    const anagramWords = anagram.split(" ");
    expect(anagramWords).toHaveLength(words.length);
    for (let i = 0; i < words.length; i++) {
      const sorted = (s: string) => s.split("").sort().join("");
      expect(sorted(anagramWords[i]!)).toBe(sorted(words[i]!));
    }
  });

  it("traite un nom à un seul mot", () => {
    const name = "Alice";
    const anagram = deterministicAnagram(name);
    expect(anagram.split("").sort().join("")).toBe(name.split("").sort().join(""));
  });

  it("deux noms distincts ne produisent pas le même résultat", () => {
    expect(deterministicAnagram("Alice Martin")).not.toBe(deterministicAnagram("Bob Durand"));
  });
});
