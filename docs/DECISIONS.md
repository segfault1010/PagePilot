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




