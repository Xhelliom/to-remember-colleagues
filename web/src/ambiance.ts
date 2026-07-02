// Détermination et description de l'ambiance du cimetière selon l'heure et la saison.

export type TimeKey = "dawn" | "day" | "dusk" | "night";
export type SeasonKey = "spring" | "summer" | "autumn" | "winter" | "halloween";
export type ParticleKind = "none" | "snow" | "leaves" | "pollen" | "embers" | "rain";
/** Météo dynamique (issue #8) : modifie le brouillard et les particules par-dessus l'ambiance de base. */
export type WeatherKey = "clear" | "brumeux" | "orageux";

export type TimeSetting = TimeKey | "auto";
export type SeasonSetting = SeasonKey | "auto";

export type Ambiance = {
  timeKey: TimeKey;
  seasonKey: SeasonKey;
  skyTop: number;
  skyBottom: number;
  fogColor: number;
  fogDensity: number;
  hemiSky: number;
  hemiGround: number;
  hemiIntensity: number;
  keyLightColor: number;
  keyLightIntensity: number;
  /** Direction de la lumière principale (soleil ou lune), normalisée approximativement. */
  keyLightDir: [number, number, number];
  ambientColor: number;
  ambientIntensity: number;
  groundColor: number;
  grassColor: number;
  foliageColor: number;
  graveColor: number;
  /** Astre visible dans le ciel : soleil, lune ou aucun. */
  celestial: "sun" | "moon" | "none";
  celestialColor: number;
  particles: ParticleKind;
  /** Mode effrayant (Halloween) : lumière vacillante, citrouilles, chauves-souris… */
  scary: boolean;
};

export function resolveTimeKey(setting: TimeSetting, hour: number): TimeKey {
  if (setting !== "auto") return setting;
  if (hour >= 5 && hour < 8) return "dawn";
  if (hour >= 8 && hour < 18) return "day";
  if (hour >= 18 && hour < 21) return "dusk";
  return "night";
}

export function resolveSeasonKey(setting: SeasonSetting, month: number, day: number): SeasonKey {
  if (setting !== "auto") return setting;
  // Halloween : derniers jours d'octobre (hémisphère Nord).
  if (month === 10 && day >= 24) return "halloween";
  if (month >= 3 && month <= 5) return "spring";
  if (month >= 6 && month <= 8) return "summer";
  if (month >= 9 && month <= 11) return "autumn";
  return "winter";
}

// Palettes de base par saison (couleurs de jour).
const SEASON_PALETTE: Record<SeasonKey, { ground: number; grass: number; foliage: number; grave: number; particles: ParticleKind }> = {
  spring: { ground: 0x4a5a3a, grass: 0x6f8f4e, foliage: 0x7bb661, grave: 0x9a958c, particles: "pollen" },
  summer: { ground: 0x55603a, grass: 0x7c9244, foliage: 0x5f8f3e, grave: 0xa49f95, particles: "none" },
  autumn: { ground: 0x5b4a30, grass: 0x8a7a3e, foliage: 0xc06a2a, grave: 0x8f897e, particles: "leaves" },
  winter: { ground: 0x6b6f76, grass: 0x8f969c, foliage: 0x9aa6ad, grave: 0x9ea4ab, particles: "snow" },
  halloween: { ground: 0x241a26, grass: 0x33263a, foliage: 0x2c2230, grave: 0x6d6470, particles: "embers" },
};

// Modificateurs lumineux par moment de la journée.
const TIME_PROFILE: Record<TimeKey, {
  skyTop: number; skyBottom: number; fogColor: number; fogDensity: number;
  hemiSky: number; hemiGround: number; hemiIntensity: number;
  keyColor: number; keyIntensity: number; keyDir: [number, number, number];
  ambient: number; ambientIntensity: number; celestial: "sun" | "moon" | "none"; celestialColor: number;
}> = {
  dawn: {
    skyTop: 0x4a6a99, skyBottom: 0xe7a977, fogColor: 0xb79a8e, fogDensity: 0.018,
    hemiSky: 0x9fb8d8, hemiGround: 0x6a5d4e, hemiIntensity: 0.9,
    keyColor: 0xffd2a1, keyIntensity: 1.1, keyDir: [-0.6, 0.35, -0.7],
    ambient: 0x6f7a90, ambientIntensity: 0.5, celestial: "sun", celestialColor: 0xffd9a0,
  },
  day: {
    skyTop: 0x5b8fd6, skyBottom: 0xbcd6f2, fogColor: 0xc7d6e6, fogDensity: 0.01,
    hemiSky: 0xbfd8f2, hemiGround: 0x6b6453, hemiIntensity: 1.25,
    keyColor: 0xfff4e0, keyIntensity: 1.7, keyDir: [0.5, 0.85, 0.3],
    ambient: 0x9fb0c4, ambientIntensity: 0.65, celestial: "sun", celestialColor: 0xfff6e6,
  },
  dusk: {
    skyTop: 0x33305e, skyBottom: 0xd06a4f, fogColor: 0x7a5a66, fogDensity: 0.022,
    hemiSky: 0x6a5a8a, hemiGround: 0x4a3d3a, hemiIntensity: 0.75,
    keyColor: 0xff8a5c, keyIntensity: 1.0, keyDir: [0.7, 0.22, -0.5],
    ambient: 0x5a4f66, ambientIntensity: 0.45, celestial: "sun", celestialColor: 0xff7a4a,
  },
  night: {
    skyTop: 0x0a0f24, skyBottom: 0x1a2240, fogColor: 0x141a30, fogDensity: 0.03,
    hemiSky: 0x2a3458, hemiGround: 0x141420, hemiIntensity: 0.45,
    keyColor: 0x9fb6e0, keyIntensity: 0.55, keyDir: [-0.4, 0.6, -0.6],
    ambient: 0x26304e, ambientIntensity: 0.35, celestial: "moon", celestialColor: 0xcdd8ff,
  },
};

export function getAmbiance(timeKey: TimeKey, seasonKey: SeasonKey): Ambiance {
  const palette = SEASON_PALETTE[seasonKey];
  const scary = seasonKey === "halloween";

  // Halloween force une ambiance nocturne inquiétante quel que soit le moment.
  const profile = scary ? TIME_PROFILE.night : TIME_PROFILE[timeKey];

  const base: Ambiance = {
    timeKey,
    seasonKey,
    skyTop: profile.skyTop,
    skyBottom: profile.skyBottom,
    fogColor: profile.fogColor,
    fogDensity: profile.fogDensity,
    hemiSky: profile.hemiSky,
    hemiGround: profile.hemiGround,
    hemiIntensity: profile.hemiIntensity,
    keyLightColor: profile.keyColor,
    keyLightIntensity: profile.keyIntensity,
    keyLightDir: profile.keyDir,
    ambientColor: profile.ambient,
    ambientIntensity: profile.ambientIntensity,
    groundColor: palette.ground,
    grassColor: palette.grass,
    foliageColor: palette.foliage,
    graveColor: palette.grave,
    celestial: profile.celestial,
    celestialColor: profile.celestialColor,
    particles: palette.particles,
    scary,
  };

  if (scary) {
    // Cimetière qui fait peur : ciel violacé, pleine lune blafarde, brouillard épais.
    base.skyTop = 0x0c0816;
    base.skyBottom = 0x2a163a;
    base.fogColor = 0x160d1e;
    base.fogDensity = 0.05;
    base.hemiSky = 0x3a2a52;
    base.hemiGround = 0x120c18;
    base.hemiIntensity = 0.4;
    base.keyLightColor = 0xb9a6e0;
    base.keyLightIntensity = 0.5;
    base.ambientColor = 0x2a1a3a;
    base.ambientIntensity = 0.3;
    base.celestial = "moon";
    base.celestialColor = 0xe8e2ff;
  }

  // En hiver, le sol enneigé éclaircit l'ambiance ; en automne, teinte plus chaude.
  if (seasonKey === "winter" && !scary) {
    base.fogColor = mix(base.fogColor, 0xdfe6ee, 0.35);
    base.hemiIntensity *= 1.1;
  }

  return base;
}

// Seuils et saturation du karma pour le thème Paradis/Enfer (issue #3).
const KARMA_THRESHOLD = 10;
const KARMA_SATURATE = 40;

/**
 * Superpose le thème karmatique sur une ambiance de base (issue #3).
 * Karma ≥ 10 → teinture dorée/verdoyante (Paradis).
 * Karma ≤ -10 → teinture rouge-sombre/brasier (Enfer).
 * Halloween conserve son ambiance propre, indépendante du karma.
 */
export function applyKarmaTheme(a: Ambiance, karma: number): Ambiance {
  if (a.scary) return a;

  const paradis = Math.min(1, Math.max(0, (karma - KARMA_THRESHOLD) / KARMA_SATURATE));
  const enfer = Math.min(1, Math.max(0, (-karma - KARMA_THRESHOLD) / KARMA_SATURATE));
  if (paradis === 0 && enfer === 0) return a;

  const r = { ...a };
  if (paradis > 0) {
    r.skyTop = mix(a.skyTop, 0x7ec8e3, paradis * 0.5);
    r.skyBottom = mix(a.skyBottom, 0xd4f4c4, paradis * 0.6);
    r.fogColor = mix(a.fogColor, 0xbfe8d8, paradis * 0.4);
    r.fogDensity = a.fogDensity * (1 - paradis * 0.35);
    r.hemiSky = mix(a.hemiSky, 0xd4f0e8, paradis * 0.4);
    r.hemiIntensity = a.hemiIntensity * (1 + paradis * 0.25);
    r.keyLightColor = mix(a.keyLightColor, 0xfff8cc, paradis * 0.3);
    r.groundColor = mix(a.groundColor, 0x5a8040, paradis * 0.4);
    if (paradis > 0.5) r.particles = "pollen";
  }
  if (enfer > 0) {
    r.skyTop = mix(a.skyTop, 0x1a0404, enfer * 0.7);
    r.skyBottom = mix(a.skyBottom, 0x3a0808, enfer * 0.7);
    r.fogColor = mix(a.fogColor, 0x2a0606, enfer * 0.6);
    r.fogDensity = a.fogDensity * (1 + enfer * 0.8);
    r.hemiSky = mix(a.hemiSky, 0x3a1010, enfer * 0.5);
    r.hemiGround = mix(a.hemiGround, 0x1a0808, enfer * 0.5);
    r.keyLightColor = mix(a.keyLightColor, 0xff4a1a, enfer * 0.5);
    r.groundColor = mix(a.groundColor, 0x2a1510, enfer * 0.5);
    r.graveColor = mix(a.graveColor, 0x2a1818, enfer * 0.4);
    if (enfer > 0.5) r.particles = "embers";
  }
  return r;
}

/**
 * Applique une couche météo sur une ambiance de base (issue #8).
 * Ne modifie ni le temps de la journée ni la saison.
 */
export function applyWeather(a: Ambiance, weather: WeatherKey): Ambiance {
  if (weather === "clear") return a;
  const r = { ...a };
  if (weather === "brumeux") {
    r.fogDensity = a.fogDensity * 2.8;
    r.fogColor = mix(a.fogColor, 0x8a9aaa, 0.35);
    r.hemiIntensity = a.hemiIntensity * 0.8;
    // Pluie fine seulement si aucune particule de saison déjà active.
    if (a.particles === "none") r.particles = "rain";
  } else {
    // Orageux : brume épaisse, lumière étouffée, pluie battante.
    r.fogDensity = a.fogDensity * 5;
    r.fogColor = mix(a.fogColor, 0x4a5060, 0.55);
    r.hemiIntensity = a.hemiIntensity * 0.5;
    r.keyLightIntensity = a.keyLightIntensity * 0.35;
    r.particles = "rain";
  }
  return r;
}

// --- Grade filmique par heure (issue #14) -----------------------------------
// Teinte des ombres/hautes-lumières (split teal/orange), couplée au moment de la
// journée — consommé par `scene/post/grade.ts` (passe EffectComposer additive,
// gate `?post=1` dans `main.ts`, défaut inchangé).

export type FilmGrade = {
  /** Teinte multipliée dans les tons sombres (RGB, 1 = neutre). */
  readonly shadowTint: readonly [number, number, number];
  /** Teinte multipliée dans les hautes lumières (RGB, 1 = neutre). */
  readonly highlightTint: readonly [number, number, number];
  /** >1 = plus contrasté, <1 = plus plat. */
  readonly contrast: number;
  /** Multiplicateur de saturation (0 = niveaux de gris, 1 = inchangé). */
  readonly saturation: number;
};

const FILM_GRADE: Record<TimeKey, FilmGrade> = {
  // Aube : ombres bleu-teal froides, hautes lumières orangées (golden hour classique).
  dawn: { shadowTint: [0.55, 0.68, 0.74], highlightTint: [1.18, 0.94, 0.72], contrast: 1.08, saturation: 1.1 },
  // Midi : grade quasi neutre, très légèrement désaturé (lumière plate, zénithale).
  day: { shadowTint: [0.78, 0.82, 0.84], highlightTint: [1.03, 1.0, 0.95], contrast: 1.0, saturation: 0.95 },
  // Crépuscule : split plus marqué que l'aube (ombres plus froides, hautes lumières plus chaudes).
  dusk: { shadowTint: [0.48, 0.58, 0.74], highlightTint: [1.22, 0.8, 0.58], contrast: 1.12, saturation: 1.18 },
  // Nuit : ombres bleutées neutres, désaturation globale (vision scotopique).
  night: { shadowTint: [0.62, 0.7, 0.86], highlightTint: [0.88, 0.9, 1.06], contrast: 1.04, saturation: 0.8 },
};

/** Paramètres de grade filmique pour un moment de la journée — courbes DISTINCTES
 *  par `TimeKey` (protégé par un test dawn ≠ day dans post/grade.test.ts). */
export function getFilmGrade(timeKey: TimeKey): FilmGrade {
  return FILM_GRADE[timeKey];
}

/** Mélange linéaire de deux couleurs hexadécimales (t entre 0 et 1). */
export function mix(a: number, b: number, t: number): number {
  const ar = (a >> 16) & 0xff;
  const ag = (a >> 8) & 0xff;
  const ab = a & 0xff;
  const br = (b >> 16) & 0xff;
  const bg = (b >> 8) & 0xff;
  const bb = b & 0xff;
  const r = Math.round(ar + (br - ar) * t);
  const g = Math.round(ag + (bg - ag) * t);
  const bl = Math.round(ab + (bb - ab) * t);
  return (r << 16) | (g << 8) | bl;
}
