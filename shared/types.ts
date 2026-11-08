/**
 * Shared domain contract. OWNER: Person B.
 * Frozen after hour 1 — changes go through a PR that all three people see.
 * Mirrors supabase/migrations/0001_init.sql (snake_case in DB, camelCase here).
 */

// ── Orgs, users, access ─────────────────────────────────────────────
export type OrgKind = "operator" | "tenant"; // operator = NorthMark

export interface Org {
  id: string; // "org-northmark", "org-acme", "org-globex"
  name: string;
  kind: OrgKind;
}

export type Role =
  | "tenant_viewer" // status only, no internal notes
  | "tenant_engineer" // file + work tickets on own org's equipment
  | "technician" // NorthMark; works tickets for approved tenants
  | "shift_lead" // technician + assign/handoff approval
  | "admin"; // edits users, roles, approvals

export interface User {
  id: string; // "user-alex"
  name: string;
  email: string;
  orgId: string;
  role: Role;
  /** Tenant org ids this NorthMark tech is approved for. Empty for tenant users. */
  approvedTenantIds: string[];
  avatarColor: string;
}

// ── Item tree: Rack → Device → Position → InstalledPart ─────────────
export interface Rack {
  id: string; // "rack-C4"
  label: string; // "C4"
  row: number; // floor grid row
  col: number; // floor grid column
  tenantId: string; // owning tenant org
  heightU: number; // usually 42
}

export type DeviceKind = "switch" | "server" | "pdu" | "patch_panel" | "filler";

export interface Device {
  id: string; // "SW-C4-01"
  rackId: string;
  kind: DeviceKind;
  /** Key into seed/device-models.json (chassis builder spec). */
  modelId: string;
  /** Lowest occupied U (1 = bottom). */
  uPosition: number;
  name: string;
}

export type PositionKind = "port" | "dimm_slot" | "drive_bay" | "psu_bay" | "fan_bay";

/** A permanent location on a device. History is keyed to positions. */
export interface Position {
  id: string; // "SW-C4-01/port-13"  (deviceId + "/" + localId)
  deviceId: string;
  localId: string; // "port-13" — must match the mesh name from the chassis builder
  kind: PositionKind;
  label: string; // "Port 13"
}

export type PartKind = "sfp" | "cable" | "dimm" | "drive" | "psu" | "fan";

/** A replaceable thing installed in a position. Replacing = new row, old one gets removedAt. */
export interface InstalledPart {
  id: string;
  positionId: string;
  kind: PartKind;
  serial: string;
  installedAt: string; // ISO
  removedAt: string | null;
}

/** Any node a ticket can attach to. */
export type ItemRef =
  | { type: "rack"; id: string }
  | { type: "device"; id: string }
  | { type: "position"; id: string }
  | { type: "part"; id: string };

// ── Tickets ─────────────────────────────────────────────────────────
export type TicketStatus = "ai_draft" | "open" | "in_progress" | "resolved";
export type Severity = "low" | "medium" | "high" | "critical";

export const ISSUE_CATEGORIES = [
  "link_flap",
  "crc_errors",
  "overheat",
  "ecc_memory",
  "disk_failure",
  "psu_fault",
  "other",
] as const;
export type IssueCategory = (typeof ISSUE_CATEGORIES)[number];

export const RESOLUTION_ACTIONS = [
  "reseated",
  "replaced_part",
  "cleaned",
  "config_change",
  "firmware_update",
  "other",
] as const;
export type ResolutionAction = (typeof RESOLUTION_ACTIONS)[number];

export interface Ticket {
  id: string;
  title: string;
  description: string;
  status: TicketStatus;
  severity: Severity;
  category: IssueCategory;
  tenantId: string; // denormalised from the rack, used for access checks
  rackId: string;
  deviceId: string | null;
  positionId: string | null;
  partId: string | null;
  reporterId: string;
  assigneeId: string | null;
  createdAt: string;
  resolvedAt: string | null;
  resolutionAction: ResolutionAction | null;
  resolutionNote: string | null;
}

export type WorkLogKind = "note" | "status_change" | "part_replaced" | "handoff" | "resolution";

export interface WorkLogEntry {
  id: string;
  ticketId: string;
  authorId: string;
  kind: WorkLogKind;
  body: string;
  /** Hidden from tenant_viewer. */
  internal: boolean;
  createdAt: string;
}

// ── Shift handoff ───────────────────────────────────────────────────
export type HandoffStatus = "pending" | "acknowledged";

export interface Handoff {
  id: string;
  ticketId: string;
  fromUserId: string;
  toUserId: string;
  note: string; // AI-drafted, human-edited
  status: HandoffStatus;
  createdAt: string;
  acknowledgedAt: string | null; // acknowledging reassigns the ticket
}

// ── Derived views (computed server-side, consumed by UI) ────────────
export interface RepeatFlag {
  positionId: string;
  category: IssueCategory;
  count: number; // resolved tickets in window since last replacement
  windowDays: number; // 30
  replaceSuggested: boolean; // count >= 3
}

export interface Highlight {
  /** Position localId on a device, e.g. "port-13". */
  deviceId: string;
  localId: string;
  severity: Severity;
}

/** What the 3D floor needs. Server decides visibility — 3D does no access logic. */
export interface FloorView {
  racks: Array<Rack & { visible: boolean; worstSeverity: Severity | null }>;
  devices: Device[]; // only for visible racks
  highlights: Highlight[];
}

/** Everything the item drawer shows for one position. */
export interface PositionHistory {
  position: Position;
  device: Device;
  currentParts: InstalledPart[];
  tickets: Ticket[]; // newest first
  partEvents: InstalledPart[]; // all parts ever installed, incl. removed
  repeatFlags: RepeatFlag[];
}

// ── AI contracts (Person C) ─────────────────────────────────────────
export interface TicketDraftInput {
  reportText: string;
  reporterId: string;
}

export interface TicketDraft {
  title: string;
  description: string;
  severity: Severity;
  category: IssueCategory;
  rackId: string;
  deviceId: string | null;
  positionId: string | null;
  confidence: number; // 0..1
}

export interface KnownIssueSummary {
  positionId: string;
  summary: string; // "Reseating hasn't held; replace cable/SFP."
  recommendation: "monitor" | "replace_part" | "replace_device" | "move_port";
}
