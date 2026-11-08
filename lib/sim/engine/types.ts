/** Engine types. Pure data, no I/O (SIM-SPEC §5, §10). */
import type { DeviceKind, IssueCategory, PartKind, PositionKind, ResolutionAction, Severity } from "@/shared/types";
import type { SimConfig } from "../config";

export const FAILURE_MODES = [
  "loose",
  "kinked",
  "dirty_optics",
  "failing_laser",
  "bad_port",
  "failing_rows",
  "media_wear",
  "bearing_wear",
  "input_fault",
] as const;
export type FailureMode = (typeof FAILURE_MODES)[number];

/** What a failure mode attaches to: a part kind, or the position itself (`bad_port`). */
export const MODE_TARGET: Record<FailureMode, PartKind | "position"> = {
  loose: "cable",
  kinked: "cable",
  dirty_optics: "sfp",
  failing_laser: "sfp",
  bad_port: "position",
  failing_rows: "dimm",
  media_wear: "drive",
  bearing_wear: "fan",
  input_fault: "psu",
};

// ── Inventory (what the hardware is) ────────────────────────────────
export interface InvDevice {
  id: string;
  kind: DeviceKind;
  rackId: string;
  tenantId: string;
}

export interface InvPosition {
  id: string;
  deviceId: string;
  localId: string;
  kind: PositionKind;
  tenantId: string;
}

export interface InvPart {
  id: string;
  positionId: string;
  kind: PartKind;
  /** Install time in sim seconds. Sim time 0 = run start, so existing parts are negative. */
  installedAtS: number;
}

export interface SimInventory {
  devices: Record<string, InvDevice>;
  positions: Record<string, InvPosition>;
  /** Currently installed parts only, keyed by part id. */
  parts: Record<string, InvPart>;
}

/** A pinned condition from a scenario, already converted to sim time (SIM-SPEC §11). */
export interface ResolvedPin {
  positionId: string;
  defect: FailureMode;
  severity: number;
  /** Absolute sim-time (s) the symptoms start. */
  onsetAtS: number;
}

// ── Hidden condition (SIM-SPEC §5) ──────────────────────────────────
export interface PartCondition {
  /** null for a position-level defect (`bad_port`). */
  partId: string | null;
  positionId: string;
  defect: FailureMode | null; // null = healthy
  severity: number; // 0..1
  onsetAt: number; // sim-time (s) when symptoms start
  wear: number;
  suppressedUntil: number | null;
}

/** Key into `SimState.conditions`: the part id, or `pos:<positionId>` for position-level defects. */
export const conditionKey = (partId: string | null, positionId: string): string =>
  partId ?? `pos:${positionId}`;

// ── Metrics (SIM-SPEC §10) ──────────────────────────────────────────
export type PositionMetrics =
  | { link: "up" | "down"; flaps5m: number; crcPerMin: number; rxDbm?: number }
  | { eccCorrectable: number; eccUncorrectable: number }
  | { reallocated: number; driveState: "ok" | "degraded" | "failed" }
  /** `tempC` is the device temperature, carried on the device's `fan-1` row. */
  | { rpm: number; nominalRpm: number; tempC?: number }
  | { psuInput: "ok" | "lost"; watts: number };

// ── State ───────────────────────────────────────────────────────────
export interface DeviceThermal {
  baseTempC: number;
  driftC: number;
}

/** Short rolling history per position that windowed detection rules need. */
export interface PositionSignals {
  /** Sim-times of recent link flaps (kept for 5 sim-min). */
  flapTimes: number[];
  /** Sim-times of recent PSU input losses (kept for 10 sim-min). */
  lossTimes: number[];
  /** Recent correctable-ECC increments (kept for 1 sim-hour). */
  eccEvents: Array<{ t: number; n: number }>;
  /** Sim-time the link went hard-down (dead laser), or null. */
  downSince: number | null;
  /** Rule id → last alert time, last time the rule was firing, and the highest severity alerted since it re-armed. */
  lastAlert: Record<string, { t: number; seenAt: number; severity: Severity }>;
}

export const emptySignals = (): PositionSignals => ({
  flapTimes: [],
  lossTimes: [],
  eccEvents: [],
  downSince: null,
  lastAlert: {},
});

export interface SimState {
  seed: number;
  /** Simulated seconds since run start. */
  simTimeS: number;
  /** Resumable RNG state (see `Rng.state`). */
  rngState: number;
  config: SimConfig;
  inventory: SimInventory;
  conditions: Record<string, PartCondition>;
  thermal: Record<string, DeviceThermal>;
  metrics: Record<string, PositionMetrics>;
  signals: Record<string, PositionSignals>;
}

// ── Inputs and outputs of `tick` ────────────────────────────────────
export interface SimCommand {
  kind: "break";
  positionId: string;
  failureMode: FailureMode;
}

/** Repair feedback from the app (SIM-SPEC §7). Consumed by `repair.ts`. */
export type SimEvent =
  | { kind: "resolved"; positionId: string; partId: string | null; action: ResolutionAction }
  | { kind: "part_removed"; partId: string }
  | { kind: "part_installed"; part: InvPart };

export interface SimAlert {
  positionId: string;
  deviceId: string;
  tenantId: string;
  category: IssueCategory;
  severity: Severity;
  message: string;
  simTimeS: number;
}

export interface TickResult {
  state: SimState;
  /** Only the positions whose metrics changed this tick. */
  changedMetrics: Record<string, PositionMetrics>;
  alerts: SimAlert[];
  /** Commands that could not be applied (unknown position, wrong mode for the position, …). */
  rejectedCommands: SimCommand[];
}
