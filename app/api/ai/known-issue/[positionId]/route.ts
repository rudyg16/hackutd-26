// OWNER: Person C. GET /api/ai/known-issue/:positionId -> KnownIssueSummary
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import type { KnownIssueSummary } from "@/shared/types";
import { canSeeInternal, canSeeTenant, getCurrentUser } from "@/lib/access";
import { completeJson } from "@/lib/ai/client";
import { demoFallback } from "@/lib/ai/fallback";
import { describeHistory, loadPositionHistory } from "@/lib/ai/history";

export const dynamic = "force-dynamic";

const schema = z.object({
  summary: z.string().min(1).max(300),
  recommendation: z.enum(["monitor", "replace_part", "replace_device", "move_port"]),
});

const SYSTEM = `You are a data-center maintenance advisor. You get the full history of one hardware position (a port, DIMM slot, drive bay, PSU or fan): resolved tickets, part replacements and repeat-failure flags.
Write "summary": 1-2 sentences, plain and specific, on what has been tried and whether it held (e.g. "Reseating hasn't held; replace cable/SFP."). Use only facts in the history.
Write "recommendation", one of:
- monitor: no pattern, or the last fix is holding
- replace_part: repeated failures that reseating/cleaning/config did not fix; replace the cable, SFP, DIMM, drive, PSU or fan in this position
- replace_device: the failures look device-level (several positions or a chassis fault)
- move_port: the position itself seems faulty (e.g. a bad switch port) and the connection should move to a spare
If a repeat flag says REPLACE SUGGESTED, do not answer monitor.
Output JSON with exactly the keys: summary, recommendation.`;

export async function GET(req: NextRequest, { params }: { params: Promise<{ positionId: string }> }) {
  let user;
  try {
    user = await getCurrentUser(req);
  } catch {
    return NextResponse.json({ error: "unknown user" }, { status: 401 });
  }

  const { positionId: raw } = await params;
  let positionId = raw;
  try {
    positionId = decodeURIComponent(raw);
  } catch {}

  const history = await loadPositionHistory(positionId).catch(() => null);
  if (!history) return NextResponse.json({ error: "position not found" }, { status: 404 });
  if (!canSeeTenant(user, history.rack.tenantId)) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  if (history.tickets.length === 0) {
    const none: KnownIssueSummary = {
      positionId,
      summary: "No prior issues recorded at this position.",
      recommendation: "monitor",
    };
    return NextResponse.json(none);
  }

  const cached = demoFallback<KnownIssueSummary>(`known-issue:${positionId}`);
  let result: z.infer<typeof schema>;
  try {
    result = await completeJson(
      schema,
      SYSTEM,
      describeHistory(history, canSeeInternal(user)),
      cached && { summary: cached.summary, recommendation: cached.recommendation },
    );
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "summary failed" }, { status: 502 });
  }

  if (result.recommendation === "monitor" && history.repeatFlags.some((f) => f.replaceSuggested)) {
    result = { ...result, recommendation: "replace_part" };
  }
  const out: KnownIssueSummary = { positionId, ...result };
  return NextResponse.json(out);
}
