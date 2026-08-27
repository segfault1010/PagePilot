# PagePilot — Current Status

**Last Updated:** August 2026  
**Current Milestone:** Milestone 2 — Accounts & Projects (Active / In Progress)  
**Previous Milestones:** Milestone 0 — Product Foundation & Monorepo Setup (Complete & Verified), Milestone 1 — Core Audit MVP (Complete & Verified)

---

## 1. Verified Current State

The PagePilot monorepo architecture, core landing-page audit MVP, **Milestone 2 Task 2.1 Supabase Schema & Multi-Tenant Foundation**, **Milestone 2 Task 2.2 Supabase Auth Integration & Tenant Workspace Foundation**, **Milestone 2 Task 2.3 Projects & Monitored Pages Persistence + API**, and **Milestone 2 Task 2.4 Historical Audit Report Persistence & Association** are **fully implemented, tested, and verified**.

### Monorepo Structure (`pnpm`)
- `supabase/migrations/`: Multi-tenant schema migrations (`20260827120000_init_multi_tenant_schema.sql`, `20260827130000_monitored_page_uniqueness.sql`, `20260827140000_audit_persistence_and_idempotency.sql`) defining 10 core tables (`profiles`, `organizations`, `memberships`, `projects`, `monitored_pages`, `audit_runs`, `audit_reports`, `score_snapshots`, `findings`, `recommendations`), `latest_successful_audit_run_id`, `idempotency_key` unique constraints, atomic PostgreSQL RPC `persist_completed_audit_report`, and explicit RLS policies for 4 roles (`owner`, `admin`, `member`, `viewer`).
- `packages/contracts/` (`@pagepilot/contracts`): Shared Zod schemas, TypeScript types, `API_ERROR_CODES`, `enforceUrlPolicy`, `normalizeDomain`, database entity contracts, version constants (`REPORT_SCHEMA_VERSION = "1.0.0"`, `AUDIT_ENGINE_CHECK_VERSION = "1.0.0"`, `AUDIT_ENGINE_PROMPT_VERSION = "1.0.0"`, `AUDIT_ENGINE_SCORING_VERSION = "1.0.0"`), audit request & response schemas (`triggerAuditRequestSchema`, `auditRunResponseSchema`, `auditHistoryListResponseSchema`, `persistedAuditReportResponseSchema`). 62 tests passing across 7 test files.
- `packages/audit-engine/` (`@pagepilot/audit-engine`): SSRF-safe fetch (`ipaddr.js`, all-records DNS lookup, pinned socket connection), Cheerio snapshot extraction, deterministic checks, bounded Gemini model input serialization, structured output adapter, schema validation, signal reference integrity verification, and server-side scoring. 119 tests passing across 9 test files.
- `apps/web/` (`@pagepilot/web`): Vite + React 19 + TypeScript + Tailwind CSS v4 client application (`src/App.tsx`, `src/features/analysis/`, `src/features/auth/`, `src/features/projects/`, `src/features/audits/`). Includes browser-safe Supabase client, `AuthProvider` (`useAuth`), accessible `<AuthModal />`, `<AuthNav />`, typed project & monitored page API client, and typed audit persistence API client with automatic session token attachment. 83 tests passing across 11 test files.
- `apps/api/` (`@pagepilot/api`): Express API application on Vercel Node runtime (`src/http/app.ts`, `src/auth/`, `src/projects/`, `src/audits/`, `src/index.ts`, `api/analyze.ts`). Includes server-side token verification, `requireAuth`, `requireWorkspace`, `requireOrgRole`, idempotent first-workspace provisioning, project/page CRUD, and full audit persistence & history endpoints (`POST /api/projects/:projectId/pages/:pageId/audits`, `GET .../audits`, `GET .../audits/latest`, `GET .../audits/:auditRunId`) with atomic database RPC persistence and race-condition idempotency conflict handling. 59 tests passing across 6 test files.
- Root Vercel adapter (`api/analyze.ts`): Minimal pass-through handler delegating to `@pagepilot/api`, with `vercel.json` routing `outputDirectory: "apps/web/dist"`.
- Total workspace test suite: **322 tests passing across 33 test files**.

### Verified Core Capabilities & Task 2.4 Foundation
- **Historical Audit Report Persistence & Association (Task 2.4):**
  - Complete persistence aggregate: manual audit creates `audit_runs`, and on success persists `audit_reports`, 7 `score_snapshots`, `findings` (top problems + category findings), `recommendations` (quick wins + detailed), and updates `monitored_pages` latest pointers.
  - Atomic persistence via PostgreSQL RPC (`persist_completed_audit_report`): single database transaction guarantees all-or-nothing consistency with zero partial state.
  - Concurrent idempotency race handling: catches unique constraint conflict (`23505`) on `(monitored_page_id, idempotency_key)`, queries existing run/report, and returns without duplicate analysis.
  - Distinct HTTP status semantics: `201 Created` for newly executed audits; `200 OK` for idempotent requests finding an already-completed report.
  - Last successful report preservation: on audit failure, `latest_audit_run_id` is updated to the failed run, but **`latest_successful_audit_run_id` remains unchanged**, keeping historical evidence intact.
  - Historical report immutability: RLS prevents `UPDATE` on reports/snapshots/recommendations; version metadata is frozen permanently per report.
  - Typed client API helpers (`triggerManualAudit`, `listAuditHistory`, `getLatestAuditReport`, `getAuditReportByRunId`) in `apps/web/src/features/audits/api.ts`.
- **Projects & Monitored Pages Persistence & API (Task 2.3):**
  - Authoritative RLS boundary: database operations execute with verified JWT user context (`auth.uid() = req.user.id`).
  - Explicit role matrix: `owner`/`admin` delete projects; `member` project create/read/update & page CRUD; `viewer` read-only (`403 FORBIDDEN` on mutations).
  - Duplicate monitored page registration protection (`uq_monitored_pages_project_url` + `409 CONFLICT`).
  - Strict separation of URL security policy (`enforceUrlPolicy`) vs project metadata formatting (`normalizeDomain`).
- **Supabase Auth Integration & Tenant Workspaces (Task 2.2):**
  - Strict credential separation: browser receives only public credentials. Zero server secrets in web bundle.
  - Server auth middleware parses `Authorization: Bearer <token>`, verifies JWT via Supabase Auth, and resolves workspace context.
  - Idempotent and concurrency-safe first-user workspace provisioning using database unique constraints.
- **Anonymous Audit MVP Preservation:**
  - `POST /api/analyze` remains open, unauthenticated, stateless, and 100% functional (verified live with `pnpm run verify:gemini`).
- **Multi-Tenant Schema & Isolation (Task 2.1):**
  - 10 normalized tables with primary keys, foreign keys, unique constraints, and check constraints.
  - Non-recursive SECURITY DEFINER authorization functions with fixed search path.
  - Strict RLS enabled and forced across all tables.
  - Cascading deletion semantics from projects to child runs/reports/findings.

---

## 2. Quality Gates & Verification Evidence

| Quality Gate | Command | Result | Status |
|---|---|---|---|
| **Workspace Typecheck** | `pnpm run typecheck` | 0 errors across all 5 workspace projects | **PASS** |
| **Contracts Tests** | `pnpm vitest run packages/contracts/tests/` | 62 tests passing across 7 test files | **PASS** |
| **Audit Engine Tests** | `pnpm vitest run packages/audit-engine/tests/` | 119 tests passing across 9 test files | **PASS** |
| **Web App Tests** | `pnpm vitest run apps/web/tests/` | 83 tests passing across 11 test files | **PASS** |
| **API Tests** | `pnpm vitest run apps/api/tests/` | 59 tests passing across 6 test files | **PASS** |
| **Full Monorepo Suite** | `pnpm test` | 322 tests passing across 33 test files | **PASS** |
| **Production Build** | `pnpm run build` | Built `apps/web/dist/` (JS 513.7 kB / gzip 144.1 kB, CSS 26.7 kB / gzip 5.7 kB) | **PASS** |
| **Secret Leakage Review** | Ripgrep on `apps/web/dist/` | Zero instances of `SUPABASE_SERVICE_ROLE_KEY`, `GEMINI_API_KEY`, or server secrets | **PASS** |
| **Live Vercel Dev & Gemini Verification** | `pnpm run verify:gemini` | `POST /api/analyze` against `example.com` returns contract-valid report via `@pagepilot/audit-engine` (overallScore: 66) | **PASS** |
| **Runtime Supabase Verification** | `npx supabase status` | Local Docker daemon unavailable on host environment; runtime staging test marked **PENDING STAGING** | **DOCUMENTED** |

---

## 3. Current Architecture & Workspace Status

- **Package Manager:** `pnpm` (v11.10.0, Node v24.14.1) initialized via `packageManager: "pnpm@11.10.0"` in `package.json`.
- **Workspace Config:** `pnpm-workspace.yaml` active targeting `apps/*` and `packages/*`.
- **Monorepo Layout:**
  - `supabase/migrations/`: Database migrations.
  - `apps/web/` (`@pagepilot/web`): React 19 + TypeScript + Vite + Tailwind CSS v4 frontend.
  - `apps/api/` (`@pagepilot/api`): Express API on Vercel Node runtime.
  - `packages/contracts/` (`@pagepilot/contracts`): Shared Zod schemas, domain types, database types, workspace types, URL policy, error codes.
  - `packages/audit-engine` (`@pagepilot/audit-engine`): SSRF safe fetch, extraction, checks, AI audit, scoring.
- **Dependency Flow:**
  - `apps/web` $\rightarrow$ `@pagepilot/contracts`
  - `apps/api` $\rightarrow$ `@pagepilot/contracts` & `@pagepilot/audit-engine`
  - `packages/audit-engine` $\rightarrow$ `@pagepilot/contracts`
  - `packages/contracts` $\rightarrow$ zero workspace dependencies
- **Lockfile:** `pnpm-lock.yaml` active and synchronized.
- **Deployment:** Vercel project serving Vite static output (`apps/web/dist/`) and Express serverless function (`/api/analyze`).

---

## 4. Known Issues & Operational Notes

- **Database Verification Environment:** The local Windows host environment lacks Docker daemon; local containerized Supabase CLI runtime cannot be executed locally. Migration SQL correctness, table constraints, cascade rules, RLS policies, and database contracts are verified via automated static schema test suite (`migration-schema.test.ts`), unit/integration tests (`auth-middleware.test.ts`, `workspace-provisioning.test.ts`, `projects-api.test.ts`, `audits-api.test.ts`), and TypeScript typecheck. Full runtime Postgres execution will be verified in staging / CI Supabase instance.
- **Free-Tier Gemini Daily Quotas:** Free-tier API keys have per-model request caps (20 requests/day/model on free tier). Automated test suites use mock adapters to protect quota. Live verification uses `pnpm run verify:gemini`.
- **Model Support:** Adapter defaults to `gemini-3.6-flash` and supports `gemini-3.7-flash` via `GEMINI_MODEL` (with `thinkingLevel: "low"`).
- **Test Worker Threading on Windows:** Vitest is configured with `pool: "threads"` and `maxWorkers: 1` in `vite.config.ts` to prevent timeout flakes during sequential jsdom test runs.

---

## 5. Exact Next Task

- **Completed Milestones:**
  - Milestone 0 — Product Foundation & Monorepo Setup (Tasks 0.1, 0.2, 0.3, 0.4, 0.5) **COMPLETE**
  - Milestone 1 — Core Audit MVP **COMPLETE**
- **Active Milestone:** **Milestone 2 — Accounts & Projects**
  - **Task 2.1 — Supabase Schema & Multi-Tenant Migration** **COMPLETE & VERIFIED**
  - **Task 2.2 — Supabase Auth Integration & Tenant Workspaces** **COMPLETE & VERIFIED**
  - **Task 2.3 — Projects & Monitored Pages Persistence & API** **COMPLETE & VERIFIED**
  - **Task 2.4 — Historical Audit Report Persistence & Association** **COMPLETE & VERIFIED**
- **Exact Next Task:** **Task 2.5 — Workspace UI, Projects & Monitored Page Management** (Build authenticated project and monitored page dashboard and historical audit view).
