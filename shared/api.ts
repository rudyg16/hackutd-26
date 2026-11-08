/**
 * API route contract. OWNER: Person B. Frozen after hour 1.
 *
 * Every request carries the simulated current user in the `x-user-id` header
 * (set by the account switcher). Route handlers MUST call `getCurrentUser()` and
 * apply lib/access.ts checks — access is enforced server-side, never only in UI.
 *
 * While a route isn't built yet, consumers can read seed/*.json directly.
 */
import type {
  FloorView,
  Handoff,
  IssueCategory,
  KnownIssueSummary,
  PositionHistory,
  ResolutionAction,
  Ticket,
  TicketDraft,
  TicketStatus,
  User,
  WorkLogEntry,
} from "./types";

export const USER_HEADER = "x-user-id";

/** Route table — the single source of truth for who builds what. */
export const routes = {
  // Person B
  floor: "GET  /api/floor -> FloorView",
  tickets: "GET  /api/tickets?status= -> Ticket[]",
  ticket: "GET  /api/tickets/:id -> { ticket, workLog }",
  createTicket: "POST /api/tickets {TicketDraft & {status}} -> Ticket",
  patchTicket: "PATCH /api/tickets/:id {status?, assigneeId?} -> Ticket",
  resolveTicket: "POST /api/tickets/:id/resolve {category, action, note} -> Ticket",
  addLog: "POST /api/tickets/:id/log {body, internal} -> WorkLogEntry",
  replacePart: "POST /api/parts/:id/replace {serial} -> InstalledPart",
  history: "GET  /api/positions/:id/history -> PositionHistory",
  users: "GET  /api/users -> User[]",
  patchUser: "PATCH /api/users/:id {role?, approvedTenantIds?} -> User",
  assignable: "GET  /api/tickets/:id/assignable -> User[]  (approved techs only)",
  // Person C
  draftTicket: "POST /api/ai/draft-ticket {reportText} -> TicketDraft",
  knownIssue: "GET  /api/ai/known-issue/:positionId -> KnownIssueSummary",
  draftHandoff: "POST /api/ai/draft-handoff {ticketId} -> {note}",
  handoffs: "GET  /api/handoffs?to=me -> Handoff[]",
  createHandoff: "POST /api/handoffs {ticketId, toUserId, note} -> Handoff",
  ackHandoff: "POST /api/handoffs/:id/ack -> Handoff  (reassigns ticket)",
} as const;

export const DEFAULT_USER_ID = "user-alex";
const STORAGE_KEY = "nmc-user-id";

// The simulated login survives page reloads. Read at module load so every fetch made by any
// page already carries the chosen user (the server has no window, so it just gets the default).
let currentUserId = DEFAULT_USER_ID;
if (typeof window !== "undefined") {
  try {
    currentUserId = window.localStorage.getItem(STORAGE_KEY) || DEFAULT_USER_ID;
  } catch {
    // storage blocked: fall back to the default user
  }
}
export const setCurrentUserId = (id: string) => {
  currentUserId = id;
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, id);
  } catch {
    // storage blocked: the choice just won't survive a reload
  }
};
export const getCurrentUserId = () => currentUserId;

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(path, {
    method,
    headers: { "content-type": "application/json", [USER_HEADER]: currentUserId },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${method} ${path} -> ${res.status} ${await res.text()}`);
  return res.json() as Promise<T>;
}

export const api = {
  floor: () => call<FloorView>("GET", "/api/floor"),
  tickets: (status?: TicketStatus) =>
    call<Ticket[]>("GET", `/api/tickets${status ? `?status=${status}` : ""}`),
  ticket: (id: string) => call<{ ticket: Ticket; workLog: WorkLogEntry[] }>("GET", `/api/tickets/${id}`),
  createTicket: (d: TicketDraft & { status: TicketStatus }) => call<Ticket>("POST", "/api/tickets", d),
  patchTicket: (id: string, p: { status?: TicketStatus; assigneeId?: string | null }) =>
    call<Ticket>("PATCH", `/api/tickets/${id}`, p),
  resolveTicket: (id: string, r: { category: IssueCategory; action: ResolutionAction; note: string }) =>
    call<Ticket>("POST", `/api/tickets/${id}/resolve`, r),
  addLog: (id: string, l: { body: string; internal: boolean }) =>
    call<WorkLogEntry>("POST", `/api/tickets/${id}/log`, l),
  replacePart: (partId: string, serial: string) => call("POST", `/api/parts/${partId}/replace`, { serial }),
  history: (positionId: string) =>
    call<PositionHistory>("GET", `/api/positions/${encodeURIComponent(positionId)}/history`),
  users: () => call<User[]>("GET", "/api/users"),
  patchUser: (id: string, p: Partial<Pick<User, "role" | "approvedTenantIds">>) =>
    call<User>("PATCH", `/api/users/${id}`, p),
  assignable: (ticketId: string) => call<User[]>("GET", `/api/tickets/${ticketId}/assignable`),

  draftTicket: (reportText: string) => call<TicketDraft>("POST", "/api/ai/draft-ticket", { reportText }),
  knownIssue: (positionId: string) =>
    call<KnownIssueSummary>("GET", `/api/ai/known-issue/${encodeURIComponent(positionId)}`),
  draftHandoff: (ticketId: string) => call<{ note: string }>("POST", "/api/ai/draft-handoff", { ticketId }),
  handoffs: () => call<Handoff[]>("GET", "/api/handoffs?to=me"),
  createHandoff: (h: { ticketId: string; toUserId: string; note: string }) =>
    call<Handoff>("POST", "/api/handoffs", h),
  ackHandoff: (id: string) => call<Handoff>("POST", `/api/handoffs/${id}/ack`),
};
