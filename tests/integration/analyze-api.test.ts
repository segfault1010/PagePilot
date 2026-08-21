import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "../../src/server/http/app";

describe("POST /api/analyze (Phase 1 shell)", () => {
  it("returns the stable not-implemented error envelope", async () => {
    const res = await request(createApp())
      .post("/api/analyze")
      .send({ url: "https://example.com" });

    expect(res.status).toBe(501);
    expect(res.body).toEqual({
      error: {
        code: "NOT_IMPLEMENTED",
        message: "Analysis is not implemented yet.",
        retryable: false,
      },
    });
  });

  it("rejects malformed JSON bodies with a 400 envelope", async () => {
    const res = await request(createApp())
      .post("/api/analyze")
      .set("Content-Type", "application/json")
      .send("{not json");

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("BAD_REQUEST");
    expect(typeof res.body.error.retryable).toBe("boolean");
  });

  it("rejects unsupported methods with a 405 envelope", async () => {
    const res = await request(createApp()).get("/api/analyze");

    expect(res.status).toBe(405);
    expect(res.body.error.code).toBe("METHOD_NOT_ALLOWED");
  });

  it("returns a 404 envelope for unknown API routes", async () => {
    const res = await request(createApp()).get("/api/nope");

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("NOT_FOUND");
  });
});
