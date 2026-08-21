# PagePilot — Architectural Decisions

Companion to `docs/PLAN.md`. Decisions are recorded in the order they are made; a later decision must not silently contradict an earlier one.

## D1 — Single Vercel project, no monorepo (Phase 1)

One repository deploys as one Vercel project: static frontend plus serverless API under the same routing model. No workspace/monorepo tooling. This keeps local development and deployment simple, per PLAN.md's summary.

## D2 — Frontend stack: Vite + React + TypeScript + Tailwind CSS (Phase 1)

Vite with the official React plugin and strict TypeScript. Tailwind CSS v4 is wired through `@tailwindcss/vite` (no PostCSS config, no `tailwind.config.js`). No component library, chart library, or UI framework is introduced; the score ring will be CSS/SVG per PLAN.md.

## D3 — API: Express-backed Vercel Node function at `/api/analyze` (Phase 1)

`api/analyze.ts` is a thin adapter from Vercel's Node handler to an Express app created in `src/server/http/app.ts`. All routing and error handling lives in server modules so the deployment entry point stays trivial. The function is configured with a 30-second max duration and `Cache-Control: no-store` on `/api/*` via `vercel.json`.

## D4 — Shared Zod contract (Phase 1)

`src/shared/audit-types.ts` is the single source of truth for the analyze request, report shape, and stable error envelope (`{ code, message, retryable }`). Client and server import the same schemas and inferred types. Stricter Gemini-output validation arrives in Phase 5 inside `src/server/schemas/audit.ts`, built on these shared shapes.

## D5 — Local development via `vercel dev` (Phase 1)

The canonical command is `vercel dev`, which runs the Vite dev server and the local API functions under the deployed routing model. Plain `npm run dev` (Vite only) remains available for pure-frontend work but does not exercise the API route.

## D6 — No database, auth, persistence, or background jobs (Phase 1)

MVP boundary from AGENTS.md and PLAN.md. The service is stateless; the later rate limit will be in-memory per warm instance and is explicitly not an authentication system.

## D7 — Phase 1 API behavior: controlled 501 (Phase 1)

Until the pipeline phases land, `POST /api/analyze` responds `501` with the stable envelope `{ code: "NOT_IMPLEMENTED", message, retryable: false }`. Malformed JSON yields `400 BAD_REQUEST`, unsupported methods yield `405 METHOD_NOT_ALLOWED`, unknown API routes yield `404 NOT_FOUND`. No fetching, extraction, AI calls, or scoring exist yet.

## D8 — Package manager: npm (Phase 1)

No lockfile or manifest existed when the project was initialized; npm was chosen as the lowest-friction default for a single-project Vercel deployment.

## D9 — Testing stack: Vitest + Supertest (Phase 1)

Matches PLAN.md's testing section. React Testing Library and jsdom are deferred until the first phase that renders testable UI behavior. Phase 1 ships only contract unit tests and API-shell integration tests.

## D10 — Environment variables are server-only (Phase 1)

`GEMINI_API_KEY` and `GEMINI_MODEL` are documented in `.env.example`, never prefixed with `VITE_`, never imported by client code, and never committed. Production values are set in the Vercel dashboard.
