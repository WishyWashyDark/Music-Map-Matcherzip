# BeatMatch

Import an Apple Music library export and find matching Beat Saber maps on BeatSaver.

## Run & Operate

- Install dependencies with `pnpm install --frozen-lockfile` (Node.js 24 and pnpm 10).
- Start the existing `artifacts/beatmatch: web` workflow for the app at `/`.
- Start the existing `artifacts/api-server: API Server` workflow for `/api/healthz`.
- The workflows supply `PORT` and the frontend's `BASE_PATH`; use them rather than starting duplicate servers.
- `pnpm --filter @workspace/beatmatch run dev` — frontend command used by its workflow
- `pnpm --filter @workspace/api-server run dev` — API command used by its workflow
- `pnpm run typecheck` — full typecheck across all packages
- `PORT=21970 BASE_PATH=/ pnpm --filter @workspace/beatmatch run build` — build the frontend from the shell; managed workflows supply these values automatically
- `pnpm --filter @workspace/api-server run build` — build the API
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- No secrets or database are required for the current app. BeatSaver searches require internet access.
- `DATABASE_URL` is required only if the currently unused `@workspace/db` package is imported or database commands are run.

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5
- DB: PostgreSQL + Drizzle ORM
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval (from OpenAPI spec)
- Build: esbuild (CJS bundle)

## Where things live

- `artifacts/beatmatch` — React/Vite frontend and sample library in `public/`
- `artifacts/beatmatch/src/lib/library.ts` — library parsing and BeatSaver searches
- `artifacts/api-server` — Express API, currently exposing a health check
- `lib/` — shared API contracts, generated clients, and unused database scaffold
- `artifacts/mockup-sandbox` — separate design preview; not required to run BeatMatch

## Architecture decisions

_Populate as you build — non-obvious choices a reader couldn't infer from the code (3-5 bullets)._

## Product

Upload a music library, search BeatSaver by artist, view matching songs and maps, and save or reopen search results. A sample library is available from the import panel.

## User preferences

_Populate as you build — explicit user instructions worth remembering across sessions._

## Gotchas

_Populate as you build — sharp edges, "always run X before Y" rules._

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
