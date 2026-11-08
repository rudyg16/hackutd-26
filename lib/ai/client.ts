// OWNER: Person C. Provider-agnostic LLM client: any OpenAI-compatible endpoint
// (NVIDIA build.nvidia.com / Brev-hosted NIM or vLLM / OpenAI / OpenRouter / Ollama).
import "server-only";
import OpenAI from "openai";
import type { z } from "zod";

export const llm = new OpenAI({
  baseURL: process.env.LLM_BASE_URL,
  apiKey: process.env.LLM_API_KEY,
});
export const LLM_MODEL = process.env.LLM_MODEL!;

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
