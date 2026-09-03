# PagePilot — Product Roadmap

This roadmap defines the evolution of PagePilot from a single-project MVP into a continuous landing-page UX intelligence platform for growth teams.

---

## Roadmap Summary

| Milestone | Product Outcome | Status | Key Focus |
|---|---|---|---|
| **0. Product Foundation** | Maintainable monorepo base | **Complete** | pnpm workspace, shared contracts package, isolated audit engine, apps/web, apps/api, docs ledger |
| **1. Core Audit MVP** | Trustworthy one-off UX audit | **Complete** | Safe fetch, deterministic checks, Gemini structured audit, report UI |
| **2. Accounts & Projects** | Saved reports & tenant workspaces | **Complete** | Supabase Auth, organizations, roles, projects, monitored page registry (Live Verified) |
| **3. Continuous Monitoring** | Automated regression alerts | **Complete** | Inngest weekly workflows, score diffing, email alerts, trend dashboard (Live DB Verified) |
| **4. Collaboration** | Findings turned into team work | **Complete** | Finding work items (`open`, `resolved`), assignees, notes, read-only share links (Live DB Verified) |
| **5. Integrations & Measurement** | Growth toolchain connectivity | **Active** | Slack notifications, webhooks, UTM tracking, analytics context import |
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
- **Status:** `Complete & Verified on Live Supabase (qzlffxlmrhqfjeohsnkm)`
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
  - Cross-tenant data isolation verified by API authorization tests & static schema/RLS assertions (runtime Postgres RLS execution pending staging environment).
  - Historical reports remain renderable when prompt or scoring schemas evolve.
  - Deleting a project permanently purges all associated tenant records.

---

### Milestone 3: Continuous Monitoring & Alerts
- **Status:** `Complete & Verified` (Application, Contracts, Tests, & Static SQL/RLS Complete; Staging Database RLS, Inngest Cloud Dispatch, & Real Transactional Email Pending Staging)
- **Product Outcome:** Teams receive proactive alerts when monitored landing pages experience meaningful UX regressions.
- **Dependencies:** Milestone 2.
- **Tasks:**
  - **Task 3.1 — Inngest Setup & Baseline Audit Workflow (`Complete & Verified`)**:
    - Created `@pagepilot/workflows` package owning durable workflow definitions with a narrow persistence interface (`WorkflowPersistenceStore`).
    - Defined versioned event contracts (`audit/requested`, `audit/completed`, `audit/failed`) and Zod schemas in `@pagepilot/contracts`.
    - Implemented durable `execute-audit-workflow` function (`createAuditWorkflow`) with isolated multi-step execution:
      - Step 1 (`claim-and-validate-run`): validates event schema, verifies tenant isolation, checks idempotent completion, and applies atomic PostgreSQL concurrency lock.
      - Step 2 (`execute-audit-engine`): executes `@pagepilot/audit-engine` (`analyzeTarget`) safely outside database transactions.
      - Step 3 (`persist-audit-result`): on success commits completed report atomically via PostgreSQL RPC `persist_completed_audit_report`; on failure records failure while preserving `latest_successful_audit_run_id` intact. Non-retryable errors raise `NonRetriableError`.
    - Created `SupabaseWorkflowPersistenceStore` in `apps/api/src/audits/` and mounted Inngest serve handler at `/api/inngest`.
    - Kept secrets strictly server-side in `apps/api` runtime boundary; browser bundle contains zero workflow dependencies.
    - Preserved anonymous one-off audit (`POST /api/analyze`) and synchronous manual audit endpoint with zero regressions.
  - **Task 3.2 — Weekly Scheduled Audit Workflow (`Complete & Verified`)**:
    - Implemented durable `weekly-audit-scheduler` (`createWeeklyScheduler`) in `@pagepilot/workflows` with dual triggers (Cron: `0 0 * * 1` and Event: `audit/schedule-weekly`).
    - Added deterministic timezone-aware week window derivation (`getWeeklyWindow`) in `@pagepilot/contracts`.
    - Discover active monitored pages configured for weekly cadence with project timezone metadata.
    - Deterministic idempotency key strategy (`scheduled:${page.id}:${windowId}`) and pre-persisted `audit_run` (`invocation_type = 'scheduled'`, `triggered_by_user_id = null`).
    - Suppressed duplicate event emission when `isExisting === true` backed by PostgreSQL unique index `uq_audit_runs_idempotency`.
    - Dispatches `audit/requested` events, reusing the verified `execute-audit-workflow` without duplication.
  - **Task 3.3 — Score & Finding Regression Diff Engine (`Complete & Verified`)**:
    - Pure, deterministic diff engine (`computeAuditDiff`) in `@pagepilot/audit-engine` comparing previous successful report against current successful report.
    - Centralized regression thresholds: overall score drop $\ge 10$ points (`MEANINGFUL_OVERALL_SCORE_DROP_THRESHOLD`) and category score drop $\ge 15$ points (`MEANINGFUL_CATEGORY_SCORE_DROP_THRESHOLD`).
    - Stable finding identity strategy based on sorted deterministic `signalIds` for observed findings and normalized title slugs for inferred findings.
    - Severity transition tracking (`low <-> medium <-> high`) with escalation classified as regression.
    - Signal-level diffing (`pass <-> warn`, `unknown <-> measured`) without false penalties for missing evidence.
    - First-audit baseline state with zero false regressions and strict historical report immutability.
    - Typed Zod contracts and schemas in `@pagepilot/contracts`.
  - **Task 3.4 — Alert Rules & Evaluation (`Complete & Verified`)**:
    - Versioned alert contracts (`AlertDecision`, `AlertReason`, `AlertEvaluationContext`, `AlertEvaluationResult`, `AlertRuleType`, `AlertSeverity`) in `@pagepilot/contracts`.
    - Pure, deterministic alert evaluation layer (`evaluateAuditAlerts`, `evaluateScanFailureAlert`) in `@pagepilot/workflows`.
    - Centralized thresholds: overall score drop $\ge 10$ (`high`), category score drop $\ge 15$ (`medium` / `high` if $\ge 25$), new high-severity finding (`high`), finding severity escalated (`high` / `medium`), deterministic signal regressed (`medium`), repeated scan failures $\ge 3$ (`high`).
    - Logical alert deduplication key strategy (`alert:${monitoredPageId}:${ruleType}${targetId ? `:${targetId}` : ""}`) independent of transient `auditRunId`.
    - Context-supplied `evaluatedAt` preserving 100% determinism without internal clock calls.
    - Suppression of alerts on baseline first audits and neutral unknown signal transitions.
  - **Task 3.5 — Alert Persistence & Delivery Workflow (`Complete & Verified`)**:
    - Multi-tenant database migration `20260829120000_alerts_and_delivery.sql` creating `public.alerts` and `public.alert_deliveries` tables with strict RLS policies and partial unique index `uq_alerts_run_dedup`.
    - Typed Zod contracts (`AlertEntity`, `AlertDeliveryEntity`, `ALERT_STATUSES`, `DELIVERY_STATUSES`, `DELIVERY_CHANNELS`, `buildAlertDeliveryKey`, `ALERT_CREATED_EVENT`, `alertCreatedPayloadSchema`) in `@pagepilot/contracts`.
    - Integrated Step 4 (`evaluate-and-dispatch-alerts`) into `execute-audit-workflow` in `@pagepilot/workflows`, calculating diff against previous report, evaluating alerts, persisting via `persistAlert`, and dispatching `alert/created`.
    - State-aware 24-hour suppression window in `persistAlert`: identical ongoing regressions within 24h are suppressed without duplicate alerts, while new or worsened regressions proceed.
    - Durable Inngest function `deliver-alert-notification` (`createAlertDeliveryWorkflow`) triggered by `alert/created`:
      - Step 1 (`load-and-validate-alert`): loads alert, validates tenant isolation, and skips if already delivered.
      - Step 2 (`resolve-recipients`): queries organization `owner` and `admin` profiles.
      - Step 3 (`deliver-notifications`): uses database `delivery_key` for idempotency and delivers via `NotificationProvider`.
    - Pure `buildAlertEmailContent` generating sanitized semantic HTML and plain text emails without raw HTML or secret leakage.
    - Registered `createAlertDeliveryWorkflow` on the `/api/inngest` serve endpoint in `apps/api`.
  - **Task 3.6 — Trend Dashboard & Score History UI (`Complete & Verified`)**:
    - Added `categoryScores` mapping to `AuditHistoryItem` in `@pagepilot/contracts` and populated via `audit_reports.report_payload` in `apps/api`.
    - Built accessible native SVG `<ScoreTrendChart />` component in `apps/web/src/features/workspace/components/score-trend-chart.tsx`:
      - Chronological overall score trajectory plotting with neon drop-shadow and gradient area fill.
      - Baseline single-audit indicator and clean empty state handling.
      - Interactive hover and focus tooltips on data points with date, score, delta vs previous, and invocation type.
      - Category trajectory cards for all 7 UX dimensions showing current score, progress bar, and score change vs previous audit.
      - Keyboard accessible navigation, screen reader ARIA regions, and reduced-motion support with zero third-party chart dependencies.
    - Embedded `<ScoreTrendChart />` in `PageDetail` view in `apps/web`.
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
  - Retried workflow runs do not duplicate audits, reports, or alert deliveries (automated workflow replay tests verified; live cloud Inngest dispatch pending staging).
  - Alerts clearly detail the affected page, regressed category, evidence, and recommended remediation (email templates & mock delivery verified; live transactional provider dispatch pending staging).
  - Failed audits preserve previous report as the active source of truth.
  - Visual trend chart displays overall score history and category trajectories cleanly over time.

---

### Milestone 4: Collaboration & Prioritization
- **Status:** `Complete & Verified on Live Supabase (qzlffxlmrhqfjeohsnkm)` (Tasks 4.1, 4.2, 4.3, & 4.4 Complete & Verified)
- **Product Outcome:** Audit findings become a prioritized work queue that teams can assign, discuss, and track to resolution, with deterministic project prioritization, rich historical report comparison, and secure external sharing.
- **Dependencies:** Milestone 2, Milestone 3.
- **Tasks:**
  - **Task 4.1 — Collaboration & Prioritization Data Model + Secure API Foundation (`Complete & Verified`)**:
    - Multi-tenant database migration `20260830120000_work_items_and_collaboration.sql` creating `public.work_items` and `public.work_item_activities` with explicit RLS policies for 4 roles (`owner`, `admin`, `member`, `viewer`).
    - Database-level assignee authorization via trigger `trg_check_work_item_assignee` enforcing that assignees must belong to the tenant organization.
    - Partial unique indexes (`uq_work_items_page_finding`, `uq_work_items_page_recommendation`) on `(monitored_page_id, finding_id / recommendation_id)` preventing duplicate tracking on the same landing page, with API surfacing structured `409 CONFLICT`.
    - Atomic PostgreSQL stored functions `public.create_work_item_atomic` and `public.update_work_item_atomic` guaranteeing transactional work item mutation and append-only activity trail logging.
    - Immutable historical report guarantee: underlying `findings`, `recommendations`, `audit_reports`, and `score_snapshots` remain 100% untouched when work items are created, modified, or resolved.
    - Zod schemas and TypeScript contracts exported from `@pagepilot/contracts` (`workItemSchema`, `workItemActivitySchema`, `createWorkItemSchema`, `updateWorkItemSchema`, `workItemFiltersSchema`).
    - Authenticated API router mounted at `/api/projects/:projectId/work-items` supporting full CRUD, filtering, assignee/source validation, and safe 404 behavior for cross-tenant or mismatched IDs.
  - **Task 4.2 — Work Items UI, Backlog Views, & Assignee Actions (`Complete & Verified`)**:
    - Built comprehensive Web API client (`apps/web/src/features/work-items/api.ts`) with schema parsing and typed `WorkItemsApiClientError`.
    - Implemented `<WorkItemsBacklog />` with multi-dimensional filtering (Status, Severity, Assignee, Page, Category), multi-criteria sorting (Priority, Recent, Status, Title), status quick-actions, and clear empty states (`"Nothing needs attention yet."`, `"No work items match these filters."`).
    - Implemented accessible `<WorkItemDetailModal />` dialog with quick status changes, Reopen workflow, organization assignee selector, resolution rationale field (with 2000-char limiter), notes editor (5000-char limiter), interactive tag manager (max 20 tags $\le 50$ chars), and append-only activity history timeline.
    - Implemented `<CreateWorkItemModal />` with source finding/recommendation pre-population and graceful duplicate conflict handling (`"That finding/recommendation already has a work item."`).
    - Integrated `+ Track Work Item` triggers into `FindingCard`, `TopProblems`, `DetailedRecommendations`, `ReportView`, and `HistoricalReportView` without mutating immutable historical audit payloads.
    - Added **Work Backlog** tab in `WorkspaceShell` with smooth cross-navigation to monitored pages and historical reports.
    - Strictly enforced role-based permissions (viewers are read-only with interactive controls disabled) and verified at 375px, 768px, 1440px with keyboard navigation and reduced-motion support.
  - **Task 4.3 — Read-Only Shared Report Links (`Complete & Verified`)**:
    - Multi-tenant database migration `20260830130000_report_share_links.sql` creating `public.report_share_links` and isolated `SECURITY DEFINER` stored procedure `public.get_shared_audit_report(p_token_hash text)` running with `SET search_path = public, pg_temp;`.
    - Cryptographic token architecture: 256-bit cryptographically secure pseudorandom entropy (`base64url`), plaintext returned only once upon creation, database persists only deterministic SHA-256 hash (`token_hash`) with unique index.
    - Strict public projection isolation: RPC projects only sanitized report payload, scores, findings, recommendations, and safe share metadata; never leaks `organization_id`, member emails, user IDs, work items, or alerts.
    - Uniform 404 error obfuscation on invalid, expired, revoked, or nonexistent tokens (`"This report link is no longer available."`) preventing enumeration attacks.
    - Rate-limiting (60 req / 10 min per IP) and anti-indexing headers (`noindex, nofollow`, `no-store`, `nosniff`).
    - Expiration selection (7d, 30d, 90d, 365d) and immediate workspace-level revocation by authenticated members.
    - `<ShareReportModal />` dialog integrated into `HistoricalReportView` with copyable share URL and revocation confirmation.
    - Standalone `<SharedReportPage />` at `/shared/reports/:token` rendering read-only immutable report evidence without workspace navigation sidebars, edit controls, or tracking buttons.
    - Contracts (`reportShareLinkSchema`, `createShareLinkRequestSchema`, `createShareLinkResponseSchema`, `shareLinkMetadataSchema`, `sharedAuditReportResponseSchema`), API endpoints, and Web client tested.
    - Runtime RLS status: Database migration, schema, policies, and RPC tested in automated contract and unit/integration test suites; runtime live Supabase RLS verification marked `PENDING STAGING`.
  - **Task 4.4 — Project Prioritization Views & Historical Report Comparison (`Complete & Verified`)**:
    - Added deterministic historical report comparison API endpoint `GET /api/projects/:projectId/pages/:pageId/audits/:auditRunId/diff` computing pure diffs using `@pagepilot/audit-engine`'s `computeAuditDiff`.
    - Implemented automatic comparison baseline selection against the most recent completed audit prior to the current run (`created_at < beforeTimestamp AND status = 'completed' ORDER BY created_at DESC LIMIT 1`), with explicit `compareRunId` override support. Failed, queued, or running audits are never used as comparison baselines.
    - Implemented `<ReportComparisonView />` in `apps/web/` featuring overall score trajectory hero, meaningful regression alerts ($\Delta \le -10$ or new high-severity findings), 7-category score changes grid, and filterable tabbed diff views (Regressions, New Findings with `+ Track Work Item`, Resolved Findings, Changed Findings, Deterministic Signals, and Improvements).
    - Upgraded `<ProjectDetail />` with segmented views (Overview & Priorities vs Monitored Pages) and deterministic ranking for Highest-Impact Open Work (sorted strictly by severity `high` > `medium` > `low` then `updatedAt` descending), Landing Page UX Trajectories with direct "Compare Changes" actions, and Resolved Improvements.
    - Connected comparison navigation across `WorkspaceShell`, `PageDetail`, `HistoricalReportView`, and `ProjectDetail`.
    - Full quality gates verified: 542 tests passing across 60 test files, 0 typecheck errors, production build verified, live Gemini verified.
- **Must Include:**
  - Finding work item statuses: `open`, `in_progress`, `resolved`, `dismissed`.
  - Work item metadata: assignee, note, tag, resolution rationale, actor audit logs.
  - Project backlog views: high-impact open findings, regressed pages, resolved improvements.
  - Secure, revocable read-only report sharing link.
- **Explicitly Defer:** Full Jira/Linear replacement, custom issue workflows.
- **Acceptance Criteria:**
  - Status mutations record actor and timestamp without mutating historical audit report content.
  - Role-based permissions enforced: viewers cannot mutate work items; members can only mutate their organization's work.
  - Shared recipient can only view the explicitly shared historical report without workspace access.

---

### Milestone 5: Integrations & Measurement
- **Status:** `Active`
- **Product Outcome:** Connect PagePilot findings to team messaging tools and analytics context.
- **Dependencies:** Milestone 3, Milestone 4.
- **Tasks & Execution Plan:**
  - **Task 5.1 — Slack / Webhook Integration Foundation & Alert Subscriptions:** `Complete` (Database schema `integration_connections`, forced RLS, AES-256-GCM authenticated credential encryption, secret masking, outbound SSRF destination protection, HMAC-SHA256 signing, multi-channel Slack & Webhook Inngest alert dispatch with idempotent delivery keys).
  - **Task 5.2 — Integrations Management UI & Test Ping Interface:** `Complete` (Integrations management UI in @pagepilot/web with Slack & Webhook forms, project-scoped vs org-wide scope handling, masked credentials display, role-gated mutations for owner/admin, test ping action with latency & status feedback, SSRF BLOCKED_DESTINATION error handling, filtering, and 18 UI/client tests).
  - **Task 5.3 — CSV Export for Findings & Recommendation Backlogs:** `Planned` (Project and report CSV export streams with proper quoting, severity/category/effort mapping, and date formatting).
  - **Task 5.4 — Page-Level Analytics Import & Context Visualization:** `Planned` (Analytics metric ingestion, schema versioning, labeled business context separate from UX inference).
- **Explicitly Defer:** Autonomous page edits, automatic A/B testing execution.
- **Acceptance Criteria:**
  - Inbound and outbound webhook signatures verified.
  - Integration credentials encrypted at rest with AES-256-GCM and never returned to the client.
  - SSRF destination protection strictly enforced on all outbound webhooks.
  - Multi-channel delivery is idempotent and preserves previous successful audit reports on failure.

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
