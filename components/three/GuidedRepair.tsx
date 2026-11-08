"use client";
// OWNER: Person A. Step-by-step 3D repair walkthrough, laid over a DeviceViewer.
//   <GuidedRepair deviceId="SW-C4-01" steps={cableSwap("port-13")} onDone={...} />
import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import DeviceViewer from "@/components/three/DeviceViewer";
import { getPositionMesh, MM, setHighlight, type PositionMeshData } from "@/components/three/chassis";
import { easeInOutCubic as ease } from "@/components/three/camera";
import { LED_ON, makeCable, makeFibre, makeLed, makeSfp, SFP_FRONT } from "@/components/three/repairParts";
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
  /** Read once when the device is ready. The camera stays on the first step's mesh throughout. */
  steps: StepFactory;
  onDone: () => void;
  onCancel?: () => void;
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

// ── Component ───────────────────────────────────────────────────────
export default function GuidedRepair({ deviceId, steps: factory, onDone, onCancel }: Props) {
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
        focusMesh={steps?.[0]?.highlightMesh}
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
