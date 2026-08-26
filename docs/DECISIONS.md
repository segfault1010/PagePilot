# PagePilot — Architectural Decisions

Companion to `docs/PLAN.md`. Decisions are recorded in the order they are made; a later decision must not silently contradict an earlier one.

## D1 — Single Vercel project, no monorepo (Phase 1)

One repository deploys as one Vercel project: static frontend plus serverless API under the same routing model. No workspace/monorepo tooling. This keeps local development and deployment simple, per PLAN.md's summary.

## D2 — Frontend stack: Vite + React + TypeScript + Tailwind CSS (Phase 1)

Vite with the official React plugin and strict TypeScript. Tailwind CSS v4 is wired through `@tailwindcss/vite` (no PostCSS config, no `tailwind.config.js`). No component library, chart library, or UI framework is introduced; the score ring will be CSS/SVG per PLAN.md.

## D3 — API: Express-backed Vercel Node function at `/api/analyze` (Phase 1)

`api/analyze.ts` is a thin adapter from Vercel's Node handler to an Express app created in `src/server/http/app.ts`. All routing and error handling lives in server modules so the deployment entry point stays trivial. The function is configured with a 30-second max duration and `Cache-Control: no-store` on `/api/*` via `vercel.json`.

## D4 — Shared Zod contract (Phase 1)

`src/shared/audit-types.ts` is the single source of truth for the analyze request, report shape, and stable error envelope (`{ code, message, retryable }`). Client and server import the same schemas and inferred types. Stricter Gemini-output validation arrives in Phase 5 inside `src/server/schemas/audit.ts`, built on these shared shapes.

## D5 — Local development via `vercel dev` (Phase 1)

The canonical command is `vercel dev`, which runs the Vite dev server and the local API functions under the deployed routing model. Plain `npm run dev` (Vite only) remains available for pure-frontend work but does not exercise the API route.

## D6 — No database, auth, persistence, or background jobs (Phase 1)

MVP boundary from AGENTS.md and PLAN.md. The service is stateless; the later rate limit will be in-memory per warm instance and is explicitly not an authentication system.

## D7 — Phase 1 API behavior: controlled 501 (Phase 1)

Until the pipeline phases land, `POST /api/analyze` responds `501` with the stable envelope `{ code: "NOT_IMPLEMENTED", message, retryable: false }`. Malformed JSON yields `400 BAD_REQUEST`, unsupported methods yield `405 METHOD_NOT_ALLOWED`, unknown API routes yield `404 NOT_FOUND`. No fetching, extraction, AI calls, or scoring exist yet.

## D8 — Package manager: npm (Phase 1)

No lockfile or manifest existed when the project was initialized; npm was chosen as the lowest-friction default for a single-project Vercel deployment.

## D9 — Testing stack: Vitest + Supertest (Phase 1)

Matches PLAN.md's testing section. React Testing Library and jsdom are deferred until the first phase that renders testable UI behavior. Phase 1 ships only contract unit tests and API-shell integration tests.

## D10 — Environment variables are server-only (Phase 1)

`GEMINI_API_KEY` and `GEMINI_MODEL` are documented in `.env.example`, never prefixed with `VITE_`, never imported by client code, and never committed. Production values are set in the Vercel dashboard.

## D11 — UI testing stack activated: jsdom + Testing Library (Phase 2)

PLAN.md names React Testing Library for form/report/error rendering; jsdom and Testing Library were deferred in D9 until UI behavior existed. They are now added as dev dependencies. UI tests live in `tests/ui/`; API and contract tests stay on the node environment via a per-file environment pragma.

## D12 — Static state flow until the API is wired (Phase 2)

With no backend behavior yet, submitting a valid URL runs the presentational phases from PLAN.md ("Checking URL", "Reading page structure", "Preparing UX audit") and then shows the report view populated with the shared sample fixture, clearly labeled as sample data — it never claims to be a real analysis of the entered URL. The failure state is reachable through a footer preview affordance; Phase 3 replaces that with real API error handling. The client makes no network calls in this phase.

## D13 — Client URL normalization is cosmetic, not security (Phase 2)

Client-side validation only normalizes (scheme defaulting to https://) and checks syntax/supported protocol to give fast inline feedback. All security-relevant rules (private destinations, ports, credentials, redirects) remain server-side and arrive with Phase 3+.

## D14 — Shared URL policy, authoritative server validation, placeholder success (Phase 3)

- `src/shared/url-policy.ts` is the single source for URL rules (absolute http/https only, no credentials, scheme-matched standard ports 80/443). The client uses it for inline feedback; the server enforces it independently — client checks are never trusted.
- Every syntactic/policy URL rejection maps to `400 INVALID_URL` in this phase. `403 BLOCKED_DESTINATION` is reserved for the Phase 4 network-layer destination checks (DNS/IP), which do not exist yet.
- Oversized request bodies map to `413 REQUEST_TOO_LARGE`; wrong methods include an `Allow: POST` header. `422` stays reserved per PLAN.md. Rate limiting (429) and configuration failures (503) are deferred — nothing triggers them yet.
- Valid requests receive `200` with the static sample report from `src/shared/sample-report.ts` (moved there so API and client render identical data). The UI keeps its "sample data" labeling; no real analysis exists until Phase 4–5.
- The client (`features/analysis/api.ts`) posts same-origin to `/api/analyze` with a relative URL and schema-validates both success and error envelopes; malformed payloads and network failures become predictable retryable `ApiError`s. The Phase 2 demo failure affordance was removed now that real errors flow end-to-end.
- `AnalysisLoading` no longer self-completes on timers; it cycles the planned phases and holds, while App drives completion from the actual API response.

## D15 — Vercel runtime body handling and route alignment (Phase 3 verification)

Live `vercel dev` verification exposed two divergences from the Supertest environment:

- **Platform body pre-parsing**: the Vercel Node runtime parses JSON bodies and consumes the request stream before Express runs; its parser rejects malformed JSON with a plain `Error("Invalid JSON")` that lacks body-parser's type marker. The Express app therefore uses the platform-parsed body when present (`normalizePlatformBody`) and falls back to `express.json` for plain Node environments, classifies the platform marker as `400 BAD_REQUEST`, and enforces the 4 KB limit via `Content-Length` when its own parser is skipped. Unexpected errors are logged server-side only (name/message, never stacks) while clients keep receiving the sanitized envelope.
- **Unmatched API routes**: without help, `/api/*` paths other than `/api/analyze` never reach the function and receive Vercel's platform 404 page. A rewrite (`/api/:path*` → `/api/analyze`) routes them into the Express app so every API response uses the stable error envelope, matching tests across environments.

## D16 — Static HTML only; no JavaScript execution (Phase 4)

The pipeline fetches and parses raw HTML exclusively. Target-site JavaScript is never executed: no headless browsers, no Playwright, no screenshots. Anything JavaScript-rendered is invisible to PagePilot by design, and the UI copy must never claim otherwise.

## D17 — SSRF policy: allowlist IP ranges via ipaddr.js, all-records validation (Phase 4)

Destination addresses must be global unicast space (`ipaddr.js` range `unicast` for both IPv4 and IPv6). Loopback, unspecified, RFC1918, CGNAT, link-local/metadata-service (169.254.169.254), multicast, reserved/benchmark blocks, IPv6 loopback/link-local/unique-local, IPv4-mapped, 6to4, and Teredo are all rejected. DNS returns ALL records; if any single record is unsafe the entire destination is rejected (mixed-record rebinding defense). Hostname strings are never trusted — only resolved IPs.

## D18 — Pinned socket connection to eliminate DNS rebinding windows (Phase 4)

Node `fetch` does not pin IP connections across redirects or keepalives. The safe fetch pipeline creates pinned `http.Agent` / `https.Agent` instances that route connections directly to the pre-validated IP address while setting `servername` (TLS SNI) and `Host` headers to the original target hostname. This closes TOCTOU rebinding windows.

## D19 — Manual redirect loop with full hop revalidation (Phase 4)

Automatic fetch redirect following is disabled (`redirect: "manual"`). Each redirect hop (max 3) extracts the `Location` header, resolves relative URLs against the previous hop URL, and runs the entire policy from scratch: URL syntax, standard ports, protocol, all-records DNS resolution, global-unicast IP validation, and connection pinning.

## D20 — Streaming body byte limit with uncompressed counting (Phase 4)

Decoded HTML bodies are capped at 1.5 MB (`MAX_BODY_BYTES = 1_572_864`). Streaming data is intercepted after transport decompression (gzip, deflate, brotli) to defend against compression bombs. Fetch duration is bounded by an 8-second total timeout via `AbortSignal`.

## D21 — Bounded Cheerio extraction & deterministic checks (Phase 4)

Raw HTML is parsed with Cheerio and reduced into a compact `PageSnapshot`:
- Text excerpt capped at 12,000 characters.
- Headings capped at 30 items.
- Sampled links (12), buttons (12), forms (3), CTA candidates (8).
- Deterministic checks generate `DetectedSignal[]` for 7 categories (`pass`, `warn`, `unknown`). Unknown signals carry `0` penalty weight.

## D22 — Structured Gemini audit via responseJsonSchema (Phase 5)

Gemini calls use structured JSON output mode (`responseMimeType: "application/json"`, `responseJsonSchema`). The prompt provides bounded snapshot evidence, heading outline, text excerpt, sample interactive elements, and deterministic signals. The model returns 7 category assessments, top 3 problems, quick wins, and detailed recommendations.

## D23 — Strict two-stage schema validation and signal reference integrity (Phase 5)

Model output is parsed and validated in two stages:
1. `geminiWireAuditSchema` validates wire format (flat tagged findings list, required fields, bounded string lengths).
2. Wire findings are regrouped into domain `CategoryReport` structures.
3. `checkSignalReferences` verifies every cited `signalId` exists in deterministic signals and matches the finding category. Any foreign/fabricated signal ID causes safe rejection (`502 UPSTREAM_FAILURE`).

## D24 — Server-side deterministic + AI scoring arithmetic (Phase 5)

Final scores are computed server-side:
- Deterministic category baselines calculated from pass/warn signal weights.
- When applicable signal coverage is $\ge 40\%$, category scores are blended: $0.60 \times \text{AI} + 0.40 \times \text{Baseline}$.
- Overall score is weighted sum across 7 categories: Clarity (18%), Visual Hierarchy (15%), CTA Effectiveness (15%), Copy (12%), Accessibility (15%), Mobile UX (10%), Trust & Credibility (15%).
- Overall score confidence is conservative (`blended` vs `ai-led`).

## D25 — Accessible UI design system (Phase 2 & Phase 5)

- Pure semantic HTML structure (`<main>`, `<section aria-labelledby>`, `<article>`, `<header>`, `<footer>`).
- Contrast-accessible score rings with distinct visual treatments for passing, warning, and not-measured states.
- Reduced motion support (`prefers-reduced-motion: no-preference` guards, `motion-safe:animate-spin`).
- Loading states use an honest 3-phase cycle with a minimum hold to eliminate UI flashing.

## D26–D38 — Historical Milestone 1 Implementation Decisions

Recorded during MVP phases 1–5 covering error envelopes, rate limiting, logging sanitization, test coverage guarantees, and deployment configuration.

## D39 — Monorepo Architecture & Control Plane Alignment (Milestone 0)

To support the evolution into continuous landing-page UX intelligence (Milestone 2+ accounts, projects, Inngest monitoring, and collaboration):
- **Source of truth control plane**:
  - `docs/STATUS.md` is the ground-truth ledger of verified behavior, test results, active milestone, and exact next task.
  - `docs/ROADMAP.md` tracks milestone progression (`planned|active|complete|deferred`), scope boundaries, and acceptance criteria.
  - `docs/PLAN.md` defines product vision, architecture specifications, and data models.
  - `docs/DECISIONS.md` records immutable architectural, security, persistence, and vendor choices.
- **Gemini model configuration**: The audit adapter defaults to `gemini-3.6-flash` and supports `gemini-3.7-flash` via `GEMINI_MODEL` with low thinking mode (`thinkingLevel: "low"`) to respect the 30-second serverless execution budget.
- **Uncompromised security boundary**: SSRF protections, all-records DNS resolution, global-unicast IP filtering (`ipaddr.js`), connection pinning, manual redirect revalidation, and strict Zod model output validation remain non-negotiable across scheduled runs and future integrations.

## D40 — Shared Contracts Extraction (@pagepilot/contracts) (Milestone 0)

Shared Zod schemas, TypeScript types, machine-readable error codes (`API_ERROR_CODES`), and URL policy validation (`enforceUrlPolicy`) were extracted from `src/shared/` into an isolated workspace package: `packages/contracts/` (`@pagepilot/contracts`).

Key architectural decisions:
- **Clean contract boundary**: `@pagepilot/contracts` contains only runtime-agnostic schemas, domain types, error codes, and pure validation functions. It has zero application or database dependencies and depends only on `zod`.
- **Fixture separation**: Non-contract fixture data (`sampleReport`) was relocated to `src/client/features/analysis/sample-report.ts` and `tests/fixtures/` to ensure the contracts package contains only schema authority, not application mock state.
- **Workspace export structure**: Packaged with `"name": "@pagepilot/contracts"`, ESM module format, TypeScript declarations, and workspace linking (`"@pagepilot/contracts": "workspace:*"`) across consumers.
- **Package-local test suite**: Dedicated contract tests added under `packages/contracts/tests/` verifying schema validation, boundary enforcement, and URL policy correctness independently of root application tests.

## D41 — Isolated Audit Engine Extraction (@pagepilot/audit-engine) (Milestone 0)

The core landing-page audit engine was extracted from `src/server/` into an independent workspace package: `packages/audit-engine/` (`@pagepilot/audit-engine`).

Key architectural decisions:
- **Clean pipeline encapsulation**: `@pagepilot/audit-engine` contains the entire safe analysis pipeline:
  - `src/fetch/`: IP routing policy (`ipaddr.js`), all-records DNS resolver (`dns.lookup`), and SSRF-safe pinned streaming fetcher (`createSafeFetcher`).
  - `src/extract/`: Bounded HTML Cheerio snapshot extractor (`buildPageSnapshot`) and deterministic signal generator (`runDeterministicChecks`).
  - `src/ai/`: Bounded model input serializer (`buildAuditModelInput`) and Gemini structured output adapter (`createGeminiAuditor`).
  - `src/schemas/`: Strict wire and domain audit Zod schemas (`geminiAuditSchema`) and signal-reference integrity checker (`checkSignalReferences`).
  - `src/scoring/`: Deterministic baseline scoring, 60/40 blending arithmetic, and overall report builder (`scoreReport`).
  - `src/pipeline.ts`: Pipeline orchestrator function (`analyzeTarget`) coordinating safe fetch, extraction, checks, AI audit, validation, and scoring into an `AnalysisOutcome`.
- **Pure package boundaries**: `@pagepilot/audit-engine` depends strictly on `@pagepilot/contracts`, `cheerio`, `ipaddr.js`, and `zod`. It has zero Express, HTTP routing, frontend, Supabase, or database persistence dependencies.
- **Node ESM runtime compatibility**: All internal package imports use explicit `.js` specifiers (`./fetch/safe-fetch.js`, `../schemas/audit.js`, etc.) to guarantee seamless Vercel Node serverless and Node ESM execution.
- **Server integration**: `src/server/http/app.ts` imports `analyzeTarget` and `AnalysisOutcome` from `@pagepilot/audit-engine`, eliminating duplicate server logic in the root codebase.
- **Independent test suite**: 9 package-level test suites containing 119 unit and pipeline tests live under `packages/audit-engine/tests/` alongside HTML and Gemini fixtures.

## D42 — Monorepo Application Migration (apps/web & apps/api) (Milestone 0)

Frontend client code and HTTP API server code were migrated into their target monorepo application packages: `apps/web/` (`@pagepilot/web`) and `apps/api/` (`@pagepilot/api`).

Key architectural decisions:
- **Frontend package (`apps/web`)**:
  - Contains Vite + React 19 + TypeScript + Tailwind CSS v4 client application (`src/App.tsx`, `src/main.tsx`, `src/index.css`, `src/features/analysis/`).
  - Contains package-local tests (`apps/web/tests/`, 7 test files, 66 tests) covering UI rendering, form submission, loading states, error states, and reduced motion.
  - Strictly depends only on `@pagepilot/contracts` (no server dependencies, no secrets, no audit engine).
  - Builds static production bundle directly to `apps/web/dist/`.
- **Backend API package (`apps/api`)**:
  - Contains Express HTTP API application (`src/http/app.ts`, `src/index.ts`, `api/analyze.ts`).
  - Contains package-local integration tests (`apps/api/tests/`, 2 test files, 23 tests) covering request validation, error envelopes, rate limiting, and the full pipeline.
  - Strictly depends on `@pagepilot/contracts` and `@pagepilot/audit-engine`.
- **Thin Vercel adapter at root**:
  - `api/analyze.ts` remains at root as a minimal pass-through importing `createApp` from `@pagepilot/api`.
  - `vercel.json` configures `buildCommand: "pnpm --filter @pagepilot/web build"` and `outputDirectory: "apps/web/dist"`, guaranteeing 100% deployment parity on Vercel.
- **Clean directory state**:
  - Obsolete root `src/` and `tests/` directories were completely removed after all 224 workspace tests, builds, and live Gemini verifications passed.
  - Root `package.json` coordinates all workspace packages with zero duplicate source files.
