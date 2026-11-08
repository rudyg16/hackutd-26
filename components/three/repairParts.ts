// OWNER: Person A. Simple 3D models of things that plug into ports, for the guided repair.
// Each part's origin sits on the port's front face; +Z points out of the port. Units: metres.
import * as THREE from "three";
import { MM } from "@/components/three/chassis";

const mat = (color: string, extra: THREE.MeshStandardMaterialParameters = {}) =>
  new THREE.MeshStandardMaterial({ color, roughness: 0.6, metalness: 0.1, ...extra });

const PLUG = mat("#c9d1e8", { transparent: true, opacity: 0.85 }); // clear RJ45 plastic
const JACKET = { old: mat("#5a6488"), new: mat("#ff2bd6") }; // worn grey-blue vs new magenta
const SFP_METAL = mat("#8a90a8", { metalness: 0.7, roughness: 0.35 });
const BAIL = mat("#3a7bff");
const LC = mat("#3a7bff");
const FIBRE = mat("#e0c03a"); // yellow single-mode fibre

const LED_OFF = mat("#262a44");
/** Link LED lit: bright green. */
export const LED_ON = new THREE.MeshStandardMaterial({
  color: "#39ff88", emissive: "#39ff88", emissiveIntensity: 2, toneMapped: false,
});

/** Small link LED that sits just above a port; set its material to LED_ON to light it. */
export function makeLed(name: string): THREE.Mesh {
  const led = new THREE.Mesh(new THREE.BoxGeometry(3 * MM, 2 * MM, 1 * MM), LED_OFF);
  led.name = name;
  return led;
}

/** Where the front of an SFP ends up, measured out from the port face. Fibre plugs in here. */
export const SFP_FRONT = 16 * MM;

function box(w: number, h: number, d: number, material: THREE.Material, z: number, y = 0) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w * MM, h * MM, d * MM), material);
  mesh.position.set(0, y * MM, z * MM);
  return mesh;
}

/** A cable leaving a connector: straight out, then curving down. Points in mm. */
function cableTube(points: Array<[number, number, number]>, radius: number, material: THREE.Material) {
  const curve = new THREE.CatmullRomCurve3(points.map(([x, y, z]) => new THREE.Vector3(x * MM, y * MM, z * MM)));
  return new THREE.Mesh(new THREE.TubeGeometry(curve, 32, radius * MM, 8), material);
}

/** RJ45 patch cable: plug, boot and cable hanging down. */
export function makeCable(name: string, kind: "old" | "new"): THREE.Group {
  const g = new THREE.Group();
  g.name = name;
  const jacket = JACKET[kind];
  g.add(
    box(11, 8, 14, PLUG, 7),
    box(9, 7, 12, jacket, 20),
    cableTube([[0, 0, 26], [0, 0, 45], [0, -15, 70], [0, -60, 85], [0, -110, 88]], 2.5, jacket),
  );
  return g;
}

/** SFP transceiver: metal body half inside the port, plus a bail latch that flips down (rotate `${name}/bail` on X). */
export function makeSfp(name: string): THREE.Group {
  const g = new THREE.Group();
  g.name = name;
  g.add(box(8.5, 7.5, 24, SFP_METAL, 4));
  const bail = new THREE.Group(); // pivot at the bottom-front edge of the SFP
  bail.name = `${name}/bail`;
  bail.position.set(0, -3.5 * MM, SFP_FRONT);
  bail.add(box(8, 1.2, 7, BAIL, 3.5));
  g.add(bail);
  return g;
}

/** LC fibre cable: connector, boot and a yellow fibre curving down. Origin = where it plugs into an SFP. */
export function makeFibre(name: string): THREE.Group {
  const g = new THREE.Group();
  g.name = name;
  g.add(
    box(7, 6, 12, LC, 6),
    box(5, 5, 10, FIBRE, 17),
    cableTube([[0, 0, 22], [0, 0, 40], [0, -12, 62], [0, -50, 76], [0, -100, 80]], 1.5, FIBRE),
  );
  return g;
}
