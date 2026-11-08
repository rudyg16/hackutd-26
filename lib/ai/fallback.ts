// OWNER: Person C. Cached AI responses from seed/demo.json (`cachedAi`), keyed by the
// fallback strings the /api/ai routes build, e.g. "known-issue:SW-C4-01/port-13".
import "server-only";
import demo from "@/seed/demo.json";

const cache = (demo as { cachedAi: Record<string, unknown> }).cachedAi;

export function demoFallback<T>(key: string): T | undefined {
  return cache[key] as T | undefined;
}

export const draftTicketKey = (reportText: string) =>
  `draft-ticket:${reportText.trim().toLowerCase().slice(0, 80)}`;
