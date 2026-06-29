/** Hash 32 bits FNV-1a (identique à web/src/procedural.ts). */
function hashSeed(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Générateur pseudo-aléatoire mulberry32 (identique à web/src/graves.ts). */
function makeRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffleWord(word: string, rng: () => number): string {
  const letters = word.split("");
  for (let i = letters.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [letters[i], letters[j]] = [letters[j]!, letters[i]!];
  }
  return letters.join("");
}

/**
 * Anagramme déterministe d'un nom : chaque mot est mélangé indépendamment
 * via FNV-1a (graine) + mulberry32. Stable pour un même nom (issue #22).
 */
export function deterministicAnagram(name: string): string {
  return name
    .split(" ")
    .map((word) => shuffleWord(word, makeRng(hashSeed(word))))
    .join(" ");
}
