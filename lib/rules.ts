// OWNER: Person B. Repeat-failure rule; the SQL view `repeat_flags` is the source of truth.
import "server-only";
import type { IssueCategory, RepeatFlag } from "@/shared/types";
import { db } from "@/db/client";

interface RepeatFlagRow {
  position_id: string;
  category: IssueCategory;
  count: number;
  window_days: number;
  replace_suggested: boolean;
}

export async function getRepeatFlags(positionId: string): Promise<RepeatFlag[]> {
  const { data, error } = await db.from("repeat_flags").select("*").eq("position_id", positionId);
  if (error) throw new Error(`repeat_flags: ${error.message}`);
  return ((data ?? []) as RepeatFlagRow[]).map((r) => ({
    positionId: r.position_id,
    category: r.category,
    count: r.count,
    windowDays: r.window_days,
    replaceSuggested: r.replace_suggested,
  }));
}
