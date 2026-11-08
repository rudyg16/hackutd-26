"use client";
// OWNER: Person B. Four-column ticket board with HTML5 drag-and-drop.
import { useState } from "react";
import { api } from "@/shared/api";
import {
  ISSUE_CATEGORIES,
  RESOLUTION_ACTIONS,
  type IssueCategory,
  type ResolutionAction,
  type Severity,
  type Ticket,
  type TicketStatus,
  type User,
} from "@/shared/types";

const COLUMNS: { status: TicketStatus; label: string }[] = [
  { status: "ai_draft", label: "AI Drafts" },
  { status: "open", label: "Open" },
  { status: "in_progress", label: "In Progress" },
  { status: "resolved", label: "Resolved" },
];

const SEVERITY_CLASS: Record<Severity, string> = {
  low: "text-sev-low border-sev-low",
  medium: "text-sev-medium border-sev-medium",
  high: "text-sev-high border-sev-high",
  critical: "text-sev-critical border-sev-critical",
};

const label = (s: string) => s.replace(/_/g, " ");

/** Tickets the hardware simulator drafts are reported by this user (docs/SIM-SPEC.md section 8). */
const MONITOR_USER_ID = "user-monitor";

/** "C4 › SW-C4-01 › port-13", built from the ids the ticket already carries. */
function itemPath(t: Ticket): string {
  const parts = [t.rackId.replace(/^rack-/, "")];
  if (t.deviceId) parts.push(t.deviceId);
  if (t.positionId) parts.push(t.positionId.split("/").pop() ?? t.positionId);
  return parts.join(" › ");
}

interface Props {
  tickets: Ticket[];
  users: User[];
  /** Position ids where the repeat rule suggests replacing the part. */
  replacePositionIds: Set<string>;
  /** Called after any change so the parent can reload. */
  onChanged: () => void;
}

export default function KanbanBoard({ tickets, users, replacePositionIds, onChanged }: Props) {
  const [dragId, setDragId] = useState<string | null>(null);
  const [overColumn, setOverColumn] = useState<TicketStatus | null>(null);
  const [resolving, setResolving] = useState<Ticket | null>(null);
  const [error, setError] = useState<string | null>(null);

  const userById = new Map(users.map((u) => [u.id, u]));

  async function drop(status: TicketStatus) {
    const ticket = tickets.find((t) => t.id === dragId);
    setDragId(null);
    setOverColumn(null);
    if (!ticket || ticket.status === status) return;
    setError(null);
    if (status === "resolved") {
      setResolving(ticket); // resolving always needs the form
      return;
    }
    try {
      await api.patchTicket(ticket.id, { status });
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not move the ticket");
    }
  }

  return (
    <div>
      {error && (
        <div className="mb-3 border border-sev-critical text-sev-critical px-3 py-2 text-sm flex justify-between">
          <span>{error}</span>
          <button onClick={() => setError(null)} aria-label="Dismiss">
            ✕
          </button>
        </div>
      )}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
        {COLUMNS.map((col) => {
          const items = tickets.filter((t) => t.status === col.status);
          return (
            <section
              key={col.status}
              onDragOver={(e) => {
                e.preventDefault();
                setOverColumn(col.status);
              }}
              onDragLeave={() => setOverColumn((c) => (c === col.status ? null : c))}
              onDrop={(e) => {
                e.preventDefault();
                void drop(col.status);
              }}
              className={`bg-panel border min-h-64 p-2 ${
                overColumn === col.status ? "border-neon-cyan" : "border-line"
              }`}
            >
              <h2 className="text-neon-cyan text-sm tracking-widest uppercase mb-2 flex justify-between">
                <span>{col.label}</span>
                <span className="text-dim">{items.length}</span>
              </h2>
              <div className="flex flex-col gap-2">
                {items.map((t) => (
                  <Card
                    key={t.id}
                    ticket={t}
                    assignee={t.assigneeId ? userById.get(t.assigneeId) : undefined}
                    replaceSuggested={!!t.positionId && replacePositionIds.has(t.positionId)}
                    dragging={dragId === t.id}
                    onDragStart={() => setDragId(t.id)}
                    onDragEnd={() => {
                      setDragId(null);
                      setOverColumn(null);
                    }}
                  />
                ))}
              </div>
            </section>
          );
        })}
      </div>
      {resolving && (
        <ResolveModal
          ticket={resolving}
          onClose={() => setResolving(null)}
          onResolved={() => {
            setResolving(null);
            onChanged();
          }}
        />
      )}
    </div>
  );
}

function Card(props: {
  ticket: Ticket;
  assignee?: User;
  replaceSuggested: boolean;
  dragging: boolean;
  onDragStart: () => void;
  onDragEnd: () => void;
}) {
  const { ticket: t, assignee } = props;
  return (
    <article
      draggable={t.status !== "resolved"} // the server refuses to reopen a resolved ticket
      onDragStart={(e) => {
        e.dataTransfer.effectAllowed = "move";
        e.dataTransfer.setData("text/plain", t.id); // Firefox won't start a drag without data
        props.onDragStart();
      }}
      onDragEnd={props.onDragEnd}
      className={`bg-panel-2 border border-line p-2 text-sm ${
        t.status === "resolved" ? "" : "cursor-grab"
      } ${props.dragging ? "opacity-40" : ""}`}
    >
      <div className="text-dim text-xs mb-1">{itemPath(t)}</div>
      <div className="text-ink mb-2">{t.title}</div>
      <div className="flex items-center gap-2 flex-wrap">
        <span className={`border px-1 text-xs uppercase ${SEVERITY_CLASS[t.severity]}`}>{t.severity}</span>
        <span className="text-dim text-xs">{label(t.category)}</span>
        {t.reporterId === MONITOR_USER_ID && (
          <span title="Raised by the hardware simulator" aria-label="Raised by the hardware simulator">
            🤖
          </span>
        )}
        {props.replaceSuggested && t.status !== "resolved" && (
          <span className="border border-neon-amber text-neon-amber px-1 text-xs">⚠ Replace?</span>
        )}
        <span
          className="ml-auto w-6 h-6 rounded-full flex items-center justify-center text-xs text-bg border border-line"
          style={{ background: assignee?.avatarColor ?? "transparent" }}
          title={assignee ? assignee.name : "Unassigned"}
        >
          {assignee ? assignee.name[0] : ""}
        </span>
      </div>
    </article>
  );
}

function ResolveModal(props: { ticket: Ticket; onClose: () => void; onResolved: () => void }) {
  const [category, setCategory] = useState<IssueCategory>(props.ticket.category);
  const [action, setAction] = useState<ResolutionAction>("reseated");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setSaving(true);
    setError(null);
    try {
      await api.resolveTicket(props.ticket.id, { category, action, note: note.trim() });
      props.onResolved();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not resolve the ticket");
      setSaving(false);
    }
  }

  const field = "w-full bg-panel-2 border border-line text-ink px-2 py-1 focus:outline-none focus:border-neon-cyan";
  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center p-4 z-50" role="dialog" aria-modal="true">
      <div className="bg-panel border border-neon-cyan w-full max-w-md p-4 flex flex-col gap-3">
        <h3 className="text-neon-cyan tracking-widest uppercase text-sm">Resolve ticket</h3>
        <p className="text-dim text-sm">{props.ticket.title}</p>
        <label className="text-sm text-dim">
          Category
          <select className={field} value={category} onChange={(e) => setCategory(e.target.value as IssueCategory)}>
            {ISSUE_CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {label(c)}
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm text-dim">
          Action taken
          <select className={field} value={action} onChange={(e) => setAction(e.target.value as ResolutionAction)}>
            {RESOLUTION_ACTIONS.map((a) => (
              <option key={a} value={a}>
                {label(a)}
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm text-dim">
          Note
          <textarea className={field} rows={3} value={note} onChange={(e) => setNote(e.target.value)} />
        </label>
        {error && <p className="text-sev-critical text-sm break-words">{error}</p>}
        <div className="flex justify-end gap-2">
          <button onClick={props.onClose} disabled={saving} className="border border-line text-dim px-3 py-1">
            Cancel
          </button>
          <button
            onClick={submit}
            disabled={saving || !note.trim()}
            className="border border-neon-green text-neon-green px-3 py-1 disabled:opacity-40"
          >
            {saving ? "Resolving…" : "Resolve"}
          </button>
        </div>
      </div>
    </div>
  );
}
