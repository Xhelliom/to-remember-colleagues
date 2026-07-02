// Analyse photométrique d'une image de cluster (concept ou rendu) : calcule le
// vecteur de métriques P1–P9 du référentiel (plans/CLUSTER_BIOME_CRITERIA.md),
// pour comparer finement un rendu au concept. Pur : (RGBA, w, h) → vecteur.

export type MetricsVector = {
  meanLum: number;          // P1 luminance moyenne [0,1]
  vignette: number;         // P2 L(centre 30 %) / L(bordure 12 %)
  canopyTop: number;        // P3 fraction feuillage bande haute
  skyGapArea: number;       // P4 fraction claire (L>0.7) en bande haute
  skyGapX: number;          // P4b abscisse normalisée du centroïde clair haut
  skyGapY: number;          // P4b ordonnée (dans la bande haute, 0..1 du frame)
  pathEarth: number;        // P5 fraction terre en bande basse centrale
  grass: number;            // P6 fraction herbe (vert) bande basse
  graveBlobs: number;       // P7 nb de silhouettes pierre bande milieu
  graveTallestX: number;    // P7b abscisse de la colonne pierre la plus haute
  symmetry: number;         // P8 corrélation miroir G/D [0,1]
  green: number;            // P9 part de vert
  brown: number;            // P9 part de brun
  blue: number;             // P9 part de bleu
  meanSat: number;          // P9 saturation moyenne [0,1]
};

type HSL = { h: number; s: number; l: number };

function rgbToHsl(r: number, g: number, b: number): HSL {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;
  if (d === 0) return { h: 0, s: 0, l };
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h: number;
  if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
  else if (max === g) h = ((b - r) / d + 2) / 6;
  else h = ((r - g) / d + 4) / 6;
  return { h: h * 360, s, l };
}

// Classes de pixels par teinte/saturation/luminance.
const isFoliage = (c: HSL) => c.h >= 60 && c.h <= 170 && c.s >= 0.12 && c.l <= 0.6;
const isGrass = (c: HSL) => c.h >= 60 && c.h <= 170 && c.s >= 0.12; // vert, toute luminance
const isEarth = (c: HSL) => c.h >= 15 && c.h <= 50 && c.s >= 0.12 && c.l >= 0.15 && c.l <= 0.75;
const isStone = (c: HSL) => c.s < 0.18 && c.l >= 0.2 && c.l <= 0.78;
const isBlue = (c: HSL) => c.h >= 180 && c.h <= 260 && c.s >= 0.1;

function lum(r: number, g: number, b: number): number {
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
}

function at(data: Uint8Array, w: number, x: number, y: number): number {
  return (y * w + x) * 4;
}

/** Compte les composantes connexes (4-voisins) d'un masque booléen, ≥ minPx. */
function countBlobs(mask: Uint8Array, w: number, h: number, minPx: number): { count: number; tallestX: number } {
  const label = new Int32Array(w * h).fill(0);
  const stack: number[] = [];
  let count = 0;
  let bestTop = h, tallestX = 0.5;
  for (let i = 0; i < w * h; i++) {
    if (!mask[i] || label[i]) continue;
    count++;
    let size = 0, minY = h, sumX = 0, nAtMin = 0;
    stack.push(i);
    label[i] = count;
    while (stack.length) {
      const p = stack.pop()!;
      const px = p % w, py = (p / w) | 0;
      size++;
      if (py < minY) { minY = py; sumX = px; nAtMin = 1; } else if (py === minY) { sumX += px; nAtMin++; }
      const nb = [p - 1, p + 1, p - w, p + w];
      const okX = [px > 0, px < w - 1, true, true];
      for (let k = 0; k < 4; k++) {
        const q = nb[k];
        if (okX[k] && q >= 0 && q < w * h && mask[q] && !label[q]) { label[q] = count; stack.push(q); }
      }
    }
    if (size < minPx) { count--; continue; }
    if (minY < bestTop) { bestTop = minY; tallestX = (sumX / nAtMin) / w; }
  }
  return { count, tallestX };
}

export function analyze(data: Uint8Array, w: number, h: number): MetricsVector {
  const topEnd = Math.floor(h * 0.33);
  const midEnd = Math.floor(h * 0.66);
  const cx0 = Math.floor(w * 0.4), cx1 = Math.floor(w * 0.6);

  let sumLum = 0;
  let centerLum = 0, centerN = 0, borderLum = 0, borderN = 0;
  let canopyN = 0, topN = 0;
  let brightN = 0, brightSumX = 0, brightSumY = 0;
  let earthN = 0, bottomCenterN = 0;
  let grassN = 0, bottomN = 0;
  let greenN = 0, brownN = 0, blueN = 0, satSum = 0;

  const bx0 = Math.floor(w * 0.12), bx1 = Math.floor(w * 0.88);
  const by0 = Math.floor(h * 0.12), by1 = Math.floor(h * 0.88);
  const cxA = Math.floor(w * 0.35), cxB = Math.floor(w * 0.65);
  const cyA = Math.floor(h * 0.35), cyB = Math.floor(h * 0.65);

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = at(data, w, x, y);
      const r = data[i], g = data[i + 1], b = data[i + 2];
      const L = lum(r, g, b);
      const c = rgbToHsl(r, g, b);
      sumLum += L;
      satSum += c.s;

      if (x >= cxA && x < cxB && y >= cyA && y < cyB) { centerLum += L; centerN++; }
      if (x < bx0 || x >= bx1 || y < by0 || y >= by1) { borderLum += L; borderN++; }

      if (isGrass(c)) greenN++;
      else if (isEarth(c)) brownN++;
      else if (isBlue(c)) blueN++;

      if (y < topEnd) {
        topN++;
        if (isFoliage(c)) canopyN++;
        if (L > 0.7) { brightN++; brightSumX += x; brightSumY += y; }
      }
      if (y >= midEnd) {
        bottomN++;
        if (isGrass(c)) grassN++;
        if (x >= cx0 && x < cx1) { bottomCenterN++; if (isEarth(c)) earthN++; }
      }
    }
  }

  // P7 : blobs pierre dans la bande milieu (sous-échantillonnée pour la vitesse).
  const mw = midEnd - topEnd;
  const stoneMask = new Uint8Array(w * mw);
  for (let y = topEnd; y < midEnd; y++) {
    for (let x = 0; x < w; x++) {
      const i = at(data, w, x, y);
      const c = rgbToHsl(data[i], data[i + 1], data[i + 2]);
      if (isStone(c)) stoneMask[(y - topEnd) * w + x] = 1;
    }
  }
  const minBlob = Math.floor(w * mw * 0.0006); // ~0.06 % de la bande
  const blobs = countBlobs(stoneMask, w, mw, minBlob);

  // P8 : corrélation miroir gauche/droite sur la luminance.
  let symDiff = 0, symN = 0;
  for (let y = 0; y < h; y += 2) {
    for (let x = 0; x < (w >> 1); x += 2) {
      const i = at(data, w, x, y);
      const j = at(data, w, w - 1 - x, y);
      symDiff += Math.abs(lum(data[i], data[i + 1], data[i + 2]) - lum(data[j], data[j + 1], data[j + 2]));
      symN++;
    }
  }

  const total = w * h;
  return {
    meanLum: sumLum / total,
    vignette: (centerLum / Math.max(1, centerN)) / Math.max(1e-6, borderLum / Math.max(1, borderN)),
    canopyTop: canopyN / Math.max(1, topN),
    skyGapArea: brightN / Math.max(1, topN),
    skyGapX: brightN ? brightSumX / brightN / w : 0.5,
    skyGapY: brightN ? (brightSumY / brightN) / topEnd : 0,
    pathEarth: earthN / Math.max(1, bottomCenterN),
    grass: grassN / Math.max(1, bottomN),
    graveBlobs: blobs.count,
    graveTallestX: blobs.tallestX,
    symmetry: 1 - symDiff / Math.max(1, symN),
    green: greenN / total,
    brown: brownN / total,
    blue: blueN / total,
    meanSat: satSum / total,
  };
}

// Bornes de normalisation par champ (échelle typique) pour la distance.
const NORM: Record<keyof MetricsVector, number> = {
  meanLum: 0.5, vignette: 2, canopyTop: 1, skyGapArea: 0.15, skyGapX: 1, skyGapY: 1,
  pathEarth: 1, grass: 1, graveBlobs: 8, graveTallestX: 1, symmetry: 1,
  green: 0.6, brown: 0.4, blue: 0.3, meanSat: 0.5,
};

/** Similarité [0,1] = 1 − distance L2 normalisée entre deux vecteurs. */
export function similarity(a: MetricsVector, b: MetricsVector): number {
  const keys = Object.keys(NORM) as (keyof MetricsVector)[];
  let sum = 0;
  for (const k of keys) {
    const d = (a[k] - b[k]) / NORM[k];
    sum += d * d;
  }
  return Math.max(0, 1 - Math.sqrt(sum / keys.length));
}
