# PagePilot — Current Status

**Last Updated:** August 2026  
**Current Milestone:** Milestone 3 — Continuous Monitoring & Alerts (Tasks 3.1, 3.2, 3.3, & 3.4 Complete & Verified; Runtime Postgres RLS & Inngest Cloud Dispatch Pending Staging)  
**Previous Milestones:** 
- Milestone 0 — Product Foundation & Monorepo Setup (Complete & Verified)
- Milestone 1 — Core Audit MVP (Complete & Verified)
- Milestone 2 — Accounts & Projects (Tasks 2.1–2.5 Implementation Complete & Verified)

---

## 1. Verified Current State

The PagePilot monorepo architecture, core landing-page audit MVP, multi-tenant persistence foundation, workspace UI, **Milestone 3 Task 3.1 Inngest Setup & Baseline Audit Workflow**, **Milestone 3 Task 3.2 Weekly Scheduled Audit Workflow**, **Milestone 3 Task 3.3 Score & Finding Regression Diff Engine**, and **Milestone 3 Task 3.4 Alert Rules & Evaluation** are **fully implemented, tested, and verified**.

### Monorepo Structure (`pnpm`)
- `supabase/migrations/`: Multi-tenant schema migrations (`20260827120000_init_multi_tenant_schema.sql`, `20260827130000_monitored_page_uniqueness.sql`, `20260827140000_audit_persistence_and_idempotency.sql`) defining 10 core tables (`profiles`, `organizations`, `memberships`, `projects`, `monitored_pages`, `audit_runs`, `audit_reports`, `score_snapshots`, `findings`, `recommendations`), `latest_successful_audit_run_id`, `idempotency_key` unique constraints (`uq_audit_runs_idempotency`), atomic PostgreSQL RPC `persist_completed_audit_report`, and explicit RLS policies for 4 roles (`owner`, `admin`, `member`, `viewer`).
- `packages/contracts/` (`@pagepilot/contracts`): Shared Zod schemas, TypeScript types, `API_ERROR_CODES`, `enforceUrlPolicy`, `normalizeDomain`, `getWeeklyWindow` timezone helper, database entity contracts, version constants (`REPORT_SCHEMA_VERSION = "1.0.0"`, `AUDIT_ENGINE_CHECK_VERSION = "1.0.0"`, `AUDIT_ENGINE_PROMPT_VERSION = "1.0.0"`, `AUDIT_ENGINE_SCORING_VERSION = "1.0.0"`, `DIFF_SCHEMA_VERSION = "1.0.0"`, `ALERT_SCHEMA_VERSION = "1.0.0"`), audit request & response schemas, Inngest event contracts, regression diff contracts (`AuditDiff`, thresholds `MEANINGFUL_OVERALL_SCORE_DROP_THRESHOLD = 10`, `MEANINGFUL_CATEGORY_SCORE_DROP_THRESHOLD = 15`), and alert contracts (`AlertDecision`, `AlertReason`, `AlertEvaluationContext`, `AlertEvaluationResult`, `DEFAULT_REPEATED_FAILURE_ALERT_THRESHOLD = 3`). 90 tests passing across 11 test files.
- `packages/audit-engine/` (`@pagepilot/audit-engine`): SSRF-safe fetch (`ipaddr.js`, all-records DNS lookup, pinned socket connection), Cheerio snapshot extraction, deterministic checks, bounded Gemini model input serialization, structured output adapter, schema validation, signal reference integrity verification, server-side scoring, and pure deterministic diff engine (`computeAuditDiff`). 141 tests passing across 10 test files.
- `packages/workflows/` (`@pagepilot/workflows`): Focused Inngest durable workflows package owning workflow definitions (`execute-audit-workflow`, `weekly-audit-scheduler`), Inngest client, narrow persistence interface (`WorkflowPersistenceStore`), and pure alert evaluation engine (`evaluateAuditAlerts`, `evaluateScanFailureAlert`, `buildAlertDeduplicationKey`, `sortAlertDecisions`). 28 tests passing across 3 test files.
- `apps/web/` (`@pagepilot/web`): Vite + React 19 + TypeScript + Tailwind CSS v4 client application (`src/App.tsx`, `src/features/analysis/`, `src/features/auth/`, `src/features/projects/`, `src/features/audits/`, `src/features/workspace/`). Includes browser-safe Supabase client, `AuthProvider` (`useAuth`), accessible `<AuthModal />`, `<AuthNav />`, typed project/page API client, typed audit persistence API client, and full workspace experience (`WorkspaceShell`, `ProjectList`, `ProjectDetail`, `PageDetail`, `HistoricalReportView`, accessible modals). 103 tests passing across 15 test files.
- `apps/api/` (`@pagepilot/api`): Express API application on Vercel Node runtime (`src/http/app.ts`, `src/auth/`, `src/projects/`, `src/audits/`, `src/index.ts`, `api/analyze.ts`). Includes server-side token verification, `requireAuth`, `requireWorkspace`, `requireOrgRole`, idempotent first-workspace provisioning, project/page CRUD, full audit persistence & history endpoints, `SupabaseWorkflowPersistenceStore` implementation, and Inngest serve handler mounted at `/api/inngest`. 71 tests passing across 8 test files.
- Root Vercel adapter (`api/analyze.ts`): Minimal pass-through handler delegating to `@pagepilot/api`, with `vercel.json` routing `outputDirectory: "apps/web/dist"`.
- Total workspace test suite: **433 tests passing across 47 test files**.

### Verified Core Capabilities & Milestone 3 Foundation
- **Alert Rules & Evaluation (Task 3.4):**
  - Pure, deterministic, side-effect free alert evaluation engine (`evaluateAuditAlerts`, `evaluateScanFailureAlert`) in `@pagepilot/workflows`.
  - Zero network calls, zero DB calls, zero email/webhook dispatch.
  - Inputs `evaluatedAt` strictly as context to guarantee 100% determinism across test environments.
  - Centralized alert trigger evaluation matching roadmap and Task 3.3 thresholds:
    1. Overall score drop $\ge 10$ points $\rightarrow$ `overall_score_drop` (`high`).
    2. Category score drop $\ge 15$ points $\rightarrow$ `category_score_drop` (`high` if $\ge 25$, `medium` if $\ge 15$). Drops $< 15$ suppressed.
    3. New high-severity finding detected $\rightarrow$ `new_high_severity_finding` (`high`).
    4. Finding severity escalated $\rightarrow$ `finding_severity_increased` (`high` / `medium`).
    5. Deterministic signal regressed (`pass -> warn`) $\rightarrow$ `signal_regressed` (`medium`).
    6. Repeated scan failures $\ge 3$ consecutive $\rightarrow$ `repeated_scan_failure` (`high`).
  - Stable logical deduplication key strategy (`alert:${monitoredPageId}:${ruleType}${targetId ? `:${targetId}` : ""}`) identifying the logical regression rather than transient `auditRunId`.
  - Baseline audits (`isBaseline: true`) and neutral unknown signal transitions produce **zero false alerts**.
  - Deterministic priority ordering (`high` $\rightarrow$ `medium` $\rightarrow$ `low`) with stable tie-breaking.
- **Score & Finding Regression Diff Engine (Task 3.3):**
  - Pure, deterministic, side-effect free diff engine (`computeAuditDiff`) comparing previous successful audit report against current successful report.
  - Historical report immutability guarantee: input reports are never modified.
  - Overall score delta calculation with direction (`improved`, `regressed`, `unchanged`) and threshold evaluation (`MEANINGFUL_OVERALL_SCORE_DROP_THRESHOLD = 10`).
  - Per-category score delta calculation for all 7 categories with threshold evaluation (`MEANINGFUL_CATEGORY_SCORE_DROP_THRESHOLD = 15`). Smaller category drops record `direction = "regressed"` without false inclusion in the meaningful `regressions` collection.
  - Stable finding identity strategy: prioritized sorted deterministic `signalIds` for observed findings (`findingType:category:signal:sig1+sig2`) and normalized title slugs for inferred findings (`findingType:category:inferred:slug`), resilient against harmless LLM wording variations.
  - Complete finding classification: `new`, `resolved`, `changed`, `unchanged`.
  - Severity movement tracking (`low <-> medium <-> high`) with severity escalations classified as regressions and newly introduced high-severity findings triggering meaningful regression alerts.
  - Signal-level diffing (`pass <-> warn`, `unknown <-> measured`). Transitions to/from `unknown` are treated as neutral evidence state changes and are **never penalized as regressions**.
  - First-audit baseline state: when `previousReport === null`, returns a clean baseline diff with `isBaseline = true`, `hasPreviousReport = false`, and zero regressions.
  - Observed vs inferred evidence separation: preserves `basis` across all diff items and tallies `observedRegressionsCount` vs `inferredRegressionsCount`.
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
| **Contracts Tests** | `pnpm vitest run packages/contracts/tests/` | 90 tests passing across 11 test files | **PASS** |
| **Audit Engine Tests** | `pnpm vitest run packages/audit-engine/tests/` | 141 tests passing across 10 test files | **PASS** |
| **Workflows Tests** | `pnpm vitest run packages/workflows/tests/` | 28 tests passing across 3 test files | **PASS** |
| **Web App Tests** | `pnpm vitest run apps/web/tests/` | 103 tests passing across 15 test files | **PASS** |
| **API Tests** | `pnpm vitest run apps/api/tests/` | 71 tests passing across 8 test files | **PASS** |
| **Full Monorepo Suite** | `pnpm test` | 433 tests passing across 47 test files | **PASS** |
| **Production Build** | `pnpm run build` | Built `apps/web/dist/` (JS 570.2 kB / gzip 154.3 kB, CSS 37.5 kB / gzip 7.0 kB) | **PASS** |
| **Secret Leakage Review** | Ripgrep on `apps/web/dist/` | Zero instances of `SUPABASE_SERVICE_ROLE_KEY`, `GEMINI_API_KEY`, `INNGEST_SIGNING_KEY`, `INNGEST_EVENT_KEY`, or server secrets | **PASS** |
| **Live Vercel Dev & Gemini Verification** | `pnpm run verify:gemini` | `POST /api/analyze` against `example.com` returns contract-valid report via `@pagepilot/audit-engine` (overallScore: 66) | **PASS** |
| **Runtime Supabase & Inngest Verification** | `npx supabase status` / Inngest Dev Server | Local Docker/daemon unavailable on host environment; runtime staging tests marked **PENDING STAGING** (static schemas, dual-trigger endpoint introspection, and mock workflow transitions 100% verified) | **DOCUMENTED** |

---

## 3. Current Architecture & Workspace Status

- **Package Manager:** `pnpm` (v11.10.0, Node v24.14.1) initialized via `packageManager: "pnpm@11.10.0"` in `package.json`.
- **Workspace Config:** `pnpm-workspace.yaml` active targeting `apps/*` and `packages/*`.
- **Monorepo Layout:**
  - `supabase/migrations/`: Database migrations.
  - `apps/web/` (`@pagepilot/web`): React 19 + TypeScript + Vite + Tailwind CSS v4 frontend.
  - `apps/api` (`@pagepilot/api`): Express API on Vercel Node runtime with `/api/inngest` serve handler.
  - `packages/contracts/` (`@pagepilot/contracts`): Shared Zod schemas, domain types, database types, workspace types, event contracts, timezone helper, URL policy, error codes, audit diff contracts, alert contracts.
  - `packages/audit-engine` (`@pagepilot/audit-engine`): SSRF safe fetch, extraction, checks, AI audit, scoring, regression diff engine.
  - `packages/workflows` (`@pagepilot/workflows`): Inngest durable workflows (`execute-audit-workflow`, `weekly-audit-scheduler`), alert evaluation engine, client, event schemas, narrow persistence interface.
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

- **Database & Inngest Runtime Environment:** The local Windows host environment lacks Docker daemon; local containerized Supabase CLI and Inngest background dev server cannot run background daemons locally. Migration SQL correctness, RLS policies, Inngest event contracts, Inngest serve handler endpoint (`/api/inngest`), atomic concurrency claim, and multi-step workflow execution are verified via automated static schema test suite, unit/integration tests (`audit-workflow.test.ts`, `weekly-scheduler.test.ts`, `inngest-api.test.ts`, `workflow-store.test.ts`, `audit-diff.test.ts`, `alert-evaluation.test.ts`), and TypeScript typecheck. Full live Inngest execution will be verified in staging / CI environment.
- **Free-Tier Gemini Daily Quotas:** Free-tier API keys have per-model request caps (20 requests/day/model on free tier). Automated test suites use mock adapters to protect quota. Live verification uses `pnpm run verify:gemini`.
- **Model Support:** Adapter defaults to `gemini-3.6-flash` and supports `gemini-3.7-flash` via `GEMINI_MODEL` (with `thinkingLevel: "low"`).
- **Test Worker Threading on Windows:** Vitest root config is set with `pool: "forks"` and 20s timeouts to ensure rock-solid test execution across all 47 test files on Windows.

---

## 5. Exact Next Task

- **Completed Milestones:**
  - Milestone 0 — Product Foundation & Monorepo Setup (Tasks 0.1, 0.2, 0.3, 0.4, 0.5) **COMPLETE**
  - Milestone 1 — Core Audit MVP **COMPLETE**
  - Milestone 2 — Accounts & Projects (Tasks 2.1–2.5) **COMPLETE**
  - **Milestone 3 — Continuous Monitoring & Alerts (Tasks 3.1, 3.2, 3.3, & 3.4 Complete & Verified)**
- **Exact Next Task:** Milestone 3 — Continuous Monitoring & Alerts (Task 3.5: Alert Persistence & Delivery Workflow).


