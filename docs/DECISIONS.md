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

## D18 — Pinned connections with preserved Host/SNI (Phase 4)

`node:http(s).request` is used with a custom `lookup` that hands Node exactly one pre-validated address; the hostname stays intact for the Host header and TLS SNI, so the socket can only connect to an address that just passed validation — closing the validate-then-connect rebinding window. Runtime notes from live verification: Node ≥ 20 runs autoSelectFamily (happy eyeballs) and calls `lookup` with `all = true`, expecting an array of records; the pin honors both callback shapes but always yields only the validated address. Because a single pinned address disables happy-eyeballs racing, a slow network path can consume the whole eight-second budget where a dual-stack race might have connected faster — an accepted security-for-latency trade-off. Defense-in-depth: validation also happens before `openStream` is invoked, independent of the lookup hook.

## D19 — Redirects are manual and fully revalidated (Phase 4)

Automatic redirects are disabled. Up to three hops follow only after each destination passes URL policy, fresh DNS resolution, and IP-range checks. Redirect targets are never echoed to clients on failure.

## D20 — Fetch limits: 1.5 MB / 8 s / 3 redirects (Phase 4)

Decoded HTML is capped at 1.5 MB (counted while streaming, post-decompression; early rejection when Content-Length already exceeds the cap), total wall-clock deadline of eight seconds across redirects and body, maximum three redirect hops. Oversize → 413 PAGE_TOO_LARGE; deadline abort → retryable 504 TIMEOUT; non-2xx/unreachable targets → retryable 502 UPSTREAM_FAILURE. gzip/deflate/brotli responses are decompressed before size accounting.

## D21 — Content-type gate before download (Phase 4)

Only `text/html` and `application/xhtml+xml` (both safely parseable by Cheerio) are accepted; anything else — including missing content-type — is rejected with 422 NON_HTML_RESPONSE before the body is read.

## D22 — PageSnapshot design (Phase 4)

`buildPageSnapshot` (Cheerio) produces a bounded, deterministic object: metadata (title, description, canonical, viewport, capped Open Graph fields, lang), heading outline (≤30 entries) with warnings, whitespace-normalized visible text excerpt capped at 12,000 characters, limited samples (links ≤20, buttons ≤15, forms ≤10, nav ≤10, CTAs ≤12), image counts with alt-attribute coverage, and region counts. Raw HTML never leaves this module and never reaches any AI layer or the client. CTA detection is deliberately conservative evidence (buttons, submit inputs, action-phrase anchors), never a claim about visual prominence.

## D23 — Deterministic signals as the shared contract type (Phase 4)

`runDeterministicChecks` emits `DetectedSignal[]` straight from `src/shared/audit-types`, giving stable IDs (`title.present`, `headings.order`, …), categories matching the seven audit categories, bounded weights, plain-language evidence, and `unknown` status whenever HTML cannot establish an answer (unknowns never penalize). Phase 5 will compute per-category deterministic baselines from these weights and blend them with Gemini scores (0.60/0.40 when coverage ≥ 40%).

## D24 — Phase 4 API boundary (Phase 4)

On success the endpoint still returns the contract-shaped placeholder report (scores remain sample data until Phase 5) but now carries the page's REAL deterministic signals in `observedSignals`, and failures surface real classified statuses (403/413/422/502/504). The client banner states that scores are placeholders while observed signals are measured live. The pipeline is injected into `createApp({ analyzeUrl })` so tests stub it without network access.

## D25 — Gemini adapter isolation; plain fetch, no SDK (Phase 5)

All provider-specific logic — endpoint URL, prompts, generation config, timeout, response parsing — lives in `src/server/ai/gemini-auditor.ts` behind a one-method `UxAuditProvider` interface. The REST `generateContent` endpoint is called with the platform `fetch` instead of adding an SDK dependency: the adapter is small, mocking is trivial, and no transitive dependency risk is introduced. `GEMINI_API_KEY`/`GEMINI_MODEL` are read only inside this module at request time (lazy, so serverless env injection order cannot matter); neither value nor any model input/output crosses the module boundary except the validated result.

## D26 — Structured output via responseJsonSchema derived from Zod (Phase 5)

Gemini is constrained at generation time with `responseMimeType: application/json` plus `responseJsonSchema`, generated from the Zod wire schema (`z.toJSONSchema`, with keywords Gemini rejects or ignores stripped). The Zod schemas remain the authority: generation constraints guide the model, validation rejects it. Generation limits (`maxOutputTokens: 8192`, `temperature: 0.2`, 22 s client-side deadline) keep responses bounded within the 30 s function budget. No throughput retry — one bounded compatibility fallback exists only when a model generation rejects the thinking settings (HTTP 400), retried once without them.

## D26a — Live-verified Gemini API constraints shape the wire contract (Phase 5)

Live probing against `generativelanguage.googleapis.com/v1beta` surfaced undocumented restrictions that the adapter accommodates; each was confirmed by controlled request bisection:

- **Arrays of objects may not nest inside arrays of objects.** A generation schema with `categories[].findings[]` is rejected as 400 INVALID_ARGUMENT while every section in isolation passes. Findings are therefore generated as ONE flat top-level list tagged with `categoryKey`; `parseGeminiAuditOutput` groups them back under categories before the strict domain re-validation. Consumers only ever see the grouped domain type.
- **Large `maxItems` on object arrays is rejected** (maxItems 6 failed where maxItems 3 passed). All `minItems`/`maxItems` are stripped from the generation schema; exact cardinalities (7 categories, exactly 3 top problems, ≤3 findings/category, 3–5 quick wins) are stated in the prompt and enforced authoritatively by Zod after parsing.
- **`systemInstruction` combined with structured output is rejected.** The identical rule text in the user turn is accepted, so prompt rules travel in the user message.
- **String-length keywords are unsupported** by the response JSON Schema subset and are stripped; bounds enforced post-parse.

Default model is `gemini-3.6-flash` (`gemini-2.5-flash` returns 404 "no longer available to new users"). Gemini 3.x models run with `thinkingConfig.thinkingLevel: "low"` — default thinking regularly exceeded the latency budget under free-tier load — with the single no-thinking fallback from D26 covering any model that rejects the field.

## D27 — Model input is a bounded evidence pack, never HTML (Phase 5)

`src/server/ai/audit-input.ts` builds a compact JSON object from PageSnapshot + deterministic signals (metadata, heading outline, ≤4000-char visible-text excerpt, capped link/button/form/nav/CTA samples, image alt statistics, viewport/lang/canonical/OG facts, signals with evidence). Every variable-length field is truncated before serialization, with a hard serialized-size cap as a final gate. Raw HTML, cookies, request headers, DNS/IP details, and upstream response data are structurally absent from this type — they exist nowhere between the fetch layer and the adapter.

## D28 — Strict Zod gate on all model output (Phase 5)

`src/server/schemas/audit.ts` defines the strict Gemini audit schema: exactly seven unique category keys, integer scores 0–100, closed severity/basis/category enums, bounded string lengths, max three findings per category, exactly three top problems, 3–5 quick wins, 1–10 detailed recommendations, strict-object rejection of unknown keys. No best-effort repair: any violation rejects the whole response and maps to the generic retryable `502 UPSTREAM_FAILURE` envelope. The pipeline re-validates the audit defensively even when the provider already validated, so nothing malformed can reach scoring from any source.

## D29 — Signal references validated against the analyzed page's signal set (Phase 5)

Every `signalIds` entry referenced by findings/top problems must exist in the deterministic signal set produced for THIS analysis. Unknown or foreign IDs reject the whole audit (safe generic failure, logged server-side by count only). This preserves the observed/inferred distinction: "observed" claims must be anchored in real measured evidence, while "inferred" marks professional interpretation.

## D30 — Deterministic baselines, 60/40 blending, ai-led fallback (Phase 5)

Per category: applicable (pass/warn) weighted signals produce a baseline (pass = full credit, warn = 0.5 partial credit; unknowns excluded from both points and denominator, so they never penalize). When applicable weight covers ≥ 40% of the category's emitted signal weight, `categoryScore = round(0.60 × Gemini + 0.40 × baseline)` and confidence is "blended"; otherwise the Gemini score stands alone ("ai-led"). Report-level confidence is conservative: blended only when every category blended. All scoring lives in `src/server/scoring/score-report.ts` and is fully deterministic.

## D31 — overallScore computed server-side only (Phase 5)

The overall score is the PLAN-defined weighted sum of FINAL post-blend category scores (clarity .18, visualHierarchy .15, ctaEffectiveness .15, copy .12, accessibility .15, mobileUx .10, trustCredibility .15), rounded and clamped to 0–100 as a defensive invariant. The Gemini schema contains no overall-score field, so the model structurally cannot control it. `buildReport` transforms audit + signals + snapshot into the existing API report contract field-by-field and re-validates against `reportSchema` before returning.

## D32 — AI failure taxonomy maps to four safe envelopes (Phase 5)

Missing/rejected key → non-retryable `503 MISSING_CONFIGURATION`; provider/network unavailability and blocked completions → retryable `502 UPSTREAM_FAILURE`; deadline exceeded → retryable `504 TIMEOUT`; malformed/schema-invalid output or invalid signal references → retryable `502 UPSTREAM_FAILURE`. No new error codes were needed, so the frontend error-copy mapping stays untouched. Server logs carry classification data only (failure kind, HTTP status, zod issue path) — never prompts, raw responses, stack traces, or credentials.

## D33 — Mocked-first verification strategy (Phase 5)

The automated suite never touches live Gemini: tests inject fake `UxAuditProvider`s into the pipeline and mock the adapter's `fetchFn` for HTTP-level behavior; safe-fetch is module-mocked for end-to-end pipeline integration. One manual live verification via `vercel dev` with real credentials confirms the configured model, structured-output compatibility, and secret hygiene; its steps are recorded here but its credentials never leave the local `.env`.

## D34 — Phase 5 live verification record (Phase 5)

Performed against the real Gemini API with `GEMINI_API_KEY` from local `.env`, model `gemini-3.6-flash`:

- **Real adapter success:** two complete audits returned by the unmodified `createGeminiAuditor` module — structured output validated through `parseGeminiAuditOutput`, seven categories scored, findings tagged and grouped, signal references limited to real deterministic IDs (`title.present` etc.), observed/inferred bases present.
- **Live failure mapping through `vercel dev`:** provider overload (`503`) surfaced as retryable `502 UPSTREAM_FAILURE`; AI deadline overrun surfaced as retryable `504 TIMEOUT`; missing key verified live as non-retryable `503 MISSING_CONFIGURATION`. Client responses carried only the stable envelope; server logs contained classification lines only (`kind=… status=…`) — no prompts, responses, or credentials. The API key value was grep-verified absent from all logs.
- **Pending at phase close:** one successful `200` response from `/api/analyze` itself. The free tier enforces a per-model daily cap (`GenerateRequestsPerDayPerProjectPerModel-FreeTier`, 20 requests/day/model) and both tested model buckets were consumed by diagnostic bisection before a full request landed. Re-run after quota reset with `npm run verify:gemini` — it starts `vercel dev` on a private port, sends exactly ONE real analysis of a known-safe public page, validates the full report contract, classifies any failure (local configuration / auth / quota / unavailable / malformed / app bug), prints only sanitized diagnostics, and exits non-zero unless the contract-valid report arrives.

## D35 — ESM .js extensions for Vercel Node runtime (Phase 8)

Production deployment failed with `ERR_MODULE_NOT_FOUND: Cannot find module '/var/task/src/server/http/app'`. The package has `"type": "module"` and `module: ESNext`; Node ESM requires explicit file extensions, but server imports were extensionless (`../src/server/http/app`). Vercel's `@vercel/node` builder traces `api/analyze.ts` and copies `src/` files separately — compiled JS keeps specifiers verbatim, so extensionless imports fail at runtime while tests (Vitest/bundler) tolerate them.

Fix: all server and shared relative imports now use `.js` extensions (`../src/server/http/app.js`, `../../shared/audit-types.js`, etc.). TypeScript `module: ESNext` + `moduleResolution: bundler` + `noEmit: true` resolves `.js` → `.ts` during typecheck, and the emitted JS retains `.js` for Node. Client imports stay extensionless (Vite handles both). No `allowImportingTsExtensions` needed. Verified: `npm run typecheck`, `npm test`, `npm run build` still pass, and the deployed function loads.

## D36 — Lightweight per-IP throttle (Phase 8)

PLAN and AGENTS require 5 requests per 10 minutes per warm instance as cost protection. Prior phases deferred it (`NOT_IMPLEMENTED`). Phase 8 adds it in `src/server/http/app.ts` as a per-`createApp()` in-memory Map (one per warm Lambda, cold starts reset). IP extraction: `x-forwarded-for` (first) → `x-real-ip` → `req.ip` → `socket.remoteAddress`. Exceeding returns `429 RATE_LIMITED` (`retryable: true`). Isolation per `createApp()` keeps existing integration tests independent (each test creates a fresh app). Live 429 is not forced in production to avoid disrupting the deployed service; it is covered by dedicated unit/integration tests and documented as such. Documented in README with verification note.

## D37 — Production verification and artifact hygiene (Phase 8)

Pre-deploy review confirmed: real Phase 5 pipeline (not sample-report) serves `POST /api/analyze`; landing preview remains the only sample-data usage (labeled). API contracts, Gemini server-only credentials, SSRF protections, and error envelopes unchanged. `.env` stays gitignored, `.vercel` ignored, `.env.example` placeholders only, no secret committed, no debug logs, no `payload.json` or temp artifacts committed (payload removed from tracking, `.gitignore` updated). `vercel.json` verified (`vite` build, `dist` output, `/api/:path*` rewrite, `maxDuration:30`, `Cache-Control: no-store`). Production build inspected: `dist/index.html` has no `@react-refresh`/`data-vite-dev-id`, no `GEMINI_API_KEY`/`localhost`/`127.0.0.1`, correct meta/title/assets.

## D38 — Final MVP scope (Phase 8)

Phase 8 is deployment/polish only. No stretch features added: no Playwright, screenshots, Lighthouse, PDF export, sharing/history, auth, database, analytics, payments, notifications. `docs/PLAN.md` remains the source of truth; README now documents setup, `vercel dev`, env vars, testing, deployment, security boundary, and limitations (static HTML only, AI-led vs blended scoring). The MVP acceptance criterion is a deployed URL that analyzes a safe public page and returns a schema-valid report while unsafe destinations remain safely handled.

## D39 — Post-MVP Monorepo and Documentation Control Plane (Milestone 0)

Following completion and production verification of the single-project MVP (D1–D38), PagePilot is evolving to continuous landing-page UX intelligence for growth teams.

Key architectural and governance decisions:
- **Preserve working MVP**: The existing single-project MVP remains fully operational, deployed, and verified with 216 passing tests. It must not be broken or casually rewritten.
- **Incremental workspace migration**: Target architecture moves to a pnpm workspace (`apps/web`, `apps/api`, `packages/contracts`, `packages/audit-engine`, `packages/workflows`) through isolated verification gates (contracts → audit-engine → web/api) to eliminate deployment risks.
- **Living document control plane**:
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
