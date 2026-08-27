# PagePilot — Product Roadmap

This roadmap defines the evolution of PagePilot from a single-project MVP into a continuous landing-page UX intelligence platform for growth teams.

---

## Roadmap Summary

| Milestone | Product Outcome | Status | Key Focus |
|---|---|---|---|
| **0. Product Foundation** | Maintainable monorepo base | **Complete** | pnpm workspace, shared contracts package, isolated audit engine, apps/web, apps/api, docs ledger |
| **1. Core Audit MVP** | Trustworthy one-off UX audit | **Complete** | Safe fetch, deterministic checks, Gemini structured audit, report UI |
| **2. Accounts & Projects** | Saved reports & tenant workspaces | **Active** | Supabase Auth, organizations, roles, projects, monitored page registry |
| **3. Continuous Monitoring** | Automated regression alerts | **Planned** | Inngest weekly workflows, score diffing, email alerts, trend dashboard |
| **4. Collaboration** | Findings turned into team work | **Planned** | Finding work items (`open`, `resolved`), assignees, notes, read-only share links |
| **5. Integrations & Measurement** | Growth toolchain connectivity | **Planned** | Slack notifications, webhooks, UTM tracking, analytics context import |
| **6. Deep Analysis Pipeline** | Browser-rendered evidence | **Planned** | Playwright screenshots, vision-assisted hierarchy, Lighthouse, axe checks |
| **7. Commercial & Enterprise** | Monetization & governance | **Planned** | Stripe subscriptions, usage limits, audit logs, workspace export/deletion |

---

## Milestone Details

### Milestone 0: Product Foundation & Monorepo Setup
- **Status:** `Complete & Verified`
- **Product Outcome:** A clean, modular monorepo structure that isolates shared contracts, audit logic, workflows, and web/API applications without disrupting the production MVP.
- **Dependencies:** None.
- **Completed Deliverables:**
  - `docs/STATUS.md`, `docs/ROADMAP.md`, `docs/DECISIONS.md` control plane (D39).
  - pnpm workspace (`pnpm-workspace.yaml`, `pnpm@11.10.0`).
  - `packages/contracts`: shared Zod schemas, TypeScript types, `API_ERROR_CODES`, and `enforceUrlPolicy` (D40).
  - `packages/audit-engine`: isolated safe fetch, Cheerio snapshot, deterministic checks, Gemini adapter, scoring (D41).
  - `apps/web`: Vite + React + Tailwind frontend application (`@pagepilot/web`) with 72 unit/UI tests (D42, D44).
  - `apps/api`: Express API handler on Vercel Node runtime (`@pagepilot/api`) with 30 integration tests (D42, D44).
  - Root thin Vercel adapter (`api/analyze.ts`) with `vercel.json` routing.
- **Acceptance Criteria Verified:**
  - Workspace compiles under `pnpm run build` and passes strict typechecking (`pnpm run typecheck`).
  - Full test suite (258 tests across 27 test files) passes across all packages and apps.
  - Vercel build and live Gemini verification (`pnpm run verify:gemini`) verified on local dev server.

---

### Milestone 1: Core Audit MVP
- **Status:** `Complete & Verified`
- **Product Outcome:** A public web visitor can submit any public URL and receive a schema-valid, 7-category UX audit report with bounded scores and actionable recommendations.
- **Dependencies:** None.
- **Must Include:**
  - Public URL submission form with client-side validation.
  - SSRF-safe outbound fetch (DNS all-records check, `ipaddr.js` global unicast validation, socket connection pinning, manual redirect re-validation, 1.5 MB body limit, 8s timeout).
  - Bounded HTML snapshot extraction and deterministic signals.
  - Gemini structured JSON output adapter with strict Zod gate and signal reference integrity checks.
  - Server-side scoring (deterministic baselines + 60/40 blending + overall score).
  - Accessible report dashboard UI with loading and sanitized error recovery.
  - Lightweight in-memory rate limiting (5 req / 10 min / warm instance).
- **Explicitly Defer:** Persistence, accounts, screenshots, third-party integrations.
- **Acceptance Criteria:**
  - 100% test coverage across URL policy, SSRF, extraction, scoring, schemas, and UI (258 tests passing).
  - Zero raw HTML, secrets, or internal details exposed to client.

---

### Milestone 2: Accounts & Projects
- **Status:** `Active (In Progress)`
- **Product Outcome:** Signed-in growth teams can organize audits into projects, track monitored pages, and retain immutable audit history.
- **Dependencies:** Milestone 0, Milestone 1.
- **Tasks:**
  - **Task 2.1 — Supabase Schema & Multi-Tenant Migration (`Complete & Verified`)**:
    - Complete normalized SQL migration `supabase/migrations/20260827120000_init_multi_tenant_schema.sql` defining `profiles`, `organizations`, `memberships`, `projects`, `monitored_pages`, `audit_runs`, `audit_reports`, `score_snapshots`, `findings`, `recommendations`.
    - Explicit RLS enabled and forced across all 10 tables with SECURITY DEFINER helpers (`is_org_member`, `get_org_role`, `is_org_admin_or_owner`, `is_org_owner`).
    - Roles: `owner`, `admin`, `member`, `viewer` (read-only for viewers; mutations restricted to authorized roles).
    - Immutable historical report schema with `REPORT_SCHEMA_VERSION = "1.0.0"` and complete self-contained `report_payload` JSONB.
    - Cascading deletion semantics from projects to all child records (with `ON DELETE SET NULL` on `latest_audit_run_id`).
    - 90-day compact data model excluding raw HTML.
    - Contracts types & schemas exported in `@pagepilot/contracts`.
  - **Task 2.2 — Supabase Auth Integration & Tenant Workspaces (`Complete & Verified`)**:
    - Browser-safe Supabase client (`VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`) with zero secret leakage.
    - Lightweight client `AuthProvider` (`useAuth`) with session lifecycle management, sign in, sign up, sign out, and workspace sync.
    - Accessible `<AuthModal />` (dialog, tablist, aria-live alerts) and `<AuthNav />` header controls.
    - Server auth middleware (`requireAuth`, `requireWorkspace`, `requireOrgRole`) deriving identity strictly from verified JWT sessions.
    - Idempotent and concurrency-safe first-user workspace provisioning using database unique constraints.
    - Protected `GET /api/workspace/me` returning `WorkspaceResponse`.
    - Zero disruption to anonymous audits (`POST /api/analyze` remains open and unauthenticated).
  - **Task 2.3 — Projects & Monitored Pages Persistence & API (`Complete & Verified`)**:
    - Authenticated project CRUD and monitored page management with RLS policy enforcement.
    - Explicit role matrix (`owner`/`admin` delete projects; `member` project create/read/update & page CRUD; `viewer` read-only).
    - Monitored page duplicate registration protection (`uq_monitored_pages_project_url` + 409 Conflict).
    - Clear separation between URL security policy (`enforceUrlPolicy`) and domain metadata canonicalization (`normalizeDomain`).
    - Web API client (`apps/web/src/features/projects/api.ts`) with automatic session token attachment.
    - Manipulated ID and cross-tenant isolation protection (safe 404 behavior).
  - **Task 2.4 — Historical Audit Report Persistence & Association (`Complete & Verified`)**:
    - Persist complete audit aggregate (`audit_runs`, `audit_reports`, 7 `score_snapshots`, `findings`, `recommendations`) atomically via database RPC function (`persist_completed_audit_report`).
    - Handled concurrent idempotency conflict (Postgres 23505 unique constraint catch) returning existing run without duplicate execution.
    - Implemented distinct HTTP status semantics: `201 Created` for newly executed audits; `200 OK` for idempotent replayed runs.
    - Preserved `latest_successful_audit_run_id` on audit failure while updating `latest_audit_run_id`.
    - Enforced historical report immutability via RLS (no `UPDATE` on reports/snapshots/recommendations).
    - Web client API helpers (`apps/web/src/features/audits/api.ts`) with automatic session token injection.
  - **Task 2.5 — Workspace UI, Projects & Monitored Page Management (`Complete & Verified`)**:
    - Built accessible, responsive workspace shell (`WorkspaceShell`) supporting project listing, creation, editing, and deletion.
    - Built project detail view (`ProjectDetail`) for monitored page management (add/edit/delete/toggle active/paused).
    - Built monitored page detail view (`PageDetail`) displaying latest score, confidence, audit history, and manual audit trigger.
    - Implemented safe selection persistence: stored IDs in session storage are re-validated through API queries and safely cleared if unauthorized or missing.
    - Implemented failure preservation banner with "View Last Successful Audit" button when latest audit run failed.
    - Implemented historical report viewer (`HistoricalReportView`) reusing `ReportView` with frozen version metadata.
    - Preserved anonymous one-off audit flow unchanged while allowing seamless switching for authenticated users.
    - Enforced role matrix in UI: viewer (read-only), member (manage pages/audits, restricted from deleting projects), owner/admin (full control).
- **Must Include:**
  - Supabase Auth (Email / Password / Magic Link).
  - Multi-tenant data model: `organization`, `membership`, `profile`, `project`, `monitored_page`, `audit_run`, `audit_report`.
  - Organization roles: `owner`, `admin`, `member`, `viewer`.
  - Explicit Row-Level Security (RLS) on all tenant-owned tables.
  - Server-side authorization verifying organization/project access on all endpoints.
  - Versioned report schema (`schemaVersion`) to preserve historical report renderability.
  - Project deletion cascading to pages, reports, signals, and alerts.
- **Explicitly Defer:** Team invites beyond email, SAML/SSO, Stripe billing.
- **Acceptance Criteria:**
  - Cross-tenant data isolation verified by automated RLS and API authorization tests.
  - Historical reports remain renderable when prompt or scoring schemas evolve.
  - Deleting a project permanently purges all associated tenant records.

---

### Milestone 3: Continuous Monitoring & Alerts
- **Status:** `Next`
- **Product Outcome:** Teams receive proactive alerts when monitored landing pages experience meaningful UX regressions.
- **Dependencies:** Milestone 2.
- **Must Include:**
  - Inngest durable workflows for scheduled weekly audits.
  - Idempotent workflow steps anchored on `audit_run_id`.
  - Regression diff engine comparing latest successful audit against previous audit (overall score drops $\ge 10$ points, new high-severity findings).
  - Alert rules and email delivery via transactional provider.
  - 24-hour alert deduplication per page and rule.
  - Trend dashboard displaying score history and category changes over time.
  - Failed scans recorded without overwriting the last successful report.
- **Explicitly Defer:** Daily/custom cron schedules, Slack notifications, SMS alerts.
- **Acceptance Criteria:**
  - Retried workflow runs do not duplicate audits, reports, or alert deliveries.
  - Alerts clearly detail the affected page, regressed category, evidence, and recommended remediation.
  - Failed audits preserve previous report as the active source of truth.

---

### Milestone 4: Collaboration & Prioritization
- **Status:** `Planned`
- **Product Outcome:** Audit findings become a prioritized work queue that teams can assign, discuss, and track to resolution.
- **Dependencies:** Milestone 2, Milestone 3.
- **Must Include:**
  - Finding work item statuses: `open`, `in_progress`, `resolved`, `dismissed`.
  - Work item metadata: assignee, note, tag, resolution rationale, actor audit logs.
  - Project backlog views: high-impact open findings, regressed pages, resolved improvements.
  - Secure, revocable read-only report sharing link.
- **Explicitly Defer:** Full Jira/Linear replacement, custom issue workflows.
- **Acceptance Criteria:**
  - Status mutations record actor and timestamp without mutating historical audit report content.
  - Role-based permissions enforced: viewers cannot mutate work items; members can only mutate their organization's work.

---

### Milestone 5: Integrations & Measurement
- **Status:** `Planned`
- **Product Outcome:** Connect PagePilot findings to team messaging tools and analytics context.
- **Dependencies:** Milestone 3, Milestone 4.
- **Must Include:**
  - Slack incoming webhooks / app notifications for score drops and high-severity findings.
  - Generic outbound webhooks with HMAC-SHA256 signature headers.
  - CSV export for findings and recommendation backlogs.
  - Page-level analytics import (conversion rates, bounce rates) clearly labeled as business context separate from UX inference.
- **Explicitly Defer:** Autonomous page edits, automatic A/B testing execution.
- **Acceptance Criteria:**
  - Inbound and outbound webhook signatures verified.
  - Integration credentials encrypted at rest.

---

### Milestone 6: Deep Analysis Pipeline
- **Status:** `Planned`
- **Product Outcome:** Augment static HTML audits with browser-rendered measurements and visual evidence.
- **Dependencies:** Milestone 1, Milestone 3.
- **Must Include:**
  - Separate Playwright screenshot capture pipeline (never replacing safe static fetch).
  - Vision-assisted visual hierarchy review.
  - Visual regression detection across scheduled audit runs.
  - Lighthouse / PageSpeed Insights performance and Core Web Vitals extraction.
  - Automated `axe-core` accessibility rule evaluation.
- **Explicitly Defer:** Browser extension, unrestricted domain crawling.
- **Acceptance Criteria:**
  - Visual measurements and browser metrics explicitly labeled and segregated from static-HTML signals.
  - Static-HTML safe audit pipeline remains independently operational.

---

### Milestone 7: Commercial & Enterprise
- **Status:** `Planned`
- **Product Outcome:** Paid self-serve subscription plans and enterprise security controls.
- **Dependencies:** Milestone 3, Milestone 4.
- **Must Include:**
  - Stripe Billing (monitored page limits, audit run quotas, customer portal).
  - Server-enforced plan limits and grace periods.
  - Tenant audit logging for compliance.
  - Workspace data export and GDPR deletion compliance.
  - API keys for programmatic audit triggering.
  - SAML / SSO integration assessment.
- **Explicitly Defer:** Custom enterprise on-premise deployments.
- **Acceptance Criteria:**
  - Stripe webhook processing is idempotent and signature-verified.
  - Downgrade/cancellation enforces page limits gracefully without data corruption.
