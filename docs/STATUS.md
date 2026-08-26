# PagePilot — Current Status

**Last Updated:** August 2026  
**Current Milestone:** Milestone 0 — Product Foundation & Monorepo Setup (Active)  
**Previous Milestone:** Milestone 1 — Core Audit MVP (Complete & Verified)

---

## 1. Verified Current State

The PagePilot core landing-page audit MVP is **fully implemented, tested, and verified in production**.

### Verified Capabilities
- **Public URL Submission:** Client-side URL normalization, inline feedback, and same-origin API dispatching.
- **Safe Outbound Fetch (SSRF-Safe):**
  - Protocol restricted to `http:` / `https:`, ports `80` / `443` only.
  - DNS resolution of all records (`dns.lookup(all: true)`); rejection of mixed safe/unsafe addresses.
  - Global-unicast IP allowlist using `ipaddr.js` (blocking loopback, RFC1918, CGNAT, link-local, cloud metadata `169.254.169.254`, IPv6 equivalents).
  - Pinned socket connections preserving Host header and TLS SNI to eliminate DNS rebinding windows.
  - Manual redirect handling (max 3 hops) with full re-validation of URL policy, DNS, and IP on each hop.
  - Hard streaming limit of 1.5 MB decoded HTML (gzip/deflate/brotli decompressed before size check).
  - 8-second total fetch deadline including DNS resolution.
  - Content-type gate restricting downloads to `text/html` and `application/xhtml+xml`.
- **Deterministic Page Snapshot & Signals:**
  - Bounded Cheerio extraction producing `PageSnapshot` (metadata, heading outline $\le 30$, text excerpt $\le 12,000$ chars, link/button/form/CTA samples, image alt stats).
  - Deterministic checks emitting `DetectedSignal[]` for 7 UX categories (`pass`, `warn`, `unknown` with bounded weights; unknowns never penalize scoring).
- **Gemini Structured Audit:**
  - Compact evidence pack without raw HTML or upstream headers.
  - Native `fetch` adapter calling `generateContent` with `responseMimeType: application/json` and `responseJsonSchema`.
  - Configured with low thinking (`thinkingLevel: "low"`) to satisfy the serverless execution budget.
  - Strict Zod validation on model output (`geminiAuditSchema`); flat-finding generation grouped back into domain types.
  - Signal reference integrity gate rejecting any audit that cites non-existent or foreign signal IDs.
- **Server-Side Scoring:**
  - 7 category weights: Clarity (18%), Visual Hierarchy (15%), CTA Effectiveness (15%), Copy (12%), Accessibility (15%), Mobile UX (10%), Trust & Credibility (15%).
  - Deterministic baselines blended with Gemini scores (0.60 AI + 0.40 baseline) when applicable signal coverage $\ge 40\%$.
  - Server-calculated `overallScore` (0–100) and conservative score confidence (`blended` vs `ai-led`).
- **User Interface & Recovery:**
  - Accessible report dashboard (score rings, category cards, top problems, quick wins, detailed recommendations, observed signals).
  - Cycle-based loading screen with minimum hold to avoid layout flash.
  - Sanitized error state with clear recovery guidance across all failure kinds.
- **Rate Limiting & Operational Security:**
  - Lightweight in-memory throttle (5 requests per 10 minutes per warm instance per IP).
  - Server-only environment variable handling (`GEMINI_API_KEY`, `GEMINI_MODEL`).
  - Strict JSON error envelopes (`{ error: { code, message, retryable } }`); zero leakage of raw HTML, DNS/IPs, stack traces, or secrets.

---

## 2. Quality Gates & Verification Evidence

| Quality Gate | Command | Result | Status |
|---|---|---|---|
| **TypeScript Typecheck** | `pnpm run typecheck` / `npm run typecheck` | 0 errors across packages/contracts, packages/audit-engine, app, and server tsconfigs | **PASS** |
| **Contracts Tests** | `pnpm --filter @pagepilot/contracts test` | 16 tests passing across 2 test files | **PASS** |
| **Audit Engine Tests** | `pnpm --filter @pagepilot/audit-engine test` | 119 tests passing across 9 test files | **PASS** |
| **Full Unit & Integration Suite** | `pnpm test` / `npm test` | 224 tests passing across 20 test files | **PASS** |
| **Production Build** | `pnpm run build` / `npm run build` | Built to `dist/` (JS 288 kB / gzip 85.9 kB, CSS 21.7 kB / gzip 5.0 kB) | **PASS** |
| **Live Vercel Dev & Gemini Verification** | `pnpm run verify:gemini` | `POST /api/analyze` against `example.com` returns contract-valid report via `@pagepilot/audit-engine` | **PASS** |
| **Dependency Security** | `npm audit` | 0 vulnerabilities | **PASS** |

---

## 3. Current Architecture & Workspace Status

- **Package Manager:** `pnpm` (v11.10.0, Node v24.14.1) initialized via `packageManager: "pnpm@11.10.0"` in `package.json`.
- **Workspace Config:** `pnpm-workspace.yaml` active targeting `apps/*` and `packages/*`.
- **Packages Extracted:**
  - `packages/contracts/` (`@pagepilot/contracts`): Shared Zod schemas, TypeScript types, `API_ERROR_CODES`, and `enforceUrlPolicy`. Zero-dependency core (except `zod`). Includes package-local tests (`packages/contracts/tests/`).
  - `packages/audit-engine/` (`@pagepilot/audit-engine`): SSRF-safe fetch, Cheerio snapshot extraction, deterministic checks, bounded Gemini model input serialization, structured output adapter, schema validation, signal reference verification, and server-side scoring. Zero UI/persistence dependencies. Includes package-local tests (`packages/audit-engine/tests/`).
- **Lockfile:** `pnpm-lock.yaml` active.
- **Current Layout:** Root-level structure with `@pagepilot/contracts` and `@pagepilot/audit-engine` packages (`src/client`, `src/server/http`, `api/analyze.ts`, `packages/contracts`, `packages/audit-engine`).
- **Deployment:** Single Vercel project serving Vite static output (`dist/`) and Express serverless function (`/api/analyze`).
- **Target Monorepo Architecture:** `apps/web`, `apps/api`, `packages/contracts`, `packages/audit-engine`, `packages/workflows`.

---

## 4. Known Issues & Operational Notes

- **Free-Tier Gemini Daily Quotas:** Free-tier API keys have per-model request caps (20 requests/day/model on free tier). Automated test suites use mock adapters to protect quota. Live verification uses `npm run verify:gemini`.
- **Model Support:** Adapter defaults to `gemini-3.6-flash` and supports `gemini-3.7-flash` via `GEMINI_MODEL` (with `thinkingLevel: "low"`).
- **Test Worker Threading on Windows:** Vitest is configured with `pool: "threads"` and `maxWorkers: 1` in `vite.config.ts` to prevent timeout flakes during sequential jsdom test runs.

---

## 5. Exact Next Task

- **Active Milestone:** Milestone 0 — Product Foundation & Monorepo Setup
- **Completed Tasks:**
  - Task 0.1 — Source-of-Truth Control Plane Alignment (`docs/STATUS.md`, `docs/ROADMAP.md`, `docs/PLAN.md`, `docs/DECISIONS.md` D39)
  - Task 0.2 — pnpm Workspace Initialization & Root Config (`pnpm-workspace.yaml`, `packageManager: pnpm@11.10.0`, `pnpm-lock.yaml`, verified live on `vercel dev`)
  - Task 0.3 — Extract `packages/contracts` (`@pagepilot/contracts` extracted, all consumers updated, legacy `src/shared` removed, fixture data cleanly separated, verified live with Gemini)
  - Task 0.4 — Extract `packages/audit-engine` (`@pagepilot/audit-engine` extracted, SSRF fetch, extraction, checks, AI audit, scoring isolated with zero UI/database coupling, root server updated, duplicate server files removed, 119 package tests + 224 total tests verified passing, verified live with real Gemini)
- **Exact Next Task:** **Task 0.5 — Monorepo App Migration (apps/web & apps/api)** (move client frontend to `apps/web` and Express/Vercel server to `apps/api` while preserving Vercel deployment parity).
