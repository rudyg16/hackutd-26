"use client";
// OWNER: Person C. Work-log notes on a ticket: read the log and add a human note (no AI involved).
import { useCallback, useState } from "react";
import { api } from "@/shared/api";
import type { WorkLogEntry } from "@/shared/types";

const when = (iso: string) => new Date(iso).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });

export function TicketNotes({ ticketId }: { ticketId: string }) {
  const [open, setOpen] = useState(false);
  const [log, setLog] = useState<WorkLogEntry[] | null>(null);
  const [text, setText] = useState("");
  const [internal, setInternal] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(() => {
    api.ticket(ticketId).then((r) => setLog(r.workLog)).catch((e) => setError(String(e.message ?? e)));
  }, [ticketId]);

  const toggle = () => {
    if (!open && log === null) load();
    setOpen((v) => !v);
  };

  async function add() {
    if (!text.trim()) return;
    setBusy(true);
    setError("");
    try {
      await api.addLog(ticketId, { body: text.trim(), internal });
      setText("");
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-1.5">
      <button onClick={toggle} className="text-xs text-neon-cyan hover:underline">
        {open ? "Hide notes" : `Notes${log ? ` (${log.length})` : ""} / add note`}
      </button>
      {open && (
        <div className="mt-1.5 space-y-2">
          {log === null ? (
            <p className="text-xs text-dim">Loading…</p>
          ) : log.length === 0 ? (
            <p className="text-xs text-dim">No notes yet.</p>
          ) : (
            <ul className="space-y-1">
              {log.map((e) => (
                <li key={e.id} className="rounded border border-line px-2 py-1 text-xs">
                  <span className="text-dim">
                    {when(e.createdAt)} · {e.authorId.replace("user-", "")} · {e.kind.replace("_", " ")}
                    {e.internal ? " · internal" : ""}
                  </span>
                  <p className="text-ink">{e.body}</p>
                </li>
              ))}
            </ul>
          )}
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={2}
            placeholder="What did you find or do?"
            className="w-full rounded border border-line bg-panel-2 px-2 py-1.5 text-xs text-ink outline-none focus:border-neon-cyan"
          />
          <div className="flex items-center justify-between">
            <label className="flex items-center gap-1.5 text-xs text-dim">
              <input type="checkbox" checked={internal} onChange={(e) => setInternal(e.target.checked)} />
              Internal (hidden from tenant)
            </label>
            <button
              onClick={add}
              disabled={busy || !text.trim()}
              className="rounded border border-neon-cyan px-2.5 py-1 text-xs text-neon-cyan disabled:opacity-40"
            >
              {busy ? "Adding…" : "Add note"}
            </button>
          </div>
          {error && <p className="text-xs text-sev-critical">{error}</p>}
        </div>
      )}
    </div>
  );
}
