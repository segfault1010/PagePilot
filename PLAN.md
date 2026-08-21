# PagePilot — Weekend MVP Plan

## Summary

Build PagePilot as a single Vercel project, not a monorepo: a Vite/React frontend plus an Express-backed Vercel Node function at `/api/analyze`. This keeps local development and deployment simple while preserving clean client/server module boundaries.

- Core flow: public URL → safe HTML fetch → Cheerio signal extraction → Gemini structured audit → polished report.
- No database, authentication, screenshots, browser automation, persistence, or background processing.
- Use Vercel’s Node runtime for the API and its standard `/api` function layout. [Vercel Node functions](https://vercel.com/docs/functions/runtimes/node-js)
- Use Gemini structured JSON output with a Zod-backed schema; Gemini’s current SDK supports JSON-schema-based structured output. [Gemini structured outputs](https://ai.google.dev/gemini-api/docs/structured-output?authuser=14&hl=en)

## Architecture and Interfaces

### Repository layout

```text
/
  api/analyze.ts                 # Thin Vercel/Express entry point
  src/
    client/
      App.tsx
      features/analysis/
        api.ts
        components/
        report-view.tsx
    server/
      http/app.ts
      fetch/safe-fetch.ts
      extract/page-snapshot.ts
      extract/deterministic-checks.ts
      ai/gemini-auditor.ts
      scoring/score-report.ts
      schemas/audit.ts
    shared/
      audit-types.ts
  tests/
    unit/
    integration/
    fixtures/
  docs/
    PLAN.md
    DECISIONS.md
```

Use one shared TypeScript/Zod contract for API payloads, Gemini output validation, server transformation, and report rendering. Run locally with `vercel dev` so Vite and the serverless API follow the deployed routing model.

### API

`POST /api/analyze`

Request:

```ts
{ url: string }
```

Successful response:

```ts
{
  report: {
    source: {
      requestedUrl: string
      finalUrl: string
      analyzedAt: string
      title: string | null
    }
    overallScore: number
    scoreConfidence: "blended" | "ai-led"
    summary: string
    categories: CategoryReport[]
    topProblems: Finding[]
    quickWins: Recommendation[]
    detailedRecommendations: Recommendation[]
    observedSignals: DetectedSignal[]
  }
}
```

Use a stable error envelope:

```ts
{
  error: {
    code: string
    message: string
    retryable: boolean
  }
}
```

Map failures to predictable statuses: `400` invalid URL, `403` blocked/private destination, `413` oversized page, `422` non-HTML response, `429` local rate limit, `502` target or Gemini failure, `504` fetch/Gemini timeout, and `503` missing server configuration.

### Gemini audit schema

Gemini returns only a Zod-validated JSON object containing:

- `summary`: concise overall interpretation.
- Exactly seven category assessments: `clarity`, `visualHierarchy`, `ctaEffectiveness`, `copy`, `accessibility`, `mobileUx`, `trustCredibility`.
- Each category: AI score (0–100), short explanation, severity, and up to three findings.
- Each finding: title, severity (`low|medium|high`), evidence text, basis (`observed|inferred`), referenced deterministic signal IDs where applicable, and one actionable recommendation.
- `topProblems`: exactly three prioritized findings referencing valid categories.
- `quickWins`: three to five low-effort recommendations.
- `detailedRecommendations`: prioritized, specific fixes.

The server rejects malformed output, missing/duplicate categories, unsupported severities, invalid signal references, out-of-range scores, or oversized strings. It returns a safe generic AI failure instead of exposing model output.

### Extraction and scoring

Fetch only static HTML; never execute target-site JavaScript. Build a compact `PageSnapshot`, not a raw-HTML prompt:

- Final URL, title, meta description, canonical, viewport, Open Graph fields, document language.
- H1/H2/H3 counts, ordered heading outline, hierarchy warnings.
- Visible text excerpt capped at 12,000 characters after removing scripts/styles and whitespace normalization.
- Limited samples of links, buttons, forms, navigation, CTA candidates, and headings.
- Image count and alt-text coverage.
- Counts for anchors, forms, paragraphs, navigation regions, and text length.
- Deterministic checks with stable IDs, category, status (`pass|warn|unknown`), weight, and plain-language evidence.

Cap upstream HTML at 1.5 MB and reject/abort larger streamed responses. Limit redirects to three and fetch time to eight seconds.

| Category | Overall weight | Deterministic evidence |
|---|---:|---|
| Clarity | 18% | Title, meta description, meaningful single H1 |
| Visual hierarchy | 15% | Heading order, heading coverage, content structure |
| CTA effectiveness | 15% | CTA candidate count/text, forms, action links |
| Copy | 12% | Content sufficiency, title/meta lengths, duplication indicators |
| Accessibility | 15% | Image alt coverage, language, labels, link text |
| Mobile UX | 10% | Viewport tag and form/control signals only |
| Trust / credibility | 15% | Canonical/OG metadata and detectable legal/contact/trust links |

For each category, calculate a deterministic baseline from applicable weighted checks only; `unknown` checks do not create a penalty. If the available deterministic weight covers at least 40% of that category, calculate:

```text
categoryScore = round(0.60 × Gemini score + 0.40 × deterministic baseline)
```

Otherwise use the Gemini score and label the result `ai-led`. Calculate `overallScore` server-side as the weighted sum of final category scores. The UI must label observed signals separately from AI interpretation and must not claim to measure speed, visual contrast, real mobile rendering, or conversion performance.

### Security and reliability

- Permit only absolute `http:` and `https:` URLs, with no credentials and ports limited to 80/443.
- Resolve every hostname before connection and block loopback, unspecified, RFC1918 private, CGNAT, link-local, multicast, metadata-service, and private IPv6 ranges.
- Use a connection lookup pinned to validated public IPs to reduce DNS-rebinding risk; revalidate every redirect destination before following it.
- Disable automatic redirects and handle them manually; never return fetched HTML, target headers, DNS details, or raw provider errors to the browser.
- Enforce a small in-memory per-IP throttle: five requests per ten minutes per warm function instance. It is cost protection, not an authentication system.
- Keep `GEMINI_API_KEY` server-only; use `GEMINI_MODEL` as an environment override, defaulting to the current fast structured-output Gemini model selected during setup.
- Configure a 30-second function maximum duration, `Cache-Control: no-store`, a 4 KB JSON request limit, same-origin API usage, and sanitized production logs.

## UI

Create a single responsive route with two states:

- Landing state: premium monochrome layout, product positioning, URL form, inline validation, visible example of the resulting report, and keyboard-accessible submit.
- Analysis state: clear phased loading copy (“Checking URL”, “Reading page structure”, “Preparing UX audit”) without pretending to stream model progress.
- Report state: score ring built with CSS/SVG rather than Recharts, score-confidence label, category score cards, top-problem callouts, quick wins, detailed recommendations, observed-signal disclosure, and “Analyze another website.”
- Failure state: helpful recovery copy mapped to error codes, preserving the entered URL for retry.
- Respect `prefers-reduced-motion`, use semantic headings, live status announcements, visible focus states, and responsive single-column mobile layouts.

## Weekend Phases

1. **Foundation — 1.5 hours — low complexity**  
   Create the Vite/React/TypeScript/Tailwind project, Vercel function configuration, shared contracts, scripts, environment example, and the two planning documents.  
   Acceptance: local app and `/api/analyze` endpoint boot with `vercel dev`; no feature behavior yet.  
   Do not add a monorepo tool, database, component library, or chart library.

2. **Landing page — 2 hours — low complexity**  
   Build the landing shell, URL form, client-side URL normalization, validation messaging, responsive styling, and placeholder loading/report states.  
   Acceptance: polished static experience works at desktop and mobile widths.  
   Do not connect Gemini or build saved report history.

3. **URL validation and API shell — 2 hours — medium complexity**  
   Implement Express app creation, request/error schemas, URL/protocol/port rules, same-origin API client, and error envelope.  
   Acceptance: invalid and malformed URLs fail predictably before any external request.  
   Do not fetch arbitrary URLs or expose provider errors.

4. **Safe fetching and HTML extraction — 3 hours — high complexity**  
   Implement DNS/IP restrictions, redirect validation, abort/size limits, content-type checks, Cheerio extraction, deterministic signal generation, and fixtures.  
   Acceptance: valid public HTML produces a compact snapshot; blocked, timeout, non-HTML, and oversized cases fail safely.  
   Do not add Playwright, screenshots, or JavaScript execution.

5. **Gemini structured analysis — 2.5 hours — medium complexity**  
   Add Gemini client adapter, strict JSON schema, focused UX prompt, response validation, evidence reference checks, and report score merger.  
   Acceptance: a mocked and a real configured request both produce the exact frontend report contract.  
   Do not expose raw prompts or model responses.

6. **Report dashboard — 2.5 hours — medium complexity**  
   Replace static report placeholders with the complete audit view and intentional empty/unknown-signal states.  
   Acceptance: a complete report is scannable in under a minute and recommendations are actionable.  
   Do not build PDF export or share links.

7. **Failure and loading polish — 1.5 hours — low complexity**  
   Refine loading, retry, validation, error mapping, accessibility, mobile spacing, and reduced-motion behavior.  
   Acceptance: every defined failure has understandable recovery guidance.  
   Do not add notifications, accounts, or analytics.

8. **Testing, deployment, and final polish — 2.5 hours — medium complexity**  
   Run focused tests, production build, deployed smoke test, environment-variable setup, and final visual pass.  
   Acceptance: deployed URL completes a successful analysis and all error paths remain safe.  
   Do not begin stretch work until this phase passes.

Estimated total: 17–18 hours.

## Testing and Definition of Done

Use Vitest for extraction/scoring/schema units, Supertest for API integration, React Testing Library for form/report/error rendering, and mocked fetch/Gemini adapters. Keep fixtures small and local.

Required scenarios:

- Valid public HTML and complete successful report.
- Invalid/unsupported URL, private/localhost URL, unreachable host, redirect to blocked host.
- Missing title, missing H1, missing image alt text, sparse links/CTA, malformed HTML.
- Non-HTML response, fetch timeout, oversized HTML, malformed Gemini JSON, Gemini timeout/failure.
- Client validation, loading state, retryable error, responsive report rendering, and score calculation boundaries.

Definition of done:

- A visitor can submit a safe public URL and receive a schema-valid report without a database.
- Report scores are bounded, server-calculated, explainable, and separate observations from interpretation.
- Unsafe destinations and malformed/large responses are blocked without leaking internal details.
- Core success and failure tests pass locally; Vercel deployment succeeds with server-only Gemini credentials.
- `docs/PLAN.md` contains this execution plan and `docs/DECISIONS.md` records the single-project architecture, static-HTML boundary, SSRF approach, blended scoring, schema validation, and explicit non-goals.

## MVP Boundary, Risks, and Deferred Work

**Must have:** URL analysis, safe static fetch, deterministic extraction, Gemini JSON audit, seven-category report, loading/errors, tests, Vercel deployment.

**Should have:** score-confidence indicator, observed-signal disclosure, lightweight rate limiting, refined responsive visual polish.

**Stretch only after MVP:** Playwright screenshot/vision analysis, Lighthouse/PageSpeed, automated accessibility tooling, saved/shareable reports, PDF export, history/comparisons.

Key risks and mitigations:

- SSRF: strict protocol/port/IP validation, pinned resolution, redirect revalidation.
- Serverless timeouts: bounded fetch/content extraction, concise prompt, 30-second function budget, clear retryable errors.
- Gemini schema drift: response-format schema, Zod validation, model adapter, safe failure behavior.
- Weak HTML signal quality: label unknowns, make only supportable claims, retain AI-led confidence state.
- Weekend scope creep: no database, auth, screenshot analysis, or secondary deployment architecture.

Exact first implementation task: initialize the single Vite/TypeScript/Tailwind repository with the Vercel `/api/analyze` entry point, shared Zod contract, `vercel dev` script, and the two planning documents—before implementing page fetching or Gemini.
