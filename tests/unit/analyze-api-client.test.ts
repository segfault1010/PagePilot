import { afterEach, describe, expect, it, vi } from "vitest";
import type { MockInstance } from "vitest";
import {
  NETWORK_ERROR_CODE,
  analyzeUrl,
} from "../../src/client/features/analysis/api";
import { sampleReport } from "../../src/shared/sample-report";

afterEach(() => {
  vi.unstubAllGlobals();
});

function stubFetch(implementation: () => Promise<unknown>): MockInstance {
  const fetchMock = vi.fn(implementation);
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function jsonResponse(status: number, payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("analyzeUrl client", () => {
  it("POSTs a JSON body to the same-origin endpoint and returns the report", async () => {
    const fetchMock = stubFetch(async () =>
      jsonResponse(200, { report: sampleReport }),
    );

    const result = await analyzeUrl("https://example.com/");

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.report.overallScore).toBe(70);
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/analyze",
      expect.objectContaining({
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: "https://example.com/" }),
      }),
    );
  });

  it("returns the server's error envelope unchanged", async () => {
    stubFetch(async () =>
      jsonResponse(400, {
        error: {
          code: "INVALID_URL",
          message: "Only http:// and https:// URLs are supported.",
          retryable: false,
        },
      }),
    );

    const result = await analyzeUrl("https://example.com:8443");

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("INVALID_URL");
      expect(result.error.retryable).toBe(false);
    }
  });

  it("converts malformed success payloads into a generic upstream failure", async () => {
    stubFetch(async () => jsonResponse(200, { report: { broken: true } }));

    const result = await analyzeUrl("https://example.com/");

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("UPSTREAM_FAILURE");
      expect(result.error.retryable).toBe(true);
    }
  });

  it("converts non-JSON responses into a generic upstream failure", async () => {
    stubFetch(
      async () => new Response("<html>gateway error</html>", { status: 502 }),
    );

    const result = await analyzeUrl("https://example.com/");

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("UPSTREAM_FAILURE");
  });

  it("converts invalid error envelopes into a generic upstream failure", async () => {
    stubFetch(async () => jsonResponse(500, { oops: true }));

    const result = await analyzeUrl("https://example.com/");

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.retryable).toBe(true);
  });

  it("converts network failures into a retryable network error", async () => {
    stubFetch(async () => {
      throw new TypeError("Failed to fetch");
    });

    const result = await analyzeUrl("https://example.com/");

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe(NETWORK_ERROR_CODE);
      expect(result.error.retryable).toBe(true);
    }
  });
});
