# PagePilot — AI-Powered Landing Page UX Auditor

PagePilot audits any public landing page URL and returns a structured UX report with seven category scores, top problems, quick wins, and actionable recommendations. It blends deterministic HTML signals (measured from static HTML) with a Gemini structured audit, all scored server-side.

**Core flow:** URL → safe fetch → HTML extraction → deterministic checks → Gemini structured audit → server-side scoring → report UI.

---

## Architecture

Single Vercel project — no monorepo, no database, no auth:

```
/
  api/analyze.ts                 # Thin Vercel Node entry (→ src/server/http/app)
  src/
    client/                      # Vite + React + Tailwind (ESM)
      App.tsx
      features/analysis/
        api.ts                   # Same-origin POST /api/analyze client
        components/
        labels.ts
        url-validation.ts
    server/
      http/app.ts                # Express app + validation + rate limit
      fetch/safe-fetch.ts        # SSRF-safe pinned fetch
      fetch/ip-policy.ts         # Global-unicast allowlist (ipaddr.js)
      fetch/resolver.ts          # DNS lookup (all records)
      extract/page-snapshot.ts   # Cheerio snapshot (bounded)
      extract/deterministic-checks.ts
      ai/gemini-auditor.ts       # Plain fetch adapter, no SDK
      ai/audit-input.ts          # Bounded evidence pack (never HTML)
      schemas/audit.ts           # Strict Zod gate + wire/domain split
      scoring/score-report.ts    # 60/40 blending, overallScore
    shared/
      audit-types.ts             # Single Zod contract (request/report/error)
      url-policy.ts              # http/https, no creds, 80/443 only
      sample-report.ts           # Labeled preview fixture (landing only)
  vite.config.ts
  vercel.json                    # vite build, /api rewrite, maxDuration, no-store
```

**Key boundaries:**
- `src/shared` is the only client/server shared code.
- `GEMINI_API_KEY` / `GEMINI_MODEL` are server-only (never `VITE_*`, never imported by client).
- Raw HTML, upstream headers, DNS/IP details, and provider errors never reach the browser.

---

## Local Setup

**Requirements:** Node 20+, npm

```bash
npm install
cp .env.example .env   # fill GEMINI_API_KEY
```

`.env.example`:

```
GEMINI_API_KEY=        # required from Phase 5; 503 MISSING_CONFIGURATION when absent
GEMINI_MODEL=          # optional, defaults to gemini-3.6-flash; supports gemini-3.7-flash
```

`.env` is gitignored. Never commit real keys. Never prefix with `VITE_`.

---

## Environment Variables

| Variable | Scope | Notes |
|---|---|---|
| `GEMINI_API_KEY` | server-only | Required. Missing → 503. Read only in `src/server/ai/gemini-auditor.ts`. |
| `GEMINI_MODEL` | server-only | Optional override. Defaults to `gemini-3.6-flash`; supports `gemini-3.7-flash` (thinkingLevel low). Must support `responseJsonSchema`. |

**Production:** set both as server-side Environment Variables in Vercel Dashboard (Project → Settings → Environment Variables). Do not expose via `VITE_*`.

---

## Local Development

**Recommended (exercises deployed routing):**

```bash
vercel dev          # Vite + /api/analyze under one origin, same as production
# then open http://localhost:3000 (port printed by vercel dev)
```

**Vite only (frontend without API):**

```bash
npm run dev         # http://localhost:5173
```

---

## Testing

```bash
npm run typecheck   # tsc -b (strict)
npm test            # vitest run (19 suites, 216 tests)
npm run build       # tsc -b && vite build → dist/
npm audit           # 0 vulnerabilities expected
npm run verify:gemini  # One real Gemini call via vercel dev on :3210, using .env key;
                       # validates full report contract, prints sanitized diagnostics only
```

Tests cover: URL validation, SSRF/IP policy, redirects, extraction, deterministic scoring, Gemini schema validation, API error handling, frontend loading/error/report states, and per-IP rate limiting.

---

## Production Deployment

Single Vercel project (`page-pilot`):

- **Build:** `npm run build` → `dist/` (vite)
- **Output:** `dist/`
- **Function:** `api/analyze.ts` (`maxDuration: 30`, Node 24.x)
- **Rewrite:** `/api/:path*` → `/api/analyze` ensures unknown `/api/*` routes return the stable JSON error envelope, not Vercel's HTML 404.
- **Headers:** `Cache-Control: no-store` on `/api/*`
- **Deploy:** `vercel --prod` (or push to `main` → auto-deploy). Do not create a second project.

Verify after deploy:

```bash
curl -i https://<your-alias>/api/analyze -H "Content-Type: application/json" \
  -d '{"url":"https://example.com"}'
```

Expect `200` with `{ report: { overallScore, scoreConfidence, categories[7], topProblems[3], quickWins[3-5], ... } }` or the stable `{ error: { code, message, retryable } }` envelope. Frontend and API are same-origin; the client posts to relative `/api/analyze` with `cache: no-store`.

---

## Security Boundary

**URL policy (shared):** absolute `http:`/`https:` only, no credentials, ports `80`/`443` only (`src/shared/url-policy.ts`).

**Destination policy (server):** every hostname resolved via `dns.lookup(all:true)`; all returned addresses checked with `ipaddr.js` — only global unicast (`unicast`) is allowed. Loopback, unspecified, RFC1918, CGNAT (100.64/10), link-local/metadata (169.254/16, 169.254.169.254), multicast, reserved/benchmark, IPv6 loopback/link-local/unique-local, IPv4-mapped, 6to4, Teredo are rejected. Mixed safe/unsafe records reject the whole destination. Hostname strings are never trusted — only resolved IPs.

**Connection pinning:** `node:http(s).request` with a custom `lookup` pinned to one validated address; hostname preserved for Host header / TLS SNI. Validates before `openStream` and inside `lookup` (Node 20+ happy-eyeballs `all:true` handled). Redirects disabled (`redirect: manual`), up to 3 hops, each destination fully revalidated (URL policy + DNS + IP).

**Hard limits:** decoded HTML capped at 1.5 MB (Content-Length pre-check + streaming cap), total wall-clock 8 s (including DNS), gzip/deflate/brotli decompressed before size accounting. Non-HTML (`text/html` / `application/xhtml+xml` only) rejected before download. `Cache-Control: no-store`, 4 KB JSON request limit, `X-Content-Type-Options: nosniff`, no raw HTML/headers/DNS/IP/provider errors exposed.

---

## Report & Scoring

- **Seven categories:** `clarity` 18%, `visualHierarchy` 15%, `ctaEffectiveness` 15%, `copy` 12%, `accessibility` 15%, `mobileUx` 10%, `trustCredibility` 15%.
- **Deterministic signals** (`src/server/extract/deterministic-checks.ts`): stable IDs (`title.present`, `headings.order`, ...), category, `pass|warn|unknown`, bounded weight, evidence. `unknown` never penalizes scoring.
- **Per-category baseline:** weighted `pass=1, warn=0.5` over applicable signals only; unknowns excluded from numerator and denominator.
- **Blending:** when applicable weight covers ≥ 40% of emitted weight, `categoryScore = round(0.60 × Gemini + 0.40 × baseline)` → confidence `blended`, else Gemini score alone → `ai-led`. Report `scoreConfidence` is `blended` only when every category blended.
- **overallScore:** weighted sum of final post-blend category scores, rounded 0–100, computed server-side only. The model never provides overallScore.
- **Gemini output:** `responseMimeType: application/json` + `responseJsonSchema` (derived from Zod, with unsupported keywords stripped) + `temperature:0.2` + `maxOutputTokens:8192` + 22 s deadline. One compatibility fallback without thinking settings on HTTP 400. Findings are generated flat (tagged `categoryKey`) due to Gemini's restriction on nested object arrays, then grouped and re-validated. Invalid signal references reject the whole audit.

---

## MVP Limitations

- **Static HTML only.** PagePilot fetches raw HTML with Cheerio — no JavaScript execution, no headless browser, no screenshots, no Playwright. Anything rendered client-side is invisible. The UI must never claim to measure speed, Core Web Vitals, visual contrast, real mobile rendering, conversion rates, or user behavior.
- **Observed vs inferred.** Findings with `basis: observed` cite deterministic signal IDs; `inferred` marks AI interpretation.
- **No persistence:** no database, no auth, no sharing/history, no PDF export, no background jobs. Rate limiting is in-memory per warm instance (5 req / 10 min / IP), not a distributed system.

---

## Rate Limit / Cost Protection

Lightweight per-IP throttle in `src/server/http/app.ts`: 5 requests per 10 minutes per warm function instance. Uses `x-forwarded-for` (first entry) → `x-real-ip` → `req.ip` → `socket.remoteAddress`. Exceeding returns `429 RATE_LIMITED` (`retryable:true`). The map lives per `createApp()` instance — one per warm Lambda — so cold starts reset counters. Tests reuse per-app isolation; live 429 is exercised via unit coverage rather than forcing production traffic.

---

## API Contract

`POST /api/analyze`

Request: `{ url: string }`

Success `200`: `{ report: Report }`
Error: `{ error: { code, message, retryable } }`

| Status | Code | When |
|---|---|---|
| 400 | `BAD_REQUEST` | malformed JSON |
| 400 | `INVALID_URL` | URL policy violation |
| 403 | `BLOCKED_DESTINATION` | private/loopback/link-local etc. or redirect to blocked host |
| 413 | `REQUEST_TOO_LARGE` | request body >4 KB |
| 413 | `PAGE_TOO_LARGE` | decoded HTML >1.5 MB |
| 422 | `NON_HTML_RESPONSE` | content-type not HTML/XHTML |
| 429 | `RATE_LIMITED` | per-IP throttle |
| 502 | `UPSTREAM_FAILURE` | target non-2xx/unreachable or Gemini unavailable/malformed |
| 504 | `TIMEOUT` | fetch or Gemini deadline exceeded |
| 503 | `MISSING_CONFIGURATION` | `GEMINI_API_KEY` absent (non-retryable) |
| 405 | `METHOD_NOT_ALLOWED` | wrong method (`Allow: POST`) |
| 404 | `NOT_FOUND` | unknown `/api/*` route |

All errors use the stable envelope; no HTML error pages for `/api/*`.

---

## Troubleshooting

- **503 on `/api/analyze`:** `GEMINI_API_KEY` not set in Vercel env or `.env` for `vercel dev`.
- **403 on localhost/private:** expected — SSRF protection.
- **504:** site slow or Gemini overloaded; retry.
- **502:** target unreachable or Gemini returned invalid JSON (safe failure).
- **`vercel dev` not ready:** ensure `GEMINI_API_KEY` present; check `[ai]` lines in terminal (sanitized: model, key presence, status only).
