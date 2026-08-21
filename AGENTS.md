# PagePilot Agent Instructions

## Project
PagePilot is an AI-powered landing-page UX auditor.

## Source of truth
- `docs/PLAN.md` defines product scope and implementation phases.
- `docs/DECISIONS.md` records architectural decisions.
- Do not contradict either document without explicitly documenting the change.

## Workflow
- Implement one phase at a time.
- Do not implement future phases unless explicitly requested.
- Before changing architecture, inspect existing code and relevant docs.
- After implementation, run typecheck, tests, and build where applicable.
- Do not claim a task is complete without verification.
- Keep changes minimal and focused.

## MVP boundary
Do NOT add:
- authentication
- database
- payments
- screenshots
- Playwright
- browser automation
- background jobs
- PDF export
- sharing/history
unless explicitly requested.

Core flow:

URL
→ safe fetch
→ HTML extraction
→ deterministic checks
→ Gemini structured audit
→ server-side scoring
→ report UI

## Architecture
- Single Vercel project.
- React + Vite + TypeScript frontend.
- Vercel Node API at `/api/analyze`.
- Shared TypeScript/Zod contracts.
- Keep client/server boundaries clean.

## Security
Treat the URL analyzer as security-sensitive.

Never blindly fetch:
- localhost
- loopback addresses
- private IP ranges
- link-local addresses
- metadata service addresses
- unsupported protocols
- unsafe redirect destinations

Never expose:
- Gemini API keys
- raw target HTML
- internal DNS details
- provider/internal errors

Revalidate every redirect destination.

## AI
- Gemini output must be schema validated.
- Never trust model output directly.
- Reject malformed or out-of-range responses.
- Keep deterministic observations separate from AI interpretation.
- Do not claim measurements that the system cannot actually perform.

## Testing
Prefer focused tests for:
- URL validation
- SSRF protection
- redirects
- HTML extraction
- deterministic scoring
- Gemini schema validation
- API error handling
- frontend loading/error/report states

## Code quality
- TypeScript strictness should remain enabled.
- Prefer small, focused modules.
- Avoid unnecessary abstractions.
- Avoid duplicate logic.
- Add comments only where they explain non-obvious decisions.

## Git
Use small, meaningful commits after each completed phase.

Example:
`feat: implement safe page fetching`

Never rewrite unrelated files or make broad formatting changes without reason.