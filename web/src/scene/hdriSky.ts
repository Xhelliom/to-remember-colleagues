import * as THREE from "three";
import { RGBELoader } from "three/examples/jsm/loaders/RGBELoader.js";
import type { TimeKey } from "../ambiance.ts";

const HDRI_BASE = "/hdri/";

// Un seul HDR par moment de la journée ; la nuit (et Halloween) n'ont pas de
// HDR dédié et gardent le dôme shader dégradé (voir sky.ts).
const HDRI_BY_TIME: Partial<Record<TimeKey, string>> = {
  dawn: "qwantani_sunset_puresky_2k.hdr",
  day: "kloofendal_48d_partly_cloudy_puresky_2k.hdr",
  dusk: "qwantani_dusk_2_puresky_2k.hdr",
};

const rgbeLoader = new RGBELoader();

/** Ciel HDRI (fond + éclairage ambiant PBR) appliqué selon le moment de la
 *  journée ; retombe sur le dôme shader (sky.ts) quand aucun HDR n'est prévu. */
export class HdriSky {
  private readonly pmrem: THREE.PMREMGenerator;
  private readonly cache = new Map<string, THREE.Texture>();

  constructor(renderer: THREE.WebGLRenderer) {
    this.pmrem = new THREE.PMREMGenerator(renderer);
    this.pmrem.compileEquirectangularShader();
  }

  /** Applique le HDR de l'ambiance à la scène ; renvoie `false` si aucun HDR
   *  n'est prévu (l'appelant doit alors garder le dôme shader visible). */
  async apply(scene: THREE.Scene, timeKey: TimeKey, scary: boolean): Promise<boolean> {
    const file = scary ? undefined : HDRI_BY_TIME[timeKey];
    if (!file) {
      scene.background = null;
      scene.environment = null;
      return false;
    }
    const envMap = await this.load(file);
    scene.background = envMap;
    scene.environment = envMap;
    return true;
  }

  private async load(file: string): Promise<THREE.Texture> {
    const cached = this.cache.get(file);
    if (cached) return cached;
    const hdr = await rgbeLoader.loadAsync(HDRI_BASE + file);
    const envMap = this.pmrem.fromEquirectangular(hdr).texture;
    hdr.dispose();
    this.cache.set(file, envMap);
    return envMap;
  }
}
