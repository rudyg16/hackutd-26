"use client";
// OWNER: Person A. 3D close-up of one device: severity highlights, click-to-select, orbit controls.
import { useEffect, useMemo, useRef, useState } from "react";
import { Canvas, useThree, type ThreeEvent } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import * as THREE from "three";
import base from "@/seed/base.json";
import {
  buildChassis, getDeviceModel, getPositionMesh, setHighlight, type PositionMeshData,
} from "@/components/three/chassis";
import { fitPose, useCameraGlide } from "@/components/three/camera";
import type { Device, Highlight, Position, Severity } from "@/shared/types";

interface Props {
  deviceId: string;
  highlights: Highlight[];
  onSelect: (localId: string) => void;
  /** Zoom in close on this mesh (e.g. "port-13") instead of framing the whole device. */
  focusMesh?: string;
  /** Space kept in view around focusMesh, metres. Default 0.1. */
  focusRadius?: number;
  /** Called once with the built 3D device, so overlays like GuidedRepair can add and move parts. */
  onReady?: (device: THREE.Group) => void;
}

// Read from the seed until B exposes device positions over the API.
// (api.history returns one position at a time, so it can't build a whole device.)
const DEVICES = base.devices as unknown as Device[];
const POSITIONS = base.positions as unknown as Position[];

const RANK: Record<Severity, number> = { low: 1, medium: 2, high: 3, critical: 4 };

const VIEWS = {
  front: [0.25, 0.3, 1],
  top: [0, 1, 0.001],
  back: [-0.25, 0.3, -1],
} as const;
type View = keyof typeof VIEWS;

// Close-ups look from an angle, so things sliding in and out of a slot are easy to see.
const CLOSE_UP: Record<View, THREE.Vector3> = {
  front: new THREE.Vector3(0.9, 0.5, 1),
  top: new THREE.Vector3(1, 0.75, 1), // low enough that parts lifting out of the top visibly rise
  back: new THREE.Vector3(-0.9, 0.5, -1),
};
/** How much space around a focused mesh stays in view (metres): the port, its neighbours, a pulled cable. */
const CLOSE_UP_RADIUS = 0.1;

/** Glides the camera to frame the whole device from the chosen side, or a close-up of focusMesh. */
function CameraRig({
  group, view, focusMesh, focusRadius = CLOSE_UP_RADIUS,
}: { group: THREE.Group; view: View; focusMesh?: string; focusRadius?: number }) {
  const camera = useThree((s) => s.camera) as THREE.PerspectiveCamera;
  const { width, height } = useThree((s) => s.size);
  useCameraGlide(() => {
    group.updateWorldMatrix(true, true);
    const mesh = focusMesh ? group.getObjectByName(focusMesh) : undefined;
    if (mesh) {
      const center = mesh.getWorldPosition(new THREE.Vector3());
      return fitPose(camera, new THREE.Sphere(center, focusRadius), CLOSE_UP[view], width / height, 1);
    }
    const sphere = new THREE.Box3().setFromObject(group).getBoundingSphere(new THREE.Sphere());
    const [x, y, z] = VIEWS[view];
    return fitPose(camera, sphere, new THREE.Vector3(x, y, z), width / height);
  }, `${group.uuid}|${view}|${focusMesh ?? ""}|${focusRadius}|${width}x${height}`);
  return null;
}

export default function DeviceViewer({ deviceId, highlights, onSelect, focusMesh, focusRadius, onReady }: Props) {
  const [view, setView] = useState<View>("front");
  const [hovering, setHovering] = useState(false);

  const device = DEVICES.find((d) => d.id === deviceId);
  const group = useMemo(() => {
    if (!device) return null;
    const positions = POSITIONS.filter((p) => p.deviceId === device.id);
    return buildChassis(getDeviceModel(device.modelId), positions);
  }, [device]);

  const onReadyRef = useRef(onReady);
  useEffect(() => {
    onReadyRef.current = onReady;
  });
  useEffect(() => {
    if (group) onReadyRef.current?.(group);
  }, [group]);

  // Start a close-up from the side the focused part is on (a rear PSU is seen from the back).
  useEffect(() => {
    const face = focusMesh && (group?.getObjectByName(focusMesh)?.userData as Partial<PositionMeshData> | undefined)?.face;
    if (face) setView(face);
  }, [group, focusMesh]);

  // Recolour in place when highlights change; the device itself is only built once per deviceId.
  useEffect(() => {
    if (!group) return;
    const worst = new Map<string, Severity>();
    for (const h of highlights) {
      if (h.deviceId !== deviceId) continue;
      const cur = worst.get(h.localId);
      if (!cur || RANK[h.severity] > RANK[cur]) worst.set(h.localId, h.severity);
    }
    for (const mesh of group.userData.positionMeshes.values() as Iterable<THREE.Mesh>) {
      setHighlight(mesh, worst.get(mesh.name) ?? null);
    }
  }, [group, highlights, deviceId]);

  if (!device || !group) {
    return <p className="p-4 text-dim">Unknown device {deviceId}</p>;
  }

  const isPosition = (name: string) => getPositionMesh(group, name) !== undefined;

  const onClick = (e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation(); // only the nearest mesh under the cursor
    if (isPosition(e.object.name)) onSelect(e.object.name);
  };
  const onOver = (e: ThreeEvent<PointerEvent>) => {
    e.stopPropagation();
    setHovering(isPosition(e.object.name));
  };

  return (
    <div className={`relative h-full w-full ${hovering ? "cursor-pointer" : ""}`}>
      <div className="absolute right-3 top-3 z-10 flex gap-2">
        {(Object.keys(VIEWS) as View[]).map((v) => (
          <button
            key={v}
            onClick={() => setView(v)}
            className={`border px-2 py-1 ${view === v ? "border-neon-cyan text-neon-cyan" : "border-line text-dim hover:text-ink"}`}
          >
            {v}
          </button>
        ))}
      </div>
      <Canvas camera={{ position: [...VIEWS.front], fov: 35 }}>
        <color attach="background" args={["#07070c"]} />
        <ambientLight intensity={0.6} />
        <directionalLight position={[1, 2, 2]} intensity={2} />
        <directionalLight position={[-1, 1, -2]} intensity={1} />
        <primitive object={group} onClick={onClick} onPointerOver={onOver} onPointerOut={() => setHovering(false)} />
        <OrbitControls makeDefault />
        <CameraRig group={group} view={view} focusMesh={focusMesh} focusRadius={focusRadius} />
      </Canvas>
    </div>
  );
}
