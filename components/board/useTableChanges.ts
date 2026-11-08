"use client";
// OWNER: Person B. Calls `onChange` whenever a row in `table` is inserted or updated.
// Events are only a nudge: callers re-fetch through /api, which is where access is enforced.
import { useEffect, useRef } from "react";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let client: SupabaseClient | null = null;
function getClient(): SupabaseClient | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return null; // realtime is optional; callers keep a polling fallback
  client ??= createClient(url, key, { auth: { persistSession: false } });
  return client;
}

/** `filter` is a Supabase Realtime filter such as `to_user_id=eq.user-sam`. */
export function useTableChanges(table: string, onChange: () => void, filter?: string) {
  const callback = useRef(onChange);
  useEffect(() => {
    callback.current = onChange;
  });

  useEffect(() => {
    const supabase = getClient();
    if (!supabase) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const nudge = () => {
      // A drag or a seed can fire several events at once; collapse them into one refresh.
      clearTimeout(timer);
      timer = setTimeout(() => callback.current(), 150);
    };
    const channel = supabase
      .channel(`changes:${table}:${filter ?? "all"}`)
      .on("postgres_changes", { event: "*", schema: "public", table, ...(filter ? { filter } : {}) }, nudge)
      .subscribe();
    return () => {
      clearTimeout(timer);
      void supabase.removeChannel(channel);
    };
  }, [table, filter]);
}
