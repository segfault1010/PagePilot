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

## D11 — UI testing stack activated: jsdom + Testing Library (Phase 2)

PLAN.md names React Testing Library for form/report/error rendering; jsdom and Testing Library were deferred in D9 until UI behavior existed. They are now added as dev dependencies. UI tests live in `tests/ui/`; API and contract tests stay on the node environment via a per-file environment pragma.

## D12 — Static state flow until the API is wired (Phase 2)

With no backend behavior yet, submitting a valid URL runs the presentational phases from PLAN.md ("Checking URL", "Reading page structure", "Preparing UX audit") and then shows the report view populated with the shared sample fixture, clearly labeled as sample data — it never claims to be a real analysis of the entered URL. The failure state is reachable through a footer preview affordance; Phase 3 replaces that with real API error handling. The client makes no network calls in this phase.

## D13 — Client URL normalization is cosmetic, not security (Phase 2)

Client-side validation only normalizes (scheme defaulting to https://) and checks syntax/supported protocol to give fast inline feedback. All security-relevant rules (private destinations, ports, credentials, redirects) remain server-side and arrive with Phase 3+.

## D14 — Shared URL policy, authoritative server validation, placeholder success (Phase 3)

- `src/shared/url-policy.ts` is the single source for URL rules (absolute http/https only, no credentials, scheme-matched standard ports 80/443). The client uses it for inline feedback; the server enforces it independently — client checks are never trusted.
- Every syntactic/policy URL rejection maps to `400 INVALID_URL` in this phase. `403 BLOCKED_DESTINATION` is reserved for the Phase 4 network-layer destination checks (DNS/IP), which do not exist yet.
- Oversized request bodies map to `413 REQUEST_TOO_LARGE`; wrong methods include an `Allow: POST` header. `422` stays reserved per PLAN.md. Rate limiting (429) and configuration failures (503) are deferred — nothing triggers them yet.
- Valid requests receive `200` with the static sample report from `src/shared/sample-report.ts` (moved there so API and client render identical data). The UI keeps its "sample data" labeling; no real analysis exists until Phase 4–5.
- The client (`features/analysis/api.ts`) posts same-origin to `/api/analyze` with a relative URL and schema-validates both success and error envelopes; malformed payloads and network failures become predictable retryable `ApiError`s. The Phase 2 demo failure affordance was removed now that real errors flow end-to-end.
- `AnalysisLoading` no longer self-completes on timers; it cycles the planned phases and holds, while App drives completion from the actual API response.

## D15 — Vercel runtime body handling and route alignment (Phase 3 verification)

Live `vercel dev` verification exposed two divergences from the Supertest environment:

- **Platform body pre-parsing**: the Vercel Node runtime parses JSON bodies and consumes the request stream before Express runs; its parser rejects malformed JSON with a plain `Error("Invalid JSON")` that lacks body-parser's type marker. The Express app therefore uses the platform-parsed body when present (`normalizePlatformBody`) and falls back to `express.json` for plain Node environments, classifies the platform marker as `400 BAD_REQUEST`, and enforces the 4 KB limit via `Content-Length` when its own parser is skipped. Unexpected errors are logged server-side only (name/message, never stacks) while clients keep receiving the sanitized envelope.
- **Unmatched API routes**: without help, `/api/*` paths other than `/api/analyze` never reach the function and receive Vercel's platform 404 page. A rewrite (`/api/:path*` → `/api/analyze`) routes them into the Express app so every API response uses the stable error envelope, matching tests across environments.

## D16 — Static HTML only; no JavaScript execution (Phase 4)

The pipeline fetches and parses raw HTML exclusively. Target-site JavaScript is never executed: no headless browsers, no Playwright, no screenshots. Anything JavaScript-rendered is invisible to PagePilot by design, and the UI copy must never claim otherwise.

## D17 — SSRF policy: allowlist IP ranges via ipaddr.js, all-records validation (Phase 4)

Destination addresses must be global unicast space (`ipaddr.js` range `unicast` for both IPv4 and IPv6). Loopback, unspecified, RFC1918, CGNAT, link-local/metadata-service (169.254.169.254), multicast, reserved/benchmark blocks, IPv6 loopback/link-local/unique-local, IPv4-mapped, 6to4, and Teredo are all rejected. DNS returns ALL records; if any single record is unsafe the entire destination is rejected (mixed-record rebinding defense). Hostname strings are never trusted — only resolved IPs.

## D43 — Multi-Tenant Schema, Explicit RLS Policy Model, and Report Immutability Strategy (Milestone 2)

To establish the PostgreSQL / Supabase multi-tenant persistence foundation for Milestone 2:
- **Tenant Boundary & Role Hierarchy**:
  - Four explicit organization roles: `owner`, `admin`, `member`, `viewer`.
  - Deterministic tenant ownership chain: `organization` $\rightarrow$ `project` $\rightarrow$ `monitored_page` $\rightarrow$ `audit_run` $\rightarrow$ `audit_report` $\rightarrow$ (`score_snapshots`, `findings`, `recommendations`).
  - Uniqueness constraint `UNIQUE(organization_id, user_id)` guarantees unambiguous role resolution per tenant.
- **SECURITY DEFINER Helper Functions**:
  - Created `public.is_org_member`, `public.get_org_role`, `public.is_org_admin_or_owner`, and `public.is_org_owner` with fixed `search_path = public, auth, pg_temp`.
  - These prevent recursive RLS evaluations on `memberships` and provide fast, stable authorization predicates for all downstream tables.
- **Row-Level Security (RLS) Policy Model**:
  - `ENABLE ROW LEVEL SECURITY` and `FORCE ROW LEVEL SECURITY` applied across all 10 tables: `profiles`, `organizations`, `memberships`, `projects`, `monitored_pages`, `audit_runs`, `audit_reports`, `score_snapshots`, `findings`, `recommendations`.
  - Zero use of `USING (true)` or `WITH CHECK (true)` on tenant-owned tables.
  - `viewer` role is restricted to read-only (`SELECT`) operations; mutations (`INSERT`, `UPDATE`, `DELETE`) require `member`, `admin`, or `owner` privileges according to the action.
- **Historical Report Immutability**:
  - `audit_reports` stores `schema_version` (canonical constant `"1.0.0"`), `model_identifier`, `check_version`, `scoring_version`, `summary`, `overall_score`, `score_confidence`, and the complete self-contained `report_payload` JSONB.
  - RLS strictly forbids `UPDATE` on `audit_reports`, `score_snapshots`, and `recommendations`. Completed reports represent immutable historical evidence that can never be modified or recalculated in place.
- **Deletion Cascade Semantics**:
  - Deleting a project cascades deletion through all child entities: `monitored_pages`, `audit_runs`, `audit_reports`, `score_snapshots`, `findings`, `recommendations`.
  - `monitored_pages.latest_audit_run_id` uses `ON DELETE SET NULL` to avoid circular cascade locks.
- **Data Retention & HTML Exclusion**:
  - In alignment with the 90-day compact retention model, raw target HTML is **never stored** in the database. Only normalized Cheerio snapshots, deterministic signals, and validated report JSON are retained.
- **Contracts Synchronization**:
  - Database entity schemas and TypeScript types exported from `@pagepilot/contracts` (`packages/contracts/src/database-types.ts`) guaranteeing 100% type parity between persistence and application tiers.
- **Migration & Verification Strategy**:
  - Migration created at `supabase/migrations/20260827120000_init_multi_tenant_schema.sql`.
  - Validated with static SQL assertions (`packages/contracts/tests/migration-schema.test.ts`) and type validation (`packages/contracts/tests/database-types.test.ts`). Local environment lacks Docker daemon for runtime Supabase container tests; runtime DB verification remains recorded for the live staging environment.

## D44 — Supabase Auth Integration, Browser/Server Credential Boundaries, and Idempotent Workspace Provisioning (Milestone 2)

To integrate Supabase Auth into the web and API architectures while preserving the anonymous one-off audit MVP with zero regressions:
- **Strict Credential Separation**:
  - Browser bundle (`apps/web/dist`) receives only public Supabase credentials via `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`.
  - Server secrets (`SUPABASE_SERVICE_ROLE_KEY`, `GEMINI_API_KEY`) remain strictly server-only in `apps/api` and are verified absent from client bundles.
- **Zero-Disruption Anonymous Audit Pipeline**:
  - `POST /api/analyze` remains open, unauthenticated, and 100% functional for public visitors.
  - Client applications gracefully initialize without throwing if Supabase environment variables are unconfigured.
- **Server Auth Boundary & Identity Verification**:
  - Server-side auth middleware (`apps/api/src/auth/middleware.ts`) extracts `Authorization: Bearer <token>` and verifies the JWT via Supabase Auth (`supabase.auth.getUser(token)`).
  - Client-supplied identity headers (e.g. `x-user-id`, `x-organization-id`) are ignored; user identity is derived strictly from the verified session.
  - Protected routes return safe, sanitized error envelopes (`401 UNAUTHENTICATED`, `403 FORBIDDEN`) without exposing JWT contents or database internals.
- **Idempotent First-User Workspace Provisioning**:
  - When an authenticated user signs in, `resolveOrProvisionWorkspace` checks for an existing membership in `memberships`.
  - If no membership exists, it atomically provisions an organization and an `owner` membership using database unique constraints (`UNIQUE(organization_id, user_id)`) to eliminate race conditions between concurrent requests.
- **Typed Workspace Context**:
  - Added `WorkspaceContext` and `WorkspaceResponse` schemas to `@pagepilot/contracts` (`database-types.ts`).
  - Added `GET /api/workspace/me` protected endpoint returning `{ workspace: WorkspaceContext }`.
- **Client Auth State & UI**:
  - Implemented lightweight `AuthProvider` (`apps/web/src/features/auth/auth-context.tsx`) managing session lifecycle, sign-in, sign-up, sign-out, and auto-refresh of workspace context.
  - Added accessible `<AuthModal />` (with tablist semantics, keyboard navigation, and polite aria alerts) and `<AuthNav />` header controls.

## D45 — Projects & Monitored Pages Persistence, Authoritative RLS Boundary, Explicit Role Matrix, and Domain/URL Separation (Milestone 2)

To implement persistent Projects and Monitored Pages for authenticated growth teams while upholding multi-tenant security and anonymous audit stability:
- **Authoritative RLS Security Boundary**:
  - Row-Level Security (RLS) remains the primary and authoritative database security boundary. Database operations execute using the authenticated user's verified session token (`auth.uid() = req.user.id`).
  - Application-level tenant filtering (`organization_id = req.workspace.organization.id`) provides defense-in-depth.
- **Explicit Role Matrix & Project Deletion Policy**:
  - `owner` and `admin`: full project and monitored page CRUD permissions (including project deletion).
  - `member`: permitted to create, read, and update projects, and perform monitored page CRUD; **project deletion is strictly forbidden (`403 FORBIDDEN`)** aligning with database RLS policy `projects_delete_policy`.
  - `viewer`: strictly read-only (`GET` endpoints allowed; all mutations return `403 FORBIDDEN`).
- **Duplicate Monitored Page Prevention**:
  - Migration `20260827130000_monitored_page_uniqueness.sql` introduces unique index `uq_monitored_pages_project_url` on `public.monitored_pages(project_id, canonical_url)`.
  - API endpoints catch duplicate violations and return structured `409 CONFLICT` envelopes.
- **Strict Separation: URL Policy vs Domain Normalization**:
  - `enforceUrlPolicy` (`@pagepilot/contracts`): authoritative security validation for monitored pages (absolute http/https, standard ports 80/443, no credentials, returns normalized canonical href).
  - `normalizeDomain` (`@pagepilot/contracts`): project metadata formatting only (trims whitespace, strips protocol/path, lowercases hostname). Responsibilities remain strictly separated.
- **Manipulated ID & Cross-Tenant Isolation**:
  - Cross-organization queries and mismatched nested route lookups (e.g. `/api/projects/:projectId/pages/:pageId` where `pageId` does not belong to `projectId`) return safe `404 NOT_FOUND` to prevent resource probing and cross-tenant mutation.
  - Client-supplied `x-organization-id` or body parameters are ignored; tenant context is derived strictly from verified workspace session context.
- **Web API Client Token Handling**:
  - Web client API helpers (`apps/web/src/features/projects/api.ts`) automatically obtain the active Supabase session token via `getSupabaseClient().auth.getSession()` and attach `Authorization: Bearer <token>`, eliminating manual header construction for callers.

