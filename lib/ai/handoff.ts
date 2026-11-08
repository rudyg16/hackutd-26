// OWNER: Person C. Row mapping for the handoffs table.
import type { Handoff } from "@/shared/types";

/* eslint-disable @typescript-eslint/no-explicit-any */
export const toHandoff = (r: any): Handoff => ({
  id: r.id, ticketId: r.ticket_id, fromUserId: r.from_user_id, toUserId: r.to_user_id,
  note: r.note, status: r.status, createdAt: r.created_at, acknowledgedAt: r.acknowledged_at,
});
