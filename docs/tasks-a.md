# Person A — task list (3D floor, chassis builder)

Work through these in order. Run `/implement a` to pick up the next unchecked item.

---

- [x] **Chassis builder** — `components/three/chassis.ts`
  Write `buildChassis(model: DeviceModel, positions: Position[]): THREE.Group`.
  - Outer box: `model.width × (model.u × 44.45) × model.depth` mm (scale to scene units as you see fit — keep consistent).
  - For each face in `model.faces`, iterate its groups and generate a grid of box meshes.
  - Each mesh name = `${group.prefix}-${n}` (1-indexed), which must equal `Position.localId`.
  - Use `order: "row-major"` (left→right then next row) or `"odd-top"` (column-major, 1=top, 2=bottom, 3=top…) per group spec.
  - Material: dark-panel colour `#0e0f18`, thin neon-cyan wire frame on the face outlines.
  - Export the type `DeviceModel` inferred from `seed/device-models.json["models"][string]`.

- [x] **DeviceViewer component** — `components/three/DeviceViewer.tsx`
  ```ts
  interface Props {
    deviceId: string;
    highlights: Highlight[];   // from shared/types.ts
    onSelect: (localId: string) => void;
  }
  ```
  - Fetch the device row + its model + its positions from `seed/base.json` (swap to `api.history` later).
  - Render `buildChassis(model, positions)` inside a `<Canvas>`.
  - For each `Highlight`, find the mesh by name and overlay its material with the severity colour (`sev-low` → `#39ff88` etc., see `app/globals.css`).
  - On mesh click → `onSelect(mesh.name)`.
  - `OrbitControls` for mouse rotate/zoom.

- [x] **Floor scene** — `app/page.tsx`
  - Load `FloorView` from `/api/floor` (fall back to `seed/base.json` while B's route isn't live).
  - Render 8 racks in a 2-row grid (use `rack.row` / `rack.col`).
  - Each rack box glows by `worstSeverity`: `null` → dim `#262a44`, `low` → `#39ff88`, `medium` → `#ffb000`, `high` → `#ff5f1f`, `critical` → `#ff1f4b`. Use `pointLight` + bloom postprocessing for the neon effect.
  - Racks where `visible: false` render as grey (`#2a2a3a`), no label, no glow.
  - Clicking a rack selects it; store `selectedDeviceId` in state.
  - The aside panel gets an `onTicketClick(deviceId)` callback (stubbed for now — B wires open tickets; C wires ItemDrawer).

- [x] **Camera fly-in** — `app/page.tsx` / `components/three/FloorScene.tsx`
  - When `selectedDeviceId` changes, ease the camera to look at that device's rack position (tween position + lookAt over ~0.6 s using `useFrame`).
  - Clicking the canvas background (no rack hit) resets camera to the full floor overview.

- [x] **Guided repair animation** — `components/three/GuidedRepair.tsx` *(do this last)*
  ```ts
  interface Step { caption: string; highlightMesh: string; animateFn?: (t: number) => void; }
  interface Props { deviceId: string; steps: Step[]; onDone: () => void; }
  ```
  - Overlay on top of `<DeviceViewer>`.
  - Each step: show `caption`, highlight the mesh, run optional tween (e.g. pull a cable out).
  - "Next" button advances; last step shows "Done" which calls `onDone`.
  - Hard-code steps for cable swap on a switch port and SFP removal.
