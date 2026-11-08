"use client";
// OWNER: Person B. Ticket board: loads tickets, refreshes every 10 s.
import { useCallback, useEffect, useState } from "react";
import KanbanBoard from "@/components/board/KanbanBoard";
import { useTableChanges } from "@/components/board/useTableChanges";
import { api } from "@/shared/api";
import type { Ticket, User } from "@/shared/types";

const REFRESH_MS = 10_000;

export default function BoardPage() {
  const [tickets, setTickets] = useState<Ticket[] | null>(null);
  const [users, setUsers] = useState<User[]>([]);
  const [replaceIds, setReplaceIds] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const list = await api.tickets();
      setTickets(list);
      setError(null);
      // The Replace? badge comes from each position's repeat flags (open work only).
      const positionIds = [
        ...new Set(list.filter((t) => t.status !== "resolved" && t.positionId).map((t) => t.positionId as string)),
      ];
      const histories = await Promise.all(positionIds.map((id) => api.history(id).catch(() => null)));
      const flagged = new Set<string>();
      histories.forEach((h) => {
        if (h?.repeatFlags.some((f) => f.replaceSuggested)) flagged.add(h.position.id);
      });
      setReplaceIds(flagged);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load tickets");
    }
  }, []);

  useEffect(() => {
    api.users().then(setUsers).catch(() => {});
    void load();
    const timer = setInterval(() => void load(), REFRESH_MS);
    return () => clearInterval(timer);
  }, [load]);

  // Live refresh when anyone changes a ticket; the 10 s poll above stays as a fallback.
  useTableChanges("tickets", () => void load());

  return (
    <div className="p-4">
      <h1 className="text-neon-cyan neon-text tracking-widest uppercase mb-3">Ticket board</h1>
      {error && <p className="text-sev-critical text-sm mb-3 break-words">{error}</p>}
      {tickets === null ? (
        !error && <p className="text-dim">Loading…</p>
      ) : (
        <KanbanBoard tickets={tickets} users={users} replacePositionIds={replaceIds} onChanged={() => void load()} />
      )}
    </div>
  );
}
