// Ambiance sonore : souffle de vent synthétisé (bruit blanc filtré, Web Audio
// API native — aucun asset audio à charger), modulé par la météo dynamique
// (issue #8). Démarré depuis un geste utilisateur (verrouillage du pointeur) :
// les navigateurs interdisent l'audio avant toute interaction.
import type { WeatherKey } from "../ambiance.ts";

const NOISE_DURATION_S = 4; // buffer de bruit blanc bouclé
const GAIN_RAMP_S = 1.5; // douceur des transitions (météo, coupure du son)
const WEATHER_GAIN: Record<WeatherKey, number> = { clear: 0.05, brumeux: 0.09, orageux: 0.16 };
const WEATHER_CUTOFF: Record<WeatherKey, number> = { clear: 900, brumeux: 500, orageux: 260 }; // Hz, passe-bas

/** Souffle de vent ambiant, en boucle, dont le volume/timbre suit la météo. */
export class AmbientAudio {
  private ctx: AudioContext | null = null;
  private gain: GainNode | null = null;
  private filter: BiquadFilterNode | null = null;
  private muted = false;
  private weather: WeatherKey = "clear";

  /** À appeler synchroniquement depuis un gestionnaire de clic (geste utilisateur). */
  start() {
    if (this.ctx) return; // déjà démarré
    const ctx = new AudioContext();
    const buffer = ctx.createBuffer(1, Math.round(ctx.sampleRate * NOISE_DURATION_S), ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;

    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.loop = true;

    const filter = ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = WEATHER_CUTOFF[this.weather];

    const gain = ctx.createGain();
    gain.gain.value = 0; // fondu d'entrée via applyGain(), pas de « pop »

    source.connect(filter).connect(gain).connect(ctx.destination);
    source.start();

    this.ctx = ctx;
    this.gain = gain;
    this.filter = filter;
    this.applyGain();
  }

  /** Ajuste le volume/timbre du vent selon la météo (issue #8). */
  setWeather(weather: WeatherKey) {
    this.weather = weather;
    if (!this.ctx || !this.filter) return;
    this.filter.frequency.linearRampToValueAtTime(WEATHER_CUTOFF[weather], this.ctx.currentTime + GAIN_RAMP_S);
    this.applyGain();
  }

  /** Coupe/rétablit le son (panneau Ambiance). */
  setMuted(muted: boolean) {
    this.muted = muted;
    this.applyGain();
  }

  private applyGain() {
    if (!this.ctx || !this.gain) return;
    const target = this.muted ? 0 : WEATHER_GAIN[this.weather];
    this.gain.gain.linearRampToValueAtTime(target, this.ctx.currentTime + GAIN_RAMP_S);
  }

  dispose() {
    void this.ctx?.close();
    this.ctx = null;
    this.gain = null;
    this.filter = null;
  }
}
