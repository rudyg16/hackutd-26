/** Wire types for app/api/sim/** (client-safe). The shared contract in shared/ is B's, so sim types live here. */
import type { IssueCategory, Severity } from "@/shared/types";
import type { FailureMode, PositionMetrics } from "./engine/types";

export interface SimControlState {
  paused: boolean;
  speed: number;
  seed: number | null;
  scenario: string | null;
  simTimeS: number;
  heartbeatAt: string | null;
}

export interface SimStatus {
  control: SimControlState | null;
  alertCount: number;
  simTicketCount: number;
}

export interface SimAlertRow {
  id: string;
  positionId: string;
  deviceId: string;
  rackId: string;
  tenantId: string;
  category: IssueCategory;
  severity: Severity;
  message: string;
  ticketId: string | null;
  createdAt: string;
  clearedAt: string | null;
}

export interface PositionMetricsRow {
  positionId: string;
  metrics: PositionMetrics | null;
  updatedAt: string | null;
}

export interface BreakCommand {
  positionId: string;
  failureMode: FailureMode;
}

/** Hidden defect state, admin-only (SIM-SPEC §17). */
export interface XrayRow {
  id: string;
  partId: string | null;
  positionId: string;
  defect: FailureMode;
  severity: number;
  onsetSimS: number;
  suppressedUntilSimS: number | null;
}

// ── Power (docs/POWER-SPEC.md §5) ───────────────────────────────────
export type PowerState = "ok" | "warn" | "critical";

export interface PowerComponent {
  positionId: string;
  kind: string;
  watts: number;
}

export interface PowerDevice {
  deviceId: string;
  kind: string;
  /** Wall draw: the sum of its PSUs' shares; 0 if every PSU has lost input. */
  drawW: number;
  tempC: number;
  /** Only filled for the rack requested with `?detail=<rackId>`; empty otherwise to keep polling cheap. */
  components: PowerComponent[];
}

export interface PowerRack {
  rackId: string;
  tenantId: string;
  tenantName: string;
  drawW: number;
  limitW: number;
  maxTempC: number;
  state: PowerState;
  devices: PowerDevice[];
}

export interface PowerSnapshot {
  facility: { drawW: number; limitW: number; state: PowerState };
  racks: PowerRack[];
  simTimeS: number;
  /** `sim_control.heartbeat_at`, so the page can show a stale banner like /sim does. */
  heartbeatAt: string | null;
}
