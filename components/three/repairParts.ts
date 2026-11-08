// OWNER: Person A. Simple 3D models of things that plug into ports and bays, for the guided repair.
// Each part's origin sits on the slot's face; +X across, +Y up the face, +Z straight out of it. Units: metres
// (sizes below are written in mm). GuidedRepair turns this "face frame" to match the front, back or top.
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

/** A box of w x h x d mm centred at (x, y, z) mm. */
function box(w: number, h: number, d: number, material: THREE.Material, z: number, y = 0, x = 0, name?: string) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w * MM, h * MM, d * MM), material);
  mesh.position.set(x * MM, y * MM, z * MM);
  if (name) mesh.name = name;
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

// ── Hot-swap modules (fan, PSU, drive) and memory ───────────────────
const DARK = mat("#2a2e44");
const FACE = mat("#20243a");
const BLACK = mat("#0b0c12");
const BLADE = mat("#3f4566");
const BLUE_TAB = mat("#3a7bff");
const METAL = mat("#8a90a8", { metalness: 0.6, roughness: 0.4 });
const ORANGE = mat("#ff9a3a");
const PCB = mat("#1f6b46");
const CLIP = mat("#e8e8f0");

export type ModuleKind = "fan" | "psu" | "drive" | "dimm";

/** Which module kind a slot takes, from its `parts` in device-models.json. */
export function moduleKindOf(parts: string[]): ModuleKind | null {
  for (const k of ["fan", "psu", "drive", "dimm"] as const) if (parts.includes(k)) return k;
  return null;
}

/**
 * A replaceable module sized to a w x h mm slot. The body reaches back into the device (hidden inside it)
 * and slides out along +Z. Named sub-parts the walkthrough moves:
 *   fan:   `${name}/tab` (release tab), `${name}/led`
 *   psu:   `${name}/latch` (release latch), `${name}/led`; the power socket is at PSU_SOCKET
 *   drive: `${name}/handle` (swings open: rotate on Y), `${name}/button`, `${name}/led`
 *   dimm:  just the stick; its clips belong to the slot (makeDimmClips)
 */
export function makeModule(name: string, kind: ModuleKind, w: number, h: number): THREE.Group {
  const g = new THREE.Group();
  g.name = name;
  const led = (x: number, y: number, z: number) => box(3, 2, 1, LED_OFF, z, y, x, `${name}/led`);

  if (kind === "fan") {
    const r = Math.min(w, h) * 0.38;
    const blades = new THREE.Mesh(new THREE.CylinderGeometry(r * MM, r * MM, 1.5 * MM, 24), BLADE);
    blades.rotation.x = Math.PI / 2; // cylinder axis along +Z
    blades.position.z = 2.2 * MM;
    const hub = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.3 * MM, r * 0.3 * MM, 2.5 * MM, 16), BLACK);
    hub.rotation.x = Math.PI / 2;
    hub.position.z = 2.7 * MM;
    g.add(
      box(w - 1, h - 1, 30, DARK, -15),
      box(w - 1, h - 1, 1.5, FACE, 0.75),
      blades,
      hub,
      box(w * 0.35, 4, 5, BLUE_TAB, 3.5, -h / 2 + 4, 0, `${name}/tab`),
      led(w / 2 - 4, h / 2 - 4, 2),
    );
  } else if (kind === "psu") {
    g.add(
      box(w - 1, h - 1, 120, DARK, -60),
      box(w - 1, h - 1, 2, FACE, 1),
      box(14, 10, 2, BLACK, 3, 0, PSU_SOCKET(w)),
      box(3, 3, 8, METAL, 6, -h * 0.25, -w * 0.3),
      box(3, 3, 8, METAL, 6, -h * 0.25, w * 0.3),
      box(w * 0.6 + 3, 3, 3, METAL, 10, -h * 0.25),
      box(4, h * 0.5, 2, BLUE_TAB, 3, 0, w / 2 - 5, `${name}/latch`),
      led(w / 2 - 12, h / 2 - 5, 2.5),
    );
  } else if (kind === "drive") {
    const handle = new THREE.Group(); // hinged on the left edge of the bezel
    handle.name = `${name}/handle`;
    handle.position.set((-w / 2 + 4) * MM, 0, 3 * MM);
    handle.add(box(w * 0.75, h * 0.45, 2, METAL, 1, 0, w * 0.375));
    g.add(
      box(w - 1, h - 1, 140, DARK, -70),
      box(w - 1, h - 1, 3, FACE, 1.5),
      handle,
      box(6, 4, 2, ORANGE, 4, 0, w / 2 - 8, `${name}/button`),
      led(w / 2 - 8, h / 2 - 4, 3.5),
    );
  } else {
    // DIMM: a thin board standing up out of its slot (w is the slot's narrow side, h its length).
    g.add(box(1.4, h - 6, 30, PCB, 15));
    for (const y of [-0.34, -0.11, 0.11, 0.34]) g.add(box(2.4, 12, 8, BLACK, 18, y * h));
  }
  return g;
}

/** x (mm, face frame) of a PSU's power socket. The cord plugs in here. */
export const PSU_SOCKET = (w: number) => -w / 2 + 12;

/** Power cord plug and cable. Origin = the PSU socket face. */
export function makeCord(name: string): THREE.Group {
  const g = new THREE.Group();
  g.name = name;
  g.add(
    box(13, 9, 18, BLACK, 9),
    cableTube([[0, 0, 18], [0, 0, 40], [0, -15, 65], [0, -70, 80], [0, -130, 84]], 3, BLACK),
  );
  return g;
}

/**
 * The two latching clips at the ends of a DIMM slot of length h mm. Open them by rotating on X:
 * `${name}/clip-a` (at +Y) by -angle and `${name}/clip-b` (at -Y) by +angle.
 */
export function makeDimmClips(name: string, h: number): THREE.Group[] {
  return (["a", "b"] as const).map((end) => {
    const clip = new THREE.Group();
    clip.name = `${name}/clip-${end}`;
    clip.position.set(0, (end === "a" ? 1 : -1) * (h / 2 - 1) * MM, 0);
    clip.add(box(4, 3, 9, CLIP, 4.5));
    return clip;
  });
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
