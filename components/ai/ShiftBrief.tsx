"use client";
// OWNER: Person C. Incoming handoffs for the current user + unacknowledged-count hook for the nav badge.
// Refresh: `subscribe` (Person B's Realtime INSERT hook, when it exists) or a 15s poll as fallback.
import { useCallback, useEffect, useState } from "react";
import { api } from "@/shared/api";
import type { Handoff } from "@/shared/types";
import base from "@/seed/base.json";

const CHANGED = "handoffs:changed";
const POLL_MS = 15_000;

/** Subscribe-to-INSERT signature: call `onInsert` on each new handoff row, return an unsubscribe fn. */
export type HandoffSubscribe = (onInsert: () => void) => () => void;

function usePending(subscribe?: HandoffSubscribe) {
  const [pending, setPending] = useState<Handoff[] | null>(null);
  const [error, setError] = useState("");

  const refresh = useCallback(() => {
    api
      .handoffs()
      .then((all) => {
        setPending(all.filter((h) => h.status === "pending"));
        setError("");
      })
      .catch((e) => setError(String(e.message ?? e)));
  }, []);

  useEffect(() => {
    refresh();
    const off = subscribe?.(refresh);
    const timer = subscribe ? undefined : setInterval(refresh, POLL_MS);
    window.addEventListener(CHANGED, refresh);
    return () => {
      off?.();
      if (timer) clearInterval(timer);
      window.removeEventListener(CHANGED, refresh);
    };
  }, [refresh, subscribe]);

  return { pending, setPending, error, refresh };
}

/** Number of pending handoffs addressed to the current user — render it as a badge on the Shift nav link. */
export function usePendingHandoffCount(subscribe?: HandoffSubscribe): number {
  return usePending(subscribe).pending?.length ?? 0;
}

/** Small badge for the nav link; renders nothing at zero. */
export function ShiftBadge({ subscribe }: { subscribe?: HandoffSubscribe }) {
  const n = usePendingHandoffCount(subscribe);
  if (n === 0) return null;
  return (
    <span className="ml-1 rounded-full bg-neon-magenta px-1.5 text-xs text-bg" aria-label={`${n} pending handoffs`}>
      {n}
    </span>
  );
}

const seedUserName = (id: string) => base.users.find((u) => u.id === id)?.name ?? id;
const seedTicketTitle = (id: string) => base.tickets.find((t) => t.id === id)?.title ?? id;

export function ShiftBrief({ subscribe }: { subscribe?: HandoffSubscribe }) {
  const { pending, setPending, error } = usePending(subscribe);
  const [names, setNames] = useState<Record<string, string>>({});
  const [titles, setTitles] = useState<Record<string, string>>({});
  const [acking, setAcking] = useState<string | null>(null);
  const [ackError, setAckError] = useState("");

  // Resolve display names/titles; fall back to seed data while B's routes aren't live.
  useEffect(() => {
    if (!pending?.length) return;
    api
      .users()
      .then((us) => setNames(Object.fromEntries(us.map((u) => [u.id, u.name]))))
      .catch(() => {});
    pending.forEach((h) => {
      if (titles[h.ticketId]) return;
      api
        .ticket(h.ticketId)
        .then(({ ticket }) => ticket.title)
        .catch(() => seedTicketTitle(h.ticketId))
        .then((title) => setTitles((t) => ({ ...t, [h.ticketId]: title })));
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pending]);

  const ack = async (id: string) => {
    setAcking(id);
    setAckError("");
    try {
      await api.ackHandoff(id);
      setPending((p) => p?.filter((h) => h.id !== id) ?? p);
      window.dispatchEvent(new Event(CHANGED));
    } catch (e) {
      setAckError(e instanceof Error ? e.message : "Acknowledge failed");
    } finally {
      setAcking(null);
    }
  };

  return (
    <section className="space-y-3">
      <h2 className="flex items-center gap-2 text-neon-cyan neon-text tracking-widest">
        SHIFT BRIEF
        {!!pending?.length && (
          <span className="rounded-full bg-neon-magenta px-2 text-xs text-bg">{pending.length}</span>
        )}
      </h2>
      {error && <p className="text-sm text-sev-critical">{error}</p>}
      {ackError && <p className="text-sm text-sev-critical">{ackError}</p>}
      {pending === null && !error && <p className="text-dim">Loading handoffs…</p>}
      {pending?.length === 0 && <p className="text-dim">No pending handoffs. You&apos;re all caught up.</p>}
      {pending?.map((h) => (
        <article key={h.id} className="space-y-2 rounded border border-line bg-panel p-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h3 className="text-ink">{titles[h.ticketId] ?? h.ticketId}</h3>
              <p className="text-xs text-dim">
                from {names[h.fromUserId] ?? seedUserName(h.fromUserId)} · {h.createdAt.slice(0, 16).replace("T", " ")}
              </p>
            </div>
            <button
              onClick={() => ack(h.id)}
              disabled={acking === h.id}
              className="rounded border border-neon-green px-3 py-1.5 text-sm text-neon-green hover:bg-neon-green/10 disabled:opacity-40"
            >
              {acking === h.id ? "Acknowledging…" : "Acknowledge"}
            </button>
          </div>
          <p className="whitespace-pre-wrap text-sm text-ink">{h.note}</p>
        </article>
      ))}
    </section>
  );
}

export default ShiftBrief;
