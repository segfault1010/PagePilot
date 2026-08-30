import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createShareLink,
  getActiveShareLink,
  getPublicSharedReport,
  revokeShareLink,
} from "../src/features/share/api";

// Mock Supabase client
vi.mock("../src/features/auth/supabase-client", () => ({
  getSupabaseClient: () => ({
    auth: {
      getSession: vi.fn().mockResolvedValue({
        data: {
          session: {
            access_token: "mock-test-jwt-token",
          },
        },
      }),
    },
  }),
}));

describe("Share API Client", () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("calls POST /api/projects/:projectId/pages/:pageId/audits/:auditRunId/share with auth token and payload", async () => {
    const mockResponse = {
      shareLink: {
        id: "share-123",
        shareUrl: "/shared/reports/mock-token-abc",
        token: "mock-token-abc",
        expiresAt: "2026-09-30T00:00:00.000Z",
        createdAt: "2026-08-30T00:00:00.000Z",
      },
    };

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => mockResponse,
    });

    const result = await createShareLink("proj-1", "page-1", "run-1", {
      expiresInDays: 30,
    });

    expect(global.fetch).toHaveBeenCalledWith(
      "/api/projects/proj-1/pages/page-1/audits/run-1/share",
      expect.objectContaining({
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer mock-test-jwt-token",
        },
        body: JSON.stringify({ expiresInDays: 30 }),
      }),
    );
    expect(result).toEqual(mockResponse);
  });

  it("retrieves active share link metadata via GET", async () => {
    const mockMetadata = {
      id: "share-123",
      auditRunId: "run-1",
      auditReportId: "report-1",
      expiresAt: "2026-09-30T00:00:00.000Z",
      revokedAt: null,
      isRevoked: false,
      isExpired: false,
      createdAt: "2026-08-30T00:00:00.000Z",
      lastAccessedAt: null,
    };

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ shareLink: mockMetadata }),
    });

    const result = await getActiveShareLink("proj-1", "page-1", "run-1");

    expect(global.fetch).toHaveBeenCalledWith(
      "/api/projects/proj-1/pages/page-1/audits/run-1/share",
      expect.objectContaining({
        method: "GET",
        headers: expect.objectContaining({
          Authorization: "Bearer mock-test-jwt-token",
        }),
      }),
    );
    expect(result).toEqual(mockMetadata);
  });

  it("revokes a share link via DELETE", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ success: true, revokedShareId: "share-123" }),
    });

    const result = await revokeShareLink("proj-1", "share-123");

    expect(global.fetch).toHaveBeenCalledWith(
      "/api/projects/proj-1/share-links/share-123",
      expect.objectContaining({
        method: "DELETE",
        headers: expect.objectContaining({
          Authorization: "Bearer mock-test-jwt-token",
        }),
      }),
    );
    expect(result).toBe(true);
  });

  it("fetches public shared report without auth headers", async () => {
    const mockReportData = {
      report: {
        id: "rep-1",
        overallScore: 85,
        reportPayload: {
          summary: "Great SaaS hero section",
          overallScore: 85,
          scoreConfidence: "high",
          categoryScores: {},
          findings: [],
          topRecommendations: [],
        },
      },
      auditRun: {
        id: "run-1",
        targetUrl: "https://acme.com",
        modelVersion: "gemini-2.5-flash",
      },
      scoreSnapshots: [],
      findings: [],
      recommendations: [],
      shareMetadata: {
        id: "share-123",
        createdAt: "2026-08-30T00:00:00.000Z",
      },
    };

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => mockReportData,
    });

    const result = await getPublicSharedReport("valid-token-xyz");

    expect(global.fetch).toHaveBeenCalledWith(
      "/api/shared/reports/valid-token-xyz",
      expect.objectContaining({
        method: "GET",
        headers: {
          "Content-Type": "application/json",
        },
      }),
    );
    expect(result).toEqual(mockReportData);
  });

  it("throws safe 404 error when public token lookup fails", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
      json: async () => ({
        error: {
          code: "NOT_FOUND",
          message: "This report link is no longer available.",
        },
      }),
    });

    await expect(getPublicSharedReport("expired-or-revoked-token")).rejects.toThrow(
      "This report link is no longer available.",
    );
  });
});
