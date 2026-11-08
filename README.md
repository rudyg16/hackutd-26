# NMC² Ops

Component-level ticketing, repeat-failure detection and shift handoff for colocation data centers. It includes a 3D digital twin that shows exactly which port, DIMM or bay is failing. Built for HackUTD 2026, NorthMark Compute & Cloud track.

The full spec, demo script and ownership table are in [docs/SPEC.md](docs/SPEC.md).

## Setup

```bash
npm install
cp .env.example .env.local   # fill in values (shared privately in team chat)
npm run seed                  # idempotent; safe to re-run
npm run dev                   # http://localhost:3000
```

The database schema lives in `supabase/migrations/`. Person B applies new migrations, either by pasting them into the Supabase SQL editor or with `supabase db push`.

## Layout

```
shared/          types.ts + api.ts — the contract (Person B, frozen after hour 1)
supabase/        migrations (Person B only)
seed/            device-models.json (A), base.json + demo.json (C)
scripts/seed.ts  idempotent seeder
db/  lib/access.ts  app/api/**       data + access (B)
lib/ai/  app/api/ai/**  app/api/handoffs/**   AI + handoff (C)
components/three/  app/page.tsx      3D floor + device viewer (A)
components/board/  app/board  app/admin       board + admin (B)
components/ai/     app/shift          report modal, item drawer, shift brief (C)
```

Only edit files you own (see the SPEC ownership table). Pull often and merge small.
