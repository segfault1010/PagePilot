# PagePilot — Current Status

**Last Updated:** August 2026  
**Current Milestone:** Milestone 2 — Accounts & Projects (Active / Next)  
**Previous Milestone:** Milestone 0 — Product Foundation & Monorepo Setup (Complete & Verified) & Milestone 1 — Core Audit MVP (Complete & Verified)

---

## 1. Verified Current State

The PagePilot monorepo architecture and core landing-page audit MVP are **fully implemented, tested, and verified in production**.

### Monorepo Structure (`pnpm`)
- `packages/contracts/` (`@pagepilot/contracts`): Runtime-agnostic shared Zod schemas, TypeScript types, `API_ERROR_CODES`, and `enforceUrlPolicy`. 16 tests passing across 2 test files.
- `packages/audit-engine/` (`@pagepilot/audit-engine`): SSRF-safe fetch (`ipaddr.js`, all-records DNS lookup, pinned socket connection), Cheerio snapshot extraction, deterministic checks, bounded Gemini model input serialization, structured output adapter, schema validation, signal reference integrity verification, and server-side scoring. 119 tests passing across 9 test files.
- `apps/web/` (`@pagepilot/web`): Vite + React 19 + TypeScript + Tailwind CSS v4 client application (`src/App.tsx`, `src/features/analysis/`). Builds directly to `apps/web/dist/`. 66 tests passing across 7 test files.
- `apps/api/` (`@pagepilot/api`): Express API application on Vercel Node runtime (`src/http/app.ts`, `src/index.ts`, `api/analyze.ts`). 23 tests passing across 2 test files.
- Root Vercel adapter (`api/analyze.ts`): Minimal pass-through handler delegating to `@pagepilot/api`, with `vercel.json` routing `outputDirectory: "apps/web/dist"`.
- Total workspace test suite: **224 tests passing across 20 test files**.

### Verified Core Capabilities
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
| **Workspace Typecheck** | `pnpm run typecheck` | 0 errors across all 5 workspace projects | **PASS** |
| **Contracts Tests** | `pnpm --filter @pagepilot/contracts test` | 16 tests passing across 2 test files | **PASS** |
| **Audit Engine Tests** | `pnpm --filter @pagepilot/audit-engine test` | 119 tests passing across 9 test files | **PASS** |
| **Web App Tests** | `pnpm --filter @pagepilot/web test` | 66 tests passing across 7 test files | **PASS** |
| **API Tests** | `pnpm --filter @pagepilot/api test` | 23 tests passing across 2 test files | **PASS** |
| **Full Monorepo Suite** | `pnpm test` | 224 tests passing across 20 test files | **PASS** |
| **Production Build** | `pnpm run build` | Built `apps/web/dist/` (JS 288 kB / gzip 85.9 kB, CSS 21.6 kB / gzip 5.0 kB) | **PASS** |
| **Live Vercel Dev & Gemini Verification** | `pnpm run verify:gemini` | `POST /api/analyze` against `example.com` returns contract-valid report via `@pagepilot/audit-engine` | **PASS** |
| **Live Route Status Verification** | SSRF `127.0.0.1` -> 403, `GET /api/analyze` -> 405, `/api/unknown` -> 404 | Tested against `vercel dev` server instance | **PASS** |

---

## 3. Current Architecture & Workspace Status

- **Package Manager:** `pnpm` (v11.10.0, Node v24.14.1) initialized via `packageManager: "pnpm@11.10.0"` in `package.json`.
- **Workspace Config:** `pnpm-workspace.yaml` active targeting `apps/*` and `packages/*`.
- **Monorepo Layout:**
  - `apps/web/` (`@pagepilot/web`): React 19 + TypeScript + Vite + Tailwind CSS v4 frontend.
  - `apps/api/` (`@pagepilot/api`): Express API on Vercel Node runtime.
  - `packages/contracts/` (`@pagepilot/contracts`): Shared Zod schemas, domain types, URL policy, error codes.
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

- **Free-Tier Gemini Daily Quotas:** Free-tier API keys have per-model request caps (20 requests/day/model on free tier). Automated test suites use mock adapters to protect quota. Live verification uses `npm run verify:gemini`.
- **Model Support:** Adapter defaults to `gemini-3.6-flash` and supports `gemini-3.7-flash` via `GEMINI_MODEL` (with `thinkingLevel: "low"`).
- **Test Worker Threading on Windows:** Vitest is configured with `pool: "threads"` and `maxWorkers: 1` in `vite.config.ts` to prevent timeout flakes during sequential jsdom test runs.

---

## 5. Exact Next Task

- **Completed Milestones:**
  - Milestone 0 — Product Foundation & Monorepo Setup (Tasks 0.1, 0.2, 0.3, 0.4, 0.5) **COMPLETE**
  - Milestone 1 — Core Audit MVP **COMPLETE**
- **Active Milestone:** **Milestone 2 — Accounts & Projects**
- **Exact Next Task:** **Task 2.1 — Supabase Schema & Multi-Tenant Migration** (Design and create Supabase database schema for organizations, memberships, roles, profiles, projects, monitored pages, audit runs, and audit reports with strict Row-Level Security policies).
