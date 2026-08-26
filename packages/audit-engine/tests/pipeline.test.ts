import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SafeFetchError } from "../src/fetch/safe-fetch.js";
import type { FetchedPage } from "../src/fetch/safe-fetch.js";
import { AiError } from "../src/ai/gemini-auditor.js";
import type { UxAuditProvider } from "../src/ai/gemini-auditor.js";
import type { AuditModelInput } from "../src/ai/audit-input.js";
import type { GeminiAudit } from "../src/schemas/audit.js";
import { analyzeTarget } from "../src/pipeline.js";
import { validGeminiAudit } from "./fixtures/gemini-audit.js";

vi.mock("../src/fetch/safe-fetch.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/fetch/safe-fetch.js")>();
  return {
    ...actual,
    createSafeFetcher: vi.fn(),
  };
});

const mockedCreateSafeFetcher = vi.mocked(
  (await import("../src/fetch/safe-fetch.js")).createSafeFetcher,
);

const PAGE_HTML = `<!doctype html>
<html lang="en">
<head>
  <title>Acme landing page</title>
  <meta name="description" content="Acme helps teams ship faster.">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <link rel="canonical" href="https://acme.example/">
</head>
<body>
  <h1>Ship faster with Acme</h1>
  <p>Acme gives your team superpowers.</p>
  <button>Get started free</button>
  <a href="/privacy">Privacy policy</a>
</body>
</html>`;

function fetcherReturning(page: FetchedPage): void {
  mockedCreateSafeFetcher.mockReturnValue(() => Promise.resolve(page));
}

function fetcherFailing(error: SafeFetchError): void {
  mockedCreateSafeFetcher.mockReturnValue(() => Promise.reject(error));
}

function fakeAuditor(overrides: {
  runAudit?: UxAuditProvider["runAudit"];
}): UxAuditProvider & { calls: unknown[] } {
  const calls: unknown[] = [];
  return {
    calls,
    runAudit: overrides.runAudit ?? ((input) => {
      calls.push(input);
      return Promise.resolve(validGeminiAudit());
    }),
  };
}

describe("analyzeTarget — audit pipeline", () => {
  beforeEach(() => {
    mockedCreateSafeFetcher.mockReset();
    fetcherReturning({
      finalUrl: "https://acme.example/",
      contentType: "text/html",
      body: PAGE_HTML,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("produces a real server-scored report end-to-end with a mocked Gemini", async () => {
    const auditor = fakeAuditor({});
    const outcome = await analyzeTarget("https://acme.example", { auditor });

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;

    const report = outcome.report;
    expect(report.source.title).toBe("Acme landing page");
    expect(report.source.finalUrl).toBe("https://acme.example/");
    expect(
      report.observedSignals.some((signal) => signal.id === "title.present"),
    ).toBe(true);
    expect(report.categories).toHaveLength(7);
    expect(report.topProblems).toHaveLength(3);
    expect(typeof report.overallScore).toBe("number");

    // The model saw bounded evidence only.
    const input = auditor.calls[0] as AuditModelInput;
    expect(input.page.title).toBe("Acme landing page");
    expect(JSON.stringify(input)).not.toContain("<script");
    expect(JSON.stringify(input)).not.toContain("<!doctype");
    expect(input.deterministicSignals.length).toBeGreaterThan(5);
  });

  it("keeps fetch-failure mappings intact through the real pipeline", async () => {
    fetcherFailing(new SafeFetchError("BLOCKED_DESTINATION", "blocked"));
    const blocked = await analyzeTarget("https://blocked.example", { auditor: fakeAuditor({}) });
    expect(blocked).toEqual({
      ok: false,
      status: 403,
      code: "BLOCKED_DESTINATION",
      message: "This destination isn't reachable. PagePilot only analyzes public websites.",
      retryable: false,
    });

    fetcherFailing(new SafeFetchError("NON_HTML_RESPONSE", "pdf"));
    const nonHtml = await analyzeTarget("https://pdf.example", { auditor: fakeAuditor({}) });
    expect(nonHtml).toEqual({
      ok: false,
      status: 422,
      code: "NON_HTML_RESPONSE",
      message: "PagePilot analyzes HTML landing pages.",
      retryable: false,
    });
  });

  it("maps AI configuration failures to non-retryable 503", async () => {
    const outcome = await analyzeTarget("https://acme.example", {
      auditor: fakeAuditor({
        runAudit: () => Promise.reject(new AiError("configuration")),
      }),
    });
    expect(outcome).toEqual({
      ok: false,
      status: 503,
      code: "MISSING_CONFIGURATION",
      message: "The service is missing configuration. This isn't something you can fix — please try again later.",
      retryable: false,
    });
  });

  it("maps provider unavailability and malformed output to retryable 502", async () => {
    for (const kind of ["unavailable", "invalid-response"] as const) {
      const outcome = await analyzeTarget("https://acme.example", {
        auditor: fakeAuditor({
          runAudit: () => Promise.reject(new AiError(kind)),
        }),
      });
      expect(outcome).toEqual({
        ok: false,
        status: 502,
        code: "UPSTREAM_FAILURE",
        message: "We couldn't complete the audit this time. Please try again shortly.",
        retryable: true,
      });
    }
  });

  it("maps AI timeouts to retryable 504", async () => {
    const outcome = await analyzeTarget("https://acme.example", {
      auditor: fakeAuditor({
        runAudit: () => Promise.reject(new AiError("timeout")),
      }),
    });
    expect(outcome).toEqual({
      ok: false,
      status: 504,
      code: "TIMEOUT",
      message: "The analysis took too long to complete. Give it another try.",
      retryable: true,
    });
  });

  it("rejects audits referencing unknown or foreign signal IDs", async () => {
    const inventing = validGeminiAudit();
    inventing.categories[0]!.findings[0]!.signalIds = ["totally.invented.signal"];
    const outcome = await analyzeTarget("https://acme.example", {
      auditor: fakeAuditor({ runAudit: () => Promise.resolve(inventing) }),
    });
    expect(outcome).toEqual({
      ok: false,
      status: 502,
      code: "UPSTREAM_FAILURE",
      message: "We couldn't complete the audit this time. Please try again shortly.",
      retryable: true,
    });
  });

  it("fails safely without echoing model content when the audit is malformed", async () => {
    const rogue = {
      ...validGeminiAudit(),
      summary: "Short summary.",
    } satisfies GeminiAudit;
    delete (rogue as Record<string, unknown>).categories;

    const outcome = await analyzeTarget("https://acme.example", {
      auditor: fakeAuditor({ runAudit: () => Promise.resolve(rogue) }),
    });

    expect(outcome).toEqual({
      ok: false,
      status: 502,
      code: "UPSTREAM_FAILURE",
      message: "We couldn't complete the audit this time. Please try again shortly.",
      retryable: true,
    });
  });

  it("reports missing configuration when GEMINI_API_KEY is unset (no injection)", async () => {
    const previousKey = process.env.GEMINI_API_KEY;
    delete process.env.GEMINI_API_KEY;
    try {
      const outcome = await analyzeTarget("https://acme.example");
      expect(outcome).toEqual({
        ok: false,
        status: 503,
        code: "MISSING_CONFIGURATION",
        message: "The service is missing configuration. This isn't something you can fix — please try again later.",
        retryable: false,
      });
    } finally {
      if (previousKey !== undefined) process.env.GEMINI_API_KEY = previousKey;
    }
  });
});
