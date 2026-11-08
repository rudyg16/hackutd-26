# NMC² Ops — Claude Code rules

**Stack:** Next.js 15 App Router · TypeScript · Tailwind 4 · react-three-fiber/drei · Supabase Postgres

## Golden rule: file ownership
Never edit a file you don't own. If you need a cross-person change, stop and describe what you need in chat.

| Person | Owns |
|---|---|
| **A** | `components/three/**` · `app/page.tsx` · `seed/device-models.json` |
| **B** | `shared/**` · `supabase/**` · `db/**` · `lib/access.ts` · `lib/rules.ts` · `scripts/seed.ts` · `app/layout.tsx` · `app/globals.css` · `app/board/**` · `app/admin/**` · `components/board/**` · `app/api/**` (except `ai/` and `handoffs/`) |
| **C** | `lib/ai/**` · `app/api/ai/**` · `app/api/handoffs/**` · `app/shift/**` · `components/ai/**` · `seed/base.json` · `seed/demo.json` · `lib/sim/**` · `scripts/sim.ts` · `app/sim/**` · `app/api/sim/**` · `components/sim/**` |

The shared contract (`shared/types.ts`, `shared/api.ts`) is **read-only** for A and C. Changes go through Person B.

## While another person's route isn't live yet
Read `seed/base.json` or `seed/device-models.json` directly in the component. Swap to the real `api.*()` call once the route exists.

## CSS theme tokens (Tailwind classes from `app/globals.css`)
`bg-bg` · `bg-panel` · `bg-panel-2` · `border-line`
`text-ink` · `text-dim`
`text-neon-cyan` · `text-neon-magenta` · `text-neon-amber` · `text-neon-green`
`text-sev-low` · `text-sev-medium` · `text-sev-high` · `text-sev-critical`
Neon glow: add `neon-text` alongside the colour class.

## Supabase access pattern (server components / route handlers only)
```ts
import { db } from "@/db/client"; // service-role, server-only
import { getCurrentUser } from "@/lib/access";
// all routes must call getCurrentUser(req) and check canSeeTenant / canWorkTenant
```

## Git
- Pull before starting: `git pull origin main`
- One commit per finished task; push after each: `git push -u origin HEAD`
- Stage only your own files: `git add <your-files>`
