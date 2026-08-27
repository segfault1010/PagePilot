import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "../src/http/app.js";
import type { WorkspaceContext } from "@pagepilot/contracts";

describe("API Authentication & Authorization Middleware", () => {
  const validUser = {
    id: "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11",
    email: "growth@example.com",
    fullName: "Alex Growth",
  };

  const sampleWorkspace: WorkspaceContext = {
    user: { id: validUser.id, email: validUser.email },
    profile: {
      id: validUser.id,
      email: validUser.email,
      fullName: validUser.fullName,
      avatarUrl: null,
      createdAt: "2026-08-27T12:00:00.000Z",
      updatedAt: "2026-08-27T12:00:00.000Z",
    },
    organization: {
      id: "b0eebc99-9c0b-4ef8-bb6d-6bb9bd380a22",
      name: "Alex Growth's Workspace",
      slug: "alex-growth-a0eebc99",
      createdBy: validUser.id,
      createdAt: "2026-08-27T12:00:00.000Z",
      updatedAt: "2026-08-27T12:00:00.000Z",
    },
    membership: {
      id: "c0eebc99-9c0b-4ef8-bb6d-6bb9bd380a33",
      organizationId: "b0eebc99-9c0b-4ef8-bb6d-6bb9bd380a22",
      userId: validUser.id,
      role: "owner",
      createdAt: "2026-08-27T12:00:00.000Z",
      updatedAt: "2026-08-27T12:00:00.000Z",
    },
    role: "owner",
  };

  it("rejects unauthenticated requests to protected GET /api/workspace/me with 401", async () => {
    const app = createApp({
      verifyToken: async () => null,
      resolveWorkspace: async () => sampleWorkspace,
    });

    const res = await request(app).get("/api/workspace/me");
    expect(res.status).toBe(401);
    expect(res.body).toEqual({
      error: {
        code: "UNAUTHENTICATED",
        message: "Authentication required.",
        retryable: false,
      },
    });
  });

  it("rejects invalid/expired Bearer token with 401", async () => {
    const app = createApp({
      verifyToken: async (token) => {
        if (token === "valid-token") return validUser;
        return null;
      },
      resolveWorkspace: async () => sampleWorkspace,
    });

    const res = await request(app)
      .get("/api/workspace/me")
      .set("Authorization", "Bearer invalid-token");

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe("UNAUTHENTICATED");
  });

  it("returns verified workspace context for valid Bearer token", async () => {
    const app = createApp({
      verifyToken: async (token) => {
        if (token === "valid-token") return validUser;
        return null;
      },
      resolveWorkspace: async (user) => {
        expect(user.id).toBe(validUser.id);
        return sampleWorkspace;
      },
    });

    const res = await request(app)
      .get("/api/workspace/me")
      .set("Authorization", "Bearer valid-token");

    expect(res.status).toBe(200);
    expect(res.body.workspace).toEqual(sampleWorkspace);
    expect(res.body.workspace.user.id).toBe(validUser.id);
  });

  it("ignores client-supplied user headers and uses verified session identity", async () => {
    const app = createApp({
      verifyToken: async () => validUser,
      resolveWorkspace: async (user) => {
        // Assert user ID comes from verified session, not spoofed header
        expect(user.id).toBe(validUser.id);
        return sampleWorkspace;
      },
    });

    const res = await request(app)
      .get("/api/workspace/me")
      .set("Authorization", "Bearer valid-token")
      .set("x-user-id", "attacker-uuid")
      .set("x-organization-id", "attacker-org");

    expect(res.status).toBe(200);
    expect(res.body.workspace.user.id).toBe(validUser.id);
  });

  it("allows anonymous public requests to POST /api/analyze without token", async () => {
    const app = createApp({
      analyzeUrl: async () => ({
        ok: true,
        status: 200,
        report: {} as any,
      }),
    });

    const res = await request(app)
      .post("/api/analyze")
      .send({ url: "https://example.com" });

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("report");
  });
});
