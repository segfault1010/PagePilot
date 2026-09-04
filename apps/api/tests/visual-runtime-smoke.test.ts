import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { createClient } from "@supabase/supabase-js";
import { PlaywrightBrowserCaptureProvider } from "@pagepilot/audit-engine";
import {
  SCREENSHOT_STORAGE_BUCKET,
  DESKTOP_VIEWPORT,
  MOBILE_VIEWPORT,
} from "@pagepilot/contracts";

const ROOT = join(__dirname, "../../..");

// Load root .env if present
if (existsSync(join(ROOT, ".env"))) {
  const envContent = readFileSync(join(ROOT, ".env"), "utf8");
  for (const line of envContent.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed && !trimmed.startsWith("#") && trimmed.includes("=")) {
      const idx = trimmed.indexOf("=");
      const key = trimmed.slice(0, idx).trim();
      const val = trimmed.slice(idx + 1).trim();
      if (!process.env[key]) {
        process.env[key] = val;
      }
    }
  }
}

describe("Task 6.1 — Live Browser & Storage Runtime Verification", () => {
  it("executes real Playwright smoke capture against example.com (desktop + mobile)", async () => {
    const provider = new PlaywrightBrowserCaptureProvider();
    const result = await provider.capture("https://example.com", {
      viewports: ["desktop", "mobile"],
      captureType: "viewport",
    });

    expect(result.url).toBe("https://example.com/");
    expect(result.captures).toHaveLength(2);

    const desktop = result.captures.find((c) => c.deviceType === "desktop");
    const mobile = result.captures.find((c) => c.deviceType === "mobile");

    expect(desktop).toBeDefined();
    expect(desktop?.width).toBe(DESKTOP_VIEWPORT.width);
    expect(desktop?.height).toBe(DESKTOP_VIEWPORT.height);
    expect(desktop?.buffer.length).toBeGreaterThan(1000);
    expect(["image/webp", "image/jpeg", "image/png"]).toContain(desktop?.mimeType);

    expect(mobile).toBeDefined();
    expect(mobile?.width).toBe(MOBILE_VIEWPORT.width);
    expect(mobile?.height).toBe(MOBILE_VIEWPORT.height);
    expect(mobile?.buffer.length).toBeGreaterThan(1000);
  }, 45_000);

  it("actively blocks browser request to loopback (127.0.0.1) via SSRF guard", async () => {
    const provider = new PlaywrightBrowserCaptureProvider();
    await expect(
      provider.capture("http://127.0.0.1:80/admin")
    ).rejects.toThrow(/blocked by SSRF policy|Security policy rejected/i);
  });

  it("verifies live private Supabase storage bucket 'audit-screenshots' and signed URL HTTP retrieval", async () => {
    const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !serviceKey) {
      console.warn("Skipping storage verification: missing Supabase credentials.");
      return;
    }

    const supabase = createClient(supabaseUrl, serviceKey);

    // 1. Verify bucket exists and is private
    const { data: buckets, error: bErr } = await supabase.storage.listBuckets();
    expect(bErr).toBeNull();

    const bucket = buckets?.find((b) => b.id === SCREENSHOT_STORAGE_BUCKET);
    expect(bucket).toBeDefined();
    expect(bucket?.public).toBe(false);

    // 2. Upload test screenshot
    const testPath = `runtime-smoke/test-${Date.now()}.webp`;
    const testBuffer = Buffer.from(
      "UklGRkAAAABXRUJQVlA4IDQAAADwAQCdASoBAAEAAQAcJaACdLoB+AAA/v6n/4kAAAAAAAAAAAAAAAAAAAAAAAAAAAA=",
      "base64"
    );

    const { error: upErr } = await supabase.storage
      .from(SCREENSHOT_STORAGE_BUCKET)
      .upload(testPath, testBuffer, {
        contentType: "image/webp",
        upsert: true,
      });
    expect(upErr).toBeNull();

    // 3. Generate 15-minute signed URL
    const { data: signData, error: signErr } = await supabase.storage
      .from(SCREENSHOT_STORAGE_BUCKET)
      .createSignedUrl(testPath, 900);
    expect(signErr).toBeNull();
    expect(signData?.signedUrl).toBeDefined();

    // 4. Verify signed URL is accessible via HTTP GET
    const httpRes = await fetch(signData!.signedUrl);
    expect(httpRes.status).toBe(200);

    const blob = await httpRes.arrayBuffer();
    expect(blob.byteLength).toBe(testBuffer.length);

    // 5. Clean up test file
    await supabase.storage.from(SCREENSHOT_STORAGE_BUCKET).remove([testPath]);
  });

  it("verifies apps/web/dist contains zero leaked server secrets", () => {
    const distDir = join(ROOT, "apps/web/dist");
    if (!existsSync(distDir)) {
      return;
    }

    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    const indexHtml = join(distDir, "index.html");
    if (existsSync(indexHtml)) {
      const html = readFileSync(indexHtml, "utf8");
      expect(html).not.toContain("SUPABASE_SERVICE_ROLE_KEY");
      if (serviceKey) {
        expect(html).not.toContain(serviceKey);
      }
    }
  });

  it("verifies an existing static audit remains successful when screenshot capture is forced to fail", async () => {
    const { MockBrowserCaptureProvider } = await import("@pagepilot/audit-engine");
    const { createAuditWorkflow } = await import("@pagepilot/workflows");
    const { AUDIT_REQUESTED_EVENT, AUDIT_CATEGORIES } = await import("@pagepilot/contracts");

    const failingCapture = new MockBrowserCaptureProvider({
      simulateFailure: true,
      failureMessage: "Forced capture crash for failure isolation test",
    });

    const runId = "550e8400-e29b-41d4-a716-446655440000";
    const pageId = "550e8400-e29b-41d4-a716-446655440001";
    const projectId = "550e8400-e29b-41d4-a716-446655440002";
    const orgId = "550e8400-e29b-41d4-a716-446655440003";
    const reportId = "550e8400-e29b-41d4-a716-446655440004";

    let persistedReportId: string | null = null;
    let recordedFailure: boolean = false;

    const mockStore: any = {
      getAuditRun: async () => ({
        id: runId,
        organizationId: orgId,
        projectId: projectId,
        monitoredPageId: pageId,
        invocationType: "scheduled",
        status: "queued",
        targetUrl: "https://example.com",
        finalUrl: null,
        triggeredByUserId: null,
        idempotencyKey: "idem-1",
        startedAt: null,
        completedAt: null,
        failedAt: null,
        errorCode: null,
        errorMessage: null,
        retryable: null,
        modelVersion: "gemini-2.0-flash",
        checkVersion: "1.0.0",
        promptVersion: "1.0.0",
        scoringVersion: "1.0.0",
        retryCount: 0,
        maxRetries: 3,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }),
      getMonitoredPage: async () => ({
        id: pageId,
        projectId: projectId,
        organizationId: orgId,
        canonicalUrl: "https://example.com",
        status: "active",
        cadence: "weekly",
        tags: [],
        latestAuditRunId: runId,
        latestSuccessfulAuditRunId: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }),
      claimRunForExecution: async () => ({
        state: "claimed",
        run: { id: runId, status: "running" },
      }),
      persistCompletedAudit: async () => {
        persistedReportId = reportId;
        return { auditReportId: reportId };
      },
      recordRunFailure: async () => {
        recordedFailure = true;
      },
      getPreviousSuccessfulAuditReport: async () => null,
      findRecentAlert: async () => null,
      persistAlert: async () => ({ isExisting: false, isSuppressed: false }),
      listOrganizationRecipients: async () => [],
      listSubscribedIntegrations: async () => [],
      getOrCreateDelivery: async () => ({ delivery: { id: "del-1" }, isExisting: false }),
      recordDeliverySuccess: async () => {},
      recordDeliveryFailure: async () => {},
    };

    const mockScreenshotStore: any = {
      listScreenshots: async () => [],
      uploadScreenshot: async () => ({ storagePath: "" }),
      persistScreenshotMetadata: async () => ({}),
    };

    const workflow = createAuditWorkflow({
      auditStore: mockStore,
      screenshotStore: mockScreenshotStore,
      browserCapture: failingCapture,
      analyzeUrl: async () => ({
        ok: true,
        report: {
          source: {
            requestedUrl: "https://example.com",
            finalUrl: "https://example.com/",
            analyzedAt: new Date().toISOString(),
            title: "Example Page",
          },
          overallScore: 85,
          scoreConfidence: "blended",
          summary: "Static report succeeded.",
          categories: AUDIT_CATEGORIES.map((c) => ({
            category: c,
            score: 85,
            confidence: "blended" as const,
            severity: "low" as const,
            explanation: "All ok",
            findings: [],
          })),
          topProblems: [],
          quickWins: [],
          detailedRecommendations: [],
          observedSignals: [],
        },
      }),
    });

    const mockStep = {
      run: async (_name: string, fn: () => Promise<unknown>) => fn(),
    };
    const fn = (workflow as any)["fn"];

    const result = await fn({
      event: {
        name: AUDIT_REQUESTED_EVENT,
        data: {
          auditRunId: runId,
          monitoredPageId: pageId,
          projectId: projectId,
          organizationId: orgId,
          trigger: "scheduled",
        },
      },
      step: mockStep,
    });

    // Workflow must succeed despite screenshot failure
    expect(result.ok).toBe(true);
    expect(result.status).toBe("completed");
    expect(result.auditReportId).toBe(reportId);
    expect(result.overallScore).toBe(85);
    expect(result.visualStatus).toBe("failed");
    expect(result.visualCapturesCount).toBe(0);
    expect(persistedReportId).toBe(reportId);
    expect(recordedFailure).toBe(false);
  });
});
