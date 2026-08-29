# PagePilot — Current Status

**Last Updated:** August 2026  
**Current Milestone:** Milestone 3 — Continuous Monitoring & Alerts (Tasks 3.1 & 3.2 Complete & Verified; Runtime Postgres RLS & Inngest Cloud Dispatch Pending Staging)  
**Previous Milestones:** 
- Milestone 0 — Product Foundation & Monorepo Setup (Complete & Verified)
- Milestone 1 — Core Audit MVP (Complete & Verified)
- Milestone 2 — Accounts & Projects (Tasks 2.1–2.5 Implementation Complete & Verified)

---

## 1. Verified Current State

The PagePilot monorepo architecture, core landing-page audit MVP, multi-tenant persistence foundation, workspace UI, **Milestone 3 Task 3.1 Inngest Setup & Baseline Audit Workflow**, and **Milestone 3 Task 3.2 Weekly Scheduled Audit Workflow** are **fully implemented, tested, and verified**.

### Monorepo Structure (`pnpm`)
- `supabase/migrations/`: Multi-tenant schema migrations (`20260827120000_init_multi_tenant_schema.sql`, `20260827130000_monitored_page_uniqueness.sql`, `20260827140000_audit_persistence_and_idempotency.sql`) defining 10 core tables (`profiles`, `organizations`, `memberships`, `projects`, `monitored_pages`, `audit_runs`, `audit_reports`, `score_snapshots`, `findings`, `recommendations`), `latest_successful_audit_run_id`, `idempotency_key` unique constraints (`uq_audit_runs_idempotency`), atomic PostgreSQL RPC `persist_completed_audit_report`, and explicit RLS policies for 4 roles (`owner`, `admin`, `member`, `viewer`).
- `packages/contracts/` (`@pagepilot/contracts`): Shared Zod schemas, TypeScript types, `API_ERROR_CODES`, `enforceUrlPolicy`, `normalizeDomain`, `getWeeklyWindow` timezone helper, database entity contracts, version constants (`REPORT_SCHEMA_VERSION = "1.0.0"`, `AUDIT_ENGINE_CHECK_VERSION = "1.0.0"`, `AUDIT_ENGINE_PROMPT_VERSION = "1.0.0"`, `AUDIT_ENGINE_SCORING_VERSION = "1.0.0"`), audit request & response schemas, and Inngest event contracts (`audit/requested`, `audit/completed`, `audit/failed`, `audit/schedule-weekly`). 79 tests passing across 9 test files.
- `packages/audit-engine/` (`@pagepilot/audit-engine`): SSRF-safe fetch (`ipaddr.js`, all-records DNS lookup, pinned socket connection), Cheerio snapshot extraction, deterministic checks, bounded Gemini model input serialization, structured output adapter, schema validation, signal reference integrity verification, and server-side scoring. 119 tests passing across 9 test files.
- `packages/workflows/` (`@pagepilot/workflows`): Focused Inngest durable workflows package owning workflow definitions (`execute-audit-workflow`, `weekly-audit-scheduler`), Inngest client, and narrow persistence interface (`WorkflowPersistenceStore`). Decoupled from direct database clients. 13 tests passing across 2 test files.
- `apps/web/` (`@pagepilot/web`): Vite + React 19 + TypeScript + Tailwind CSS v4 client application (`src/App.tsx`, `src/features/analysis/`, `src/features/auth/`, `src/features/projects/`, `src/features/audits/`, `src/features/workspace/`). Includes browser-safe Supabase client, `AuthProvider` (`useAuth`), accessible `<AuthModal />`, `<AuthNav />`, typed project/page API client, typed audit persistence API client, and full workspace experience (`WorkspaceShell`, `ProjectList`, `ProjectDetail`, `PageDetail`, `HistoricalReportView`, accessible modals). 103 tests passing across 15 test files.
- `apps/api/` (`@pagepilot/api`): Express API application on Vercel Node runtime (`src/http/app.ts`, `src/auth/`, `src/projects/`, `src/audits/`, `src/index.ts`, `api/analyze.ts`). Includes server-side token verification, `requireAuth`, `requireWorkspace`, `requireOrgRole`, idempotent first-workspace provisioning, project/page CRUD, full audit persistence & history endpoints, `SupabaseWorkflowPersistenceStore` implementation, and Inngest serve handler mounted at `/api/inngest`. 71 tests passing across 8 test files.
- Root Vercel adapter (`api/analyze.ts`): Minimal pass-through handler delegating to `@pagepilot/api`, with `vercel.json` routing `outputDirectory: "apps/web/dist"`.
- Total workspace test suite: **385 tests passing across 43 test files**.

### Verified Core Capabilities & Task 3.2 Foundation
- **Weekly Scheduled Audit Workflow (Task 3.2):**
  - Durable `weekly-audit-scheduler` Inngest function (`createWeeklyScheduler`) supporting dual triggers:
    1. Cron: `0 0 * * 1` (Runs globally every Monday at 00:00 UTC).
    2. Event: `audit/schedule-weekly` (for testing, staging, and administrative execution).
  - Discovery of active monitored pages: queries `monitored_pages` joined with `projects(timezone)` for `status = 'active'` and `cadence = 'weekly'`. Paused and archived pages are skipped.
  - Deterministic timezone-aware ISO week calculation via `getWeeklyWindow(date, timezone)`: stable week window format (`YYYY-Www`) across DST transitions and UTC offsets.
  - Deterministic idempotency key: `scheduled:${page.id}:${windowId}`.
  - Pre-persisting `audit_run` (`invocation_type = 'scheduled'`, `triggered_by_user_id = null`, `idempotency_key`) before emitting `audit/requested`.
  - Multi-trigger duplicate prevention: when a run with matching `idempotency_key` already exists, `createScheduledAuditRun` returns `isExisting: true` and the scheduler suppresses event emission.
  - PostgreSQL unique index `uq_audit_runs_idempotency` guarantees exactly one logical run per page per weekly window.
  - Dispatches standard `audit/requested` event referencing persisted IDs only, reusing `execute-audit-workflow` from Task 3.1 with zero duplicated pipeline logic.
- **Inngest Setup & Baseline Audit Workflow (Task 3.1):**
  - Modular, decoupled `@pagepilot/workflows` package with zero `@supabase/supabase-js` dependency.
  - Strict server-only secret boundary: all Inngest keys, Supabase credentials, and Gemini API keys remain strictly on the server runtime boundary.
  - Durable `execute-audit-workflow` function (`createAuditWorkflow`) with isolated multi-step execution: claim and lock, engine analysis, and atomic persistence RPC.
  - Failed runs preserve `latest_successful_audit_run_id` intact.
  - Synchronous manual audit (`POST /api/projects/:projectId/pages/:pageId/audits`) and anonymous one-off audit (`POST /api/analyze`) preserved with zero regressions (Option A).

---

## 2. Quality Gates & Verification Evidence

| Quality Gate | Command | Result | Status |
|---|---|---|---|
| **Workspace Typecheck** | `pnpm run typecheck` | 0 errors across all 6 workspace projects | **PASS** |
| **Contracts Tests** | `pnpm vitest run packages/contracts/tests/` | 79 tests passing across 9 test files | **PASS** |
| **Audit Engine Tests** | `pnpm vitest run packages/audit-engine/tests/` | 119 tests passing across 9 test files | **PASS** |
| **Workflows Tests** | `pnpm vitest run packages/workflows/tests/` | 13 tests passing across 2 test files | **PASS** |
| **Web App Tests** | `pnpm vitest run apps/web/tests/` | 103 tests passing across 15 test files | **PASS** |
| **API Tests** | `pnpm vitest run apps/api/tests/` | 71 tests passing across 8 test files | **PASS** |
| **Full Monorepo Suite** | `pnpm test` | 385 tests passing across 43 test files | **PASS** |
| **Production Build** | `pnpm run build` | Built `apps/web/dist/` (JS 562.7 kB / gzip 152.6 kB, CSS 37.5 kB / gzip 7.0 kB) | **PASS** |
| **Secret Leakage Review** | Ripgrep on `apps/web/dist/` | Zero instances of `SUPABASE_SERVICE_ROLE_KEY`, `GEMINI_API_KEY`, `INNGEST_SIGNING_KEY`, `INNGEST_EVENT_KEY`, or server secrets | **PASS** |
| **Live Vercel Dev & Gemini Verification** | `pnpm run verify:gemini` | `POST /api/analyze` against `example.com` returns contract-valid report via `@pagepilot/audit-engine` (overallScore: 57) | **PASS** |
| **Runtime Supabase & Inngest Verification** | `npx supabase status` / Inngest Dev Server | Local Docker/daemon unavailable on host environment; runtime staging tests marked **PENDING STAGING** (static schemas, dual-trigger endpoint introspection, and mock workflow transitions 100% verified) | **DOCUMENTED** |

---

## 3. Current Architecture & Workspace Status

- **Package Manager:** `pnpm` (v11.10.0, Node v24.14.1) initialized via `packageManager: "pnpm@11.10.0"` in `package.json`.
- **Workspace Config:** `pnpm-workspace.yaml` active targeting `apps/*` and `packages/*`.
- **Monorepo Layout:**
  - `supabase/migrations/`: Database migrations.
  - `apps/web/` (`@pagepilot/web`): React 19 + TypeScript + Vite + Tailwind CSS v4 frontend.
  - `apps/api/` (`@pagepilot/api`): Express API on Vercel Node runtime with `/api/inngest` serve handler.
  - `packages/contracts/` (`@pagepilot/contracts`): Shared Zod schemas, domain types, database types, workspace types, event contracts, timezone helper, URL policy, error codes.
  - `packages/audit-engine` (`@pagepilot/audit-engine`): SSRF safe fetch, extraction, checks, AI audit, scoring.
  - `packages/workflows` (`@pagepilot/workflows`): Inngest durable workflows (`execute-audit-workflow`, `weekly-audit-scheduler`), client, event schemas, narrow persistence interface.
- **Dependency Flow:**
  - `apps/web` $\rightarrow$ `@pagepilot/contracts`
  - `apps/api` $\rightarrow$ `@pagepilot/contracts`, `@pagepilot/audit-engine`, `@pagepilot/workflows`
  - `packages/workflows` $\rightarrow$ `@pagepilot/contracts`, `@pagepilot/audit-engine`
  - `packages/audit-engine` $\rightarrow$ `@pagepilot/contracts`
  - `packages/contracts` $\rightarrow$ zero workspace dependencies
- **Lockfile:** `pnpm-lock.yaml` active and synchronized.
- **Deployment:** Vercel project serving Vite static output (`apps/web/dist/`) and Express serverless function (`/api/analyze` + `/api/inngest`).

---

## 4. Known Issues & Operational Notes

- **Database & Inngest Runtime Environment:** The local Windows host environment lacks Docker daemon; local containerized Supabase CLI and Inngest background dev server cannot run background daemons locally. Migration SQL correctness, RLS policies, Inngest event contracts, Inngest serve handler endpoint (`/api/inngest`), atomic concurrency claim, and multi-step workflow execution are verified via automated static schema test suite, unit/integration tests (`audit-workflow.test.ts`, `weekly-scheduler.test.ts`, `inngest-api.test.ts`, `workflow-store.test.ts`), and TypeScript typecheck. Full live Inngest execution will be verified in staging / CI environment.
- **Free-Tier Gemini Daily Quotas:** Free-tier API keys have per-model request caps (20 requests/day/model on free tier). Automated test suites use mock adapters to protect quota. Live verification uses `pnpm run verify:gemini`.
- **Model Support:** Adapter defaults to `gemini-3.6-flash` and supports `gemini-3.7-flash` via `GEMINI_MODEL` (with `thinkingLevel: "low"`).
- **Test Worker Threading on Windows:** Vitest root config is set with `pool: "forks"` and 20s timeouts to ensure rock-solid test execution across all 43 test files on Windows.

---

## 5. Exact Next Task

- **Completed Milestones:**
  - Milestone 0 — Product Foundation & Monorepo Setup (Tasks 0.1, 0.2, 0.3, 0.4, 0.5) **COMPLETE**
  - Milestone 1 — Core Audit MVP **COMPLETE**
  - Milestone 2 — Accounts & Projects (Tasks 2.1–2.5) **COMPLETE**
  - **Milestone 3 — Continuous Monitoring & Alerts (Tasks 3.1 & 3.2 Complete & Verified)**
- **Exact Next Task:** Milestone 3 — Continuous Monitoring & Alerts (Task 3.3: Score & Finding Regression Diff Engine).
