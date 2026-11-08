// OWNER: Person B. snake_case DB rows -> camelCase shared types.
import type { Ticket, User, WorkLogEntry } from "@/shared/types";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function toTicket(r: any): Ticket {
  return {
    id: r.id,
    title: r.title,
    description: r.description,
    status: r.status,
    severity: r.severity,
    category: r.category,
    tenantId: r.tenant_id,
    rackId: r.rack_id,
    deviceId: r.device_id,
    positionId: r.position_id,
    partId: r.part_id,
    reporterId: r.reporter_id,
    assigneeId: r.assignee_id,
    createdAt: r.created_at,
    resolvedAt: r.resolved_at,
    resolutionAction: r.resolution_action,
    resolutionNote: r.resolution_note,
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function toWorkLogEntry(r: any): WorkLogEntry {
  return {
    id: r.id,
    ticketId: r.ticket_id,
    authorId: r.author_id,
    kind: r.kind,
    body: r.body,
    internal: r.internal,
    createdAt: r.created_at,
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function toUser(r: any): User {
  return {
    id: r.id,
    name: r.name,
    email: r.email,
    orgId: r.org_id,
    role: r.role,
    approvedTenantIds: r.approved_tenant_ids,
    avatarColor: r.avatar_color,
  };
}
