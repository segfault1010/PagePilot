import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Response } from "supertest";
import {
  analyzeErrorResponseSchema,
  analyzeSuccessResponseSchema,
} from "@pagepilot/contracts";
import {
  SafeFetchError,
  AiError,
  analyzeTarget,
} from "@pagepilot/audit-engine";
import type {
  FetchedPage,
  UxAuditProvider,
  AuditModelInput,
  GeminiAudit,
} from "@pagepilot/audit-engine";
import { createApp } from "../src/http/app.js";
import { validGeminiAudit } from "./fixtures/gemini-audit.js";

vi.mock("../../../packages/audit-engine/src/fetch/safe-fetch.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../packages/audit-engine/src/fetch/safe-fetch.js")>();
  return {
    ...actual,
    createSafeFetcher: vi.fn(),
  };
});

const mockedCreateSafeFetcher = vi.mocked(
  (await import("../../../packages/audit-engine/src/fetch/safe-fetch.js")).createSafeFetcher,
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

function appWith(deps?: { auditor?: UxAuditProvider }) {
  return createApp({
    analyzeUrl: (url) => analyzeTarget(url, deps),
  });
}

async function postUrl(app: ReturnType<typeof createApp>, url = "https://acme.example"): Promise<Response> {
  return request(app).post("/api/analyze").send({ url });
}

describe("POST /api/analyze — full Phase 5 pipeline", () => {
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
    const res = await postUrl(appWith({ auditor }));

    expect(res.status).toBe(200);
    const parsed = analyzeSuccessResponseSchema.safeParse(res.body);
    expect(parsed.success).toBe(true);

    const report = res.body.report;
    expect(report.source.title).toBe("Acme landing page");
    expect(report.source.finalUrl).toBe("https://acme.example/");
    expect(
      report.observedSignals.some((signal: { id: string }) => signal.id === "title.present"),
    ).toBe(true);
    expect(report.categories).toHaveLength(7);
    expect(report.topProblems).toHaveLength(3);
    expect(typeof report.overallScore).toBe("number");

    const input = auditor.calls[0] as AuditModelInput;
    expect(input.page.title).toBe("Acme landing page");
    expect(JSON.stringify(input)).not.toContain("<script");
    expect(JSON.stringify(input)).not.toContain("<!doctype");
    expect(input.deterministicSignals.length).toBeGreaterThan(5);
  });

  it("keeps fetch-failure mappings intact through the real pipeline", async () => {
    fetcherFailing(new SafeFetchError("BLOCKED_DESTINATION", "blocked"));
    const res = await postUrl(appWith({ auditor: fakeAuditor({}) }));
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("BLOCKED_DESTINATION");

    fetcherFailing(new SafeFetchError("NON_HTML_RESPONSE", "pdf"));
    const pdf = await postUrl(appWith({ auditor: fakeAuditor({}) }));
    expect(pdf.status).toBe(422);
  });

  it("maps AI configuration failures to non-retryable 503", async () => {
    const res = await postUrl(
      appWith({
        auditor: fakeAuditor({
          runAudit: () => Promise.reject(new AiError("configuration")),
        }),
      }),
    );
    expect(res.status).toBe(503);
    expect(res.body.error.code).toBe("MISSING_CONFIGURATION");
    expect(res.body.error.retryable).toBe(false);
    expectEnvelopeOnly(res);
  });

  it("maps provider unavailability and malformed output to retryable 502", async () => {
    for (const kind of ["unavailable", "invalid-response"] as const) {
      const res = await postUrl(
        appWith({
          auditor: fakeAuditor({
            runAudit: () => Promise.reject(new AiError(kind)),
          }),
        }),
      );
      expect(res.status).toBe(502);
      expect(res.body.error.code).toBe("UPSTREAM_FAILURE");
      expect(res.body.error.retryable).toBe(true);
      expectEnvelopeOnly(res);
    }
  });

  it("maps AI timeouts to retryable 504", async () => {
    const res = await postUrl(
      appWith({
        auditor: fakeAuditor({
          runAudit: () => Promise.reject(new AiError("timeout")),
        }),
      }),
    );
    expect(res.status).toBe(504);
    expect(res.body.error.code).toBe("TIMEOUT");
    expect(res.body.error.retryable).toBe(true);
  });

  it("rejects audits referencing unknown or foreign signal IDs", async () => {
    const inventing = validGeminiAudit();
    inventing.categories[0]!.findings[0]!.signalIds = ["totally.invented.signal"];
    const res = await postUrl(
      appWith({
        auditor: fakeAuditor({ runAudit: () => Promise.resolve(inventing) }),
      }),
    );
    expect(res.status).toBe(502);
    expect(res.body.error.code).toBe("UPSTREAM_FAILURE");
    expect(JSON.stringify(res.body)).not.toContain("totally.invented.signal");
  });

  it("returns only contract-shaped report fields on success", async () => {
    const res = await postUrl(appWith({ auditor: fakeAuditor({}) }));
    expect(res.status).toBe(200);
    expect(Object.keys(res.body).sort()).toEqual(["report"]);
    expect(Object.keys(res.body.report).sort()).toEqual([
      "categories",
      "detailedRecommendations",
      "observedSignals",
      "overallScore",
      "quickWins",
      "scoreConfidence",
      "source",
      "summary",
      "topProblems",
    ]);
    expect(JSON.stringify(res.body)).not.toMatch(/finishReason|promptFeedback/);
  });

  it("fails safely without echoing model content when the audit is malformed", async () => {
    const marker = "RAW_MODEL_MARKER_XYZ";
    const rogue = {
      ...validGeminiAudit(),
      summary: `${marker} summary that is definitely long enough to pass bounds.`,
    } satisfies GeminiAudit;
    delete (rogue as Record<string, unknown>).categories;

    const res = await postUrl(
      appWith({
        auditor: fakeAuditor({ runAudit: () => Promise.resolve(rogue) }),
      }),
    );

    expect(res.status).toBe(502);
    expect(res.body.error.code).toBe("UPSTREAM_FAILURE");
    const serialized = JSON.stringify(res.body);
    expect(serialized).not.toContain(marker);
    expect(serialized).not.toContain("categories");
  });

  it("maps unexpected auditor crashes to a generic 500 without leaking details", async () => {
    const failure = await postUrl(
      appWith({
        auditor: fakeAuditor({
          runAudit: () => Promise.reject(new Error("internal secret XYZ")),
        }),
      }),
    );
    expect(failure.status).toBe(500);
    expect(JSON.stringify(failure.body)).not.toContain("XYZ");
    expect(failure.body.error.code).toBe("INTERNAL_ERROR");
  });

  it("reports missing configuration when GEMINI_API_KEY is unset (no injection)", async () => {
    const previousKey = process.env.GEMINI_API_KEY;
    delete process.env.GEMINI_API_KEY;
    try {
      const app = createApp({ analyzeUrl: (url) => analyzeTarget(url) });
      const res = await request(app).post("/api/analyze").send({ url: "https://acme.example" });
      expect(res.status).toBe(503);
      expect(res.body.error.code).toBe("MISSING_CONFIGURATION");
    } finally {
      if (previousKey !== undefined) process.env.GEMINI_API_KEY = previousKey;
    }
  });
});

function expectEnvelopeOnly(res: Response): void {
  const parsed = analyzeErrorResponseSchema.safeParse(res.body);
  expect(parsed.success).toBe(true);
}
