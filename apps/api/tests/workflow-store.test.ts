import { describe, expect, it, vi } from "vitest";
import { SupabaseWorkflowPersistenceStore } from "../src/audits/supabase-workflow-store.js";
import { sampleReport } from "./fixtures/reports.js";

describe("SupabaseWorkflowPersistenceStore", () => {
  const orgId = "550e8400-e29b-41d4-a716-446655440001";
  const projectId = "550e8400-e29b-41d4-a716-446655440002";
  const pageId = "550e8400-e29b-41d4-a716-446655440003";
  const runId = "550e8400-e29b-41d4-a716-446655440000";

  const rawRunRow = {
    id: runId,
    monitored_page_id: pageId,
    project_id: projectId,
    organization_id: orgId,
    invocation_type: "manual",
    status: "requested",
    target_url: "https://example.com",
    final_url: null,
    triggered_by_user_id: "550e8400-e29b-41d4-a716-446655440004",
    idempotency_key: "idemp-key-1",
    started_at: null,
    completed_at: null,
    failed_at: null,
    error_code: null,
    error_message: null,
    retryable: null,
    model_version: "gemini-3.6-flash",
    check_version: "1.0.0",
    prompt_version: "1.0.0",
    scoring_version: "1.0.0",
    retry_count: 0,
    max_retries: 3,
    created_at: "2026-08-28T10:00:00.000Z",
    updated_at: "2026-08-28T10:00:00.000Z",
  };

  const rawPageRow = {
    id: pageId,
    project_id: projectId,
    organization_id: orgId,
    canonical_url: "https://example.com",
    cadence: "weekly",
    status: "active",
    owner_id: null,
    tags: ["landing"],
    latest_audit_run_id: runId,
    latest_successful_audit_run_id: null,
    created_at: "2026-08-28T10:00:00.000Z",
    updated_at: "2026-08-28T10:00:00.000Z",
  };

  it("getAuditRun returns mapped AuditRun entity", async () => {
    const mockClient = {
      from: vi.fn((table: string) => {
        expect(table).toBe("audit_runs");
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn().mockResolvedValue({ data: rawRunRow, error: null }),
        };
      }),
    } as any;

    const store = new SupabaseWorkflowPersistenceStore(mockClient);
    const run = await store.getAuditRun(runId);

    expect(run).not.toBeNull();
    expect(run?.id).toBe(runId);
    expect(run?.monitoredPageId).toBe(pageId);
    expect(run?.organizationId).toBe(orgId);
    expect(run?.status).toBe("requested");
  });

  it("getMonitoredPage returns mapped MonitoredPage entity", async () => {
    const mockClient = {
      from: vi.fn((table: string) => {
        expect(table).toBe("monitored_pages");
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn().mockResolvedValue({ data: rawPageRow, error: null }),
        };
      }),
    } as any;

    const store = new SupabaseWorkflowPersistenceStore(mockClient);
    const page = await store.getMonitoredPage(orgId, projectId, pageId);

    expect(page).not.toBeNull();
    expect(page?.id).toBe(pageId);
    expect(page?.canonicalUrl).toBe("https://example.com");
  });

  it("claimRunForExecution transitions requested -> running and returns claimed state", async () => {
    const updatedRow = {
      ...rawRunRow,
      status: "running",
      started_at: "2026-08-28T10:01:00.000Z",
    };

    let callCount = 0;
    const mockClient = {
      from: vi.fn((table: string) => {
        expect(table).toBe("audit_runs");
        callCount++;
        if (callCount === 1) {
          // Initial select
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({ data: rawRunRow, error: null }),
          };
        } else {
          // Atomic update
          return {
            update: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            in: vi.fn().mockReturnThis(),
            select: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({ data: updatedRow, error: null }),
          };
        }
      }),
    } as any;

    const store = new SupabaseWorkflowPersistenceStore(mockClient);
    const result = await store.claimRunForExecution(orgId, runId);

    expect(result.state).toBe("claimed");
    if (result.state === "claimed") {
      expect(result.run.status).toBe("running");
    }
  });

  it("claimRunForExecution detects already completed run", async () => {
    const completedRow = { ...rawRunRow, status: "completed" };
    const mockClient = {
      from: vi.fn(() => ({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockResolvedValue({ data: completedRow, error: null }),
      })),
    } as any;

    const store = new SupabaseWorkflowPersistenceStore(mockClient);
    const result = await store.claimRunForExecution(orgId, runId);

    expect(result.state).toBe("already_completed");
    if (result.state === "already_completed") {
      expect(result.run.status).toBe("completed");
    }
  });

  it("claimRunForExecution detects already running run", async () => {
    const runningRow = { ...rawRunRow, status: "running" };
    const mockClient = {
      from: vi.fn(() => ({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockResolvedValue({ data: runningRow, error: null }),
      })),
    } as any;

    const store = new SupabaseWorkflowPersistenceStore(mockClient);
    const result = await store.claimRunForExecution(orgId, runId);

    expect(result.state).toBe("already_running");
    if (result.state === "already_running") {
      expect(result.run.status).toBe("running");
    }
  });

  it("persistCompletedAudit calls persist_completed_audit_report database RPC", async () => {
    const mockRpc = vi.fn().mockResolvedValue({
      data: "550e8400-e29b-41d4-a716-446655440005",
      error: null,
    });
    const mockClient = {
      rpc: mockRpc,
    } as any;

    const store = new SupabaseWorkflowPersistenceStore(mockClient);
    const result = await store.persistCompletedAudit(
      orgId,
      projectId,
      pageId,
      runId,
      "https://example.com/",
      sampleReport,
    );

    expect(result.auditReportId).toBe("550e8400-e29b-41d4-a716-446655440005");
    expect(mockRpc).toHaveBeenCalledWith(
      "persist_completed_audit_report",
      expect.objectContaining({
        p_org_id: orgId,
        p_project_id: projectId,
        p_page_id: pageId,
        p_run_id: runId,
        p_final_url: "https://example.com/",
        p_overall_score: 70,
      }),
    );
  });

  it("recordRunFailure records failure and preserves latest_successful_audit_run_id", async () => {
    const auditRunUpdate = vi.fn().mockReturnThis();
    const monitoredPageUpdate = vi.fn().mockReturnThis();
    const eqMock = vi.fn().mockReturnThis();

    const mockClient = {
      from: vi.fn((table: string) => {
        if (table === "audit_runs") {
          return {
            update: auditRunUpdate,
            eq: eqMock,
          };
        } else if (table === "monitored_pages") {
          return {
            update: monitoredPageUpdate,
            eq: eqMock,
          };
        }
        return {};
      }),
    } as any;

    const store = new SupabaseWorkflowPersistenceStore(mockClient);
    await store.recordRunFailure(orgId, projectId, pageId, runId, {
      code: "BLOCKED_DESTINATION",
      message: "Blocked IP.",
      retryable: false,
    });

    expect(auditRunUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "failed",
        error_code: "BLOCKED_DESTINATION",
        error_message: "Blocked IP.",
        retryable: false,
      }),
    );

    // Verifies latest_audit_run_id is updated, but latest_successful_audit_run_id is NOT updated
    expect(monitoredPageUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        latest_audit_run_id: runId,
      }),
    );
    expect(monitoredPageUpdate).not.toHaveBeenCalledWith(
      expect.objectContaining({
        latest_successful_audit_run_id: expect.anything(),
      }),
    );
  });
});
