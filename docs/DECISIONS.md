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

## D46 — Historical Audit Report Persistence, Atomic Database RPC, Concurrent Idempotency, and Last Successful Report Semantics (Milestone 2)

To connect the `@pagepilot/audit-engine` analysis pipeline to authenticated, tenant-scoped persistent storage while maintaining strict multi-tenant isolation, historical immutability, and anonymous audit stability:
- **Audit Persistence Architecture**:
  - Introduced `AuditPersistenceStore` interface (`apps/api/src/audits/audit-store.ts`) and `SupabaseAuditPersistenceStore` executing queries with the user's verified session token (`auth.uid() = req.user.id`).
  - Introduced `AuditService` (`apps/api/src/audits/audit-service.ts`) orchestrating run lifecycle, safe execution of `@pagepilot/audit-engine`, and atomic persistence.
  - Mounted audit endpoints under `/api/projects/:projectId/pages/:pageId/audits` (`apps/api/src/audits/routes.ts`).
- **Atomic Report Persistence via PostgreSQL RPC**:
  - Migration `20260827140000_audit_persistence_and_idempotency.sql` introduces PostgreSQL stored function `public.persist_completed_audit_report(...)`.
  - The function runs in a single transaction to update `audit_runs` to `completed`, insert `audit_reports`, batch-insert `score_snapshots` (7 categories), batch-insert `findings` (top problems + category findings), batch-insert `recommendations` (quick wins + detailed), and update `monitored_pages` pointers.
  - All rows commit together or roll back on error, guaranteeing zero partial persistence states.
- **Concurrent Idempotency Conflict Resolution**:
  - Added unique partial index `uq_audit_runs_idempotency` ON `public.audit_runs(monitored_page_id, idempotency_key) WHERE idempotency_key IS NOT NULL`.
  - When concurrent requests with the same idempotency key arrive, the losing request catches Postgres constraint violation `23505`, fetches the existing run/report, and avoids re-executing analysis or creating duplicate records.
- **Distinct HTTP Statuses for Idempotency**:
  - Newly executed and persisted manual audits return `201 Created`.
  - Idempotent requests finding an already-completed report return `200 OK` with the existing report payload.
- **Latest Successful Audit Semantics**:
  - `monitored_pages` maintains distinct pointers: `latest_audit_run_id` (most recent run of any status) and `latest_successful_audit_run_id` (most recent completed run).
  - When an audit fails, `latest_audit_run_id` is updated, but **`latest_successful_audit_run_id` remains unchanged**, preserving the last valid historical report for monitoring and history queries.
- **Historical Immutability & Version Preservation**:
  - RLS policies disallow `UPDATE` operations on `audit_reports`, `score_snapshots`, and `recommendations`.
  - Every persisted report stores frozen version metadata (`schema_version = "1.0.0"`, `check_version = "1.0.0"`, `prompt_version = "1.0.0"`, `scoring_version = "1.0.0"`, and `model_identifier`).
- **Anonymous MVP Audit Unchanged**:
  - `POST /api/analyze` remains open, unauthenticated, stateless, and verified live with `pnpm run verify:gemini`.

## D47 — Workspace UI, Project/Page Management, Audit History, and Safe Selection Persistence (Milestone 2)

To turn the authenticated persistence and API layer into a cohesive, accessible workspace experience:
- **Component Hierarchy & Separation**:
  - Created modular workspace components under `apps/web/src/features/workspace/components/`:
    - `WorkspaceShell`: orchestrates top-level navigation, project/page selection, view level transitions, and one-off audit switching.
    - `ProjectList`: displays project cards, metadata, empty states, and role-gated creation/editing/deletion.
    - `ProjectDetail`: shows project overview, breadcrumbs, monitored page list, status badges, cadence, tags, and page management actions.
    - `PageDetail`: renders monitored page overview, latest overall score with confidence pills, last audit timestamp, failure preservation banner with "View Last Successful Audit", "Run Audit" action, and paginated audit history table.
    - `HistoricalReportView`: reuses the verified `ReportView` component (`src/features/analysis/components/report-view.tsx`) wrapped in a historical metadata header (run timestamp, model version, scoring version, and back navigation).
    - `ProjectModal`: accessible dialog with keyboard `Escape` support, validating project name, domain, timezone, and goals against `@pagepilot/contracts` schemas.
    - `MonitoredPageModal`: accessible dialog validating landing page URLs via `@pagepilot/contracts` `enforceUrlPolicy` and parsing tags.
    - `DeleteConfirmModal`: accessible confirmation dialog for destructive project and page deletions.
- **Safe Selection Persistence & Authorization Re-validation**:
  - Selected project and page IDs are saved in session storage for navigation convenience across refreshes, but **stored IDs are never treated as authorized**.
  - On mount or change, selections are re-validated through API queries (`listProjects`, `getProject`, `getMonitoredPage`). If a resource is not found (e.g. user switches accounts or resource was deleted), the stored selection is cleared immediately and the view falls back safely to the project list.
- **Role-Aware UI Visibility**:
  - `viewer`: Read-only. Mutation controls ("+ New Project", edit project, delete project, "+ Add Page", edit page, delete page, status toggles, "Run Audit") are hidden or disabled; viewing projects, pages, latest reports, and historical reports is fully supported.
  - `member`: Full project creation/editing, monitored page management (add/edit/delete/toggle status), and manual audit triggers are enabled; **project deletion is hidden** (matching D45/D46).
  - `owner` / `admin`: Full project, page, and audit management controls enabled.
- **Manual Audit Idempotency Key Lifecycle**:
  - Clicking "Run Audit" generates a client-side idempotency key for that specific action.
  - If a transient network error occurs, the key is preserved so retries avoid duplicate runs.
  - On completion or starting a fresh audit, a new idempotency key is generated.
- **Failed Run Notice & Last Successful Report Access**:
  - When the latest audit run for a page failed, an alert banner explains the failure reason while confirming that the previous successful report is preserved. A dedicated "View Last Successful Audit" button provides instant access to the valid report evidence.
- **Anonymous One-Off Audit Flow Preserved**:
  - Anonymous visitors continue to land on the public one-off auditor (`Landing` $\rightarrow$ `Analyzing` $\rightarrow$ `Report` / `Failure`) with zero friction.
  - Authenticated users can seamlessly switch between the workspace and the one-off auditor via the navigation header.

## D48 — Inngest Durable Workflows Architecture, Decoupled Workflow Package, Event Contracts, and Baseline Audit Execution (Milestone 3)

To introduce Inngest as the durable background workflow orchestration engine for continuous monitoring:
- **Modular Package Boundary (`@pagepilot/workflows`)**:
  - Established `@pagepilot/workflows` package owning durable workflow definitions without UI or Express routing concerns.
  - The package depends on `@pagepilot/contracts`, `@pagepilot/audit-engine`, and `inngest`.
  - **Decoupled Database Boundary**: `@pagepilot/workflows` does not depend on `@supabase/supabase-js`. It defines a narrow `WorkflowPersistenceStore` interface. The database implementation (`SupabaseWorkflowPersistenceStore`) lives server-side in `apps/api`.
- **Server-Only Credentials & Runtime Boundary**:
  - Inngest secrets (`INNGEST_EVENT_KEY`, `INNGEST_SIGNING_KEY`), Supabase credentials (`SUPABASE_SERVICE_ROLE_KEY`), and `GEMINI_API_KEY` remain strictly server-only within `apps/api`.
  - Browser bundles contain zero workflow package references and zero server credentials.
- **Versioned Event Contracts**:
  - Defined `audit/requested` (`AUDIT_REQUESTED_EVENT`) and companion event contracts (`audit/completed`, `audit/failed`) in `@pagepilot/contracts`.
  - Payload contract `auditRequestedPayloadSchema` includes strictly resource IDs (`auditRunId`, `organizationId`, `projectId`, `monitoredPageId`, `requestedByUserId`).
  - Raw HTML, Gemini prompts, and secrets are strictly excluded from event payloads.
- **Idempotency, DB-Backed Concurrency Lock, and Replay Safety**:
  - Every workflow execution is anchored to `audit_run.id`.
  - Step 1 (`claim-and-validate-run`):
    - Validates payload against Zod schema and enforces strict tenant isolation.
    - Idempotency check: if `status === "completed"`, returns early without re-executing analysis or creating duplicate reports.
    - Concurrency lock: atomically claims execution in PostgreSQL (`status IN ('requested', 'queued')` $\rightarrow$ `status = 'running'`). If a concurrent worker is already executing (`status === 'running'`), returns `{ state: "already_running" }` and terminates cleanly.
- **Isolated Multi-Step Execution & Failure Semantics**:
  - Step 2 (`execute-audit-engine`): calls `@pagepilot/audit-engine` (`analyzeTarget`) outside of database transactions.
  - Step 3 (`persist-audit-result`):
    - On success: commits completed report atomically via existing PostgreSQL RPC `persist_completed_audit_report` and updates latest pointers.
    - On failure: records failure metadata in `audit_runs` and updates `latest_audit_run_id` while **preserving `latest_successful_audit_run_id` intact**.
    - Non-retryable errors (e.g. `INVALID_URL`, `BLOCKED_DESTINATION`) throw `NonRetriableError` to avoid infinite retry loops.
- **API Strategy (Option A)**:
  - Existing authenticated manual audit endpoint (`POST /api/projects/:projectId/pages/:pageId/audits`) remains synchronous to prevent regressions in the workspace UI, while the durable Inngest workflow is established as a fully functional background path ready for weekly monitoring in Task 3.2.
  - Anonymous `/api/analyze` remains open, unauthenticated, and stateless.
  - Express serve handler is mounted at `/api/inngest` in `apps/api/src/http/app.ts`.

## D49 — Weekly Scheduled Audit Workflow, Timezone Handling, and Multi-Trigger Idempotency (Milestone 3)

To automate scheduled weekly landing page audits with zero duplicate runs across timezones, retries, and concurrent triggers:
- **Durable Weekly Scheduler Function (`weekly-audit-scheduler`)**:
  - Implemented in `@pagepilot/workflows` as `createWeeklyScheduler`.
  - Supports dual triggers:
    1. Cron: `0 0 * * 1` (Runs globally every Monday at 00:00 UTC).
    2. Event: `audit/schedule-weekly` (for testing, staging, and administrative triggers).
  - Registered alongside `execute-audit-workflow` in `apps/api/src/http/app.ts` under `/api/inngest`.
- **Active & Weekly Eligibility Discovery**:
  - `listEligibleWeeklyPages` strictly queries pages with `status = 'active'` and `cadence = 'weekly'`.
  - Paused and archived pages are filtered out in discovery and re-verified during execution.
  - Pages are enriched with project timezone metadata (`projects.timezone`).
- **Deterministic Timezone & Week Window Derivation**:
  - `getWeeklyWindow(date, timezone)` in `@pagepilot/contracts` formats the date into the target IANA timezone via standard `Intl.DateTimeFormat` and computes the ISO-8601 week number (`YYYY-Www`).
  - Safe fallback to UTC on invalid or missing timezones.
  - Generates deterministic window IDs (e.g. `2026-W35`) that remain constant throughout the week regardless of DST transitions, UTC hour offsets, or scheduler retry timing.
- **Deterministic Idempotency Key & Pre-Persisted Run**:
  - Each scheduled audit constructs an idempotency key: `scheduled:${page.id}:${windowId}`.
  - Before emitting any event, the scheduler pre-persists the `audit_run` in PostgreSQL with:
    - `invocation_type = 'scheduled'`
    - `triggered_by_user_id = null` (scheduled runs never impersonate interactive users)
    - `idempotency_key = scheduled:${page.id}:${windowId}`
  - If a run already exists for that `(monitored_page_id, idempotency_key)`:
    - `createScheduledAuditRun` returns `{ run: existingRun, isExisting: true }`.
    - The scheduler **suppresses event emission** when `isExisting === true`. This guarantees that multiple cron triggers, manual event dispatches, or Inngest step retries in the same week never emit duplicate `audit/requested` events.
    - PostgreSQL unique index `uq_audit_runs_idempotency` acts as the authoritative final barrier against race conditions.
- **Zero Workflow Duplication**:
  - The scheduler emits standard `audit/requested` events referencing persisted IDs only.
  - Reuses the verified `execute-audit-workflow` pipeline (SSRF-safe fetch, deterministic checks, structured Gemini audit, atomic PostgreSQL persistence RPC, and failure preservation semantics).

## D50 — Pure Deterministic Regression Diff Engine, Stable Finding Identity, and Meaningful Regression Thresholds (Milestone 3)

To compare historical audit reports and evaluate regressions for continuous landing page monitoring:
- **Pure Function & Historical Report Immutability**:
  - `computeAuditDiff(params)` is a pure, side-effect free, deterministic function in `@pagepilot/audit-engine`.
  - Zero network calls, zero database queries, zero model invocations, and zero timestamp guessing.
  - Input reports (`previousReport` and `currentReport`) are treated as immutable historical evidence and never mutated.
- **Centralized Meaningful Regression Thresholds**:
  - `MEANINGFUL_OVERALL_SCORE_DROP_THRESHOLD = 10`: an overall score drop of $\ge 10$ points is classified as a meaningful regression and added to `regressions`.
  - `MEANINGFUL_CATEGORY_SCORE_DROP_THRESHOLD = 15`: a category score drop of $\ge 15$ points is classified as a meaningful category regression and added to `regressions`.
  - Smaller score decreases still record `direction = "regressed"` but are **not included** in the meaningful `regressions` collection.
- **Stable Finding Identity Strategy**:
  - For observed findings backed by deterministic signals, `buildFindingIdentityKey` derives an identity key based on sorted signal IDs: `findingType:category:signal:sig1+sig2`. This guarantees that harmless LLM title/evidence wording changes do not cause false finding churn.
  - For inferred findings without signal IDs, `buildFindingIdentityKey` normalizes the title into a clean alphanumeric slug: `findingType:category:inferred:normalized-slug`.
  - Classifies findings into `new`, `resolved`, `changed`, and `unchanged`.
- **Severity Movement & Regression Triggers**:
  - Tracks severity movement across `low` (1), `medium` (2), `high` (3).
  - Severity increases (`low -> medium`, `medium -> high`, `low -> high`) are recorded as regressions.
  - Newly introduced `high`-severity findings trigger `hasMeaningfulRegression = true`.
- **Deterministic Signal Diffing & Neutral Unknown Rule**:
  - Tracks signal transitions: `pass -> warn` (regression), `warn -> pass` (improvement), `unknown -> pass/warn` (`became_measured`), and `pass/warn -> unknown` (`became_unknown`).
  - Transitions to or from `unknown` represent changes in evidence availability and are **never classified as regressions or penalties**.
- **First-Audit Baseline State**:
  - When `previousReport === null` (first successful audit for a page), `computeAuditDiff` returns an explicit baseline state (`isBaseline = true`, `hasPreviousReport = false`, `hasMeaningfulRegression = false`) with zero regressions.
- **Observed vs Inferred Evidence Separation**:
  - Every finding diff item, regression item, and improvement item preserves its `basis` (`"observed" | "inferred"`).
  - The summary explicitly tallies `observedRegressionsCount` and `inferredRegressionsCount` to maintain evidence transparency.

## D51 — Deterministic Alert Rules, Severity Mapping, Repeated Failure Threshold, and Deduplication Key Strategy (Milestone 3)

To evaluate regressions and detect actionable issues from audit diffs without premature notification delivery:
- **Pure Evaluation & Context-Driven Determinism**:
  - `evaluateAuditAlerts(diff, context, options)` and `evaluateScanFailureAlert(context, failureInfo)` are pure, deterministic functions in `@pagepilot/workflows`.
  - Zero side effects, zero DB queries, zero network calls, and zero external email or webhook dispatch.
  - `evaluatedAt` is supplied strictly as an input parameter via `AlertEvaluationContext`, preserving 100% determinism and eliminating non-deterministic clock access.
- **Alert Rules & Centralized Thresholds**:
  1. `overall_score_drop`: Triggered when overall score delta $\le -10$ points (`MEANINGFUL_OVERALL_SCORE_DROP_THRESHOLD`). Severity: `high`.
  2. `category_score_drop`: Triggered when a category score delta $\le -15$ points (`MEANINGFUL_CATEGORY_SCORE_DROP_THRESHOLD`). Severity: `high` if drop $\ge 25$, `medium` if $\ge 15$. Drops $< 15$ points do not trigger category alerts.
  3. `new_high_severity_finding`: Triggered when a brand new finding appears with `severity === "high"`. Severity: `high`. Low/medium findings do not trigger this alert.
  4. `finding_severity_increased`: Triggered when an existing finding's severity escalates (e.g. `low -> high`, `low -> medium`). Severity matches the new escalated level. Severity reductions (improvements) never trigger alerts.
  5. `signal_regressed`: Triggered when a deterministic signal regresses (`pass -> warn`). Severity: `medium`.
  6. `repeated_scan_failure`: Triggered when consecutive audit failures reach or exceed `DEFAULT_REPEATED_FAILURE_ALERT_THRESHOLD = 3`. Severity: `high`.
- **Deduplication Key Strategy**:
  - Format: `buildAlertDeduplicationKey` $\rightarrow$ `alert:${monitoredPageId}:${ruleType}${targetId ? `:${targetId}` : ""}`.
  - The key identifies the **logical alert condition** (the page, rule, and specific finding/signal identity) rather than the transient `auditRunId`.
  - This guarantees that repeated or consecutive runs experiencing the same ongoing regression condition generate the identical deduplication identity for 24-hour delivery deduplication in Task 3.5.
- **Baseline & Unknown State Suppression**:
  - Baseline first-ever audits (`isBaseline === true` or `hasPreviousReport === false`) generate **zero alerts**.
  - Transitions to or from `unknown` deterministic signals (`unknown -> pass/warn` or `pass/warn -> unknown`) are neutral evidence state shifts and **never generate alerts**.
- **Deterministic Priority Ordering**:
  - Multiple simultaneous alert decisions are sorted deterministically: `high` severity first, followed by `medium`, then `low`, with tie-breaking on rule priority (`overall_score_drop` $\rightarrow$ `new_high_severity_finding` $\rightarrow$ `finding_severity_increased` $\rightarrow$ `category_score_drop` $\rightarrow$ `signal_regressed` $\rightarrow$ `repeated_scan_failure`) and deduplication key.

## D52 — Alert Persistence Model, Delivery Channel Abstraction, Recipient Resolution, State-Aware 24-Hour Suppression, and Delivery Idempotency (Milestone 3)

To turn pure `AlertDecision` results into durable, idempotent persisted alerts and safely deliver notifications via Inngest background workflows:
- **Alert Persistence Model & Schema Migration**:
  - `supabase/migrations/20260829120000_alerts_and_delivery.sql` creates `public.alerts` and `public.alert_deliveries` tables.
  - `alerts` records rule type, severity, reason summary, details, category, target ID, score delta, previous/current values, logical `deduplication_key`, and `schema_version = '1.0.0'`.
  - Unique partial index `uq_alerts_run_dedup` on `(audit_run_id, deduplication_key) WHERE audit_run_id IS NOT NULL` prevents duplicate alert rows for the same run.
  - Row-Level Security (RLS) is strictly enabled and forced on both tables, restricting read/write access to organization members (`is_org_member`) and deletion to admins/owners (`is_org_admin_or_owner`).
- **State-Aware 24-Hour Suppression Window**:
  - To prevent alert spam on recurring weekly scans while allowing legitimate regressions to notify teams, `persistAlert` checks for existing alerts with the same `(monitored_page_id, deduplication_key)` within 24 hours.
  - State-awareness: if the existing alert within 24 hours reflects an **identical ongoing regression condition** (`currentValue`, `previousValue`, `scoreDelta` all match), the alert is marked `isSuppressed = true` and no notification event is emitted.
  - If the intermediate state was clean/resolved, or if the score regression deepened, it is treated as a new regression and persisted with `isSuppressed = false`.
- **Recipient Resolution**:
  - `listOrganizationRecipients(orgId)` queries `memberships` joined with `profiles` for `role IN ('owner', 'admin')`.
  - Alerts are delivered to team leads and administrators who have authority to act on UX regressions. Viewers and regular members are excluded from default transactional alert delivery.
- **Delivery Channel Abstraction & Security**:
  - Pure `NotificationProvider` interface in `@pagepilot/workflows` decoupling workflows from specific transactional email vendors (Resend/SendGrid/SES).
  - `MockEmailNotificationProvider` (with simulated retryable failure support) for automated tests, and `ConsoleEmailNotificationProvider` for local development.
  - `buildAlertEmailContent` is a pure deterministic renderer generating both semantic HTML and plain text emails with accessible score changes and severity badges.
  - Strict security boundary: user inputs, titles, and evidence are HTML-escaped; raw HTML and server secrets (`SUPABASE_SERVICE_ROLE_KEY`, `GEMINI_API_KEY`, etc.) are never leaked.
- **Delivery Idempotency & Delivery Semantics**:
  - Unique constraint `uq_alert_deliveries_key` on `alert_deliveries(delivery_key)` where `delivery_key = buildAlertDeliveryKey(alertId, "email", recipient)`.
  - Delivery semantics are explicitly documented as **at-least-once**. While the database `delivery_key` prevents duplicate delivery tracking records and suppresses resends upon workflow replay, network-level crashes between third-party provider acceptance and database commitment may result in at-least-once email transmission.
  - If an Inngest step or workflow is retried, `getOrCreateDelivery` detects existing `status === "delivered"` records and skips duplicate provider dispatch.

## D53 — Native SVG Trend Dashboard, Category Score Trajectories, and Zero Heavy Chart Dependencies (Milestone 3)

To visualize landing page UX health trajectories and category movements over time without adding heavy third-party bundle weight:
- **Zero Heavy Chart Dependencies**:
  - In accordance with `AGENTS.md` and Decision `D2`, external chart libraries (e.g. Chart.js, Recharts, D3) were avoided.
  - Built a native SVG `<ScoreTrendChart />` component in `apps/web/src/features/workspace/components/score-trend-chart.tsx`.
  - SVG polylines, area gradient fills, coordinate scaling, and responsive viewBox keeping the production bundle light, fast, and dependency-free.
- **Score History & Category Trajectory Mapping**:
  - `AuditHistoryItem` in `@pagepilot/contracts` was augmented with optional `categoryScores?: Partial<Record<AuditCategory, number>>`.
  - `listAuditHistory` in `apps/api/src/audits/audit-store.ts` extracts `categories` from `audit_reports.report_payload` alongside the run record, avoiding any additional database round-trips.
- **Baseline & Edge-Case Handling**:
  - Single audit baseline: renders a distinct radar-like baseline marker with "Baseline Established" indicator without computing false deltas.
  - Multi-audit progression: calculates overall net improvement/decline since baseline and recent delta vs previous audit.
  - Failed scans: filtered from the score line so that failed runs do not pollute historical score curves or replace last successful measurements.
  - Empty history: displays an actionable empty state prompting the team to run the first audit.
- **Interactive Tooltips & Category Trajectories Grid**:
  - Interactive hover and focus data points reveal rich metadata: date/time, score, confidence, delta vs previous, and invocation type (`scheduled` vs `manual`).
  - 7 Category Trajectory cards display current score, visual progress bar, and score delta vs previous audit for each UX dimension (`clarity`, `visualHierarchy`, `ctaEffectiveness`, `copy`, `accessibility`, `mobileUx`, `trustCredibility`).
- **Accessibility & Motion Considerations**:
  - Complete ARIA labelling: `role="region"`, `aria-label="UX Score Trend and Historical Trajectory"`, and `role="img"` on SVG with narrative description.
  - Focusable keyboard-navigable dots with `tabIndex={0}` and screen-reader accessible attributes.
  - Respects `@media (prefers-reduced-motion)` through clean CSS transitions and zero jarring animations.

## D54 — Collaboration & Prioritization Data Model, Mutable Work Items vs Immutable Evidence, Database Assignee Authorization, and Atomic Activity Trail (Milestone 4)

To turn persisted audit findings and recommendations into tenant-scoped collaborative work items without changing historical audit reports:
- **Clean Separation: Mutable Work Items vs Immutable Audit Evidence**:
  - `findings`, `recommendations`, `audit_reports`, and `score_snapshots` remain **100% immutable historical evidence**.
  - Collaborative actions create separate mutable records in `public.work_items`, linked via `source_type` (`'finding'` or `'recommendation'`), `finding_id`, and `recommendation_id`.
  - Resolving or updating a work item never mutates the underlying audit finding row.
- **Database-Level Assignee Authorization**:
  - To prevent crafted requests or direct database updates from assigning work items to cross-tenant or arbitrary users, database trigger `trg_check_work_item_assignee` and function `public.check_work_item_assignee_org()` enforce that `assignee_id` MUST be a valid member of `organization_id` in `public.memberships`.
- **Work-Item Deduplication & Unique Partial Indexes**:
  - Created unique partial indexes `uq_work_items_page_finding` on `(monitored_page_id, finding_id) WHERE finding_id IS NOT NULL` and `uq_work_items_page_recommendation` on `(monitored_page_id, recommendation_id) WHERE recommendation_id IS NOT NULL`.
  - The API explicitly catches constraint violations (Postgres code `23505`) and surfaces a structured `409 CONFLICT` envelope (`API_ERROR_CODES.conflict`) rather than an unclassified 500.
- **Atomic PostgreSQL RPCs & Activity Trail**:
  - `public.create_work_item_atomic` and `public.update_work_item_atomic` guarantee that work item mutations and corresponding `public.work_item_activities` audit records commit together in a single PostgreSQL transaction.
  - `work_item_activities` preserves an immutable append-only trail of mutations (`created`, `status_changed`, `assigned`, `unassigned`, `updated`) capturing actor, timestamp, previous/new status, and details.
- **Row-Level Security (RLS) & Role Matrix**:
  - RLS is strictly enabled and forced on `work_items` and `work_item_activities`.
  - `owner`, `admin`, `member`: full CRUD within their verified organization.
  - `viewer`: read-only access (`SELECT` allowed; mutations return `403 FORBIDDEN`).
  - Cross-tenant queries return safe `404 NOT_FOUND` to prevent resource probing.
- **Contracts Synchronization**:
  - Added `workItemSchema`, `workItemActivitySchema`, `createWorkItemSchema`, `updateWorkItemSchema`, `workItemFiltersSchema`, and responses in `@pagepilot/contracts` with strict note/tag bounds (notes $\le 5000$ chars, tags $\le 20$ items $\times 50$ chars, rationale $\le 2000$ chars).

## D55 — Collaboration Workspace UI, Filterable Backlog, Member Assignee Selection, and Historical Report Tracking (Milestone 4)

To provide an authenticated collaboration experience for growth teams prioritizing and resolving landing page UX issues without mutating immutable audit evidence:
- **Work Backlog UI & Filterable Prioritization Queue**:
  - Built `<WorkItemsBacklog />` in `apps/web/src/features/work-items/components/work-items-backlog.tsx`.
  - Multi-dimensional filtering across Status (`All`, `Open`, `In Progress`, `Resolved`, `Dismissed`), Severity (`All`, `High`, `Medium`, `Low`), Assignee (`All`, `Unassigned`, and specific members), Monitored Page, and UX Category.
  - Multi-directional sorting by Severity/Priority, Recent Updates, Status, and Title.
  - Empty states distinguish `"Nothing needs attention yet."` (zero work items) from `"No work items match these filters."` (filtered out).
- **Assignee Selection Restricted to Organization Members**:
  - Assignee selectors in creation and detail modals are strictly populated from verified organization members loaded via `GET /api/workspace/members`.
  - Freeform email entry is disallowed, upholding tenant boundary invariants established in `D54`.
- **Detail Modal, Resolution Rationale, and Append-Only Activity Trail**:
  - Built `<WorkItemDetailModal />` in `apps/web/src/features/work-items/components/work-item-detail-modal.tsx`.
  - Accessible dialog (`role="dialog"`, `aria-modal="true"`, `Escape` to close, visible focus rings) providing quick status transitions (`Start Progress`, `Resolve Issue`, `Dismiss`, `Reopen Issue`).
  - Required resolution rationale textarea when resolving (2000 character bound).
  - Note editor (5000 character bound) and interactive tag manager (max 20 tags $\le 50$ characters).
  - Activity history feed displaying chronological immutable timeline of actions (`created`, `status_changed`, `assigned`, `unassigned`, `updated`) with actors and timestamp formatting.
  - Deep links to monitored landing page and source historical audit report.
- **Creation from Audit Findings & Recommendations with 409 Conflict Handling**:
  - Added `+ Track Work Item` trigger buttons on findings and recommendations in `FindingCard`, `TopProblems`, `DetailedRecommendations`, `ReportView`, and `HistoricalReportView`.
  - `<CreateWorkItemModal />` in `apps/web/src/features/work-items/components/create-work-item-modal.tsx` pre-populates finding/recommendation titles, evidence, category, and severity.
  - Catches duplicate partial unique index violations (Postgres 409 conflict) with the exact user copy: `"That finding/recommendation already has a work item."`
- **Role-Based Permissions & Immutability**:
  - Viewer role: read-only access with interactive controls disabled (`disabled={isViewer}`) and clear helper text explaining read-only permissions.
  - Historical audit reports and database finding/recommendation rows remain 100% immutable. Tracked work items exist exclusively in `public.work_items` with separate lifecycles.
## D56 — Read-Only Shared Report Links, High-Entropy Bearer Tokens, SHA-256 Hash Persistence, Revocation, and Public Boundary (Milestone 4 — Task 4.3)

To allow workspace members to share specific historical audit reports with external stakeholders, clients, or leadership without granting workspace access or violating tenant isolation:
- **Share Model Tied Exclusively to One Immutable Historical Report**:
  - `public.report_share_links` links directly to a specific `audit_run_id` and `audit_report_id` within a verified `organization_id` and `monitored_page_id`.
  - A share token grants access to *only* that single audit report. It cannot be used to inspect monitored pages, organization projects, work items, alerts, or audit run history.
- **Cryptographic Token Architecture & Hash-Only Persistence**:
  - Unforgeable tokens are generated server-side using 256-bit cryptographically secure pseudorandom entropy (`crypto.randomBytes(32).toString("base64url")`).
  - The plaintext bearer token is returned to the creator *exactly once* upon creation and is never persisted in plaintext.
  - The database persists only the deterministic SHA-256 hash (`token_hash = sha256(token)`) backed by a unique index (`idx_report_share_links_token_hash`).
- **Strict Public Resolver Isolation & Sanitized Projection**:
  - Public token resolution is executed via a dedicated `SECURITY DEFINER` PostgreSQL RPC `public.get_shared_audit_report(p_token_hash text)` running with `SET search_path = public, pg_temp;`.
  - The function verifies token validity, expiration (`expires_at > now()`), and revocation (`revoked_at IS NULL`), and projects *only* the sanitized report payload, audit run timestamps/model metadata, score snapshots, findings, and recommendations.
  - Internal tenant identifiers (`organization_id`, member user IDs, emails, work items, alert rules) are strictly excluded from the public projection.
  - Updates `last_accessed_at` timestamp upon each successful lookup.
- **Uniform 404 Error Obfuscation & Public Rate Limiting**:
  - To prevent token enumeration, timing attacks, or state probing, all failure cases (invalid token, expired link, revoked link, non-existent share) return an identical `404 NOT_FOUND` with message `"This report link is no longer available."`.
  - Public endpoint `/api/shared/reports/:token` is safeguarded with an IP-based rate limiter (60 requests / 10 minutes per IP) returning `429 RATE_LIMITED`.
  - HTTP responses enforce strict anti-indexing and security headers: `Cache-Control: no-store, no-cache, must-revalidate`, `X-Robots-Tag: noindex, nofollow`, and `X-Content-Type-Options: nosniff`.
- **Expiration, Revocation, and Workspace Lifecycle Controls**:
  - Configurable expiration periods: 7 days, 30 days (default), 90 days, or 365 days.
  - Explicit revocation mechanism: Authenticated workspace members (owner, admin, member) can immediately revoke active share links. Revocation takes effect instantly across all sessions.
  - Viewer role: read-only access to view share status; cannot generate or revoke share links.
- **Isolated Public Report View**:
  - Standalone `<SharedReportPage />` in `apps/web/src/features/share/components/shared-report-page.tsx` renders the full rich report without workspace navigation sidebars, edit controls, or "+ Track Work Item" mutation triggers.
  - When an expired or revoked link is loaded, displays a clean, non-intrusive unavailable screen.
- **Runtime RLS Status**:
  - Full schema, RLS policies, and RPC definitions are committed in migration `20260830130000_report_share_links.sql` and verified via contracts and unit/integration test suites. Actual live runtime Supabase RLS verification remains marked `PENDING STAGING` until a dedicated PagePilot Supabase staging instance is provisioned.

## D57 — Project Prioritization Views, Historical Report Comparison, Deterministic Ranking, and Automatic Baseline Selection (Milestone 4 — Task 4.4)

To turn audit findings and monitoring streams into an actionable, explainable prioritization engine and give teams continuous visibility into UX regressions and improvements over time:
- **Pure Deterministic Historical Report Comparison**:
  - Registered `GET /api/projects/:projectId/pages/:pageId/audits/:auditRunId/diff` in `apps/api/src/audits/routes.ts`.
  - Computes pure deterministic diffs using `computeAuditDiff` from `@pagepilot/audit-engine` and returns `{ diff, currentReport, previousReport }` conforming to `auditDiffResponseSchema`.
  - Zero mutations to historical reports, findings, recommendations, score snapshots, or audit runs: historical reports remain immutable evidence.
- **Automatic Comparison Baseline vs. Explicit Comparison**:
  - When `compareRunId` is not supplied in query parameters, the server queries `getPreviousSuccessfulAudit(orgId, projectId, pageId, beforeTimestamp)`, strictly selecting the most recent audit with `status = 'completed'` created prior to the current run's timestamp (`created_at < beforeTimestamp`).
  - Failed, queued, or running audits are never used as comparison baselines.
  - When a page has only one completed audit, the server returns `isBaseline: true` with `previousReport: null`, and the UI renders a dedicated "Baseline Audit Established" notice.
  - Supports explicit `compareRunId` parameter allowing teams to compare any arbitrary pair of completed audits on that landing page.
- **Deterministic Project Prioritization Ranking**:
  - Highest-Impact Open Work in `<ProjectDetail />` ranks open and in-progress work items deterministically:
    1. Severity rank: `high` (3) > `medium` (2) > `low` (1)
    2. Recency: `updatedAt` descending
  - Explicitly rejects composite/opaque "business-impact scores" in favor of transparent, explainable ranking using verified severity, status, and recency attributes.
- **Project Prioritization Sections & Navigation**:
  - **Overview & Priorities Tab**:
    1. Summary KPI cards: Monitored Pages (active tally), Open Work Items (high-severity tally), Audited Pages count, Resolved Improvements count.
    2. **Highest-Impact Open Work**: Ranked list of open/in-progress work items with deep-link modal inspection (`<WorkItemDetailModal />`), assignee chips, and empty states.
    3. **Landing Page UX Trajectories**: Monitored pages with direct "Compare Changes" actions and management controls.
    4. **Resolved Improvements**: Verified improvements with resolution rationale, resolver info, and resolution date.
  - **Monitored Pages Tab**: Complete landing page directory with status toggles, cadence, tags, edit, and deletion modals.
- **Comprehensive Comparison Viewer (`<ReportComparisonView />`)**:
  - Score Delta Hero: Previous Score $\to$ Current Score with delta badge and meaningful regression alerts (highlighted when $\Delta \le -10$ or new high-severity findings appear).
  - 7 Category Score Changes Grid: Before $\to$ After score transitions and severity shifts for all 7 UX dimensions.
  - Filterable Tabbed Diff Views:
    - **Regressions & Issues**: Score drops, new high-severity issues, severity escalations.
    - **New Findings**: Newly detected problems with `+ Track Work Item` action for non-viewers.
    - **Resolved Findings**: Fixed problems highlighted with line-through styling and previous evidence.
    - **Changed Findings**: Material before/after changes in severity and recommendations.
    - **Deterministic Signals**: Status transitions (`pass -> warn`, `warn -> pass`, `became_measured`, `became_unknown`).
    - **Improvements**: Positive score deltas and resolved issues.
  - Compare Target Dropdown: Allows switching the comparison baseline to any historical run directly in the UI.
- **Strict Role Gating & Tenant Isolation**:
  - Viewer role has read-only access to diffs and comparison views; `+ Track Work Item` buttons and page mutation controls are hidden.
  - Cross-tenant requests return safe `404 NOT_FOUND`.

## D58 — Dedicated PagePilot Supabase Project Provisioning, Migration Application, and Live Auth/RLS Runtime Verification

To establish a dedicated, secure multi-tenant database environment for PagePilot prior to Milestone 5:
- **Dedicated Project Ref (`qzlffxlmrhqfjeohsnkm`)**:
  - Provisioned and wired exclusively for PagePilot with zero dependency on external or shared databases.
  - Public credentials (`VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `SUPABASE_URL`, `SUPABASE_ANON_KEY`) and server-side secret (`SUPABASE_SERVICE_ROLE_KEY`) configured in `.env`.
- **Sequential Migration Application**:
  - Applied all 6 multi-tenant migrations in chronological order:
    1. `20260827120000_init_multi_tenant_schema.sql` (profiles, orgs, memberships, projects, pages, runs, reports, snapshots, findings, recommendations, RLS).
    2. `20260827130000_monitored_page_uniqueness.sql` (`uq_monitored_pages_project_url`).
    3. `20260827140000_audit_persistence_and_idempotency.sql` (`persist_completed_audit_report` RPC).
    4. `20260829120000_alerts_and_delivery.sql` (alerts, alert_deliveries).
    5. `20260830120000_work_items_and_collaboration.sql` (work_items, work_item_activities, `create_work_item_atomic`, `update_work_item_atomic` RPCs).
    6. `20260830130000_report_share_links.sql` (report_share_links, `has_org_role` helper, `get_shared_audit_report` RPC).
  - All 15 tables operational with Row-Level Security (RLS) enabled and forced.
- **End-to-End Runtime Auth & Tenant Isolation Verification**:
  - Verified user sign up, password authentication, and invalid password error rejection via Supabase Auth.
  - Verified automatic profile creation via Postgres trigger `handle_new_user` on `auth.users`.
  - Verified server-side JWT verification and idempotent first-user workspace auto-provisioning with owner role assignment (`GET /api/workspace/me`).
  - Verified authenticated project & monitored page CRUD with partial uniqueness constraint enforcement (`409 CONFLICT` on duplicate canonical URLs).
  - Verified strict role-based access control: `viewer` role can read projects (`200 OK`) but is blocked from mutating projects or pages (`403 FORBIDDEN`).
  - Verified cross-tenant isolation and anti-spoofing: foreign tenant users cannot access or view another organization's resources (`404 NOT_FOUND`), and client-supplied `x-organization-id` or `x-user-id` headers cannot bypass server-verified JWT identities.
  - Verified clean sign out and test user cleanup via privileged administrative endpoints.
- **Security & Non-Disruption**:
  - `SUPABASE_SERVICE_ROLE_KEY`, `GEMINI_API_KEY`, and `INNGEST_SIGNING_KEY` confirmed 100% absent from client bundle (`apps/web/dist`).
  - Anonymous MVP audits (`POST /api/analyze`) remain open and functional without requiring authentication (`pnpm run verify:gemini` PASS).

## D59 — Shared ISO-8601 Datetime Schema with Timezone Offset Support and Canonical Server Normalization

- **Problem & Root Cause**:
  - Browser verification revealed two datetime validation defects when interacting with the dedicated Supabase Postgres instance:
    1. Project and monitored page timestamps failed frontend Zod schema validation because PostgreSQL `timestamptz` columns return ISO-8601 strings with timezone offsets (e.g. `+00:00`, `+05:30`), whereas default `z.string().datetime()` strictly requires `Z`.
    2. Share link creation returned HTTP 500 when `mapShareLinkRow` parsed `created_at` from the database.
- **Architectural & Security Rules Preserved**:
  - Validation is NOT weakened to accept arbitrary strings; it is bounded to RFC 3339 / ISO-8601 compliant datetime representations with valid offsets via `z.string().datetime({ offset: true })`.
  - Authentication, RLS, audit scoring, and historical report immutability remain strictly untouched.
  - Database stores continue to persist standard PostgreSQL `timestamptz`.
- **Implementation Strategy**:
  - **Shared Contract Layer (`@pagepilot/contracts`)**:
    - Centralized `isoDateTimeSchema = z.string().datetime({ offset: true })` in `packages/contracts/src/audit-types.ts` and re-exported it across `database-types.ts`, `alert-types.ts`, `audit-diff-types.ts`, and `events.ts`.
    - Defined `sharedScoreSnapshotSchema` and `sharedFindingEntitySchema` matching the public projection returned by the `get_shared_audit_report` RPC.
  - **API Store Normalization (`apps/api`)**:
    - Implemented `toNormalizedIsoDate(val)` in `projects-store.ts`, `share-store.ts`, and `work-items-store.ts` to convert any valid date string or Date object into a canonical UTC ISO string (`toISOString()`, ending in `Z`) before returning through the API.
    - Normalized all timestamps across `rowToProject`, `rowToMonitoredPage`, `mapShareLinkRow`, and `resolvePublicSharedReport`.
- **Verification Evidence**:
  - Full test suite passes: 557 tests passing across 62 test files.
  - TypeScript build (`tsc -b`) and production bundle build succeed with 0 errors.
  - Unit regression tests verify parsing of Supabase `+00:00` strings and canonical normalization.
  - Browser verification verified in real browser: Project list renders cleanly, project creation & refresh succeeds, share link creation returns HTTP 201, and standalone public shared report view renders completely without authentication.

## D60 — Slack & Webhook Integration Foundation, Credential Encryption, and Idempotent Multi-Channel Alert Subscriptions

- **Problem & Motivation**:
  - Growth and engineering teams monitor critical landing pages but require instant alert notifications in Slack channels and through HTTP webhooks rather than email alone.
  - Integration endpoints require secure handling of untrusted destinations (SSRF defense), encryption of incoming webhook URLs and signing secrets at rest, tamper-evident signing of outbound webhooks, and idempotent dispatch across channels.
- **Architectural Decision & Scope**:
  - Implemented the full backend, persistence, security, cryptographic, and workflow engine foundations for Slack and Webhook integrations (Milestone 5, Task 5.1).
  - Scope deliberately bounded to Task 5.1 foundation; UI (Task 5.2), CSV export (Task 5.3), and analytics import (Task 5.4) remain cleanly deferred.
- **Database Architecture & Schema (`20260904120000_integration_connections.sql`)**:
  - Created `public.integration_connections`:
    - Columns: `id`, `organization_id`, `project_id` (nullable), `provider` (`slack` | `webhook`), `name`, `status` (`active` | `disabled`), `encrypted_credentials` (`text`, envelope `v1:<iv>:<tag>:<ciphertext>`), `events` (`text[]`), `config` (`jsonb`), `created_by_user_id`, `created_at`, `updated_at`.
    - Partial uniqueness: `idx_integration_connections_org_name` ensures unique integration names per organization.
    - Foreign keys with `ON DELETE CASCADE` on `organization_id` and `project_id`.
  - Row-Level Security:
    - RLS enabled and forced (`FORCE ROW LEVEL SECURITY`).
    - SELECT: `is_org_member(organization_id)` allows all org members (owners, admins, members, viewers) to view integrations.
    - INSERT/UPDATE/DELETE: `is_org_admin_or_owner(organization_id)` restricts mutations to administrative roles only.
  - Channel Expansion on `public.alert_deliveries`:
    - Dropped previous check constraint and updated `alert_deliveries_channel_check` to `CHECK (channel IN ('email', 'slack', 'webhook'))`.
    - Added `integration_connection_id UUID REFERENCES public.integration_connections(id) ON DELETE SET NULL` with index `idx_alert_deliveries_integration_id`.
- **Symmetric Encryption & Secret Masking (`apps/api/src/integrations/crypto.ts`)**:
  - AES-256-GCM authenticated encryption:
    - 96-bit random initialization vector (IV) per encryption operation.
    - 128-bit authentication tag protecting against ciphertext tampering.
    - Envelope format: `v1:<iv_hex>:<tag_hex>:<ciphertext_hex>`.
    - Tampered or truncated payloads fail authenticated decryption closed.
  - Secret Projection & Masking:
    - Raw decrypted secrets are strictly server-only and NEVER returned to the client.
    - Integration queries project `maskedTargetUrl` (e.g. `https://hooks.slack.com/services/T01***/*****/********`) and boolean `hasSigningSecret`.
- **Outbound SSRF & Destination Protection (`apps/api/src/integrations/destination-guard.ts`)**:
  - Every outbound destination is validated before integration persistence and before test ping dispatch.
  - Rejects:
    - Protocols other than `http:` and `https:`.
    - Custom ports (restricted strictly to 80 and 443).
    - Embedded user credentials (`user:pass@host`).
    - Private IP literals, loopback (`localhost`, `127.0.0.1`), RFC1918 subnets (`10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`).
    - Cloud instance metadata services (`169.254.169.254`).
    - Mixed-record DNS destinations (all resolved records must be publicly routable addresses via `isPubliclyRoutableAddress`).
- **Cryptographic Webhook Signatures & Anti-Replay (`packages/workflows/src/notifications/crypto.ts`)**:
  - Outbound webhooks include:
    - `X-PagePilot-Signature: sha256=<hmac_hex>` computed as `HMAC-SHA256(secret, `${timestamp}.${payload}`)`.
    - `X-PagePilot-Timestamp: <unix_seconds>`.
  - Signature verification enforces:
    - Replay protection with strict 300-second tolerance window.
    - Constant-time verification using `crypto.timingSafeEqual` preventing timing-attack vulnerabilities.
- **Multi-Channel Durable Inngest Delivery (`packages/workflows/src/functions/alert-delivery-workflow.ts`)**:
  - In `resolve-recipients`: resolves authorized email recipients alongside active subscribed Slack and Webhook integrations.
  - In `deliver-notifications`:
    - Dispatches to Slack via `SlackNotificationProvider` using rich Block Kit formatting (header, severity badge, rule details, score delta, and landing page URL).
    - Dispatches to Webhooks via `WebhookNotificationProvider` with structured JSON event envelope and HMAC signature headers.
    - Idempotency barrier: deterministic `buildAlertDeliveryKey(alert.id, channel, targetId)` claimed atomically via `getOrCreateDelivery`. Duplicate invocations skip already-delivered channels without duplicate outbound HTTP calls.
    - Error handling: provider 4xx errors marked non-retryable; transient 5xx/network errors retryable; overall alert status preserves last successful state.
- **Verification Evidence**:
  - Live Supabase project `qzlffxlmrhqfjeohsnkm`: Migration applied, forced RLS verified on `pg_class`, RLS policies verified on `pg_policies`, check constraint and foreign keys verified on `pg_constraint`.
  - Full test suite passes: 603 tests passing across 67 test files (0 failures).
  - TypeScript build (`tsc -b`) and Vite production bundle build succeed with 0 errors.

## D61 — Integrations Management UI, Scope Handling, Masked Secret Preservation, and Interactive Test Ping Interface

- **Problem & Motivation**:
  - Growth teams and workspace administrators need a clear, accessible, and secure interface to configure, test, and manage outbound alert integrations (Slack channels and HTTP webhooks) without exposing plaintext credentials or requiring manual database intervention.
  - Need to support both project-scoped integrations and organization-wide dispatchers, enforce role-based access control, provide instant test ping verification with roundtrip latency, and handle SSRF security policy rejections safely.
- **Architectural Decisions & Implementation**:
  - **Shared Contract Enhancement (`packages/contracts/src/integration-types.ts`)**:
    - Added optional `isOrganizationWide: z.boolean().optional()` to `createIntegrationConnectionSchema` to allow clients to explicitly declare organization-wide scope.
  - **Web Client API Layer (`apps/web/src/features/integrations/api.ts`)**:
    - Typed API client covering `listIntegrations`, `getIntegration`, `createIntegration`, `updateIntegration`, `deleteIntegration`, and `testIntegration`.
    - Automatically injects current Supabase session token (`Authorization: Bearer <token>`).
    - Validates all API responses with Zod schemas (`integrationListResponseSchema`, `integrationDetailResponseSchema`, `testIntegrationResponseSchema`).
    - Translates backend error envelopes into structured `IntegrationsApiClientError` preserving HTTP status and machine-readable error codes.
  - **Component Architecture (`apps/web/src/features/integrations/components/`)**:
    - `IntegrationCard`:
      - Provider branding with distinct visual styles for Slack and generic HTTP webhooks.
      - Status pill with pulsing live indicator when active; disabled state when inactive.
      - Scope badge indicating "Org-Wide" vs "Project-Scoped".
      - Masked target URL display with instant copy-to-clipboard button.
      - HMAC badge indicating tamper-evident cryptographic signing.
      - Event pills detailing all subscribed alert triggers.
      - Quick status toggle and action buttons (Edit, Delete, Test Ping).
    - `IntegrationModal`:
      - Dialog supporting creation and editing of integrations.
      - Provider card selector (Slack Webhook vs Generic Webhook).
      - Scope selector allowing project-scoped or organization-wide alerts.
      - Safe client-side URL policy checks (`http:` / `https:`, valid port, no credentials).
      - Masked credential preservation: during edit, the URL field displays the masked placeholder; submitting empty/whitespace leaves the encrypted secret unchanged.
      - Webhook signing secret field with toggleable show/hide visibility.
      - Multi-select trigger event matrix across all 6 alert rules with quick "Defaults" and "Select All" buttons.
      - Specialized SSRF error handling: catches `BLOCKED_DESTINATION` and renders a clear security warning without exposing internal infrastructure details.
    - `DeleteIntegrationModal`:
      - Confirmation dialog detailing the target endpoint and warning that alert deliveries will immediately cease.
    - `IntegrationsManager`:
      - Orchestrates data fetching, filtering by search query, provider (`all` | `slack` | `webhook`), scope (`all` | `org` | `project`), and status (`all` | `active` | `disabled`).
      - Renders interactive Test Ping feedback banner showing success/failure status, HTTP response code, and measured roundtrip latency (e.g. `118 ms`).
      - Empty states for zero integrations and zero filter matches.
  - **Workspace Integration**:
    - Added "Integrations" sub-tab to `ProjectDetail` for project-centric configuration.
    - Added "Integrations" primary section to `WorkspaceShell` header nav with project selector for organization-wide oversight.
  - **Role-Based Access Control (RBAC)**:
    - Administrative roles (`owner`, `admin`): Full access to create, edit, toggle status, delete, and trigger test pings.
    - Non-administrative roles (`member`, `viewer`): Mutation actions and "+ Add Integration" are hidden; Test Ping button is disabled with an explanatory tooltip.
  - **Security & Secret Leakage Auditing**:
    - Plaintext secrets are never stored in client state or returned from the API.
    - Audited `apps/web/dist/` production bundle using ripgrep: 0 occurrences of `SUPABASE_SERVICE_ROLE_KEY`, `GEMINI_API_KEY`, or `INNGEST_SIGNING_KEY`.
- **Verification Evidence**:
  - Full test suite passes: 622 tests passing across 69 test files (0 failures).
  - Web UI test suite: 18 integration tests pass across `integrations-api-client.test.ts` (7 tests) and `integrations-ui.test.tsx` (11 tests).
  - TypeScript build (`tsc -b`) and Vite production bundle build succeed with 0 errors.

## D62 — CSV Export Engine, RFC 4180 Streaming, Formula Injection Protection, and Viewer Read Access

- **Problem & Motivation**:
  - Growth teams and UX analysts need to export audit findings, recommendations, and prioritized work items into spreadsheet tools (Microsoft Excel, Google Sheets) and project tracking pipelines.
  - Exporting data to spreadsheet software presents security risks (Formula Injection / CSV Injection attacks) where unvalidated user input starting with `=`, `+`, `-`, `@`, `\t`, `\r`, `%` can trigger formula execution or malicious commands in spreadsheet processors.
  - Large work item backlogs can cause Node.js server memory bloat if buffered in a single gigantic string.
  - Excel default encoding on Windows frequently mishandles UTF-8 text unless a Byte Order Mark (`\uFEFF`) is present.
  - Must preserve historical audit report immutability, enforce strict tenant isolation (cross-tenant 404), and ensure the `viewer` role can read and export backlogs without mutation rights.
- **Architectural Decisions & Implementation**:
  - **Shared Contract Engine (`packages/contracts/src/csv.ts`)**:
    - RFC 4180 serializer quoting cells containing commas, double quotes (`""`), or newlines (`\n`, `\r`).
    - UTF-8 Byte Order Mark (`\uFEFF`) prepended to every export, guaranteeing seamless double-click opening in Excel and Sheets.
    - Comprehensive spreadsheet formula injection defense (`sanitizeCsvValue`): automatically prepends a single quote (`'`) to any value starting with `=`, `+`, `-`, `@`, `\t`, `\r`, or `%`, neutralizing formula execution while preserving legibility.
    - Deterministic 18-column Work Item Backlog format (`WORK_ITEMS_CSV_COLUMNS`):
      `Work Item ID`, `Project ID`, `Page ID`, `Page URL`, `Page Name`, `Type`, `Source Finding / Rec ID`, `Title`, `Description`, `Category`, `Severity`, `Effort`, `Status`, `Assignee Name`, `Assignee Email`, `Resolution Rationale`, `Created At (UTC)`, `Updated At (UTC)`.
    - Deterministic 13-column Audit Report format (`AUDIT_REPORT_CSV_COLUMNS`):
      `Audit Run ID`, `Page ID`, `Page URL`, `Audit Completed At (UTC)`, `Overall Score`, `Item Type`, `Item ID`, `Title`, `Category`, `Severity / Priority`, `Impact / Effort`, `Confidence`, `Description`.
    - Format helpers for categories, severities, effort, and ISO 8601 UTC date formatting.
  - **API Streaming & Memory-Safe Batch Pagination (`apps/api/`)**:
    - Added `exportWorkItems` to `WorkItemsStore` querying items in 250-item batches via database pagination (`.range(from, to)`).
    - Page URLs and assignee profiles are looked up and mapped in-memory without expensive N+1 queries.
    - Route `GET /api/projects/:projectId/work-items/export`: streams batch rows directly to the Express response stream with `res.write()`, keeping memory consumption constant regardless of backlog size.
    - Route `GET /api/projects/:projectId/pages/:pageId/audits/:auditRunId/export`: generates a CSV representation of findings and recommendations from the immutable report payload.
    - HTTP response headers enforce security: `Content-Type: text/csv; charset=utf-8`, `Content-Disposition: attachment; filename="..."`, and `Cache-Control: no-store, no-cache, must-revalidate`.
  - **Role-Based Access Control & Tenant Boundary**:
    - `requireOrgRole(["owner", "admin", "member", "viewer"])` applied to both export endpoints. The `viewer` role has full read and export permissions without write/mutation permissions.
    - Cross-tenant requests targeting unowned projects or audits return uniform 404 Not Found responses.
  - **Historical Audit Immutability**:
    - The report export endpoint acts as a read-only projection of the stored `audit_reports.report_payload` and does not mutate historical snapshots, scores, or metadata.
  - **Web Client UI Integration (`apps/web/`)**:
    - `exportWorkItemsCsv` and `exportAuditReportCsv` in feature API clients leverage `triggerBlobDownload` with temporary blob URLs and cleanup.
    - `<WorkItemsBacklog />`: "Export CSV" button in the header toolbar passes active filter parameters (status, severity, assignee, page, category, search) to export filtered subsets, with loading spinner and inline error banner.
    - `<HistoricalReportView />`: "Export CSV" button in the action bar with loading spinner and inline error alert.
- **Verification Evidence**:
  - Full test suite: 656 tests passing across 72 test files (0 failures, 1 skipped).
  - 34 dedicated tests:
    - `packages/contracts/tests/csv.test.ts`: 17 tests (escaping, formula injection neutralization, BOM, column schemas, data formatting).
    - `apps/api/tests/csv-export.test.ts`: 11 tests (auth, viewer export, cross-tenant 404, formula neutralization, filter queries, streaming).
    - `apps/web/tests/csv-export-ui.test.tsx`: 6 tests (WorkItemsBacklog export button, active filter propagation, loading/error states, HistoricalReportView export button).
  - TypeScript build (`tsc -b`) and Vite production bundle build succeed with 0 errors.
  - Secret scan on `apps/web/dist/` confirmed 0 leaks.

## D63 — Page-Level Analytics Ingestion, Schema, Provenance Badge Invariant, and Business Impact Prioritization

- **Problem & Motivation**:
  - Growth teams and product managers need business and traffic context (sessions, unique visitors, conversions, conversion rate %, bounce rate %, average duration) to prioritize UX recommendations and work items by actual business exposure.
  - **Critical Invariant**: External metrics must be unequivocally marked as `IMPORTED DATA`. They must never be presented as PagePilot measurements or inferences, and missing data must never be fabricated with fake zeroes.
  - Overall UX scores (0–100), category scores, findings, recommendations, and historical audit reports must remain completely immutable.
  - Strict tenant isolation: data must be scoped by organization, project, and page with RLS and RBAC. Cross-tenant queries return 404.
  - Stale warning if reporting period ended >60 days ago.
  - Safe error recovery: previous valid snapshot remains active if an update or validation fails.
- **Architectural Decisions & Implementation**:
  - **Shared Contract Layer (`packages/contracts/src/analytics-types.ts`)**:
    - `pageAnalyticsSnapshotSchema`, `createPageAnalyticsSchema`, `updatePageAnalyticsSchema`, `pageAnalyticsResponseSchema`, `pageAnalyticsHistoryResponseSchema`.
    - Mandatory provenance schema requiring literal `label: "IMPORTED DATA"` and ISO timestamp.
    - Validation for date ordering (`periodStart <= periodEnd`), metric bounds (`sessions >= 0`, `conversionRate` and `bounceRate` $\in [0, 100]$).
    - Business exposure tiers:
      - `high_exposure`: sessions $\ge 20,000$ OR conversions $\ge 500$.
      - `medium_exposure`: sessions $\ge 5,000$ OR conversions $\ge 100$.
      - `low_exposure`: sessions $< 5,000$ (with counts $> 0$).
      - `unknown`: no analytics imported.
    - Deterministic business impact prioritization mapping (UX severity $\times$ exposure tier):
      - `critical_growth`: High UX Severity on high exposure.
      - `high`: High severity on medium exposure OR Medium severity on high exposure.
      - `medium`: Medium severity on medium exposure OR Low severity on high exposure.
      - `low`: Low severity on medium/low exposure OR Low exposure.
      - Never mutates audit scores or report payloads; used solely for queue ranking and visual badge indicators.
  - **Database Migration (`supabase/migrations/20260905120000_page_analytics.sql`)**:
    - Table `public.page_analytics_snapshots` with check constraints, foreign keys with `ON DELETE CASCADE`.
    - `latest_analytics_snapshot_id` foreign key on `monitored_pages` with `ON DELETE SET NULL`.
    - `ENABLE ROW LEVEL SECURITY` and `FORCE ROW LEVEL SECURITY`.
    - RLS policies: `owner`, `admin`, `member` insert/update; `owner`, `admin` delete; all organization roles read.
    - Verified live on Supabase project `qzlffxlmrhqfjeohsnkm`.
  - **API Architecture (`apps/api/src/analytics/`)**:
    - `AnalyticsStore` and `SupabaseAnalyticsStore` with atomic update of `latest_analytics_snapshot_id` on `monitored_pages`.
    - REST routes: `GET /api/projects/:projectId/pages/:pageId/analytics`, `POST`, `DELETE`.
    - Safe 404 for cross-tenant or mismatched project/page requests.
    - Preserves previous valid snapshot when validation fails.
  - **Web Client UI (`apps/web/`)**:
    - `PageAnalyticsCard`: renders `IMPORTED DATA` badge, metrics grid, source attribution, exposure tier, and stale context warning (>60 days).
    - `ImportAnalyticsModal`: date validation, number bounds, auto-calculate conversion rate helper, and explicit data provenance notice.
    - Integrated into `PageDetail` and `ProjectDetail`.
    - `ProjectDetail`: sorts open work items by business impact priority, renders `Critical Growth` badges and traffic exposure tags.
- **Verification Evidence**:
  - Full test suite: 706 tests passing across 75 test files (1 skipped).
  - 68 focused tests passing across contracts (29), migration schema (19), API (8), UI (12).
  - Production build (`tsc -b && vite build`) succeeds with 0 errors.
  - Security audit: 0 secret leaks in `apps/web/dist`.
  - Live Supabase verification: verified table, column, and 4 RLS policies on dedicated project `qzlffxlmrhqfjeohsnkm`.





