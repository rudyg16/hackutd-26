// OWNER: Person A. Chassis builder: turns a seed/device-models.json spec into a THREE.Group
// whose position meshes are named exactly like Position.localId ("port-13", "dimm-A-7", ...).
//
// Scene conventions (shared by every 3D file):
//   - 1 scene unit = 1 metre (spec is in mm, multiply by MM).
//   - Group origin = bottom-centre of the device: x centred, y = 0 at its bottom, front face toward +Z.
//     Placing a device in a rack is just y = (uPosition - 1) * U.
//   - Meshes, geometries and materials are shared between devices. Do not dispose them.
import * as THREE from "three";
import { z } from "zod";
import modelsJson from "@/seed/device-models.json";
import type { DeviceKind, PartKind, Position, PositionKind, Severity } from "@/shared/types";

export const MM = 0.001;
export const U_MM = 44.45;
export const U = U_MM * MM;
/** Positions stand this far proud of their face, so they never flicker against it and win clicks. */
const RAISE_MM = 1;

// ── Spec schema ─────────────────────────────────────────────────────
// JSON imports widen literals (kind -> string, [x, y] -> number[]), so the type system can't catch
// typos in the spec. Validating with zod at load does, and gives us the DeviceModel type.
const pair = z.tuple([z.number(), z.number()]);

const FaceGroupSchema = z
  .object({
    kind: z.enum(["port", "dimm_slot", "drive_bay", "psu_bay", "fan_bay"] as const satisfies readonly PositionKind[]),
    prefix: z.string().min(1),
    count: z.number().int().positive(),
    rows: z.number().int().positive(),
    cols: z.number().int().positive(),
    start: pair,
    size: pair,
    pitch: pair,
    order: z.enum(["row-major", "odd-top"]),
    groupEvery: z.number().int().positive().optional(),
    groupGap: z.number().nonnegative().optional(),
    parts: z.array(z.enum(["sfp", "cable", "dimm", "drive", "psu", "fan"] as const satisfies readonly PartKind[])),
  })
  .strict()
  .refine((g) => g.rows * g.cols >= g.count, { message: "rows x cols must fit count" });

const DeviceModelSchema = z
  .object({
    name: z.string(),
    reference: z.string(),
    kind: z.enum(["switch", "server", "pdu", "patch_panel", "filler"] as const satisfies readonly DeviceKind[]),
    u: z.number().int().positive(),
    width: z.number().positive(),
    depth: z.number().positive(),
    faces: z
      .object({
        front: z.array(FaceGroupSchema).optional(),
        back: z.array(FaceGroupSchema).optional(),
        top: z.array(FaceGroupSchema).optional(),
      })
      .strict(),
  })
  .strict();

export type FaceGroup = z.infer<typeof FaceGroupSchema>;
export type DeviceModel = z.infer<typeof DeviceModelSchema>;
export type FaceName = keyof DeviceModel["faces"];

export const DEVICE_MODELS: Record<string, DeviceModel> = z
  .record(z.string(), DeviceModelSchema)
  .parse(modelsJson.models);

export function getDeviceModel(modelId: string): DeviceModel {
  const model = DEVICE_MODELS[modelId];
  if (!model) throw new Error(`Unknown device model "${modelId}"`);
  return model;
}

// ── Layout (pure, in mm) ────────────────────────────────────────────
export interface Slot {
  localId: string;
  face: FaceName;
  group: FaceGroup;
  /** Bottom-left corner on the face, in mm, as seen looking at that face. */
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * Every position slot of a model, in face coordinates.
 * - "odd-top": column-major, 1 = top, 2 = bottom, 3 = top... (switch faceplates).
 * - "row-major": left to right, top row first.
 * - groupEvery/groupGap: a new block (extra gap) starts every groupEvery positions in numbering order.
 */
export function layoutModel(model: DeviceModel): Slot[] {
  const slots: Slot[] = [];
  for (const face of ["front", "back", "top"] as const) {
    for (const g of model.faces[face] ?? []) {
      for (let n = 0; n < g.count; n++) {
        const oddTop = g.order === "odd-top";
        const col = oddTop ? Math.floor(n / g.rows) : n % g.cols;
        const rowFromTop = oddTop ? n % g.rows : Math.floor(n / g.cols);
        const firstInCol = oddTop ? col * g.rows : col;
        const block = g.groupEvery ? Math.floor(firstInCol / g.groupEvery) : 0;
        slots.push({
          localId: `${g.prefix}-${n + 1}`,
          face,
          group: g,
          x: g.start[0] + col * g.pitch[0] + block * (g.groupGap ?? 0),
          y: g.start[1] + (g.rows - 1 - rowFromTop) * g.pitch[1],
          w: g.size[0],
          h: g.size[1],
        });
      }
    }
  }
  return slots;
}

// ── Shared geometry and materials ───────────────────────────────────
const shapeCache = new Map<string, { box: THREE.BoxGeometry; edges: THREE.EdgesGeometry }>();
function shape(w: number, h: number, d: number) {
  const key = `${w}|${h}|${d}`;
  let s = shapeCache.get(key);
  if (!s) {
    const box = new THREE.BoxGeometry(w, h, d);
    s = { box, edges: new THREE.EdgesGeometry(box) };
    shapeCache.set(key, s);
  }
  return s;
}

const CHASSIS_MATERIAL = new THREE.MeshStandardMaterial({ color: "#0e0f18", metalness: 0.3, roughness: 0.8 });

const KIND_MATERIAL: Record<PositionKind, THREE.MeshStandardMaterial> = {
  port: new THREE.MeshStandardMaterial({ color: "#151726", metalness: 0.3, roughness: 0.6 }),
  drive_bay: new THREE.MeshStandardMaterial({ color: "#151726", metalness: 0.4, roughness: 0.5 }),
  dimm_slot: new THREE.MeshStandardMaterial({ color: "#1b1e33", metalness: 0.2, roughness: 0.7 }),
  psu_bay: new THREE.MeshStandardMaterial({ color: "#151726", metalness: 0.4, roughness: 0.5 }),
  fan_bay: new THREE.MeshStandardMaterial({ color: "#11131f", metalness: 0.3, roughness: 0.6 }),
};

const CHASSIS_LINE = new THREE.LineBasicMaterial({ color: "#00f0ff", toneMapped: false });
const POSITION_LINE = new THREE.LineBasicMaterial({ color: "#00f0ff", transparent: true, opacity: 0.35 });

/** Severity colours, matching the sev-* tokens in app/globals.css. */
export const SEVERITY_COLOR: Record<Severity, string> = {
  low: "#39ff88",
  medium: "#ffb000",
  high: "#ff5f1f",
  critical: "#ff1f4b",
};

const SEVERITY_MATERIAL = Object.fromEntries(
  Object.entries(SEVERITY_COLOR).map(([sev, color]) => [
    sev,
    new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 1.5, toneMapped: false }),
  ]),
) as Record<Severity, THREE.MeshStandardMaterial>;

function outline(edges: THREE.EdgesGeometry, material: THREE.LineBasicMaterial) {
  const lines = new THREE.LineSegments(edges, material);
  lines.raycast = () => {}; // outlines never catch clicks
  return lines;
}

// ── Builder ─────────────────────────────────────────────────────────
export interface PositionMeshData {
  localId: string;
  kind: PositionKind;
  /** Which side of the device it's on, so cameras know where to look from. */
  face: FaceName;
  /** Part kinds that can sit in this position (cable, sfp...), for the guided repair later. */
  partKinds: PartKind[];
  /** The matching database row, or null if none was passed in. */
  position: Position | null;
  baseMaterial: THREE.Material;
}

export function buildChassis(model: DeviceModel, positions: Position[]): THREE.Group {
  const W = model.width;
  const H = model.u * U_MM;
  const D = model.depth;
  const root = new THREE.Group();
  root.name = model.name;

  const shell = shape(W * MM, H * MM, D * MM);
  const chassis = new THREE.Mesh(shell.box, CHASSIS_MATERIAL);
  chassis.name = "chassis";
  chassis.position.y = (H * MM) / 2;
  chassis.add(outline(shell.edges, CHASSIS_LINE));
  root.add(chassis);

  const byLocalId = new Map(positions.map((p) => [p.localId, p]));
  const meshes = new Map<string, THREE.Mesh>();
  const t = RAISE_MM * MM;

  for (const slot of layoutModel(model)) {
    const w = slot.w * MM;
    const h = slot.h * MM;
    const cx = slot.x + slot.w / 2; // slot centre on its face, mm
    const cy = slot.y + slot.h / 2;
    const s = slot.face === "top" ? shape(w, t, h) : shape(w, h, t);
    const material = KIND_MATERIAL[slot.group.kind];
    const mesh = new THREE.Mesh(s.box, material);
    mesh.name = slot.localId;

    if (slot.face === "front") {
      mesh.position.set((cx - W / 2) * MM, cy * MM, (D / 2) * MM + t / 2);
    } else if (slot.face === "back") {
      // Seen from behind, the face's left edge is the device's +X side.
      mesh.position.set((W / 2 - cx) * MM, cy * MM, -(D / 2) * MM - t / 2);
    } else {
      // Top face: y on the spec is the distance back from the front edge.
      mesh.position.set((cx - W / 2) * MM, H * MM + t / 2, (D / 2 - cy) * MM);
    }

    mesh.add(outline(s.edges, POSITION_LINE));
    mesh.userData = {
      localId: slot.localId,
      kind: slot.group.kind,
      face: slot.face,
      partKinds: slot.group.parts,
      position: byLocalId.get(slot.localId) ?? null,
      baseMaterial: material,
    } satisfies PositionMeshData;
    meshes.set(slot.localId, mesh);
    root.add(mesh);
  }

  const noMesh = positions.filter((p) => !meshes.has(p.localId)).map((p) => p.id);
  const noRow = positions.length > 0 ? [...meshes.keys()].filter((id) => !byLocalId.has(id)) : [];
  if (noMesh.length || noRow.length) {
    console.warn(`[chassis] ${model.name}: positions without a mesh`, noMesh, "meshes without a position", noRow);
  }

  root.userData.positionMeshes = meshes;
  return root;
}

/** The mesh for a position on a built chassis, e.g. getPositionMesh(group, "port-13"). */
export function getPositionMesh(chassis: THREE.Object3D, localId: string): THREE.Mesh | undefined {
  return (chassis.userData.positionMeshes as Map<string, THREE.Mesh> | undefined)?.get(localId);
}

/** Colour a position mesh by severity, or restore its normal look with null. */
export function setHighlight(mesh: THREE.Mesh, severity: Severity | null) {
  mesh.material = severity ? SEVERITY_MATERIAL[severity] : (mesh.userData as PositionMeshData).baseMaterial;
}
