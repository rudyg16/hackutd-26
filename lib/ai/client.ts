// OWNER: Person C. LLM client: Google Gemini through its OpenAI-compatible endpoint.
// Configure with GEMINI_API_KEY (required) and, optionally, GEMINI_MODEL / GEMINI_BASE_URL.
// The old LLM_* (NVIDIA / Nemotron) variables are intentionally ignored.
import "server-only";
import OpenAI from "openai";
import type { z } from "zod";

const GEMINI_BASE_URL = "https://generativelanguage.googleapis.com/v1beta/openai/";

export const llm = new OpenAI({
  baseURL: process.env.GEMINI_BASE_URL ?? GEMINI_BASE_URL,
  apiKey: process.env.GEMINI_API_KEY ?? "unset", // avoid import-time throw; calls fail -> demo fallback
});
export const LLM_MODEL = process.env.GEMINI_MODEL ?? "gemini-2.5-flash";

/**
 * Ask for JSON matching `schema`. Retries once with the validation error, then
 * returns `fallback` (cached demo response) if provided, else throws.
 */
export async function completeJson<T>(
  schema: z.ZodType<T>,
  system: string,
  user: string,
  fallback?: T,
): Promise<T> {
  let lastError = "";
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await llm.chat.completions.create({
        model: LLM_MODEL,
        temperature: 0.2,
        messages: [
          { role: "system", content: `${system}\nRespond with a single JSON object only, no prose, no code fences.` },
          { role: "user", content: lastError ? `${user}\n\nYour last reply was invalid: ${lastError}` : user },
        ],
      });
      const text = res.choices[0]?.message?.content ?? "";
      const json = JSON.parse(text.replace(/^```(?:json)?\s*|\s*```$/g, ""));
      const parsed = schema.safeParse(json);
      if (parsed.success) return parsed.data;
      lastError = parsed.error.message;
    } catch (e) {
      lastError = e instanceof Error ? e.message : String(e);
    }
  }
  if (fallback !== undefined) return fallback;
  throw new Error(`LLM JSON failed: ${lastError}`);
}
