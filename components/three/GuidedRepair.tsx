"use client";
// OWNER: Person A. Step-by-step 3D repair walkthrough, laid over a DeviceViewer.
//   <GuidedRepair deviceId="SW-C4-01" steps={guidedRepair("port-13")} focusMesh="port-13" onDone={...} />
// Walkthroughs exist for cables, SFPs, fans, power supplies, drives and DIMMs.
import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import DeviceViewer from "@/components/three/DeviceViewer";
import { getPositionMesh, MM, setHighlight, type FaceName, type PositionMeshData } from "@/components/three/chassis";
import { easeInOutCubic as ease } from "@/components/three/camera";
import {
  LED_ON, makeCable, makeCord, makeDimmClips, makeFibre, makeLed, makeModule, makeSfp, moduleKindOf, PSU_SOCKET,
  SFP_FRONT, type ModuleKind,
} from "@/components/three/repairParts";
import type { Highlight } from "@/shared/types";

export interface Step {
  caption: string;
  /** Name of the mesh or part to light up, e.g. "port-13" or "port-13/old-cable". */
  highlightMesh: string;
  /** Sets the scene for progress t (0..1). Runs over ~1.2 s when the step opens; must not depend on earlier t. */
  animateFn?: (t: number) => void;
}

/** Builds a repair's steps once the 3D device exists (adds the parts it needs to the device). */
export type StepFactory = (device: THREE.Group) => Step[];

interface Props {
  deviceId: string;
  /** Read once when the device is ready. */
  steps: StepFactory;
  onDone: () => void;
  onCancel?: () => void;
  /** Position the camera stays on throughout (default: the first step's mesh). Its side sets the view. */
  focusMesh?: string;
  /** Space kept in view around it, metres (see repairFocusRadius). */
  focusRadius?: number;
}

const STEP_MS = 1200;
const NO_HIGHLIGHTS: Highlight[] = [];
const noop = () => {};

// ── Highlighting the current step's part ────────────────────────────
const GUIDE = new THREE.MeshStandardMaterial({ color: "#00f0ff", emissive: "#00f0ff", emissiveIntensity: 1.2, toneMapped: false });

function glow(obj: THREE.Object3D, on: boolean) {
  obj.traverse((o) => {
    if (!(o instanceof THREE.Mesh)) return;
    if (on && !o.userData.guideOriginal) {
      o.userData.guideOriginal = o.material;
      o.material = GUIDE;
    } else if (!on && o.userData.guideOriginal) {
      o.material = o.userData.guideOriginal;
      delete o.userData.guideOriginal;
    }
  });
}

/**
 * Port mesh, its front-face centre (where parts plug in), a readable label, and a link LED
 * added just above the port. lightUp() turns the LED (and the port) green.
 */
function portInfo(device: THREE.Group, localId: string) {
  const port = getPositionMesh(device, localId);
  if (!port) return null;
  const face = port.position.clone();
  face.z += 0.5 * MM; // port meshes stand 1 mm proud of the panel
  const label = (port.userData as PositionMeshData).position?.label ?? localId;
  const portHeight = (port.geometry as THREE.BoxGeometry).parameters.height;
  const led = makeLed(`${localId}/led`);
  led.position.set(face.x, face.y + portHeight / 2 + 2.5 * MM, face.z);
  device.add(led);
  const lightUp = () => {
    led.material = LED_ON;
    setHighlight(port, "low");
  };
  return { face, label, led, lightUp };
}

// ── Repair scripts ──────────────────────────────────────────────────
/** Swap the patch cable in a switch port. */
export function cableSwap(localId: string): StepFactory {
  return (device) => {
    const info = portInfo(device, localId);
    if (!info) return [];
    const { face, label, led, lightUp } = info;
    const oldCable = makeCable(`${localId}/old-cable`, "old");
    const newCable = makeCable(`${localId}/new-cable`, "new");
    newCable.visible = false;
    device.add(oldCable, newCable);
    const place = (obj: THREE.Object3D, out: number, down = 0) => obj.position.set(face.x, face.y - down, face.z + out);
    place(oldCable, 0);
    place(newCable, 0.08);

    return [
      { caption: `Find ${label} on the front panel. It's lit up in cyan.`, highlightMesh: localId },
      {
        caption: "Press the latch on the plug and pull the old cable straight out.",
        highlightMesh: oldCable.name,
        animateFn: (t) => place(oldCable, ease(t) * 0.06),
      },
      {
        caption: "Set the old cable aside, then check the port for dust or bent pins.",
        highlightMesh: localId,
        animateFn: (t) => {
          oldCable.visible = t < 1;
          place(oldCable, 0.06 + t * 0.08, t * 0.12);
        },
      },
      {
        caption: "Plug the new cable in until the latch clicks.",
        highlightMesh: newCable.name,
        animateFn: (t) => {
          newCable.visible = true;
          place(newCable, (1 - ease(t)) * 0.08);
        },
      },
      {
        caption: `Check the link light above ${label}: it should turn green.`,
        highlightMesh: led.name,
        animateFn: (t) => {
          if (t >= 0.3) lightUp();
        },
      },
    ];
  };
}

/** Remove and replace the SFP transceiver in an uplink port. */
export function sfpSwap(localId: string): StepFactory {
  return (device) => {
    const info = portInfo(device, localId);
    if (!info) return [];
    const { face, label, led, lightUp } = info;
    const oldSfp = makeSfp(`${localId}/old-sfp`);
    const newSfp = makeSfp(`${localId}/new-sfp`);
    const fibre = makeFibre(`${localId}/fibre`);
    newSfp.visible = false;
    device.add(oldSfp, newSfp, fibre);
    const oldBail = oldSfp.getObjectByName(`${oldSfp.name}/bail`)!;
    const newBail = newSfp.getObjectByName(`${newSfp.name}/bail`)!;
    const place = (obj: THREE.Object3D, out: number, side = 0) => obj.position.set(face.x + side, face.y, face.z + out);
    place(oldSfp, 0);
    place(fibre, SFP_FRONT);
    // Fibre is unplugged by moving out 5 cm and 3 cm aside, out of the SFP's way.
    const fibreAt = (k: number) => place(fibre, SFP_FRONT + k * 0.05, k * 0.03);
    const OPEN = Math.PI / 2;

    return [
      { caption: `Find ${label} on the right of the front panel. It's lit up in cyan.`, highlightMesh: localId },
      {
        caption: "Unplug the fibre cable from the SFP and move it aside.",
        highlightMesh: fibre.name,
        animateFn: (t) => fibreAt(ease(t)),
      },
      {
        caption: "Flip the SFP's bail latch down to unlock it.",
        highlightMesh: oldBail.name,
        animateFn: (t) => {
          oldBail.rotation.x = ease(t) * OPEN;
        },
      },
      {
        caption: "Pull the SFP straight out by its latch.",
        highlightMesh: oldSfp.name,
        animateFn: (t) => place(oldSfp, ease(t) * 0.06),
      },
      {
        caption: "Slide the new SFP in until it clicks, then close its latch.",
        highlightMesh: newSfp.name,
        animateFn: (t) => {
          oldSfp.visible = false;
          newSfp.visible = true;
          place(newSfp, (1 - ease(Math.min(1, t / 0.7))) * 0.06);
          newBail.rotation.x = OPEN * (1 - ease(Math.max(0, (t - 0.7) / 0.3)));
        },
      },
      {
        caption: "Plug the fibre cable back into the new SFP.",
        highlightMesh: fibre.name,
        animateFn: (t) => fibreAt(1 - ease(t)),
      },
      {
        caption: `Check the link light above ${label}: it should turn green.`,
        highlightMesh: led.name,
        animateFn: (t) => {
          if (t >= 0.3) lightUp();
        },
      },
    ];
  };
}

// ── Fan, PSU, drive and DIMM swaps ──────────────────────────────────
const NORMAL: Record<FaceName, THREE.Vector3> = {
  front: new THREE.Vector3(0, 0, 1),
  back: new THREE.Vector3(0, 0, -1),
  top: new THREE.Vector3(0, 1, 0),
};
/** How far each module slides out of its slot (metres). */
const TRAVEL: Record<ModuleKind, number> = { fan: 0.05, psu: 0.14, drive: 0.16, dimm: 0.05 };
const MODULE_NAME: Record<ModuleKind, string> = { fan: "fan", psu: "power supply", drive: "drive", dimm: "DIMM" };

/**
 * A group sitting on a slot's face, turned so parts built in the face frame (+Z out of the face) line up
 * with the front, back or top of the device. Also returns the slot's size in mm.
 */
function slotMount(device: THREE.Group, localId: string) {
  const slot = getPositionMesh(device, localId);
  if (!slot) return null;
  const data = slot.userData as PositionMeshData;
  const p = (slot.geometry as THREE.BoxGeometry).parameters;
  const w = p.width / MM;
  const h = (data.face === "top" ? p.depth : p.height) / MM;
  const mount = new THREE.Group();
  mount.name = `${localId}/mount`;
  mount.position.copy(slot.position).addScaledVector(NORMAL[data.face], 0.5 * MM);
  if (data.face === "back") mount.rotation.y = Math.PI; // seen from behind: +X runs the other way
  if (data.face === "top") mount.rotation.x = -Math.PI / 2; // +Z out of the face becomes up
  device.add(mount);
  return { slot, data, w, h, mount, label: data.position?.label ?? localId };
}

/** Swap a fan, power supply, drive or DIMM, whichever the slot takes. */
export function moduleSwap(localId: string): StepFactory {
  return (device) => {
    const s = slotMount(device, localId);
    const kind = s && moduleKindOf(s.data.partKinds);
    if (!s || !kind) return [];
    const { slot, data, w, h, mount, label } = s;
    const oldM = makeModule(`${localId}/old-${kind}`, kind, w, h);
    const newM = makeModule(`${localId}/new-${kind}`, kind, w, h);
    newM.visible = false;
    mount.add(oldM, newM);

    const at = (obj: THREE.Object3D, k: number) => obj.position.set(0, 0, k * TRAVEL[kind]);
    at(newM, 1);
    const part = (m: THREE.Object3D, name: string) => m.getObjectByName(`${m.name}/${name}`)!;
    const pullOut = (t: number) => at(oldM, ease(t));
    /** New module slides in over the first `share` of the step. */
    const slideIn = (t: number, share = 1) => {
      oldM.visible = false;
      newM.visible = true;
      at(newM, 1 - ease(Math.min(1, t / share)));
    };
    const lightUp = () => {
      const led = newM.getObjectByName(`${newM.name}/led`);
      if (led instanceof THREE.Mesh) led.material = LED_ON;
      setHighlight(slot, "low");
    };
    // Parts under the lid (server fans): the server is pulled out on its rails and opened first,
    // then closed and pushed back in at the end. Front/back modules swap with the server in place.
    const underLid = data.face === "top";
    const find: Step = {
      caption: underLid
        ? `Slide the server out on its rails until they lock, then open the lid. Find ${label}; it's lit up in cyan.`
        : `Find ${label} on the ${data.face} panel. It's lit up in cyan.`,
      highlightMesh: oldM.name,
    };
    const check: Step = {
      caption:
        `Check the ${MODULE_NAME[kind]}'s status light: it should turn green.` +
        (underLid ? " Then close the lid and slide the server back into the rack." : ""),
      highlightMesh: `${newM.name}/led`,
      animateFn: (t) => {
        if (t >= 0.3) lightUp();
      },
    };

    if (kind === "fan") {
      const tab = part(oldM, "tab");
      return [
        find,
        {
          caption: "Squeeze the blue release tab on the fan.",
          highlightMesh: tab.name,
          animateFn: (t) => {
            tab.position.z = (3.5 - 1.5 * ease(t)) * MM;
          },
        },
        { caption: "Pull the fan straight out of its bay.", highlightMesh: oldM.name, animateFn: pullOut },
        { caption: "Push the new fan in until it clicks.", highlightMesh: newM.name, animateFn: (t) => slideIn(t) },
        check,
      ];
    }

    if (kind === "psu") {
      const latch = part(oldM, "latch");
      const cord = makeCord(`${localId}/cord`);
      mount.add(cord);
      // Unplugged cord: 6 cm out and 3 cm down, clear of the power supply as it slides out.
      const cordAt = (k: number) => cord.position.set(PSU_SOCKET(w) * MM, -k * 0.03, 4 * MM + k * 0.06);
      cordAt(0);
      return [
        find,
        { caption: "Unplug the power cord from the power supply.", highlightMesh: cord.name, animateFn: (t) => cordAt(ease(t)) },
        {
          caption: "Press the blue release latch.",
          highlightMesh: latch.name,
          animateFn: (t) => {
            latch.position.x = (w / 2 - 5 - 2 * ease(t)) * MM;
          },
        },
        { caption: "Pull the power supply out by its handle.", highlightMesh: oldM.name, animateFn: pullOut },
        { caption: "Slide the new power supply in until the latch clicks.", highlightMesh: newM.name, animateFn: (t) => slideIn(t) },
        { caption: "Plug the power cord back in.", highlightMesh: cord.name, animateFn: (t) => cordAt(1 - ease(t)) },
        check,
      ];
    }

    if (kind === "drive") {
      const OPEN = 1.2; // handle swing, radians
      const button = part(oldM, "button");
      const handle = part(oldM, "handle");
      const newHandle = part(newM, "handle");
      newHandle.rotation.y = -OPEN; // new drives go in with the handle open
      return [
        find,
        {
          caption: "Press the orange release button. The drive's handle swings open.",
          highlightMesh: button.name,
          animateFn: (t) => {
            button.position.z = (4 - 1.5 * ease(Math.min(1, t / 0.3))) * MM;
            handle.rotation.y = -OPEN * ease(Math.max(0, (t - 0.3) / 0.7));
          },
        },
        { caption: "Pull the drive out by its handle.", highlightMesh: oldM.name, animateFn: pullOut },
        {
          caption: "Slide the new drive in, then swing the handle shut until it clicks.",
          highlightMesh: newM.name,
          animateFn: (t) => {
            slideIn(t, 0.7);
            newHandle.rotation.y = -OPEN * (1 - ease(Math.max(0, (t - 0.7) / 0.3)));
          },
        },
        { ...check, caption: `${check.caption} The array will start rebuilding onto it.` },
      ];
    }

    // DIMM: memory isn't hot-swappable, and its clips belong to the slot.
    const clips = new THREE.Group();
    clips.name = `${localId}/clips`;
    const [clipA, clipB] = makeDimmClips(localId, h);
    clips.add(clipA, clipB);
    mount.add(clips);
    const setClips = (k: number) => {
      clipA.rotation.x = -0.6 * k;
      clipB.rotation.x = 0.6 * k;
    };
    return [
      {
        caption: `Power the server down and slide it out on its rails (memory isn't hot-swappable). Then find ${label}.`,
        highlightMesh: oldM.name,
      },
      { caption: "Push the white clips at both ends of the slot outward.", highlightMesh: clips.name, animateFn: (t) => setClips(ease(t)) },
      { caption: "Lift the DIMM straight up out of the slot.", highlightMesh: oldM.name, animateFn: pullOut },
      {
        caption: "Line up the notch and press the new DIMM in until both clips snap shut.",
        highlightMesh: newM.name,
        animateFn: (t) => {
          slideIn(t, 0.7);
          setClips(1 - ease(Math.max(0, (t - 0.7) / 0.3)));
        },
      },
      {
        caption: "Slide the server back in and power it on. The memory check should pass.",
        highlightMesh: newM.name,
        animateFn: (t) => {
          if (t >= 0.3) setHighlight(slot, "low");
        },
      },
    ];
  };
}

// ── Picking the right walkthrough for a position ────────────────────
/** Button label for a position that takes these parts, or null if there's no walkthrough for it. */
export function repairLabel(parts: string[]): string | null {
  if (parts.includes("sfp")) return "SFP swap";
  if (parts.includes("cable")) return "cable swap";
  const kind = moduleKindOf(parts);
  return kind ? `${kind === "psu" ? "PSU" : kind === "dimm" ? "DIMM" : kind} swap` : null;
}

/** How much space the close-up keeps around a position (metres): long modules slide further out. */
export function repairFocusRadius(parts: string[]): number {
  const kind = moduleKindOf(parts);
  return kind === "psu" ? 0.16 : kind === "drive" ? 0.18 : kind === "dimm" ? 0.12 : 0.1;
}

/** The walkthrough for whatever sits in this position: cable, SFP, fan, power supply, drive or DIMM. */
export function guidedRepair(localId: string): StepFactory {
  return (device) => {
    const parts = (getPositionMesh(device, localId)?.userData as PositionMeshData | undefined)?.partKinds ?? [];
    if (parts.includes("sfp")) return sfpSwap(localId)(device);
    if (parts.includes("cable")) return cableSwap(localId)(device);
    return moduleSwap(localId)(device);
  };
}

// ── Component ───────────────────────────────────────────────────────
export default function GuidedRepair({ deviceId, steps: factory, onDone, onCancel, focusMesh, focusRadius }: Props) {
  const [device, setDevice] = useState<THREE.Group | null>(null);
  const [index, setIndex] = useState(0);
  const [replays, setReplays] = useState(0);

  // Build the steps once the device exists. The cleanup removes the parts the script added,
  // so React re-running effects in development doesn't leave a second cable in the port.
  const factoryRef = useRef(factory);
  const [steps, setSteps] = useState<Step[] | null>(null);
  useEffect(() => {
    if (!device) return;
    const before = new Set(device.children);
    setSteps(factoryRef.current(device));
    return () => {
      for (const child of [...device.children]) if (!before.has(child)) device.remove(child);
      setSteps(null);
    };
  }, [device]);
  const step = steps?.[index];

  // Light up the current step's part.
  useEffect(() => {
    const obj = step && device?.getObjectByName(step.highlightMesh);
    if (!obj) return;
    glow(obj, true);
    return () => glow(obj, false);
  }, [device, step]);

  // Play the current step's animation (again on Replay).
  useEffect(() => {
    const fn = step?.animateFn;
    if (!fn) return;
    const start = performance.now();
    let frame = 0;
    const tick = () => {
      const t = Math.min(1, (performance.now() - start) / STEP_MS);
      fn(t);
      if (t < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [step, replays]);

  const last = !!steps && index === steps.length - 1;
  const next = () => {
    step?.animateFn?.(1); // finish this step's motion even if Next was pressed early
    if (last) onDone();
    else setIndex((i) => i + 1);
  };

  return (
    <div className="absolute inset-0 z-20 bg-bg">
      <DeviceViewer
        deviceId={deviceId}
        highlights={NO_HIGHLIGHTS}
        onSelect={noop}
        focusMesh={focusMesh ?? steps?.[0]?.highlightMesh}
        focusRadius={focusRadius}
        onReady={setDevice}
      />
      <div className="absolute inset-x-0 bottom-0 z-10 border-t border-line bg-panel/90 p-4 space-y-3">
        {steps && step ? (
          <>
            <p className="text-dim">
              Guided repair · {deviceId} · step {index + 1} of {steps.length}
            </p>
            <p className="text-ink">{step.caption}</p>
            {/* Buttons sit on the right, clear of the Next.js dev badge in the bottom-left corner. */}
            <div className="flex justify-end gap-2">
              {onCancel && (
                <button className="mr-auto ml-14 border border-line px-3 py-1 text-dim hover:text-ink" onClick={onCancel}>
                  Exit
                </button>
              )}
              {step.animateFn && (
                <button className="border border-line px-3 py-1 text-dim hover:text-ink" onClick={() => setReplays((r) => r + 1)}>
                  Replay
                </button>
              )}
              <button className="border border-neon-cyan px-3 py-1 text-neon-cyan" onClick={next}>
                {last ? "Done" : "Next"}
              </button>
            </div>
          </>
        ) : (
          <div className="flex items-center gap-2">
            <p className="text-dim">{steps ? "This repair has no steps for that position." : "Loading device…"}</p>
            {onCancel && (
              <button className="ml-auto border border-line px-3 py-1 text-dim hover:text-ink" onClick={onCancel}>
                Exit
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
