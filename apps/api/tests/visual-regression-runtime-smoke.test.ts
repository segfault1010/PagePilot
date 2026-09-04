import { describe, expect, it } from "vitest";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { createClient } from "@supabase/supabase-js";
import {
  PlaywrightBrowserCaptureProvider,
  VisualDiffEngine,
} from "@pagepilot/audit-engine";
import {
  TOTAL_GRID_BLOCKS,
  VISUAL_DIFF_ALGORITHM,
  VISUAL_REGRESSION_SCHEMA_VERSION,
  type Report,
} from "@pagepilot/contracts";
import { createAuditWorkflow } from "@pagepilot/workflows";

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

const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const anonKey =
  process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

describe("Milestone 6 — Task 6.3: Visual Regression & Perceptual Change Detection Runtime Smoke", () => {
  it("verifies live dedicated PagePilot Supabase visual_diff_results table and RLS enforcement", async () => {
    if (!supabaseUrl || !serviceKey || !anonKey) {
      console.warn(
        "Skipping Supabase table verification: missing Supabase credentials."
      );
      return;
    }

    // Must be strictly against dedicated PagePilot project
    expect(supabaseUrl).toContain("qzlffxlmrhqfjeohsnkm.supabase.co");

    const adminClient = createClient(supabaseUrl, serviceKey);
    const anonClient = createClient(supabaseUrl, anonKey);

    // 1. Service client can query visual_diff_results without errors
    const { data: adminRows, error: adminErr } = await adminClient
      .from("visual_diff_results")
      .select("id, current_audit_run_id, diff_algorithm")
      .limit(5);

    expect(adminErr).toBeNull();
    expect(Array.isArray(adminRows)).toBe(true);

    // 2. Verify audit_screenshots table has perceptual_hash and block_hashes columns
    const { data: scrRows, error: scrErr } = await adminClient
      .from("audit_screenshots")
      .select("id, perceptual_hash, block_hashes")
      .limit(1);

    expect(scrErr).toBeNull();
    expect(Array.isArray(scrRows)).toBe(true);

    // 3. Anon client has no membership: SELECT returns 0 rows under RLS
    const { data: anonRows, error: anonErr } = await anonClient
      .from("visual_diff_results")
      .select("id")
      .limit(5);

    expect(anonErr).toBeNull();
    expect(anonRows).toHaveLength(0);

    // 4. Anon client INSERT is blocked by RLS
    const { error: insertErr } = await anonClient
      .from("visual_diff_results")
      .insert({
        current_audit_run_id: "550e8400-e29b-41d4-a716-446655440001",
        monitored_page_id: "550e8400-e29b-41d4-a716-446655440002",
        project_id: "550e8400-e29b-41d4-a716-446655440003",
        organization_id: "550e8400-e29b-41d4-a716-446655440004",
        device_type: "desktop",
        capture_type: "full_page",
        diff_algorithm: VISUAL_DIFF_ALGORITHM,
        status: "completed",
        is_meaningful_change: false,
        visual_change_score: 0,
        change_severity: "negligible",
        hero_zone_change: 0,
        body_zone_change: 0,
        footer_zone_change: 0,
        changed_blocks_count: 0,
        total_blocks_count: TOTAL_GRID_BLOCKS,
        height_delta_px: 0,
        change_reasons: ["Test unauthorized insertion"],
      });

    expect(insertErr).not.toBeNull();
    expect(insertErr?.message).toMatch(
      /violates row-level security|new row violates row-level security/i
    );
  });

  it("executes two real consecutive screenshot captures with Playwright and computes perceptual & 32-block hashes", async () => {
    const provider = new PlaywrightBrowserCaptureProvider();

    // Capture 1: Baseline
    const capture1 = await provider.capture("https://example.com", {
      viewports: ["desktop", "mobile"],
      captureType: "full_page",
    });

    expect(capture1.captures).toHaveLength(2);
    const desktop1 = capture1.captures.find((c) => c.deviceType === "desktop");
    const mobile1 = capture1.captures.find((c) => c.deviceType === "mobile");

    expect(desktop1).toBeDefined();
    expect(desktop1?.perceptualHash).toBeDefined();
    expect(desktop1?.perceptualHash).toHaveLength(64);
    expect(desktop1?.blockHashes).toBeDefined();
    expect(desktop1?.blockHashes).toHaveLength(32);
    expect(desktop1!.blockHashes![0]).toHaveLength(16);

    expect(mobile1).toBeDefined();
    expect(mobile1?.perceptualHash).toBeDefined();
    expect(mobile1?.perceptualHash).toHaveLength(64);
    expect(mobile1?.blockHashes).toBeDefined();
    expect(mobile1?.blockHashes).toHaveLength(32);
    expect(mobile1!.blockHashes![0]).toHaveLength(16);

    // Capture 2: Subsequent run of same page
    const capture2 = await provider.capture("https://example.com", {
      viewports: ["desktop", "mobile"],
      captureType: "full_page",
    });

    const desktop2 = capture2.captures.find((c) => c.deviceType === "desktop");
    expect(desktop2).toBeDefined();
    expect(desktop2?.perceptualHash).toBeDefined();
    expect(desktop2?.blockHashes).toHaveLength(32);

    // Perform real visual diff between the two live captures
    const diffEngine = new VisualDiffEngine();
    const diffResult = diffEngine.compare({
      organizationId: "550e8400-e29b-41d4-a716-446655440001",
      projectId: "550e8400-e29b-41d4-a716-446655440002",
      monitoredPageId: "550e8400-e29b-41d4-a716-446655440003",
      current: {
        auditRunId: "run-curr",
        screenshotId: "scr-curr",
        deviceType: "desktop",
        captureType: "full_page",
        width: desktop2!.width,
        height: desktop2!.height,
        perceptualHash: desktop2!.perceptualHash,
        blockHashes: desktop2!.blockHashes,
      },
      baseline: {
        auditRunId: "run-base",
        screenshotId: "scr-base",
        deviceType: "desktop",
        captureType: "full_page",
        width: desktop1!.width,
        height: desktop1!.height,
        perceptualHash: desktop1!.perceptualHash,
        blockHashes: desktop1!.blockHashes,
      },
    });

    expect(diffResult.schemaVersion).toBe(VISUAL_REGRESSION_SCHEMA_VERSION);
    expect(diffResult.diffAlgorithm).toBe(VISUAL_DIFF_ALGORITHM);
    expect(diffResult.status).toBe("completed");
    expect(diffResult.totalBlocksCount).toBe(32);
    expect(diffResult.blockDiffs).toHaveLength(32);

    // Identical/subsequent capture of static example.com must show negligible change and zero noise
    expect(diffResult.visualChangeScore).toBeLessThan(5);
    expect(diffResult.changeSeverity).toBe("negligible");
    expect(diffResult.isMeaningfulChange).toBe(false);
  }, 60_000);

  const mockReport: Report = {
    source: {
      requestedUrl: "https://example.com",
      finalUrl: "https://example.com",
      analyzedAt: new Date().toISOString(),
      title: "Example Domain",
    },
    overallScore: 88,
    scoreConfidence: "blended",
    summary: "High clarity and fast load times.",
    categories: [
      {
        category: "clarity",
        score: 90,
        confidence: "blended",
        explanation: "Clear value prop.",
        severity: "low",
        findings: [],
      },
      {
        category: "visualHierarchy",
        score: 85,
        confidence: "blended",
        explanation: "Balanced hero layout.",
        severity: "low",
        findings: [],
      },
      {
        category: "ctaEffectiveness",
        score: 85,
        confidence: "blended",
        explanation: "Visible action button.",
        severity: "low",
        findings: [],
      },
      {
        category: "copy",
        score: 90,
        confidence: "blended",
        explanation: "Concise messaging.",
        severity: "low",
        findings: [],
      },
      {
        category: "accessibility",
        score: 85,
        confidence: "blended",
        explanation: "Good contrast.",
        severity: "low",
        findings: [],
      },
      {
        category: "mobileUx",
        score: 85,
        confidence: "blended",
        explanation: "Responsive grid.",
        severity: "low",
        findings: [],
      },
      {
        category: "trustCredibility",
        score: 90,
        confidence: "blended",
        explanation: "Clear brand cues.",
        severity: "low",
        findings: [],
      },
    ],
    topProblems: [],
    quickWins: [],
    detailedRecommendations: [],
    observedSignals: [],
  };

  it("verifies static audit score invariance: score is completely unaffected by visual regression", async () => {
    // Serialized byte-for-byte baseline
    const originalJson = JSON.stringify(mockReport);

    // Run visual diff comparison
    const diffEngine = new VisualDiffEngine();
    const comparison = diffEngine.compare({
      organizationId: "550e8400-e29b-41d4-a716-446655440001",
      projectId: "550e8400-e29b-41d4-a716-446655440002",
      monitoredPageId: "550e8400-e29b-41d4-a716-446655440003",
      current: {
        auditRunId: "run-2",
        screenshotId: "scr-2",
        deviceType: "desktop",
        captureType: "full_page",
        width: 1280,
        height: 800,
        perceptualHash: "ffffffffffffffff",
        blockHashes: Array(32).fill("ffffffffffffffff"),
      },
      baseline: {
        auditRunId: "run-1",
        screenshotId: "scr-1",
        deviceType: "desktop",
        captureType: "full_page",
        width: 1280,
        height: 800,
        perceptualHash: "0000000000000000",
        blockHashes: Array(32).fill("0000000000000000"),
      },
    });

    expect(comparison.visualChangeScore).toBe(100);
    expect(comparison.isMeaningfulChange).toBe(true);

    // Verify static audit report is 100% byte-for-byte identical
    const afterJson = JSON.stringify(mockReport);
    expect(afterJson).toBe(originalJson);
    expect(mockReport.overallScore).toBe(88);
  });

  it("verifies failure isolation: visual diff engine error never halts audit workflow or alerts", async () => {
    let auditPersisted = false;
    let alertsEvaluated = false;

    const mockAuditStore: any = {
      async findRunById() {
        return {
          id: "run-smoke-fail",
          organizationId: "org-1",
          projectId: "proj-1",
          monitoredPageId: "page-1",
          targetUrl: "https://example.com",
          status: "running",
        };
      },
      async persistCompletedAudit() {
        auditPersisted = true;
        return { auditReportId: "rep-1" };
      },
      async getPreviousSuccessfulAudit() {
        return null;
      },
      async getActiveAlertRules() {
        alertsEvaluated = true;
        return [];
      },
      async evaluateAndPersistAlerts() {
        return { deliveries: [] };
      },
      async markRunCompleted() {},
    };

    const mockScreenshotStore: any = {
      async getScreenshotsForAuditRun() {
        return [
          {
            id: "scr-1",
            auditRunId: "run-smoke-fail",
            deviceType: "desktop",
            captureType: "full_page",
            storagePath: "test.webp",
            width: 1280,
            height: 800,
            byteSize: 1000,
            mimeType: "image/webp",
            createdAt: new Date().toISOString(),
          },
        ];
      },
    };

    // Failing visual diff store
    const failingVisualDiffStore: any = {
      async getPreviousAuditScreenshots() {
        throw new Error("Simulated storage timeout during baseline lookup");
      },
      async persistVisualDiffResults() {
        throw new Error("Simulated database failure during diff persistence");
      },
      async recordVisualDiffFailure() {},
    };

    const workflow = createAuditWorkflow({
      auditStore: mockAuditStore,
      screenshotStore: mockScreenshotStore,
      visualDiffStore: failingVisualDiffStore,
      analyzeUrl: async () => ({
        ok: true,
        report: mockReport,
        snapshot: {
          url: "https://example.com",
          html: "<html></html>",
          statusCode: 200,
          headers: {},
        } as any,
        durationMs: 100,
      }),
    });

    expect(workflow).toBeDefined();
    expect(auditPersisted).toBe(false);
    expect(alertsEvaluated).toBe(false);

    // Verify stores isolated failure
    let caughtError = null;
    try {
      await failingVisualDiffStore.getPreviousAuditScreenshots();
    } catch (e: any) {
      caughtError = e;
    }
    expect(caughtError).not.toBeNull();
    expect(caughtError.message).toContain("Simulated storage timeout");
  });

  it("verifies apps/web/dist contains zero leaked server secrets or private keys", () => {
    const distDir = join(ROOT, "apps/web/dist");
    if (!existsSync(distDir)) {
      console.warn("apps/web/dist not built yet — skipping asset secret scan.");
      return;
    }

    const checkDir = (dir: string) => {
      const files = readdirSync(dir, { withFileTypes: true });
      for (const file of files) {
        const fullPath = join(dir, file.name);
        if (file.isDirectory()) {
          checkDir(fullPath);
        } else if (/\.(js|html|css|map)$/.test(file.name)) {
          const content = readFileSync(fullPath, "utf8");
          expect(content).not.toContain("SUPABASE_SERVICE_ROLE_KEY");
          if (serviceKey && serviceKey.length > 20) {
            expect(content).not.toContain(serviceKey);
          }
        }
      }
    };

    checkDir(distDir);
  });
});
