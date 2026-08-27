# PagePilot — Current Status

**Last Updated:** August 2026  
**Current Milestone:** Milestone 2 — Accounts & Projects (Active / In Progress)  
**Previous Milestones:** Milestone 0 — Product Foundation & Monorepo Setup (Complete & Verified), Milestone 1 — Core Audit MVP (Complete & Verified)

---

## 1. Verified Current State

The PagePilot monorepo architecture, core landing-page audit MVP, **Milestone 2 Task 2.1 Supabase Schema & Multi-Tenant Foundation**, **Milestone 2 Task 2.2 Supabase Auth Integration & Tenant Workspace Foundation**, and **Milestone 2 Task 2.3 Projects & Monitored Pages Persistence + API** are **fully implemented, tested, and verified**.

### Monorepo Structure (`pnpm`)
- `supabase/migrations/`: Multi-tenant schema migrations (`20260827120000_init_multi_tenant_schema.sql`, `20260827130000_monitored_page_uniqueness.sql`) defining 10 core tables (`profiles`, `organizations`, `memberships`, `projects`, `monitored_pages`, `audit_runs`, `audit_reports`, `score_snapshots`, `findings`, `recommendations`), unique index `uq_monitored_pages_project_url`, SECURITY DEFINER authorization helpers, and explicit RLS policies for 4 roles (`owner`, `admin`, `member`, `viewer`).
- `packages/contracts/` (`@pagepilot/contracts`): Runtime-agnostic shared Zod schemas, TypeScript types, `API_ERROR_CODES`, `enforceUrlPolicy`, `normalizeDomain`, database entity contracts (`Role`, `Organization`, `Membership`, `Profile`, `Project`, `MonitoredPage`, `AuditRun`, `AuditReport`, `ScoreSnapshot`, `FindingEntity`, `RecommendationEntity`), project & monitored page input/output schemas (`CreateProjectInput`, `UpdateProjectInput`, `CreateMonitoredPageInput`, `UpdateMonitoredPageInput`), `WorkspaceContext`, and canonical `REPORT_SCHEMA_VERSION = "1.0.0"`. 54 tests passing across 6 test files.
- `packages/audit-engine/` (`@pagepilot/audit-engine`): SSRF-safe fetch (`ipaddr.js`, all-records DNS lookup, pinned socket connection), Cheerio snapshot extraction, deterministic checks, bounded Gemini model input serialization, structured output adapter, schema validation, signal reference integrity verification, and server-side scoring. 119 tests passing across 9 test files.
- `apps/web/` (`@pagepilot/web`): Vite + React 19 + TypeScript + Tailwind CSS v4 client application (`src/App.tsx`, `src/features/analysis/`, `src/features/auth/`, `src/features/projects/`). Includes browser-safe Supabase client, lightweight `AuthProvider` (`useAuth`), accessible `<AuthModal />` (with tablist semantics, keyboard navigation, and polite aria alerts), `<AuthNav />` header controls, and typed project & monitored page API client with automatic session token attachment. 78 tests passing across 10 test files.
- `apps/api/` (`@pagepilot/api`): Express API application on Vercel Node runtime (`src/http/app.ts`, `src/auth/`, `src/projects/`, `src/index.ts`, `api/analyze.ts`). Includes server-side token verification, `requireAuth`, `requireWorkspace`, `requireOrgRole`, idempotent first-workspace provisioning, protected `GET /api/workspace/me`, and full tenant-scoped project & monitored page CRUD endpoints (`/api/projects`, `/api/projects/:projectId/pages`) with authoritative RLS execution and defense-in-depth tenant isolation. 52 tests passing across 5 test files.
- Root Vercel adapter (`api/analyze.ts`): Minimal pass-through handler delegating to `@pagepilot/api`, with `vercel.json` routing `outputDirectory: "apps/web/dist"`.
- Total workspace test suite: **303 tests passing across 30 test files**.

### Verified Core Capabilities & Task 2.3 Foundation
- **Projects & Monitored Pages Persistence & API (Task 2.3):**
  - Authoritative RLS boundary: database operations execute with verified JWT user context (`auth.uid() = req.user.id`); application-level tenant filtering (`organization_id = req.workspace.organization.id`) serves strictly as defense-in-depth.
  - Explicit role matrix enforced across API and RLS: `owner`/`admin` have full CRUD (including project deletion); `member` can create/read/update projects and manage pages, but project deletion is denied (`403 FORBIDDEN`); `viewer` is read-only (`GET` only).
  - Duplicate monitored page registration protection (`uq_monitored_pages_project_url` + `409 CONFLICT`).
  - Strict separation of URL security policy (`enforceUrlPolicy` checking protocol, ports, credentials, hostname) vs project metadata formatting (`normalizeDomain`).
  - Protection against cross-tenant and manipulated ID attacks: mismatched or foreign project/page requests return safe `404 NOT_FOUND` and cannot mutate or delete cross-tenant data.
  - Automatic token injection in web client API helpers (`apps/web/src/features/projects/api.ts`).
- **Supabase Auth Integration & Tenant Workspaces (Task 2.2):**
  - Strict credential separation: browser bundle receives only public `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`. Zero server secrets in web bundle.
  - Server auth middleware parses `Authorization: Bearer <token>`, verifies JWT via Supabase Auth, and resolves tenant workspace context without trusting client-supplied IDs.
  - Idempotent and concurrency-safe first-user workspace provisioning using database unique constraints.
  - Protected `GET /api/workspace/me` endpoint returns verified `WorkspaceContext`.
  - Accessible client-side auth modal and nav controls with seamless anonymous $\leftrightarrow$ authenticated transition.
- **Anonymous Audit MVP Preservation:**
  - `POST /api/analyze` remains open, unauthenticated, and 100% functional.
  - Public visitors can submit any valid public URL and receive a real-time Gemini audit without signing in.
- **Multi-Tenant Schema & Isolation (Task 2.1):**
  - 10 normalized tables with primary keys, foreign keys, unique constraints, and check constraints.
  - Non-recursive SECURITY DEFINER authorization functions (`is_org_member`, `get_org_role`, `is_org_admin_or_owner`, `is_org_owner`) with fixed search path.
  - Strict RLS enabled and forced across all tables. Zero `USING (true)` or `WITH CHECK (true)` on tenant-owned data.
  - Cascading deletion semantics from projects to all child records.
- **Historical Report Immutability:**
  - Schema-versioned report model (`REPORT_SCHEMA_VERSION = "1.0.0"`, `model_identifier`, `check_version`, `scoring_version`).
  - Immutable historical evidence with complete self-contained `report_payload` JSONB.
  - RLS strictly forbids `UPDATE` on historical reports, score snapshots, and recommendations.
  - 90-day compact data retention with raw HTML strictly excluded from persistence.
- **SSRF-Safe Outbound Fetch & Public Submission:**
  - Strict URL policy (http/https, ports 80/443, no credentials).
  - All-records DNS lookup with global-unicast validation (`ipaddr.js`).
  - Pinned socket connections and manual redirect re-validation.
  - 1.5 MB body limit and 8s fetch deadline.
- **Gemini Structured Audit & Server-Side Scoring:**
  - Bounded evidence pack; strict 2-stage Zod validation.
  - Signal reference integrity check.
  - Server-calculated 7-category blended score and overall confidence rating.

---

## 2. Quality Gates & Verification Evidence

| Quality Gate | Command | Result | Status |
|---|---|---|---|
| **Workspace Typecheck** | `pnpm run typecheck` | 0 errors across all 5 workspace projects | **PASS** |
| **Contracts Tests** | `pnpm vitest run packages/contracts/tests/` | 54 tests passing across 6 test files | **PASS** |
| **Audit Engine Tests** | `pnpm vitest run packages/audit-engine/tests/` | 119 tests passing across 9 test files | **PASS** |
| **Web App Tests** | `pnpm vitest run apps/web/tests/` | 78 tests passing across 10 test files | **PASS** |
| **API Tests** | `pnpm vitest run apps/api/tests/` | 52 tests passing across 5 test files | **PASS** |
| **Full Monorepo Suite** | `pnpm test` | 303 tests passing across 30 test files | **PASS** |
| **Production Build** | `pnpm run build` | Built `apps/web/dist/` (JS 512.6 kB / gzip 143.9 kB, CSS 26.7 kB / gzip 5.7 kB) | **PASS** |
| **Secret Leakage Review** | Ripgrep on `apps/web/dist/` | Zero instances of `SUPABASE_SERVICE_ROLE_KEY`, `GEMINI_API_KEY`, or server secrets | **PASS** |
| **Live Vercel Dev & Gemini Verification** | `pnpm run verify:gemini` | `POST /api/analyze` against `example.com` returns contract-valid report via `@pagepilot/audit-engine` (overallScore: 64) | **PASS** |
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

- **Database Verification Environment:** The local Windows host environment lacks Docker daemon; local containerized Supabase CLI runtime cannot be executed locally. Migration SQL correctness, table constraints, cascade rules, RLS policies, and database contracts are verified via automated static schema test suite (`migration-schema.test.ts`), unit/integration tests (`auth-middleware.test.ts`, `workspace-provisioning.test.ts`, `projects-api.test.ts`), and TypeScript typecheck. Full runtime Postgres execution will be verified in staging / CI Supabase instance.
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
- **Exact Next Task:** **Task 2.4 — Historical Audit Report Persistence & Association** (Persisting audit runs, immutable reports, score snapshots, findings, and linking to monitored pages).
