// OWNER: Person A. Camera helpers shared by the 3D views.
import { useEffect, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";

/** OrbitControls as r3f exposes them through useThree((s) => s.controls). */
export type Controls = { target: THREE.Vector3; update: () => void; enabled: boolean } | null;

export type Pose = { position: THREE.Vector3; target: THREE.Vector3; distance: number };

/** Slow start, fast middle, slow end. t and the result are 0..1. */
export const easeInOutCubic = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);

/**
 * Where to put a camera so a sphere fits on screen when viewed from `direction`.
 * Accounts for the canvas aspect, so narrow or wide canvases both fit.
 */
export function fitPose(
  camera: THREE.PerspectiveCamera,
  sphere: THREE.Sphere,
  direction: THREE.Vector3,
  aspect: number,
  margin = 1.1,
) {
  const vFov = THREE.MathUtils.degToRad(camera.fov);
  const hFov = 2 * Math.atan(Math.tan(vFov / 2) * aspect);
  const distance = (sphere.radius * margin) / Math.sin(Math.min(vFov, hFov) / 2);
  const position = sphere.center.clone().addScaledVector(direction.clone().normalize(), distance);
  return { position, target: sphere.center.clone(), distance };
}

/** Jump the camera (and orbit target) to a pose immediately. */
export function applyPose(camera: THREE.PerspectiveCamera, controls: Controls, pose: Pose) {
  camera.position.copy(pose.position);
  camera.near = pose.distance / 100;
  camera.far = pose.distance * 100;
  camera.updateProjectionMatrix();
  if (controls) {
    controls.target.copy(pose.target);
    controls.update();
  } else {
    camera.lookAt(pose.target);
  }
}

/**
 * Glides the camera to `getPose()` whenever `key` changes (~0.6 s, eased). The first placement is
 * instant. Mouse orbiting is paused during a glide. Use inside a <Canvas> with <OrbitControls makeDefault />.
 */
export function useCameraGlide(getPose: () => Pose | null, key: string, ms = 600) {
  const camera = useThree((s) => s.camera) as THREE.PerspectiveCamera;
  const controls = useThree((s) => s.controls) as Controls;
  const flight = useRef<{ from: Pose; to: Pose; start: number } | null>(null);
  const placed = useRef(false);
  const getPoseRef = useRef(getPose);
  useEffect(() => {
    getPoseRef.current = getPose;
  });

  useEffect(() => {
    if (!controls) return; // wait for OrbitControls so the orbit target moves with the camera
    const to = getPoseRef.current();
    if (!to) return;
    if (!placed.current) {
      placed.current = true;
      applyPose(camera, controls, to);
      return;
    }
    const from: Pose = {
      position: camera.position.clone(),
      target: controls.target.clone(),
      distance: camera.position.distanceTo(controls.target),
    };
    camera.near = Math.min(from.distance, to.distance) / 100;
    camera.far = Math.max(from.distance, to.distance) * 100;
    camera.updateProjectionMatrix();
    controls.enabled = false;
    flight.current = { from, to, start: performance.now() };
  }, [key, camera, controls]);

  useFrame(() => {
    const f = flight.current;
    if (!f || !controls) return;
    const t = Math.min(1, (performance.now() - f.start) / ms);
    const k = easeInOutCubic(t);
    camera.position.lerpVectors(f.from.position, f.to.position, k);
    controls.target.lerpVectors(f.from.target, f.to.target, k);
    controls.update();
    if (t === 1) {
      applyPose(camera, controls, f.to);
      controls.enabled = true;
      flight.current = null;
    }
  });
}
