// OWNER: Person B. GET /api/users -> User[]
// Open to any recognised user, not just admins: the account switcher (simulated login) needs the
// full list so you can switch between demo accounts. Editing is admin-only, see users/[id].
import { NextResponse, type NextRequest } from "next/server";
import { db } from "@/db/client";
import { toUser } from "@/db/mappers";
import { getCurrentUser } from "@/lib/access";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    await getCurrentUser(req);
  } catch {
    return NextResponse.json({ error: "unknown user" }, { status: 401 });
  }

  const { data, error } = await db.from("users").select("*").order("name");
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json((data ?? []).map(toUser));
}
