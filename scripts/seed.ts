/**
 * Idempotent seed: upserts seed/base.json + seed/demo.json into Supabase.
 * Positions are generated from seed/device-models.json. OWNER: Person B (runner), Person C (data).
 *   npm run seed           -> upsert (safe to run any time)
 *   npm run seed -- --wipe -> delete demo tickets/handoffs/logs first (announce before doing this!)
 */
import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";
import base from "../seed/base.json";
import demo from "../seed/demo.json";
import models from "../seed/device-models.json";

config({ path: ".env.local" });
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) throw new Error("Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local");
const db = createClient(url, key, { auth: { persistSession: false } });

const daysAgo = (d: number | null) => (d === null ? null : new Date(Date.now() - d * 86_400_000).toISOString());

const POSITION_LABEL: Record<string, string> = {
  port: "Port", uplink: "Uplink", psu: "PSU", fan: "Fan", bay: "Bay", "dimm-A": "DIMM A", "dimm-B": "DIMM B",
};

type Group = { kind: string; prefix: string; count: number };
type Model = { faces: Record<string, Group[]> };

function positionsFor(deviceId: string, modelId: string) {
  const model = (models.models as Record<string, Model>)[modelId];
  if (!model) throw new Error(`Unknown modelId ${modelId}`);
  return Object.values(model.faces).flat().flatMap((g) =>
    Array.from({ length: g.count }, (_, i) => ({
      id: `${deviceId}/${g.prefix}-${i + 1}`,
      device_id: deviceId,
      local_id: `${g.prefix}-${i + 1}`,
      kind: g.kind,
      label: `${POSITION_LABEL[g.prefix] ?? g.prefix} ${i + 1}`,
    })),
  );
}

async function upsert(table: string, rows: object[]) {
  if (rows.length === 0) return;
  const { error } = await db.from(table).upsert(rows, { onConflict: "id" });
  if (error) throw new Error(`${table}: ${error.message}`);
  console.log(`  ${table}: ${rows.length}`);
}

async function main() {
  if (process.argv.includes("--wipe")) {
    for (const t of ["handoffs", "work_log", "tickets"]) {
      const { error } = await db.from(t).delete().neq("id", "");
      if (error) throw new Error(`wipe ${t}: ${error.message}`);
    }
    console.log("wiped tickets, work_log, handoffs");
  }

  await upsert("orgs", base.orgs);
  await upsert("users", base.users.map((u) => ({
    id: u.id, name: u.name, email: u.email, org_id: u.orgId, role: u.role,
    approved_tenant_ids: u.approvedTenantIds, avatar_color: u.avatarColor,
  })));
  await upsert("racks", base.racks.map((r) => ({
    id: r.id, label: r.label, row: r.row, col: r.col, tenant_id: r.tenantId, height_u: r.heightU,
  })));
  await upsert("devices", base.devices.map((d) => ({
    id: d.id, rack_id: d.rackId, kind: d.kind, model_id: d.modelId, u_position: d.uPosition, name: d.name,
  })));
  await upsert("positions", base.devices.flatMap((d) => positionsFor(d.id, d.modelId)));
  await upsert("installed_parts", demo.parts.map((p) => ({
    id: p.id, position_id: p.positionId, kind: p.kind, serial: p.serial,
    installed_at: daysAgo(p.installedDaysAgo), removed_at: daysAgo(p.removedDaysAgo),
  })));
  await upsert("tickets", demo.tickets.map((t) => ({
    id: t.id, title: t.title, description: t.description, status: t.status, severity: t.severity,
    category: t.category, tenant_id: t.tenantId, rack_id: t.rackId, device_id: t.deviceId,
    position_id: t.positionId, part_id: t.partId, reporter_id: t.reporterId, assignee_id: t.assigneeId,
    created_at: daysAgo(t.createdDaysAgo), resolved_at: daysAgo(t.resolvedDaysAgo),
    resolution_action: t.resolutionAction, resolution_note: t.resolutionNote,
  })));
  console.log("seed done");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
