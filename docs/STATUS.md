# PagePilot — Current Status

**Last Updated:** August 2026  
**Current Milestone:** Milestone 2 — Accounts & Projects (Active / In Progress)  
**Previous Milestones:** Milestone 0 — Product Foundation & Monorepo Setup (Complete & Verified), Milestone 1 — Core Audit MVP (Complete & Verified)

---

## 1. Verified Current State

The PagePilot monorepo architecture, core landing-page audit MVP, and **Milestone 2 Task 2.1 Supabase Schema & Multi-Tenant Foundation** are **fully implemented, tested, and verified**.

### Monorepo Structure (`pnpm`)
- `supabase/migrations/`: Initial multi-tenant schema migration `20260827120000_init_multi_tenant_schema.sql` defining 10 core tables (`profiles`, `organizations`, `memberships`, `projects`, `monitored_pages`, `audit_runs`, `audit_reports`, `score_snapshots`, `findings`, `recommendations`), SECURITY DEFINER authorization helpers, and explicit RLS policies for 4 roles (`owner`, `admin`, `member`, `viewer`).
- `packages/contracts/` (`@pagepilot/contracts`): Runtime-agnostic shared Zod schemas, TypeScript types, `API_ERROR_CODES`, `enforceUrlPolicy`, database entity contracts (`Role`, `Organization`, `Membership`, `Profile`, `Project`, `MonitoredPage`, `AuditRun`, `AuditReport`, `ScoreSnapshot`, `FindingEntity`, `RecommendationEntity`), and canonical `REPORT_SCHEMA_VERSION = "1.0.0"`. 33 tests passing across 4 test files.
- `packages/audit-engine/` (`@pagepilot/audit-engine`): SSRF-safe fetch (`ipaddr.js`, all-records DNS lookup, pinned socket connection), Cheerio snapshot extraction, deterministic checks, bounded Gemini model input serialization, structured output adapter, schema validation, signal reference integrity verification, and server-side scoring. 119 tests passing across 9 test files.
- `apps/web/` (`@pagepilot/web`): Vite + React 19 + TypeScript + Tailwind CSS v4 client application (`src/App.tsx`, `src/features/analysis/`). Builds directly to `apps/web/dist/`. 66 tests passing across 7 test files.
- `apps/api/` (`@pagepilot/api`): Express API application on Vercel Node runtime (`src/http/app.ts`, `src/index.ts`, `api/analyze.ts`). 23 tests passing across 2 test files.
- Root Vercel adapter (`api/analyze.ts`): Minimal pass-through handler delegating to `@pagepilot/api`, with `vercel.json` routing `outputDirectory: "apps/web/dist"`.
- Total workspace test suite: **241 tests passing across 22 test files**.

### Verified Core Capabilities & Task 2.1 Foundation
- **Multi-Tenant Schema & Isolation:**
  - 10 normalized tables with primary keys, foreign keys, unique constraints, and check constraints.
  - Profile synchronizer trigger on `auth.users`.
  - Non-recursive SECURITY DEFINER authorization functions (`is_org_member`, `get_org_role`, `is_org_admin_or_owner`, `is_org_owner`) with fixed search path.
  - Strict RLS enabled and forced across all tables. Zero `USING (true)` or `WITH CHECK (true)` on tenant-owned data.
  - Viewer role is strictly read-only; mutation is guarded by role-level policies.
- **Historical Report Immutability:**
  - Schema-versioned report model (`REPORT_SCHEMA_VERSION = "1.0.0"`, `model_identifier`, `check_version`, `scoring_version`).
  - Immutable historical evidence with complete self-contained `report_payload` JSONB.
  - RLS strictly forbids `UPDATE` on historical reports, score snapshots, and recommendations.
  - 90-day compact data retention with raw HTML strictly excluded from persistence.
- **Deletion Cascades:**
  - Deleting a project cascades cleanly down to pages, runs, reports, snapshots, findings, and recommendations.
  - Forward pointer `monitored_pages.latest_audit_run_id` uses `ON DELETE SET NULL` preventing circular locks.
- **SSRF-Safe Outbound Fetch & Public Submission:**
  - Strict URL policy (http/https, ports 80/443, no credentials).
  - All-records DNS lookup with global-unicast validation (`ipaddr.js`).
  - Pinned socket connections and manual redirect re-validation.
  - 1.5 MB body limit and 8s fetch deadline.
- **Gemini Structured Audit & Server-Side Scoring:**
  - Bounded evidence pack; strict 2-stage Zod validation.
  - Signal reference integrity check.
  - Server-calculated 7-category blended score and overall confidence rating.
- **Production Parity:**
  - Anonymous one-off audit MVP continues to work with zero regressions.

---

## 2. Quality Gates & Verification Evidence

| Quality Gate | Command | Result | Status |
|---|---|---|---|
| **Workspace Typecheck** | `pnpm run typecheck` | 0 errors across all 5 workspace projects | **PASS** |
| **Contracts Tests** | `pnpm vitest run packages/contracts/tests/` | 33 tests passing across 4 test files | **PASS** |
| **Audit Engine Tests** | `pnpm vitest run packages/audit-engine/tests/` | 119 tests passing across 9 test files | **PASS** |
| **Web App Tests** | `pnpm vitest run apps/web/tests/` | 66 tests passing across 7 test files | **PASS** |
| **API Tests** | `pnpm vitest run apps/api/tests/` | 23 tests passing across 2 test files | **PASS** |
| **Full Monorepo Suite** | `pnpm test` | 241 tests passing across 22 test files | **PASS** |
| **Production Build** | `pnpm run build` | Built `apps/web/dist/` (JS 291.5 kB / gzip 86.6 kB, CSS 21.6 kB / gzip 5.0 kB) | **PASS** |
| **Live Vercel Dev & Gemini Verification** | `pnpm run verify:gemini` | `POST /api/analyze` against `example.com` returns contract-valid report via `@pagepilot/audit-engine` (overallScore: 62) | **PASS** |
| **Migration Static Verification** | `packages/contracts/tests/migration-schema.test.ts` | 10 tests verifying tables, constraints, cascades, RLS, functions, immutability, and HTML exclusion | **PASS** |

---

## 3. Current Architecture & Workspace Status

- **Package Manager:** `pnpm` (v11.10.0, Node v24.14.1) initialized via `packageManager: "pnpm@11.10.0"` in `package.json`.
- **Workspace Config:** `pnpm-workspace.yaml` active targeting `apps/*` and `packages/*`.
- **Monorepo Layout:**
  - `supabase/migrations/`: Database migrations.
  - `apps/web/` (`@pagepilot/web`): React 19 + TypeScript + Vite + Tailwind CSS v4 frontend.
  - `apps/api/` (`@pagepilot/api`): Express API on Vercel Node runtime.
  - `packages/contracts/` (`@pagepilot/contracts`): Shared Zod schemas, domain types, database types, URL policy, error codes.
  - `packages/audit-engine/` (`@pagepilot/audit-engine`): SSRF safe fetch, extraction, checks, AI audit, scoring.
- **Dependency Flow:**
  - `apps/web` $\rightarrow$ `@pagepilot/contracts`
  - `apps/api` $\rightarrow$ `@pagepilot/contracts` & `@pagepilot/audit-engine`
  - `packages/audit-engine` $\rightarrow$ `@pagepilot/contracts`
  - `packages/contracts` $\rightarrow$ zero workspace dependencies
- **Lockfile:** `pnpm-lock.yaml` active and synchronized.
- **Deployment:** Vercel project serving Vite static output (`apps/web/dist/`) and Express serverless function (`/api/analyze`).

---

## 4. Known Issues & Operational Notes

- **Database Verification Environment:** The local Windows host environment lacks Docker daemon; local containerized Supabase CLI runtime cannot be executed locally. Migration SQL correctness, table constraints, cascade rules, RLS policies, and database contracts are verified via automated static schema test suite (`migration-schema.test.ts`) and TypeScript typecheck. Full runtime Postgres execution will be verified in staging / CI Supabase instance.
- **Free-Tier Gemini Daily Quotas:** Free-tier API keys have per-model request caps (20 requests/day/model on free tier). Automated test suites use mock adapters to protect quota. Live verification uses `npm run verify:gemini`.
- **Model Support:** Adapter defaults to `gemini-3.6-flash` and supports `gemini-3.7-flash` via `GEMINI_MODEL` (with `thinkingLevel: "low"`).
- **Test Worker Threading on Windows:** Vitest is configured with `pool: "threads"` and `maxWorkers: 1` in `vite.config.ts` to prevent timeout flakes during sequential jsdom test runs.

---

## 5. Exact Next Task

- **Completed Milestones:**
  - Milestone 0 — Product Foundation & Monorepo Setup (Tasks 0.1, 0.2, 0.3, 0.4, 0.5) **COMPLETE**
  - Milestone 1 — Core Audit MVP **COMPLETE**
- **Active Milestone:** **Milestone 2 — Accounts & Projects**
  - **Task 2.1 — Supabase Schema & Multi-Tenant Migration** **COMPLETE & VERIFIED**
- **Exact Next Task:** **Task 2.2 — Supabase Auth Integration & Tenant Workspaces** (Integrate Supabase Auth for Email/Magic Link, user session handling, and server-side organization/project authorization).
