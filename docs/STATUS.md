# PagePilot — Current Status

**Last Updated:** August 2026  
**Current Milestone:** Milestone 3 — Continuous Monitoring & Alerts (Tasks 3.1, 3.2, 3.3, 3.4, & 3.5 Complete & Verified; Runtime Postgres RLS & Inngest Cloud Dispatch Pending Staging)  
**Previous Milestones:** 
- Milestone 0 — Product Foundation & Monorepo Setup (Complete & Verified)
- Milestone 1 — Core Audit MVP (Complete & Verified)
- Milestone 2 — Accounts & Projects (Tasks 2.1–2.5 Implementation Complete & Verified)

---

## 1. Verified Current State

The PagePilot monorepo architecture, core landing-page audit MVP, multi-tenant persistence foundation, workspace UI, **Milestone 3 Task 3.1 Inngest Setup & Baseline Audit Workflow**, **Milestone 3 Task 3.2 Weekly Scheduled Audit Workflow**, **Milestone 3 Task 3.3 Score & Finding Regression Diff Engine**, **Milestone 3 Task 3.4 Alert Rules & Evaluation**, and **Milestone 3 Task 3.5 Alert Persistence & Delivery** are **fully implemented, tested, and verified**.

### Monorepo Structure (`pnpm`)
- `supabase/migrations/`: Multi-tenant schema migrations (`20260827120000_init_multi_tenant_schema.sql`, `20260827130000_monitored_page_uniqueness.sql`, `20260827140000_audit_persistence_and_idempotency.sql`, `20260829120000_alerts_and_delivery.sql`) defining 12 core tables (`profiles`, `organizations`, `memberships`, `projects`, `monitored_pages`, `audit_runs`, `audit_reports`, `score_snapshots`, `findings`, `recommendations`, `alerts`, `alert_deliveries`), `latest_successful_audit_run_id`, `idempotency_key` unique constraints (`uq_audit_runs_idempotency`), alert deduplication unique index (`uq_alerts_run_dedup`), alert delivery key unique index (`uq_alert_deliveries_key`), atomic PostgreSQL RPC `persist_completed_audit_report`, and explicit RLS policies for 4 roles (`owner`, `admin`, `member`, `viewer`).
- `packages/contracts/` (`@pagepilot/contracts`): Shared Zod schemas, TypeScript types, `API_ERROR_CODES`, `enforceUrlPolicy`, `normalizeDomain`, `getWeeklyWindow` timezone helper, database entity contracts, version constants (`REPORT_SCHEMA_VERSION = "1.0.0"`, `AUDIT_ENGINE_CHECK_VERSION = "1.0.0"`, `AUDIT_ENGINE_PROMPT_VERSION = "1.0.0"`, `AUDIT_ENGINE_SCORING_VERSION = "1.0.0"`, `DIFF_SCHEMA_VERSION = "1.0.0"`, `ALERT_SCHEMA_VERSION = "1.0.0"`), audit request & response schemas, Inngest event contracts (`ALERT_CREATED_EVENT`), regression diff contracts (`AuditDiff`), alert contracts (`AlertDecision`, `AlertEntity`, `AlertDeliveryEntity`, `buildAlertDeliveryKey`, `alertCreatedPayloadSchema`). 97 tests passing across 12 test files.
- `packages/audit-engine/` (`@pagepilot/audit-engine`): SSRF-safe fetch (`ipaddr.js`, all-records DNS lookup, pinned socket connection), Cheerio snapshot extraction, deterministic checks, bounded Gemini model input serialization, structured output adapter, schema validation, signal reference integrity verification, server-side scoring, and pure deterministic diff engine (`computeAuditDiff`). 141 tests passing across 10 test files.
- `packages/workflows/` (`@pagepilot/workflows`): Focused Inngest durable workflows package owning workflow definitions (`execute-audit-workflow`, `weekly-audit-scheduler`, `deliver-alert-notification`), notification templates (`buildAlertEmailContent`), notification providers (`MockEmailNotificationProvider`, `ConsoleEmailNotificationProvider`), Inngest client, narrow persistence interface (`WorkflowPersistenceStore`), and pure alert evaluation engine (`evaluateAuditAlerts`, `evaluateScanFailureAlert`). 42 tests passing across 5 test files.
- `apps/web/` (`@pagepilot/web`): Vite + React 19 + TypeScript + Tailwind CSS v4 client application (`src/App.tsx`, `src/features/analysis/`, `src/features/auth/`, `src/features/projects/`, `src/features/audits/`, `src/features/workspace/`). Includes browser-safe Supabase client, `AuthProvider` (`useAuth`), accessible `<AuthModal />`, `<AuthNav />`, typed project/page API client, typed audit persistence API client, and full workspace experience (`WorkspaceShell`, `ProjectList`, `ProjectDetail`, `PageDetail`, `HistoricalReportView`, accessible modals). 103 tests passing across 15 test files.
- `apps/api/` (`@pagepilot/api`): Express API application on Vercel Node runtime (`src/http/app.ts`, `src/auth/`, `src/projects/`, `src/audits/`, `src/index.ts`, `api/analyze.ts`). Includes server-side token verification, `requireAuth`, `requireWorkspace`, `requireOrgRole`, idempotent first-workspace provisioning, project/page CRUD, full audit persistence & history endpoints, `SupabaseWorkflowPersistenceStore` implementation, and Inngest serve handler mounted at `/api/inngest` exposing all 3 durable workflows. 75 tests passing across 8 test files.
- Root Vercel adapter (`api/analyze.ts`): Minimal pass-through handler delegating to `@pagepilot/api`, with `vercel.json` routing `outputDirectory: "apps/web/dist"`.
- Total workspace test suite: **458 tests passing across 50 test files**.

### Verified Core Capabilities & Milestone 3 Foundation
- **Alert Persistence & Delivery Workflow (Task 3.5):**
  - Durable PostgreSQL schema for `public.alerts` and `public.alert_deliveries` with explicit RLS and unique deduplication indexes.
  - Pure deterministic email renderer (`buildAlertEmailContent`) producing both semantic HTML and plain text with zero secrets and strict HTML escaping.
  - Pluggable `NotificationProvider` abstraction with test mock (`MockEmailNotificationProvider`) and console provider.
  - Integrated Step 4 (`evaluate-and-dispatch-alerts`) into `createAuditWorkflow`, calculating diff vs previous report, evaluating alerts, persisting via `persistAlert`, and dispatching `alert/created`.
  - State-aware 24-hour suppression: identical ongoing regressions within 24h are suppressed without duplicate alerts, while new or worsened regressions proceed.
  - Durable Inngest function `deliver-alert-notification` (`createAlertDeliveryWorkflow`): validates tenant isolation, resolves organization `owner` and `admin` recipients, enforces `delivery_key` idempotency, and delivers transactional notifications.
- **Alert Rules & Evaluation (Task 3.4):**
  - Pure, deterministic, side-effect free alert evaluation engine (`evaluateAuditAlerts`, `evaluateScanFailureAlert`) in `@pagepilot/workflows`.
  - Centralized alert trigger evaluation matching roadmap and Task 3.3 thresholds (overall score drop $\ge 10$, category score drop $\ge 15$, new high-severity finding, finding severity escalation, signal regressed, repeated scan failures $\ge 3$).
  - Stable logical deduplication key strategy (`alert:${monitoredPageId}:${ruleType}${targetId ? `:${targetId}` : ""}`).
  - Baseline audits (`isBaseline: true`) and neutral unknown signal transitions produce **zero false alerts**.
- **Score & Finding Regression Diff Engine (Task 3.3):**
  - Pure, deterministic diff engine (`computeAuditDiff`) comparing previous successful audit report against current successful report.
  - Strict historical report immutability guarantee.
  - Finding identity strategy based on sorted `signalIds` for observed findings and normalized title slugs for inferred findings.
  - Severity movement tracking with neutral handling of unknown signal transitions.
- **Weekly Scheduled Audit Workflow (Task 3.2):**
  - Durable `weekly-audit-scheduler` Inngest function (`createWeeklyScheduler`) supporting dual triggers (Cron: `0 0 * * 1` and Event: `audit/schedule-weekly`).
  - Deterministic timezone-aware ISO week calculation (`getWeeklyWindow`).
  - Pre-persisting `audit_run` with deterministic idempotency key (`scheduled:${page.id}:${windowId}`) and PostgreSQL unique index `uq_audit_runs_idempotency`.
- **Inngest Setup & Baseline Audit Workflow (Task 3.1):**
  - Modular, decoupled `@pagepilot/workflows` package.
  - Strict server-only secret boundary.
  - Durable `execute-audit-workflow` function (`createAuditWorkflow`) with isolated multi-step execution.
  - Failed runs preserve `latest_successful_audit_run_id` intact.

---

## 2. Quality Gates & Verification Evidence

| Quality Gate | Command | Result | Status |
|---|---|---|---|
| **Workspace Typecheck** | `pnpm run typecheck` | 0 errors across all workspace projects | **PASS** |
| **Contracts Tests** | `pnpm vitest run packages/contracts/tests/` | 97 tests passing across 12 test files | **PASS** |
| **Audit Engine Tests** | `pnpm vitest run packages/audit-engine/tests/` | 141 tests passing across 10 test files | **PASS** |
| **Workflows Tests** | `pnpm vitest run packages/workflows/tests/` | 42 tests passing across 5 test files | **PASS** |
| **Web App Tests** | `pnpm vitest run apps/web/tests/` | 103 tests passing across 15 test files | **PASS** |
| **API Tests** | `pnpm vitest run apps/api/tests/` | 75 tests passing across 8 test files | **PASS** |
| **Full Monorepo Suite** | `pnpm test` | 458 tests passing across 50 test files | **PASS** |
| **Production Build** | `pnpm run build` | Built `apps/web/dist/` (JS 571.8 kB / gzip 154.5 kB, CSS 37.5 kB / gzip 7.0 kB) | **PASS** |
| **Secret Leakage Review** | Ripgrep on `apps/web/dist/` | Zero instances of `SUPABASE_SERVICE_ROLE_KEY`, `GEMINI_API_KEY`, `INNGEST_SIGNING_KEY`, `INNGEST_EVENT_KEY`, or server secrets | **PASS** |
| **Live Vercel Dev & Gemini Verification** | `pnpm run verify:gemini` | `POST /api/analyze` against `example.com` returns contract-valid report via `@pagepilot/audit-engine` (overallScore: 65) | **PASS** |
| **Runtime Supabase & Inngest Verification** | `npx supabase status` / Inngest Dev Server | Local Docker/daemon unavailable on host environment; runtime staging tests marked **PENDING STAGING** (static schemas, 3-workflow endpoint introspection, and mock workflow transitions 100% verified) | **DOCUMENTED** |

---

## 3. Current Architecture & Workspace Status

- **Package Manager:** `pnpm` (v11.10.0, Node v24.14.1) initialized via `packageManager: "pnpm@11.10.0"` in `package.json`.
- **Workspace Config:** `pnpm-workspace.yaml` active targeting `apps/*` and `packages/*`.
- **Monorepo Layout:**
  - `supabase/migrations/`: Database migrations.
  - `apps/web/` (`@pagepilot/web`): React 19 + TypeScript + Vite + Tailwind CSS v4 frontend.
  - `apps/api` (`@pagepilot/api`): Express API on Vercel Node runtime with `/api/inngest` serve handler exposing all 3 durable functions.
  - `packages/contracts/` (`@pagepilot/contracts`): Shared Zod schemas, domain types, database types, workspace types, event contracts, timezone helper, URL policy, error codes, audit diff contracts, alert contracts.
  - `packages/audit-engine` (`@pagepilot/audit-engine`): SSRF safe fetch, extraction, checks, AI audit, scoring, regression diff engine.
  - `packages/workflows` (`@pagepilot/workflows`): Inngest durable workflows (`execute-audit-workflow`, `weekly-audit-scheduler`, `deliver-alert-notification`), alert evaluation engine, email template builder, notification provider abstractions, client, event schemas, narrow persistence interface.
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

- **Database & Inngest Runtime Environment:** The local Windows host environment lacks Docker daemon; local containerized Supabase CLI and Inngest background dev server cannot run background daemons locally. Migration SQL correctness, RLS policies, Inngest event contracts, Inngest serve handler endpoint (`/api/inngest`), atomic concurrency claim, and multi-step workflow execution are verified via automated static schema test suite, unit/integration tests (`audit-workflow.test.ts`, `weekly-scheduler.test.ts`, `alert-delivery-workflow.test.ts`, `inngest-api.test.ts`, `workflow-store.test.ts`, `audit-diff.test.ts`, `alert-evaluation.test.ts`), and TypeScript typecheck. Full live Inngest execution will be verified in staging / CI environment.
- **Free-Tier Gemini Daily Quotas:** Free-tier API keys have per-model request caps (20 requests/day/model on free tier). Automated test suites use mock adapters to protect quota. Live verification uses `pnpm run verify:gemini`.
- **Model Support:** Adapter defaults to `gemini-3.6-flash` and supports `gemini-3.7-flash` via `GEMINI_MODEL` (with `thinkingLevel: "low"`).
- **Test Worker Threading on Windows:** Vitest root config is set with `pool: "forks"` and 20s timeouts to ensure rock-solid test execution across all 50 test files on Windows.

---

## 5. Exact Next Task

- **Completed Milestones:**
  - Milestone 0 — Product Foundation & Monorepo Setup (Tasks 0.1, 0.2, 0.3, 0.4, 0.5) **COMPLETE**
  - Milestone 1 — Core Audit MVP **COMPLETE**
  - Milestone 2 — Accounts & Projects (Tasks 2.1–2.5) **COMPLETE**
  - **Milestone 3 — Continuous Monitoring & Alerts (Tasks 3.1, 3.2, 3.3, 3.4, & 3.5 Complete & Verified)**
- **Exact Next Task:** Milestone 3 Review / Milestone 4: Collaboration & Prioritization (or Trend Dashboard UI extension per Roadmap).


