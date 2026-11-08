"use client";
// OWNER: Person C. End Shift flow: draft a handoff note per open ticket and send it to a receiver.
import { useCallback, useEffect, useState } from "react";
import { api, getCurrentUserId } from "@/shared/api";
import type { Severity, Ticket, User } from "@/shared/types";
import base from "@/seed/base.json";
import { ShiftBrief } from "@/components/ai/ShiftBrief";

type ShiftTicket = Pick<Ticket, "id" | "title" | "severity" | "status" | "positionId" | "tenantId">;
type Receiver = Pick<User, "id" | "name">;

const SEV_TEXT: Record<Severity, string> = {
  low: "text-sev-low", medium: "text-sev-medium", high: "text-sev-high", critical: "text-sev-critical",
};
const btn = "rounded border px-3 py-1.5 text-sm disabled:opacity-40";
const field = "w-full rounded border border-line bg-panel-2 px-2 py-1.5 text-sm text-ink outline-none focus:border-neon-cyan";

// Fallbacks to seed/base.json while Person B's ticket routes aren't live.
const seedTickets = (userId: string): ShiftTicket[] =>
  base.tickets
    .filter((t) => t.assigneeId === userId && (t.status === "open" || t.status === "in_progress"))
    .map((t) => ({
      id: t.id, title: t.title, severity: t.severity as Severity, status: t.status as Ticket["status"],
      positionId: t.positionId, tenantId: t.tenantId,
    }));
const seedReceivers = (tenantId: string): Receiver[] =>
  base.users
    .filter((u) => (u.role === "technician" || u.role === "shift_lead") && u.approvedTenantIds.includes(tenantId))
    .map((u) => ({ id: u.id, name: u.name }));

type Row = {
  receivers: Receiver[] | null;
  toUserId: string;
  note: string | null;
  drafting: boolean;
  sending: boolean;
  sent: boolean;
  error: string;
};
const emptyRow: Row = { receivers: null, toUserId: "", note: null, drafting: false, sending: false, sent: false, error: "" };

export default function ShiftPage() {
  const [tickets, setTickets] = useState<ShiftTicket[] | null>(null);
  const [rows, setRows] = useState<Record<string, Row>>({});
  const [error, setError] = useState("");

  const patch = useCallback((id: string, p: Partial<Row>) => {
    setRows((r) => ({ ...r, [id]: { ...(r[id] ?? emptyRow), ...p } }));
  }, []);

  useEffect(() => {
    const me = getCurrentUserId();
    api
      .tickets()
      .then((all) => all.filter((t) => t.assigneeId === me && (t.status === "open" || t.status === "in_progress")))
      .catch(() => seedTickets(me))
      .then((mine) => {
        setTickets(mine);
        // Load receivers for each ticket (approved techs, excluding self).
        mine.forEach((t) => {
          api
            .assignable(t.id)
            .catch(() => seedReceivers(t.tenantId))
            .then((users) => {
              const list = users.filter((u) => u.id !== me);
              patch(t.id, { receivers: list, toUserId: list[0]?.id ?? "" });
            });
        });
      })
      .catch((e) => setError(String(e.message ?? e)));
  }, [patch]);

  const draft = async (id: string) => {
    patch(id, { drafting: true, error: "" });
    try {
      const { note } = await api.draftHandoff(id);
      patch(id, { note, drafting: false });
    } catch (e) {
      patch(id, { drafting: false, error: e instanceof Error ? e.message : "Drafting failed" });
    }
  };

  const send = async (id: string) => {
    const row = rows[id];
    if (!row?.note?.trim() || !row.toUserId) return;
    patch(id, { sending: true, error: "" });
    try {
      await api.createHandoff({ ticketId: id, toUserId: row.toUserId, note: row.note.trim() });
      patch(id, { sending: false, sent: true });
    } catch (e) {
      patch(id, { sending: false, error: e instanceof Error ? e.message : "Send failed" });
    }
  };

  return (
    <div className="mx-auto max-w-3xl space-y-6 p-6">
      <ShiftBrief />
      <section className="space-y-3">
        <h1 className="text-neon-amber neon-text tracking-widest">END SHIFT</h1>
        <p className="text-sm text-dim">Draft and send a handoff for each open ticket you&apos;re still holding.</p>

        {error && <p className="text-sm text-sev-critical">{error}</p>}
        {tickets === null && !error && <p className="text-dim">Loading your tickets…</p>}
        {tickets?.length === 0 && <p className="text-dim">No open tickets assigned to you. Nothing to hand off.</p>}

        {tickets?.map((t) => {
          const row = rows[t.id] ?? emptyRow;
          return (
            <article key={t.id} className="space-y-3 rounded border border-line bg-panel p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h2 className="text-ink">{t.title}</h2>
                  <p className="text-xs text-dim">{t.positionId ?? t.id} · {t.status}</p>
                </div>
                <span className={`text-xs ${SEV_TEXT[t.severity]}`}>{t.severity}</span>
              </div>

              {row.sent ? (
                <p className="text-neon-green">Sent ✓</p>
              ) : row.note === null ? (
                <button
                  onClick={() => draft(t.id)}
                  disabled={row.drafting}
                  className={`${btn} border-neon-cyan text-neon-cyan hover:bg-neon-cyan/10`}
                >
                  {row.drafting ? "Drafting…" : "Draft handoff"}
                </button>
              ) : (
                <>
                  <textarea
                    className={`${field} h-32`}
                    value={row.note}
                    onChange={(e) => patch(t.id, { note: e.target.value })}
                    disabled={row.sending}
                  />
                  <div className="flex flex-wrap items-center gap-3">
                    <label className="text-xs uppercase tracking-wider text-dim" htmlFor={`to-${t.id}`}>Hand off to</label>
                    <select
                      id={`to-${t.id}`}
                      className={`${field} w-auto min-w-40`}
                      value={row.toUserId}
                      onChange={(e) => patch(t.id, { toUserId: e.target.value })}
                      disabled={row.sending}
                    >
                      {row.receivers === null && <option value="">Loading…</option>}
                      {row.receivers?.length === 0 && <option value="">No approved techs</option>}
                      {row.receivers?.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
                    </select>
                    <button
                      onClick={() => draft(t.id)}
                      disabled={row.drafting || row.sending}
                      className={`${btn} border-line text-dim hover:text-ink`}
                    >
                      {row.drafting ? "Redrafting…" : "Redraft"}
                    </button>
                    <button
                      onClick={() => send(t.id)}
                      disabled={!row.note.trim() || !row.toUserId || row.sending}
                      className={`${btn} ml-auto border-neon-green text-neon-green hover:bg-neon-green/10`}
                    >
                      {row.sending ? "Sending…" : "Send"}
                    </button>
                  </div>
                </>
              )}
              {row.error && <p className="text-sm text-sev-critical">{row.error}</p>}
            </article>
          );
        })}
      </section>
    </div>
  );
}
