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
