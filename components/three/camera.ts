// OWNER: Person A. Camera helpers shared by the 3D views.
import * as THREE from "three";

/** OrbitControls as r3f exposes them through useThree((s) => s.controls). */
export type Controls = { target: THREE.Vector3; update: () => void } | null;

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
export function applyPose(
  camera: THREE.PerspectiveCamera,
  controls: Controls,
  pose: { position: THREE.Vector3; target: THREE.Vector3; distance: number },
) {
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
