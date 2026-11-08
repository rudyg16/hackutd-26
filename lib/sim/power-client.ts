// OWNER: Person C. Browser fetch helper for /api/power (sends the simulated user like shared/api.ts).
import { USER_HEADER, getCurrentUserId } from "@/shared/api";
import type { PowerSnapshot } from "./api-types";

export async function fetchPower(detailRackId?: string | null): Promise<PowerSnapshot> {
  const res = await fetch(`/api/power${detailRackId ? `?detail=${encodeURIComponent(detailRackId)}` : ""}`, {
    headers: { [USER_HEADER]: getCurrentUserId() },
  });
  if (!res.ok) {
    let message = String(res.status);
    try {
      message = ((await res.json()) as { error?: string }).error ?? message;
    } catch {
      /* non-JSON error body */
    }
    throw new Error(message);
  }
  return res.json() as Promise<PowerSnapshot>;
}
