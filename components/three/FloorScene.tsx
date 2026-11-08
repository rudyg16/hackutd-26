"use client";
// OWNER: Person A. The 3D data-center floor: racks in a grid, glowing by worst open severity,
// grey when out of the viewer's scope, with each visible rack's devices built by the chassis builder.
import { useEffect, useMemo, useState } from "react";
import { Canvas, useFrame, useThree, type ThreeEvent } from "@react-three/fiber";
import { Grid, Html, OrbitControls } from "@react-three/drei";
import { Bloom, EffectComposer } from "@react-three/postprocessing";
import * as THREE from "three";
import {
  buildChassis, getDeviceModel, getPositionMesh, MM, SEVERITY_COLOR, setHighlight, U, type PositionMeshData,
} from "@/components/three/chassis";
import { fitPose, useCameraGlide } from "@/components/three/camera";
import type { Device, FloorView, Highlight, Severity } from "@/shared/types";

type FloorRack = FloorView["racks"][number];

interface Props {
  floor: FloorView;
  selectedDeviceId: string | null;
  /** Selected position on the selected device, e.g. "port-13". The camera views it from its side. */
  selectedLocalId?: string | null;
  onSelectDevice: (deviceId: string | null) => void;
  /** Clicking a port, bay, fan or PSU on the device you're zoomed in on. */
  onSelectPosition?: (deviceId: string, localId: string) => void;
}

// ── Layout (metres) ─────────────────────────────────────────────────
export const RACK_W = 0.6;
export const RACK_D = 1.07;
const RACK_BASE = 0.05; // frame below U1
const PITCH_X = 0.75; // rack to rack along a row
const PITCH_Z = 2.6; // row to row (rack depth + aisle)

/** Direction the overview camera looks from: in front of the floor and above it. */
export const OVERVIEW_DIRECTION = new THREE.Vector3(0, 0.75, 1);

const rackHeight = (r: FloorRack) => RACK_BASE * 2 + r.heightU * U;

/**
 * Which way a rack's front faces along Z: +1 toward the front of the floor, -1 away from it.
 * Rows alternate like a real hot/cold-aisle layout: rows 0 and 1 stand back-to-back around a hot
 * aisle, with their fronts on the cold aisles outside.
 */
export const rackFacing = (rack: FloorRack): 1 | -1 => (rack.row % 2 === 0 ? 1 : -1);

/** Bottom-centre of a rack on the floor. Row 0 is at the front; the grid is centred on the origin. */
export function rackOrigin(rack: FloorRack, racks: FloorRack[]): [number, number, number] {
  const cols = Math.max(...racks.map((r) => r.col)) + 1;
  const rows = Math.max(...racks.map((r) => r.row)) + 1;
  return [(rack.col - (cols - 1) / 2) * PITCH_X, 0, ((rows - 1) / 2 - rack.row) * PITCH_Z];
}

// ── Shared geometry and materials ───────────────────────────────────
const RANK: Record<Severity, number> = { low: 1, medium: 2, high: 3, critical: 4 };
const HIDDEN_COLOR = "#2a2a3a";
const DIM_COLOR = "#262a44";
const noRaycast = () => {};

const BODY_VISIBLE = new THREE.MeshStandardMaterial({
  color: "#0e0f18", transparent: true, opacity: 0.25, depthWrite: false,
});
const BODY_HIDDEN = new THREE.MeshStandardMaterial({ color: HIDDEN_COLOR, roughness: 0.9 });
const EDGE_DIM = new THREE.LineBasicMaterial({ color: DIM_COLOR });
const EDGE_HIDDEN = new THREE.LineBasicMaterial({ color: "#3a3a4a" });
const STRIP_DIM = new THREE.MeshStandardMaterial({ color: DIM_COLOR });
const SELECTED_PLATE = new THREE.MeshBasicMaterial({ color: "#00f0ff", transparent: true, opacity: 0.25 });

// Severity glow: colours pushed above 1 so only these pass the bloom threshold.
const EDGE_SEV = {} as Record<Severity, THREE.LineBasicMaterial>;
const STRIP_SEV = {} as Record<Severity, THREE.MeshStandardMaterial>;
for (const sev of Object.keys(SEVERITY_COLOR) as Severity[]) {
  const c = SEVERITY_COLOR[sev];
  EDGE_SEV[sev] = new THREE.LineBasicMaterial({ color: new THREE.Color(c).multiplyScalar(2.5), toneMapped: false });
  STRIP_SEV[sev] = new THREE.MeshStandardMaterial({ color: c, emissive: c, emissiveIntensity: 3, toneMapped: false });
}

const geometryFor = (() => {
  const cache = new Map<number, { box: THREE.BoxGeometry; edges: THREE.EdgesGeometry }>();
  return (h: number) => {
    let g = cache.get(h);
    if (!g) {
      const box = new THREE.BoxGeometry(RACK_W, h, RACK_D);
      g = { box, edges: new THREE.EdgesGeometry(box) };
      cache.set(h, g);
    }
    return g;
  };
})();
const STRIP_GEO = new THREE.BoxGeometry(RACK_W - 0.06, 0.025, 0.01);
const PLATE_GEO = new THREE.PlaneGeometry(RACK_W + 0.2, RACK_D + 0.2);

const SEV_TEXT: Record<Severity, string> = {
  low: "text-sev-low", medium: "text-sev-medium", high: "text-sev-high", critical: "text-sev-critical",
};

/** Device id stored on a device group, found by walking up from any hit mesh. */
function deviceIdOf(obj: THREE.Object3D | null): string | null {
  for (let o = obj; o; o = o.parent) if (typeof o.userData.deviceId === "string") return o.userData.deviceId;
  return null;
}

// ── Servers on rails ────────────────────────────────────────────────
/**
 * How far a device slides out of the front of its rack on its rails (metres). Like a real technician,
 * we pull a server out to reach fans and memory under its lid; servers above and below cover its top.
 */
export const slideDistance = (modelId: string) => getDeviceModel(modelId).depth * MM * 0.85;

/** A device that eases out to `out` metres along the rack's front (and back in when `out` is 0). */
function SlidingDevice({ group, out }: { group: THREE.Group; out: number }) {
  useFrame((_, dt) => {
    const z = group.position.z;
    if (Math.abs(out - z) < 1e-4) return;
    group.position.z = z + (out - z) * (1 - Math.exp(-dt * 7)); // smooth, ~0.5 s
  });
  return <primitive object={group} />;
}

// ── Rack ────────────────────────────────────────────────────────────
function RackBox({
  rack, origin, devices, deviceGroups, worstByDevice, selected, selectedDeviceId, extendedDeviceId,
  onPick, onPickPosition, onHover,
}: {
  rack: FloorRack;
  origin: [number, number, number];
  devices: Device[];
  deviceGroups: Map<string, THREE.Group>;
  worstByDevice: Map<string, Severity>;
  selected: boolean;
  selectedDeviceId: string | null;
  /** Device pulled out of this rack on its rails, so parts on its top can be reached. */
  extendedDeviceId: string | null;
  onPick: (deviceId: string) => void;
  onPickPosition: (deviceId: string, localId: string) => void;
  onHover: (rackId: string | null) => void;
}) {
  const h = rackHeight(rack);
  const geo = geometryFor(h);
  const sev = rack.visible ? rack.worstSeverity : null;

  /** Device that a click on the rack frame selects: worst open problem first, then the top device. */
  const defaultDevice = () =>
    [...devices].sort(
      (a, b) =>
        (RANK[worstByDevice.get(b.id)!] ?? 0) - (RANK[worstByDevice.get(a.id)!] ?? 0) || b.uPosition - a.uPosition,
    )[0]?.id;

  const onClick = (e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation();
    if (!rack.visible) return;
    // Nearest thing hit that belongs to a device (skips the see-through rack frame).
    const hit = e.intersections.find((i) => deviceIdOf(i.object) !== null);
    const hitDevice = hit ? deviceIdOf(hit.object) : null;
    // Already zoomed in on this device: a click on one of its positions selects that position.
    if (hit && hitDevice && hitDevice === selectedDeviceId) {
      const group = deviceGroups.get(hitDevice);
      if (group && getPositionMesh(group, hit.object.name) === hit.object) {
        onPickPosition(hitDevice, hit.object.name);
        return;
      }
    }
    const id = hitDevice ?? defaultDevice();
    if (id) onPick(id);
  };

  return (
    <group
      position={origin}
      rotation-y={rackFacing(rack) === 1 ? 0 : Math.PI}
      onClick={onClick}
      onPointerOver={(e) => {
        e.stopPropagation();
        onHover(rack.visible ? rack.id : null);
      }}
      onPointerOut={() => onHover(null)}
    >
      <mesh position={[0, h / 2, 0]} geometry={geo.box} material={rack.visible ? BODY_VISIBLE : BODY_HIDDEN} />
      <lineSegments
        position={[0, h / 2, 0]}
        geometry={geo.edges}
        material={!rack.visible ? EDGE_HIDDEN : sev ? EDGE_SEV[sev] : EDGE_DIM}
        raycast={noRaycast}
      />

      {rack.visible && (
        <>
          <mesh position={[0, h - 0.03, RACK_D / 2 + 0.006]} geometry={STRIP_GEO} material={sev ? STRIP_SEV[sev] : STRIP_DIM} />
          {sev && (
            <pointLight position={[0, h * 0.6, RACK_D / 2 + 0.6]} color={SEVERITY_COLOR[sev]} intensity={3} distance={3} />
          )}
          <Html center position={[0, h + 0.18, 0]} zIndexRange={[10, 0]} className="pointer-events-none select-none">
            <span className={`border border-line bg-bg/70 px-1 ${selected ? "text-neon-cyan" : sev ? SEV_TEXT[sev] : "text-dim"}`}>
              {rack.label}
            </span>
          </Html>
          {devices.map((d) => {
            const group = deviceGroups.get(d.id);
            if (!group) return null;
            const depth = getDeviceModel(d.modelId).depth * MM;
            return (
              <group key={d.id} position={[0, RACK_BASE + (d.uPosition - 1) * U, RACK_D / 2 - depth / 2 - 0.02]}>
                <SlidingDevice group={group} out={d.id === extendedDeviceId ? slideDistance(d.modelId) : 0} />
              </group>
            );
          })}
        </>
      )}

      {selected && (
        <mesh rotation-x={-Math.PI / 2} position={[0, 0.002, 0]} geometry={PLATE_GEO} material={SELECTED_PLATE} raycast={noRaycast} />
      )}
    </group>
  );
}

/** Sphere around every rack, used to frame the whole floor. */
export function floorSphere(racks: FloorRack[]) {
  const box = new THREE.Box3();
  for (const r of racks) {
    const [x, , z] = rackOrigin(r, racks);
    box.expandByPoint(new THREE.Vector3(x - RACK_W / 2, 0, z - RACK_D / 2));
    box.expandByPoint(new THREE.Vector3(x + RACK_W / 2, rackHeight(r), z + RACK_D / 2));
  }
  return box.getBoundingSphere(new THREE.Sphere());
}

// ── Camera ──────────────────────────────────────────────────────────
type Side = "front" | "back" | "top";
/**
 * What the camera is zoomed in on: a device, seen from the side its worst problem is on.
 * `towardZ` is the world direction (+1/-1 along Z) the camera sits in, after the rack's facing;
 * `frontZ` the direction the rack's front faces. `slide` > 0 means the device is pulled out on its
 * rails by that many metres (problems on its top).
 */
type Focus = { deviceId: string; side: Side; towardZ: 1 | -1; frontZ: 1 | -1; steep: boolean; slide: number } | null;

const LOW = Math.tan(THREE.MathUtils.degToRad(25)); // normal viewing angle above the device
const HIGH = Math.tan(THREE.MathUtils.degToRad(60)); // steep enough to look over a 2 m rack in the way
function focusDirection(side: Side, towardZ: 1 | -1, steep: boolean) {
  if (side === "top") return new THREE.Vector3(0, HIGH, towardZ);
  return new THREE.Vector3(0, steep ? HIGH : LOW, towardZ);
}

/**
 * Glides the camera (~0.6 s) to the focused device, or back to the whole-floor overview when nothing
 * is selected. The first placement and nothing else is instant.
 */
function CameraRig({
  racks, focus, deviceGroups,
}: {
  racks: FloorRack[];
  focus: Focus;
  deviceGroups: Map<string, THREE.Group>;
}) {
  const camera = useThree((s) => s.camera) as THREE.PerspectiveCamera;
  const { width, height } = useThree((s) => s.size);
  const rackKey = racks.map((r) => `${r.id}:${r.row}:${r.col}`).join(",");
  const focusKey = focus ? `${focus.deviceId}|${focus.side}|${focus.towardZ}|${focus.steep}|${focus.slide}` : "overview";

  // Re-fly only when the focus, canvas size or rack layout changes, not on every floor poll.
  useCameraGlide(() => {
    const group = focus && deviceGroups.get(focus.deviceId);
    if (focus && group) {
      group.updateWorldMatrix(true, true);
      const sphere = new THREE.Box3().setFromObject(group).getBoundingSphere(new THREE.Sphere());
      // Aim where the device ends up once it has finished sliding out (or back in) on its rails.
      sphere.center.z += focus.frontZ * (focus.slide - group.position.z);
      return fitPose(camera, sphere, focusDirection(focus.side, focus.towardZ, focus.steep), width / height, 1.25);
    }
    return fitPose(camera, floorSphere(racks), OVERVIEW_DIRECTION, width / height, 1.0);
  }, `${focusKey}|${rackKey}|${width}x${height}`);

  return null;
}

// ── Scene ───────────────────────────────────────────────────────────
export default function FloorScene({
  floor, selectedDeviceId, selectedLocalId = null, onSelectDevice, onSelectPosition,
}: Props) {
  // Build each device once; rebuild only when the set of devices changes, not on every poll.
  const deviceKey = floor.devices.map((d) => `${d.id}:${d.modelId}`).join(",");
  const deviceGroups = useMemo(() => {
    const groups = new Map<string, THREE.Group>();
    for (const d of floor.devices) {
      const g = buildChassis(getDeviceModel(d.modelId), []);
      g.userData.deviceId = d.id;
      groups.set(d.id, g);
    }
    return groups;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deviceKey]);

  // Recolour positions whenever highlights change.
  const worstByDevice = useMemo(() => {
    const m = new Map<string, Severity>();
    for (const h of floor.highlights) {
      const cur = m.get(h.deviceId);
      if (!cur || RANK[h.severity] > RANK[cur]) m.set(h.deviceId, h.severity);
    }
    return m;
  }, [floor.highlights]);

  useEffect(() => {
    const byPosition = new Map<string, Severity>();
    for (const h of floor.highlights) {
      const key = `${h.deviceId}/${h.localId}`;
      const cur = byPosition.get(key);
      if (!cur || RANK[h.severity] > RANK[cur]) byPosition.set(key, h.severity);
    }
    for (const [deviceId, group] of deviceGroups) {
      for (const mesh of group.userData.positionMeshes.values() as Iterable<THREE.Mesh>) {
        setHighlight(mesh, byPosition.get(`${deviceId}/${mesh.name}`) ?? null);
      }
    }
  }, [deviceGroups, floor.highlights]);

  const selectedRackId = floor.devices.find((d) => d.id === selectedDeviceId)?.rackId ?? null;

  // Where to fly: the selected device, seen from the side of the selected position, else of its worst
  // problem (front if none), steeply when another rack stands on that side and would block the view.
  const focus = useMemo<Focus>(() => {
    const device = floor.devices.find((d) => d.id === selectedDeviceId);
    const rack = floor.racks.find((r) => r.id === device?.rackId);
    const group = device && deviceGroups.get(device.id);
    if (!device || !rack || !group) return null;
    let worst: Highlight | null = null;
    for (const h of floor.highlights) {
      if (h.deviceId === device.id && (!worst || RANK[h.severity] > RANK[worst.severity])) worst = h;
    }
    const lookAt = selectedLocalId ?? worst?.localId;
    const face = lookAt ? (getPositionMesh(group, lookAt)?.userData as PositionMeshData | undefined)?.face : undefined;
    const side: Side = face ?? "front";
    // The camera sits on the device's front (or top-front) side, or its back, turned by the rack's facing.
    const towardZ = (side === "back" ? -rackFacing(rack) : rackFacing(rack)) as 1 | -1;
    // Row 0 is at the front of the floor (+Z), so the rack on the camera's side is row - 1 toward +Z
    // and row + 1 toward -Z. If one stands there, look down over it.
    const neighbourRow = towardZ === 1 ? rack.row - 1 : rack.row + 1;
    const steep = side !== "top" && floor.racks.some((r) => r.col === rack.col && r.row === neighbourRow);
    // Fans and memory sit under the lid: pull the server out on its rails, as a technician would.
    const slide = side === "top" ? slideDistance(device.modelId) : 0;
    return { deviceId: device.id, side, towardZ, frontZ: rackFacing(rack), steep, slide };
  }, [floor.devices, floor.racks, floor.highlights, selectedDeviceId, selectedLocalId, deviceGroups]);

  const [hoveredRackId, setHoveredRackId] = useState<string | null>(null);
  useEffect(() => {
    document.body.style.cursor = hoveredRackId ? "pointer" : "";
    return () => {
      document.body.style.cursor = "";
    };
  }, [hoveredRackId]);

  return (
    <Canvas
      camera={{ position: [0, 4, 6], fov: 40 }}
      onPointerMissed={() => onSelectDevice(null)}
    >
      <color attach="background" args={["#07070c"]} />
      <ambientLight intensity={0.5} />
      <directionalLight position={[3, 6, 5]} intensity={1.5} />
      <Grid
        infiniteGrid
        cellSize={0.25}
        sectionSize={PITCH_X * 2}
        cellColor="#151726"
        sectionColor={DIM_COLOR}
        fadeDistance={60}
        position={[0, -0.001, 0]}
      />

      {floor.racks.map((rack) => (
        <RackBox
          key={rack.id}
          rack={rack}
          origin={rackOrigin(rack, floor.racks)}
          devices={floor.devices.filter((d) => d.rackId === rack.id)}
          deviceGroups={deviceGroups}
          worstByDevice={worstByDevice}
          selected={rack.id === selectedRackId}
          selectedDeviceId={selectedDeviceId}
          extendedDeviceId={focus && focus.slide > 0 ? focus.deviceId : null}
          onPick={onSelectDevice}
          onPickPosition={(deviceId, localId) =>
            onSelectPosition ? onSelectPosition(deviceId, localId) : onSelectDevice(deviceId)
          }
          onHover={setHoveredRackId}
        />
      ))}

      <OrbitControls makeDefault maxPolarAngle={Math.PI / 2.1} />
      <CameraRig racks={floor.racks} focus={focus} deviceGroups={deviceGroups} />
      <EffectComposer>
        <Bloom mipmapBlur luminanceThreshold={1} intensity={1.2} />
      </EffectComposer>
    </Canvas>
  );
}
