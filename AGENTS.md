# PagePilot — Agent Instructions

## 1. Project Mission

PagePilot is evolving from a one-off AI landing-page auditor into:

> Continuous landing-page UX intelligence for growth teams.

The product should help teams:
- monitor important pages
- detect meaningful UX regressions
- prioritize findings
- turn findings into actionable work
- receive useful alerts
- retain trustworthy historical evidence

The original one-off audit remains the core analysis engine.

---

## 2. Source of Truth

Use these files as the project control plane:

- `docs/STATUS.md` — verified current state, known issues, exact next task
- `docs/ROADMAP.md` — milestones, dependencies, acceptance criteria, deferred scope
- `docs/DECISIONS.md` — architecture, security, retention, vendor, and product decisions

Rules:

- `ROADMAP.md` defines what should be built.
- `STATUS.md` defines what is actually verified.
- `DECISIONS.md` explains why important choices were made.
- Never claim a feature is complete based only on code existing.
- Update `STATUS.md` after each milestone.
- Update `ROADMAP.md` when milestone status changes.
- Record meaningful architectural/security/vendor decisions in `DECISIONS.md`.

If implementation and documentation disagree:
1. inspect the code and tests
2. determine the verified behavior
3. resolve the discrepancy explicitly
4. update the appropriate document

Never silently rewrite the roadmap to match an incomplete implementation.

---

## 3. Architecture

Target workspace:

apps/
  web/                 # React + TypeScript + Vite + Tailwind
  api/                 # Express API exposed through Vercel Node functions

packages/
  contracts/           # Zod schemas + shared API/report types
  audit-engine/        # safe fetch + extraction + checks + scoring + Gemini adapter
  workflows/           # durable audit + alert + notification workflows

docs/
  STATUS.md
  ROADMAP.md
  DECISIONS.md

Use a pnpm workspace.

Keep package responsibilities explicit.

### Dependency direction

Preferred:

apps/web
  → packages/contracts

apps/api
  → packages/contracts
  → packages/audit-engine
  → packages/workflows

packages/workflows
  → packages/contracts
  → packages/audit-engine

packages/audit-engine
  → packages/contracts

`packages/contracts` must not depend on application packages.

Avoid circular dependencies.

Do not put product-specific persistence logic into `audit-engine`.

---

## 4. Existing MVP Must Remain Stable

The MVP analysis engine is security-sensitive and must remain behaviorally correct while the product expands.

Core pipeline:

public URL
→ safe static fetch
→ PageSnapshot
→ deterministic checks
→ Gemini structured audit
→ validated report
→ server-side scoring

Never bypass the existing safety boundary to make a new feature easier.

Scheduled audits, manual audits, and future integrations must use the same safe audit engine.

Do not create a second insecure fetch implementation.

---

## 5. Phase / Milestone Discipline

Implement one milestone or clearly bounded task at a time.

Before coding:

1. Read `docs/STATUS.md`
2. Read relevant section of `docs/ROADMAP.md`
3. Read relevant decisions in `docs/DECISIONS.md`
4. Inspect existing implementation
5. Identify dependencies and acceptance criteria

Do not implement future milestones opportunistically.

For every task:

- define scope
- implement
- test
- verify
- update docs if needed
- review diff
- then commit

Stop when the requested milestone/task is complete.

---

## 6. Definition of Done

A feature is not complete merely because:
- the code compiles
- a component exists
- a migration exists
- a workflow is registered

A feature is complete only when its acceptance criteria are verified.

Default completion gates:

- typecheck passes
- focused tests pass
- relevant full tests pass
- production build passes where applicable
- security/authorization tests pass where applicable
- integration behavior is verified
- logs/errors are checked
- documentation/status updated
- no unrelated scope was introduced

For production-impacting changes, include an appropriate smoke test.

Never claim "complete" without evidence.

---

## 7. Multi-Tenant Security

Tenant isolation is a first-class security boundary.

Persisted tenant-owned data includes concepts such as:

- organization
- membership
- profile
- project
- monitored_page
- audit_run
- audit_report
- score_snapshot
- finding
- recommendation
- alert_rule
- alert_delivery
- integration_connection

Every tenant-owned table must have explicit RLS policies.

Every API authorization path must enforce organization/project membership.

Do not rely only on:
- frontend filtering
- hidden UI
- request parameters
- organization IDs supplied by clients

Always derive and verify authorization server-side.

Roles:

- owner
- admin
- member
- viewer

Respect role boundaries.

Examples:

- viewer → read-only where specified
- member → organization-scoped product actions
- admin → administrative organization/project actions
- owner → ownership-level controls

Any new mutation must include an authorization test.

---

## 8. Supabase Rules

Use Supabase Auth and Postgres as specified by the roadmap.

Requirements:

- migrations are source-controlled
- RLS is explicit
- policies are tested
- service-role access is never exposed to the browser
- server-side privileged operations are narrowly scoped
- tenant boundaries are enforced at the database and API layers

Never solve an RLS problem by disabling RLS.

Never use service-role credentials in client code.

When adding persisted reports, preserve historical renderability.

Every persisted report schema must be versionable.

---

## 9. Historical Report Immutability

Audit history is evidence.

When an audit completes:

- preserve the original report output
- preserve score/category values
- preserve relevant model/check versions
- preserve audit timing/status metadata

Do not mutate historical report content just because:
- prompts change
- scoring changes
- deterministic checks change
- models change

New analysis produces a new audit/report version.

Historical reports must remain renderable after schema evolution.

Use explicit migration/version fields.

---

## 10. Audit Engine Rules

`packages/audit-engine` is the source of truth for analysis behavior.

It must remain:

- deterministic where possible
- bounded
- testable
- independently runnable
- independent of UI concerns

Never place React/UI code in the audit engine.

Never make the audit engine depend directly on Supabase user-session state.

Input should be explicit.

Output should be schema-validated.

---

## 11. SSRF / Outbound Fetch Rules

Preserve all existing MVP protections.

User-controlled URLs are untrusted.

Only allow:
- `http`
- `https`

Enforce:
- absolute URLs
- no credentials
- ports limited to 80/443
- DNS/IP validation
- global-unicast-only destination policy
- mixed-record rejection
- pinned validated connection behavior
- manual redirect handling
- redirect revalidation
- bounded body size
- bounded fetch time
- content-type validation

Never reimplement these rules casually.

Do not weaken protection because a scheduled job or integration needs access.

Scheduled audits must use the same safe fetch boundary as manual audits.

Never:
- execute arbitrary target JavaScript in the safe HTML pipeline
- expose raw HTML
- expose DNS/IP details
- expose upstream headers
- expose provider errors
- expose secrets

Browser/screenshot analysis is a separate later pipeline.

---

## 12. AI / Audit Provider Rules

Gemini remains behind a replaceable provider interface:

`AuditProvider`

Do not couple product features directly to Gemini.

The provider layer must:

- use structured output
- validate model output with Zod
- reject malformed output
- validate signal references
- bound strings and arrays
- distinguish observed vs inferred
- avoid raw HTML prompts
- avoid unsupported claims
- keep provider credentials server-side

Never trust model output.

The model cannot directly set:
- final overall score
- tenant identity
- permissions
- alert decisions
- persistence IDs

Server-side code owns those decisions.

Provider changes must be versioned and traceable.

Record model/check/prompt versions in audit metadata where appropriate.

---

## 13. Scoring Rules

Scoring is server-owned.

Preserve:
- bounded category scores
- deterministic baseline
- unknown signals excluded from penalties
- blended vs ai-led confidence
- server-calculated overall score

Do not modify scoring weights casually.

Any scoring change requires:
- decision entry
- regression tests
- historical compatibility consideration
- explicit roadmap/status impact

Do not silently change historical scores.

---

## 14. Audit Run Model

Every audit should have an explicit run identity.

An `audit_run` should distinguish:

- manual vs scheduled invocation
- status
- timing
- model/check versions
- retry metadata

Suggested conceptual lifecycle:

requested
→ queued
→ running
→ completed

or:

requested
→ queued
→ running
→ failed

Do not overwrite the previous successful report when a newer run fails.

The latest successful report remains the valid current report.

---

## 15. Workflows / Inngest

Use Inngest for durable workflows as specified by the roadmap.

Workflow steps should be:

- independently retriable
- bounded
- idempotent
- observable
- safe to replay

Every workflow must use the `audit_run` ID as its idempotency anchor.

Scheduled jobs can overlap.

Assume duplicate delivery can happen.

Never create duplicate:
- audit reports
- alerts
- notifications
- work items

before checking idempotency.

Prefer small workflow steps over one giant function.

Example audit workflow concept:

request
→ create audit_run
→ fetch
→ extract
→ deterministic checks
→ AI audit
→ persist report
→ calculate diff
→ evaluate alerts
→ request delivery

Do not combine unrelated durable steps into a single opaque operation.

---

## 16. Monitoring Milestone Rules

The first monitoring milestone starts with weekly scans.

Do not add daily/custom schedules prematurely.

Monitor:

- important page
- latest successful score
- current score
- score difference
- category changes
- finding changes
- scan failures

Alert only on defined meaningful changes.

Default alert triggers:

- overall score drops by at least 10 points
- new high-severity finding
- repeated scan failure

Deduplicate alerts per page/rule for 24 hours.

A failed scan must not replace the last successful report.

---

## 17. Collaboration Rules

Work items derived from findings may use:

- open
- in_progress
- resolved
- dismissed

Every mutation should record:
- actor
- timestamp
- organization
- relevant entity

Resolution must not mutate the original audit report.

Do not turn PagePilot into a full project-management system.

Keep collaboration centered on UX findings and recommendations.

---

## 18. Integrations

Integrations are server-side concerns.

For Slack/webhooks/future analytics:

- credentials remain server-only
- secrets are encrypted at rest where persisted
- webhook signatures are verified
- least-privilege access is preferred
- outbound failures are retryable where appropriate
- delivery must be idempotent
- delivery history should be observable

Never trust inbound webhook payloads without signature verification.

Never store integration credentials in plaintext.

Do not build integrations before the roadmap milestone calls for them.

---

## 19. Feature Flags

Use feature flags for major staged capabilities such as:

- monitoring
- sharing
- integrations
- visual analysis
- billing

Flags should support safe rollout.

Do not scatter raw environment checks throughout the codebase.

Prefer centralized feature-flag evaluation.

Disabled features should fail closed.

---

## 20. Billing Rules

Stripe is deferred until paid monitoring demand is validated.

Do not add billing because it is technically easy.

When billing eventually starts:

- subscription state is server-owned
- webhook events are verified and idempotent
- usage is separately tracked
- grace periods are explicit
- plan limits are enforced server-side

Billing must not become a prerequisite for collaboration or monitoring milestones.

---

## 21. Visual / Deep Analysis Boundary

Screenshot/vision analysis, Lighthouse/PageSpeed, axe, and visual regression are later milestones.

When introduced:

- keep them in a separate pipeline
- do not replace the safe static-HTML engine
- clearly label measured vs inferred evidence
- preserve the existing report contract through versioned extensions

Do not claim a screenshot-based observation from HTML-only analysis.

Do not claim HTML-derived metrics are browser-rendered measurements.

---

## 22. Data Retention

Default retention for compact audit data:

90 days initially.

Store normalized extracted signals and reports by default.

Do not retain full raw HTML unless explicitly justified by a later product requirement and documented.

Project deletion must remove:

- pages
- reports
- signals
- scheduled work
- alerts
- related tenant data

Retention and deletion behavior must be tested.

---

## 23. Events

Use these internal product events:

- `audit.requested`
- `audit.completed`
- `audit.failed`
- `score.changed`
- `finding.detected`
- `alert.delivery.requested`

Events should be:
- structured
- versionable
- tenant-scoped where appropriate
- safe to replay

Do not put sensitive credentials or raw HTML into events.

---

## 24. Logging / Observability

Use structured logs.

Logs should help answer:

- which audit failed?
- which stage failed?
- how long did it take?
- which provider/model was used?
- was the failure retryable?
- was an alert delivered?

Never log:
- API keys
- webhook secrets
- raw HTML
- credentials
- full sensitive request bodies
- internal IP/DNS information unless explicitly required and access-controlled

Add stage-level latency/cost metrics when the roadmap requires observability.

---

## 25. Error Handling

Use stable machine-readable error codes and safe user-facing messages.

Errors should distinguish:
- client validation
- authorization
- not found
- blocked destination
- oversized input
- upstream failure
- provider failure
- timeout
- configuration
- rate limiting

Never expose stack traces or provider internals to clients.

Retry only when the operation is genuinely retryable.

Never retry blindly.

---

## 26. Testing Strategy

Use focused tests at the appropriate layer.

### Unit
- contracts
- scoring
- URL policy
- IP policy
- extraction
- deterministic signals
- authorization helpers
- diffing
- alert evaluation

### Integration
- API
- Supabase/RLS
- workflow handlers
- report persistence
- alert persistence
- deletion behavior

### UI
- authentication flows
- project/page management
- report rendering
- monitoring trends
- finding workflows
- role visibility
- recovery states

### Security
Always test:
- tenant isolation
- role permissions
- SSRF
- redirects
- rate limits
- secret boundaries
- webhook signature verification
- deletion/retention

### Workflow
Always test:
- duplicate delivery
- retry
- idempotency
- alert deduplication
- failed scan preserving last success

Do not make tests depend unnecessarily on live third-party APIs.

Mock external services wherever practical.

Keep at least one controlled live smoke test for critical provider/deployment verification.

---

## 27. Database Changes

For every schema change:

1. create a migration
2. update contracts/types
3. add/update RLS
4. add indexes based on actual query needs
5. add tests
6. verify backward compatibility where historical data exists
7. update `DECISIONS.md` if the architecture changes

Never edit production schema manually when a migration should exist.

---

## 28. API Design

Prefer:
- explicit request schemas
- explicit response schemas
- stable error envelopes
- server-side authorization
- idempotency where mutation/workflow duplication is possible

Do not let frontend assumptions define backend truth.

Keep API handlers thin.

Business logic belongs in appropriate packages/services.

---

## 29. Frontend Rules

Frontend responsibilities:

- presentation
- interaction
- client-side validation
- authenticated UX
- status/report rendering
- progressive loading

Frontend must not own:
- authorization
- tenant isolation
- scoring authority
- secret handling
- provider credentials

Do not duplicate important business rules only in the browser.

Maintain:
- semantic HTML
- keyboard accessibility
- visible focus
- reduced-motion support
- responsive layouts
- honest loading states
- explicit empty/unknown states

---

## 30. Dependencies

Before adding a dependency ask:

1. Is it required by the roadmap?
2. Can existing project code solve it cleanly?
3. Does it increase security/maintenance burden?
4. Does it belong in the correct package?
5. Is it justified for the current milestone?

Do not add dependencies speculatively.

Avoid duplicate libraries solving the same problem.

---

## 31. Scope Control

Do not build without validated demand:

- browser extension
- unrestricted crawling
- autonomous page changes
- full project-management replacement
- broad CMS integrations
- custom ML model

Do not implement future milestone features just because the architecture could support them.

Prefer finishing the smallest complete milestone.

---

## 32. Git Workflow

Use focused commits.

Examples:

- `feat: add organization membership`
- `feat: persist audit reports`
- `feat: add weekly audit workflow`
- `feat: add score regression alerts`
- `fix: enforce project membership authorization`

Avoid giant mixed commits.

Before committing:

- inspect `git diff`
- run relevant tests
- verify no secrets/artifacts
- verify generated files are intentionally tracked

Never commit:
- `.env`
- credentials
- API keys
- temporary payloads
- local logs
- `.vercel`
- build artifacts unless intentionally required

---

## 33. Documentation Workflow

After each meaningful milestone:

### Update `docs/STATUS.md`
Include:
- current milestone
- verified behavior
- known issues
- exact next task

### Update `docs/ROADMAP.md`
Update milestone:
- planned
- active
- complete
- deferred

### Update `docs/DECISIONS.md`
Record:
- architectural choices
- vendor changes
- security decisions
- retention policy changes
- schema strategy
- workflow semantics
- major scoring/provider changes

Documentation must describe verified behavior, not intended behavior.

---

## 34. Agent Working Style

Before changing code:

- inspect nearby code
- inspect related tests
- inspect contracts
- inspect docs
- identify blast radius

While coding:

- prefer small composable modules
- preserve existing abstractions
- avoid speculative refactors
- avoid unrelated formatting changes
- do not silently change public contracts

After coding:

1. typecheck
2. focused tests
3. full relevant tests
4. build
5. integration/smoke verification
6. review diff
7. update docs

Then stop.

---

## 35. Never Do These

- Never expose secrets to the client.
- Never bypass RLS.
- Never trust client-supplied organization ownership.
- Never weaken SSRF protections.
- Never execute arbitrary target JavaScript in the safe audit pipeline.
- Never trust raw model output.
- Never mutate historical reports silently.
- Never create duplicate workflow side effects.
- Never overwrite the last successful audit with a failed run.
- Never claim measurements the system did not actually make.
- Never add stretch work before the current milestone passes.
- Never claim completion without verification.

---

## 36. Preferred Task Prompt Pattern

When implementing a roadmap task, expect prompts like:

"Implement the next task from docs/STATUS.md and docs/ROADMAP.md.

Follow AGENTS.md.

Stay within the current milestone.
Inspect existing architecture first.
Implement only the requested scope.
Run focused tests, full relevant tests, typecheck, and build.
Update STATUS.md and DECISIONS.md only where required.
Review the diff.
Stop when the acceptance criteria are satisfied."

---

## 37. Project North Star

Every feature should strengthen this product loop:

Monitor
→ detect
→ explain
→ prioritize
→ act
→ measure change

PagePilot is not just an AI report generator.

The long-term product is a trustworthy system for continuous UX intelligence.

Optimize for:
- trustworthy evidence
- safe automation
- clear ownership
- durable history
- useful alerts
- actionable work
- measurable change