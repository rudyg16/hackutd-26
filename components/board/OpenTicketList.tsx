"use client";
// OWNER: Person B. Side-panel list of open and in-progress tickets for the floor page.
// Clicking a ticket calls onTicketClick(deviceId, positionId) so the floor can fly to it.
import { useCallback, useEffect, useState } from "react";
import { api } from "@/shared/api";
import type { Severity, Ticket } from "@/shared/types";
import { useTableChanges } from "./useTableChanges";

const SEVERITY_CLASS: Record<Severity, string> = {
  low: "text-sev-low border-sev-low",
  medium: "text-sev-medium border-sev-medium",
  high: "text-sev-high border-sev-high",
  critical: "text-sev-critical border-sev-critical",
};
const RANK: Record<Severity, number> = { low: 1, medium: 2, high: 3, critical: 4 };

interface Props {
  onTicketClick: (deviceId: string, positionId?: string | null) => void;
}

export default function OpenTicketList({ onTicketClick }: Props) {
  const [tickets, setTickets] = useState<Ticket[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [open, inProgress] = await Promise.all([api.tickets("open"), api.tickets("in_progress")]);
      setTickets([...open, ...inProgress].sort((a, b) => RANK[b.severity] - RANK[a.severity]));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load tickets");
    }
  }, []);

  useEffect(() => {
    // Poll as a fallback; realtime below makes it feel instant when configured.
    // The first load runs on a zero-delay timer so no state is set synchronously in the effect.
    const first = setTimeout(load, 0);
    const timer = setInterval(load, 10_000);
    return () => {
      clearTimeout(first);
      clearInterval(timer);
    };
  }, [load]);
  useTableChanges("tickets", load);

  return (
    <div>
      <h2 className="text-neon-amber neon-text mb-2">Open tickets{tickets ? ` (${tickets.length})` : ""}</h2>
      {error && <p className="text-sev-critical">{error}</p>}
      {tickets?.length === 0 && <p className="text-dim">Nothing open.</p>}
      <ul className="space-y-1">
        {tickets?.map((t) => (
          <li key={t.id}>
            <button
              className="w-full text-left border border-line px-2 py-1 hover:border-neon-cyan"
              onClick={() => t.deviceId && onTicketClick(t.deviceId, t.positionId)}
              disabled={!t.deviceId}
            >
              <span className={`border px-1 mr-2 text-xs uppercase ${SEVERITY_CLASS[t.severity]}`}>{t.severity}</span>
              <span className="text-ink">{t.title}</span>
              <span className="block text-dim text-xs">
                {t.rackId.replace(/^rack-/, "")}
                {t.deviceId ? ` › ${t.deviceId}` : ""}
                {t.positionId ? ` › ${t.positionId.split("/").pop()}` : ""}
                {t.status === "in_progress" ? " · in progress" : ""}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
