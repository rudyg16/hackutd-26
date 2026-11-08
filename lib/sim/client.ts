// OWNER: Person C. Browser fetch helpers for app/api/sim/** (sends the simulated user like shared/api.ts).
import { USER_HEADER, getCurrentUserId } from "@/shared/api";
import type { BreakCommand, PositionMetricsRow, SimAlertRow, SimControlState, SimStatus, XrayRow } from "./api-types";

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(path, {
    method,
    headers: { "content-type": "application/json", [USER_HEADER]: getCurrentUserId() },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) {
    let message = `${res.status}`;
    try {
      message = ((await res.json()) as { error?: string }).error ?? message;
    } catch {
      /* non-JSON error body */
    }
    throw new Error(message);
  }
  return res.json() as Promise<T>;
}

export const simApi = {
  status: () => call<SimStatus>("GET", "/api/sim/control"),
  setControl: (p: { paused?: boolean; speed?: number }) => call<SimControlState>("PATCH", "/api/sim/control", p),
  breakPosition: (c: BreakCommand) => call<{ id: string }>("POST", "/api/sim/commands", c),
  alerts: (limit = 20) => call<SimAlertRow[]>("GET", `/api/sim/alerts?limit=${limit}`),
  xray: () => call<XrayRow[]>("GET", "/api/sim/xray"),
  metrics: (positionId: string) =>
    call<PositionMetricsRow>("GET", `/api/sim/metrics/${encodeURIComponent(positionId)}`),
};
