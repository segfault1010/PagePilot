import request from "supertest";
import { describe, expect, it } from "vitest";
import type { Response } from "supertest";
import {
  analyzeErrorResponseSchema,
  analyzeSuccessResponseSchema,
} from "../../src/shared/audit-types";
import { createApp } from "../../src/server/http/app";

function postJson(body: unknown): request.Test {
  return request(createApp()).post("/api/analyze").send(body as object);
}

function expectEnvelope(res: Response) {
  const parsed = analyzeErrorResponseSchema.safeParse(res.body);
  expect(parsed.success).toBe(true);
  expect(Object.keys(res.body).sort()).toEqual(["error"]);
  expect(Object.keys(res.body.error).sort()).toEqual([
    "code",
    "message",
    "retryable",
  ]);
  expect(typeof res.body.error.message).toBe("string");
  expect(typeof res.body.error.retryable).toBe("boolean");
}

describe("POST /api/analyze — request validation", () => {
  it("returns the placeholder report for a valid https URL", async () => {
    const res = await postJson({ url: "https://example.com" });

    expect(res.status).toBe(200);
    expect(analyzeSuccessResponseSchema.safeParse(res.body).success).toBe(true);
    expect(typeof res.body.report.overallScore).toBe("number");
    expect(res.headers["content-type"]).toMatch(/application\/json/);
  });

  it("returns the placeholder report for a valid http URL", async () => {
    const res = await postJson({ url: "http://example.com/page" });
    expect(res.status).toBe(200);
  });

  it("accepts explicit default ports", async () => {
    expect((await postJson({ url: "https://example.com:443" })).status).toBe(200);
    expect((await postJson({ url: "http://example.com:80" })).status).toBe(200);
  });

  it("rejects an empty URL with 400", async () => {
    const res = await postJson({ url: "" });
    expect(res.status).toBe(400);
    expectEnvelope(res);
    expect(res.body.error.code).toBe("BAD_REQUEST");
  });

  it("rejects a whitespace-only URL as an invalid URL", async () => {
    const res = await postJson({ url: "   " });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("INVALID_URL");
  });

  it("rejects a missing url field with 400", async () => {
    const res = await postJson({});
    expect(res.status).toBe(400);
    expectEnvelope(res);
    expect(res.body.error.code).toBe("BAD_REQUEST");
  });

  it("rejects a non-string url with 400", async () => {
    const res = await postJson({ url: 12345 });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("BAD_REQUEST");
  });

  it("rejects malformed URLs with 400 INVALID_URL", async () => {
    const res = await postJson({ url: "not a url" });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("INVALID_URL");
  });

  it("rejects non-absolute URLs (server does not prepend schemes)", async () => {
    const res = await postJson({ url: "example.com" });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("INVALID_URL");
  });

  it.each(["ftp://example.com", "javascript:alert(1)", "file:///etc/hosts"])(
    "rejects unsupported protocol %s with 400 INVALID_URL",
    async (url) => {
      const res = await postJson({ url });
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe("INVALID_URL");
      expect(res.body.error.message).toMatch(/http/i);
    },
  );

  it("rejects URLs with credentials", async () => {
    const res = await postJson({ url: "https://user:pass@example.com" });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("INVALID_URL");
  });

  it("rejects disallowed ports", async () => {
    for (const url of [
      "https://example.com:8443",
      "http://example.com:3128",
      "https://example.com:80",
    ]) {
      const res = await postJson({ url });
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe("INVALID_URL");
    }
  });
});

describe("POST /api/analyze — body handling", () => {
  it("rejects malformed JSON with a 400 envelope", async () => {
    const res = await request(createApp())
      .post("/api/analyze")
      .set("Content-Type", "application/json")
      .send("{not json");

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("BAD_REQUEST");
  });

  it("rejects a missing body with 400", async () => {
    const res = await request(createApp()).post("/api/analyze");
    expect(res.status).toBe(400);
    expectEnvelope(res);
  });

  it("rejects oversized bodies with 413 REQUEST_TOO_LARGE", async () => {
    const res = await postJson({
      url: `https://example.com/${"a".repeat(5000)}`,
    });
    expect(res.status).toBe(413);
    expect(res.body.error.code).toBe("REQUEST_TOO_LARGE");
    expect(res.body.error.retryable).toBe(false);
  });
});

describe("API surface", () => {
  it("rejects GET /api/analyze with 405 and an Allow header", async () => {
    const res = await request(createApp()).get("/api/analyze");

    expect(res.status).toBe(405);
    expect(res.headers.allow).toBe("POST");
    expect(res.body.error.code).toBe("METHOD_NOT_ALLOWED");
  });

  it("rejects DELETE /api/analyze with 405", async () => {
    const res = await request(createApp()).delete("/api/analyze");
    expect(res.status).toBe(405);
    expect(res.body.error.code).toBe("METHOD_NOT_ALLOWED");
  });

  it("returns a 404 envelope for unknown API routes", async () => {
    const res = await request(createApp()).get("/api/nope");
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("NOT_FOUND");
  });

  it("never leaks stack traces or internal details in errors", async () => {
    const res = await postJson({ url: "not a url" });
    const serialized = JSON.stringify(res.body);

    expect(serialized).not.toMatch(/at .*\(/);
    expect(serialized.toLowerCase()).not.toContain("stack");
    expect(Object.keys(res.body)).toEqual(["error"]);
  });
});
