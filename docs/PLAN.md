# PagePilot Product Roadmap — Growth-Team Edition

## Current Status and Product Direction

**Verified current status:** The repository contains a complete, verified, single-project MVP deployed on Vercel with 216 passing tests across 19 test suites. The core pipeline (`Public URL → safe fetch → deterministic signals → Gemini structured audit → server-side scoring → report UI`) is fully operational and verified.

This plan describes the post-MVP evolution from that single-project foundation into:

> **Continuous landing-page UX intelligence for growth teams** — monitor important pages, detect meaningful UX regressions, and turn them into prioritized work.

The project control plane is maintained in:

- `docs/STATUS.md`: verified completed behavior, current milestone, known issues, exact next task.
- `docs/ROADMAP.md`: milestones, status (`planned|active|complete|deferred`), dependencies, acceptance criteria.
- `docs/DECISIONS.md`: architecture, security, data-retention, and vendor decisions.

## Target Architecture

Move directly to a lightweight pnpm workspace because the product will need shared contracts, a background workflow surface, and separate web/API deployment units:

```text
apps/
  web/                 # React, TypeScript, Vite, Tailwind
  api/                 # Express API exposed as Vercel Node functions
packages/
  contracts/           # Zod schemas and shared API/report types
  audit-engine/        # Safe fetch, extraction, checks, scoring, Gemini adapter
  workflows/           # Scheduled audits, alerts, notification workflows
docs/
```

Platform defaults:

- Vercel hosts the web app and Node API functions.
- Supabase provides Auth and Postgres; every tenant-owned table uses explicit row-level-security policies and role-aware membership checks. [Supabase RLS guidance](https://supabase.com/docs/guides/database/postgres/row-level-security)
- Inngest handles durable audit, alert, and notification workflows with retries, idempotent steps, scheduling, and concurrency limits. [Inngest durable functions](https://www.inngest.com/docs/learn/inngest-functions)
- Gemini remains the structured-audit provider behind a replaceable `AuditProvider` interface.
- Add Stripe only when monitoring has validated paid demand; do not let billing delay the collaboration or monitoring milestones.

Keep the existing static-HTML safety boundary. Screenshot/browser analysis becomes a separate later pipeline, never a replacement for safe server-side extraction.

### Core product data

Add these records progressively:

- `organization`, `membership`, and `profile`: tenant boundary and `owner|admin|member|viewer` roles.
- `project`: a team’s product/site context, domain, timezone, and goals.
- `monitored_page`: canonical URL, scan cadence, active state, owner, tags, and latest audit pointer.
- `audit_run`: manual or scheduled invocation, status, timing, model/check versions, and retry metadata.
- `audit_report`, `score_snapshot`, `finding`, `recommendation`: immutable report history and actionable output.
- `alert_rule`, `alert_delivery`: score-drop, new-high-severity, and scan-failure notifications.
- `integration_connection`: encrypted credentials and installation metadata for later Slack/analytics integrations.
- `subscription` and `usage_event`: deferred until the billing milestone.

Store normalized extracted signals and reports by default, not full raw HTML. Retain compact audit data for 90 days initially; allow project deletion to remove all tenant data.

### Stable product events

Use internal events from the first persisted-audit milestone:

```text
audit.requested
audit.completed
audit.failed
score.changed
finding.detected
alert.delivery.requested
```

Every workflow must be idempotent using the audit run ID. This is required because scheduled function invocations can overlap or be delivered more than once. [Vercel cron reliability guidance](https://vercel.com/docs/cron-jobs/manage-cron-jobs)

## Roadmap

| Milestone | Product outcome | Must include | Explicitly defer |
|---|---|---|---|
| 0. Product foundation | A maintainable base for the MVP | Workspace, shared Zod contracts, environment handling, audit status model, docs ledger | Auth, database, billing |
| 1. Core audit MVP | A team can get a trustworthy one-off UX audit | Safe fetch, deterministic checks, Gemini JSON, report UI, error/loading states | Persistence, screenshots, integrations |
| 2. Accounts and projects | A signed-in team can retain and organize audits | Supabase Auth, organizations, roles, projects, monitored page registry, historical reports | Invites beyond email, SSO, billing |
| 3. Continuous monitoring | Teams learn when important pages regress | Weekly schedules, durable audit workflow, score/finding diffing, alert rules, email delivery, trend dashboard | Daily scans, Slack, custom schedules |
| 4. Collaboration and prioritization | Findings become work the team can manage | Assignee, status, notes, tags, recommendation backlog, report comparison, shareable read-only link | Full task-management replacement |
| 5. Integrations and measurement | Audits connect to growth workflows | Slack alerts, webhooks, UTM/page tags, CSV export, analytics import with documented limitations | Autonomous optimization |
| 6. Deep analysis | PagePilot gains stronger evidence | Screenshot/vision pipeline, Lighthouse/PageSpeed, axe checks, visual change detection | Browser extension, crawling |
| 7. Commercial and enterprise | Product can sell safely to larger teams | Stripe plans/usage, audit log, API keys, SSO/SAML assessment, retention controls, support tooling | Custom enterprise contracts before demand |

### Milestone 1: Core audit MVP

Implement the original planned experience first.

Acceptance criteria:

- A user can submit a public URL and receive a schema-valid seven-category report.
- Scores are server-calculated, bounded, and distinguish deterministic evidence from AI interpretation.
- SSRF protection, redirect validation, HTML size limits, timeouts, non-HTML handling, and Gemini failure handling are covered by tests.
- No account or stored data is required.

### Milestone 2: Accounts and projects

Add product identity only after the core audit is dependable.

- Require authentication for saved data; anonymous users may retain only an in-browser one-off report.
- Create an organization automatically for the first user; support one owner and basic membership roles.
- Let users create projects, register pages, manually re-run audits, and browse report history.
- Enforce tenant isolation in API authorization and database RLS tests.
- Add a migration/version field to all persisted reports so scoring and prompt changes remain traceable.

Acceptance criteria:

- A member cannot read or mutate another organization’s data.
- A historical report remains renderable after the audit schema evolves.
- Deleting a project removes its pages, reports, signals, and scheduled work.

### Milestone 3: Continuous monitoring

This is the first paid-product bet.

- Start with weekly scans only, one cadence per plan tier.
- Create an audit run before dispatching work; process fetch, extraction, analysis, persistence, diffing, and alerts as independently retriable workflow steps.
- Alert only when overall score changes by at least 10 points, a new high-severity finding appears, or a monitored page repeatedly fails.
- Deduplicate alerts per page and rule for 24 hours.
- Show score history, category trends, current-versus-previous comparison, and “what changed” findings.

Acceptance criteria:

- A scheduled run survives retry without creating duplicate reports or notifications.
- Alerts identify the affected page, changed category, evidence, and recommended action.
- Failed scans are visible in the product and do not overwrite the last successful report.

### Milestone 4: Collaboration and prioritization

Turn reports into a shared work queue.

- Allow a finding/recommendation to be marked `open`, `in_progress`, `resolved`, or `dismissed`.
- Support assignee, note, tag, and resolution rationale.
- Add project-level views for highest-impact open work, recently regressed pages, and resolved improvements.
- Provide a secure, revocable read-only report share link.

Acceptance criteria:

- Changes are recorded with actor and timestamp.
- Viewers cannot alter work items; members can update only their organization’s work.
- A resolved issue remains visible in report history without changing the original audit output.

### Milestone 5–7: Future Scope

Prioritize these only after monitoring is routinely used:

1. **Slack and webhooks:** deliver score changes and new severe findings to existing workflows.
2. **Analytics context:** import page-level conversion data so recommendations can be prioritized by business impact; always label imported metrics separately from UX inference.
3. **Visual analysis:** Playwright screenshot capture, vision-assisted hierarchy review, visual regression detection, Lighthouse/PageSpeed, and axe accessibility checks.
4. **Commercial controls:** plan limits by monitored pages and audit runs, Stripe checkout/customer portal, usage visibility, and controlled grace periods.
5. **Enterprise controls:** audit logs, configurable data retention, workspace export/deletion, API keys, SSO/SAML only when customer demand justifies it.

## Quality, Security, and Operations

- Preserve the MVP’s outbound-fetch restrictions for every manual and scheduled audit.
- Keep API keys, provider tokens, and webhook secrets server-side; encrypt integration credentials at rest.
- Use signed webhook verification, least-privilege service roles, request/rate limits, and structured audit logs.
- Add error tracking, latency/cost metrics by audit stage, workflow dashboards, and alerts for sustained audit failure rates.
- Use feature flags for monitoring, sharing, integrations, visual analysis, and billing changes.
- Test tenant isolation, role permissions, scheduled-job idempotency, notification deduplication, schema migrations, provider failures, deletion/retention, and existing MVP safety cases.

## Priority Boundaries

**Build now:** foundation and the complete one-off audit MVP.

**Build next:** authentication, projects, saved report history, then weekly monitoring and change alerts.

**Build later:** collaboration, Slack/webhooks, analytics context, screenshot/vision analysis, billing, and enterprise controls.

**Do not build without validated demand:** browser extension, unrestricted crawling, autonomous page changes, full project-management workflows, broad CMS integrations, or a custom ML model.

## Exact First Task

Establish the documentation control plane (`docs/STATUS.md`, `docs/ROADMAP.md`, updated `docs/PLAN.md`, and `docs/DECISIONS.md` D39) reflecting the verified MVP status and Milestone 0 foundation scope before beginning pnpm workspace migration.
