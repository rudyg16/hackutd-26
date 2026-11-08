"use client";
// OWNER: Person B. Simulated login: picks who the app acts as (sent as the x-user-id header on every call).
import { useEffect, useState } from "react";
import { api, DEFAULT_USER_ID, getCurrentUserId, setCurrentUserId } from "@/shared/api";
import type { User } from "@/shared/types";

export default function AccountSwitcher() {
  const [users, setUsers] = useState<User[] | null>(null);
  const [value, setValue] = useState<string | null>(null); // null until mounted, so SSR and first paint agree
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const current = getCurrentUserId();
    setValue(current);
    api
      .users()
      .then(setUsers)
      .catch(() => {
        // A saved user that no longer exists is rejected as unknown; fall back to the default once.
        if (current !== DEFAULT_USER_ID) {
          setCurrentUserId(DEFAULT_USER_ID);
          window.location.reload();
        } else {
          setFailed(true);
        }
      });
  }, []);

  function onChange(id: string) {
    setCurrentUserId(id);
    setValue(id);
    // Pages fetch with the user they loaded as, so a reload is the simple way to make all of them
    // (and any open 3D scene or drawer) forget the previous account.
    window.location.reload();
  }

  if (failed) return <span className="text-sev-critical">accounts unavailable</span>;
  if (!users || value === null) return <span className="text-dim">…</span>;

  return (
    <label className="flex items-center gap-2 text-dim">
      <span>as</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="bg-panel-2 border border-line text-ink px-2 py-1 focus:outline-none focus:border-neon-cyan"
      >
        {users.map((u) => (
          <option key={u.id} value={u.id}>
            {u.name} ({u.role})
          </option>
        ))}
      </select>
    </label>
  );
}
