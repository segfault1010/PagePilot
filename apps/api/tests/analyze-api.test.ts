import request from "supertest";
import { describe, expect, it } from "vitest";
import type { Response } from "supertest";
import {
  analyzeErrorResponseSchema,
  analyzeSuccessResponseSchema,
} from "@pagepilot/contracts";
import type { AnalysisOutcome } from "@pagepilot/audit-engine";
import { createApp } from "../src/http/app.js";
import { sampleReport } from "./fixtures/reports.js";

function postJson(
  body: unknown,
  analyzeUrl?: (url: string) => Promise<AnalysisOutcome>,
): request.Test {
  const app = createApp(analyzeUrl ? { analyzeUrl } : undefined);
  return request(app).post("/api/analyze").send(body as object);
}

function expectEnvelope(res: Response) {
  const parsed = analyzeErrorResponseSchema.safeParse(res.body);
  expect(parsed.success).toBe(true);
  expect(Object.keys(res.body).sort()).toEqual(["error"]);
}

describe("POST /api/analyze — request validation", () => {
  it("rejects malformed URLs with 400 INVALID_URL before any analysis", async () => {
    let called = false;
    const res = await postJson({ url: "not a url" }, async () => {
      called = true;
      throw new Error("must not run");
    });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("INVALID_URL");
    expect(called).toBe(false);
  });

  it.each(["ftp://example.com", "https://user:pass@example.com", "https://example.com:8443"])(
    "rejects policy-violating URL %s with 400",
    async (url) => {
      const res = await postJson({ url }, async () => {
        throw new Error("must not run");
      });
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe("INVALID_URL");
    },
  );

  it("rejects missing/malformed bodies and wrong methods as in Phase 3", async () => {
    expect((await postJson({}).set("x", "y")).status).toBe(400);

    const malformed = await request(createApp())
      .post("/api/analyze")
      .set("Content-Type", "application/json")
      .send("{not json");
    expect(malformed.status).toBe(400);
    expect(malformed.body.error.code).toBe("BAD_REQUEST");

    const oversized = await postJson({
      url: `https://example.com/${"a".repeat(5000)}`,
    });
    expect(oversized.status).toBe(413);
    expect(oversized.body.error.code).toBe("REQUEST_TOO_LARGE");

    const get = await request(createApp()).get("/api/analyze");
    expect(get.status).toBe(405);
    expect(get.headers.allow).toBe("POST");
  });

  it("never leaks stack traces or internal details", async () => {
    const res = await postJson({ url: "not a url" });
    const serialized = JSON.stringify(res.body);
    expect(serialized).not.toMatch(/at .*\(/);
    expect(serialized.toLowerCase()).not.toContain("stack");
  });
});

const SAMPLE_SIGNALS = [
  {
    id: "title.present",
    category: "clarity" as const,
    status: "pass" as const,
    weight: 0.5,
    evidence: "Title present.",
  },
];

const successOutcome: AnalysisOutcome = {
  ok: true,
  report: {
    ...sampleReport,
    observedSignals: SAMPLE_SIGNALS,
  },
};

function failure(
  status: number,
  code: string,
  message: string,
  retryable: boolean,
): AnalysisOutcome {
  return { ok: false, status, code, message, retryable };
}

describe("POST /api/analyze — pipeline outcomes", () => {
  it("returns the placeholder report carrying real observed signals", async () => {
    const res = await postJson({ url: "https://example.com" }, async () => successOutcome);

    expect(res.status).toBe(200);
    expect(analyzeSuccessResponseSchema.safeParse(res.body).success).toBe(true);
    expect(res.body.report.observedSignals[0]).toMatchObject({
      id: "title.present",
      status: "pass",
    });
    expect(typeof res.body.report.overallScore).toBe("number");
  });

  it("maps blocked destinations to 403", async () => {
    const res = await postJson(
      { url: "http://169.254.169.254/latest/meta-data" },
      async () =>
        failure(
          403,
          "BLOCKED_DESTINATION",
          "This destination isn't reachable.",
          false,
        ),
    );

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("BLOCKED_DESTINATION");
    expectEnvelope(res);
  });

  it("maps oversized pages to 413 PAGE_TOO_LARGE", async () => {
    const res = await postJson({ url: "https://huge.example/" }, async () =>
      failure(413, "PAGE_TOO_LARGE", "That page exceeds the size PagePilot can process.", false),
    );

    expect(res.status).toBe(413);
    expect(res.body.error.code).toBe("PAGE_TOO_LARGE");
  });

  it("maps non-HTML responses to 422 NON_HTML_RESPONSE", async () => {
    const res = await postJson({ url: "https://files.example/doc.pdf" }, async () =>
      failure(422, "NON_HTML_RESPONSE", "PagePilot analyzes HTML landing pages.", false),
    );

    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe("NON_HTML_RESPONSE");
  });

  it("maps timeouts to retryable 504 TIMEOUT", async () => {
    const res = await postJson({ url: "https://slow.example/" }, async () =>
      failure(504, "TIMEOUT", "The site took too long to respond.", true),
    );

    expect(res.status).toBe(504);
    expect(res.body.error.retryable).toBe(true);
  });

  it("maps upstream failures to retryable 502 UPSTREAM_FAILURE", async () => {
    const res = await postJson({ url: "https://down.example/" }, async () =>
      failure(502, "UPSTREAM_FAILURE", "We couldn't complete the audit this time.", true),
    );

    expect(res.status).toBe(502);
    expect(res.body.error.retryable).toBe(true);
  });

  it("returns a generic 500 when the injected pipeline throws unexpectedly", async () => {
    const res = await postJson({ url: "https://example.com" }, async () => {
      throw new Error("secret internal detail XYZ");
    });

    expect(res.status).toBe(500);
    expect(JSON.stringify(res.body)).not.toContain("XYZ");
    expect(res.body.error.code).toBe("INTERNAL_ERROR");
  });
});
