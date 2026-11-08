"use client";
// OWNER: Person B. Admin page: edit roles and per-tenant approvals. Changes apply immediately.
import { useCallback, useEffect, useState } from "react";
import { api, getCurrentUserId } from "@/shared/api";
import type { Role, User } from "@/shared/types";

const OPERATOR_ORG = "org-northmark";
const OPERATOR_ROLES: Role[] = ["technician", "shift_lead", "admin"];
const TENANT_ROLES: Role[] = ["tenant_viewer", "tenant_engineer"];
const TENANTS = [
  { id: "org-acme", name: "Acme" },
  { id: "org-globex", name: "Globex" },
];

const label = (s: string) => s.replace(/_/g, " ");

export default function AdminPage() {
  const [users, setUsers] = useState<User[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [savingId, setSavingId] = useState<string | null>(null);

  const load = useCallback(() => {
    api.users().then(setUsers).catch((e) => setError(e instanceof Error ? e.message : "Could not load users"));
  }, []);
  useEffect(load, [load]);

  async function save(id: string, patch: Partial<Pick<User, "role" | "approvedTenantIds">>) {
    setSavingId(id);
    setError(null);
    try {
      const updated = await api.patchUser(id, patch);
      setUsers((list) => list?.map((u) => (u.id === id ? updated : u)) ?? null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save");
    } finally {
      setSavingId(null);
    }
  }

  if (!users) return <div className="p-6 text-dim">{error ?? "Loading…"}</div>;

  const me = users.find((u) => u.id === getCurrentUserId());
  if (me?.role !== "admin") return <div className="p-6 text-sev-critical">Access denied</div>;

  const select = "bg-panel-2 border border-line text-ink px-2 py-1 focus:outline-none focus:border-neon-cyan";
  return (
    <div className="p-4">
      <h1 className="text-neon-cyan neon-text tracking-widest uppercase mb-3">Users &amp; approvals</h1>
      {error && <p className="text-sev-critical text-sm mb-3 break-words">{error}</p>}
      <div className="overflow-x-auto">
        <table className="w-full text-sm border border-line">
          <thead className="bg-panel text-dim text-left">
            <tr>
              <th className="p-2">User</th>
              <th className="p-2">Role</th>
              <th className="p-2">Approved for</th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => {
              const operator = u.orgId === OPERATOR_ORG;
              return (
                <tr key={u.id} className={`border-t border-line ${savingId === u.id ? "opacity-60" : ""}`}>
                  <td className="p-2">
                    <span
                      className="inline-block w-3 h-3 rounded-full mr-2 align-middle"
                      style={{ background: u.avatarColor }}
                    />
                    {u.name}
                    <span className="text-dim ml-2">{u.email}</span>
                  </td>
                  <td className="p-2">
                    <select
                      className={select}
                      value={u.role}
                      disabled={savingId === u.id}
                      onChange={(e) => void save(u.id, { role: e.target.value as Role })}
                    >
                      {(operator ? OPERATOR_ROLES : TENANT_ROLES).map((r) => (
                        <option key={r} value={r}>
                          {label(r)}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="p-2">
                    {operator ? (
                      <div className="flex gap-4">
                        {TENANTS.map((t) => (
                          <label key={t.id} className="flex items-center gap-1">
                            <input
                              type="checkbox"
                              checked={u.approvedTenantIds.includes(t.id)}
                              disabled={savingId === u.id}
                              onChange={(e) =>
                                void save(u.id, {
                                  approvedTenantIds: e.target.checked
                                    ? [...u.approvedTenantIds, t.id]
                                    : u.approvedTenantIds.filter((x) => x !== t.id),
                                })
                              }
                            />
                            {t.name}
                          </label>
                        ))}
                      </div>
                    ) : (
                      <span className="text-dim">n/a (tenant user)</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
