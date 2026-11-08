// OWNER: Person B. Server-only Supabase client (service role). Never import from a client component.
import "server-only";
import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

export const db = createClient(url, serviceKey, { auth: { persistSession: false } });
