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

