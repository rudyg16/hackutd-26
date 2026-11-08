"use client";
// OWNER: Person B. Count of handoffs waiting for the current user, shown beside the Shift nav link.
import { useCallback, useEffect, useState } from "react";
import { api, getCurrentUserId } from "@/shared/api";
import { useTableChanges } from "./useTableChanges";

const POLL_MS = 10_000; // fallback if realtime is unavailable

export default function ShiftBadge() {
  const [userId, setUserId] = useState<string | null>(null); // null until mounted, so SSR and first paint agree
  const [count, setCount] = useState(0);

  const refresh = useCallback(() => {
    api
      .handoffs()
      .then((list) => setCount(list.filter((h) => h.status === "pending").length))
      .catch(() => setCount(0));
  }, []);

  useEffect(() => {
    setUserId(getCurrentUserId());
    refresh();
    const timer = setInterval(refresh, POLL_MS);
    return () => clearInterval(timer);
  }, [refresh]);

  useTableChanges("handoffs", refresh, userId ? `to_user_id=eq.${userId}` : undefined);

  if (count === 0) return null;
  return (
    <span
      className="ml-1 border border-neon-amber text-neon-amber px-1 text-xs"
      title={`${count} handoff${count === 1 ? "" : "s"} waiting`}
    >
      {count}
    </span>
  );
}
