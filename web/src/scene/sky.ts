import * as THREE from "three";

const SKY_RADIUS = 300;
const SKY_WIDTH_SEGMENTS = 32;
const SKY_HEIGHT_SEGMENTS = 16;

const VERTEX_SHADER = `
  varying vec3 vPos;
  void main() {
    vPos = position;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }`;

const FRAGMENT_SHADER = `
  varying vec3 vPos;
  uniform vec3 topColor;
  uniform vec3 bottomColor;
  void main() {
    float h = normalize(vPos).y * 0.5 + 0.5;
    gl_FragColor = vec4(mix(bottomColor, topColor, clamp(h, 0.0, 1.0)), 1.0);
  }`;

export type Sky = {
  mesh: THREE.Mesh;
  setColors(top: number, bottom: number): void;
};

/** Dôme de ciel à dégradé vertical (couleur du zénith vers l'horizon). */
export function createSky(): Sky {
  const material = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    uniforms: {
      topColor: { value: new THREE.Color(0x5b8fd6) },
      bottomColor: { value: new THREE.Color(0xbcd6f2) },
    },
    vertexShader: VERTEX_SHADER,
    fragmentShader: FRAGMENT_SHADER,
  });
  const geometry = new THREE.SphereGeometry(SKY_RADIUS, SKY_WIDTH_SEGMENTS, SKY_HEIGHT_SEGMENTS);
  const mesh = new THREE.Mesh(geometry, material);

  return {
    mesh,
    setColors(top, bottom) {
      (material.uniforms.topColor.value as THREE.Color).setHex(top);
      (material.uniforms.bottomColor.value as THREE.Color).setHex(bottom);
    },
  };
}
