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

  it("listEligibleWeeklyPages queries active weekly pages and maps project timezone", async () => {
    const rawJoinRows = [
      {
        ...rawPageRow,
        id: "page-1",
        projects: { timezone: "America/New_York", name: "Project Alpha" },
      },
      {
        ...rawPageRow,
        id: "page-2",
        projects: null,
      },
    ];

    const mockClient = {
      from: vi.fn((table: string) => {
        expect(table).toBe("monitored_pages");
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          range: vi.fn().mockResolvedValue({ data: rawJoinRows, error: null }),
        };
      }),
    } as any;

    const store = new SupabaseWorkflowPersistenceStore(mockClient);
    const pages = await store.listEligibleWeeklyPages();

    expect(pages).toHaveLength(2);
    expect(pages[0]?.id).toBe("page-1");
    expect(pages[0]?.timezone).toBe("America/New_York");
    expect(pages[0]?.projectName).toBe("Project Alpha");
    expect(pages[1]?.id).toBe("page-2");
    expect(pages[1]?.timezone).toBe("UTC"); // Fallback to UTC
  });

  it("createScheduledAuditRun inserts new run with invocation_type = scheduled and updates latest pointer", async () => {
    const newRunRow = {
      ...rawRunRow,
      id: "run-scheduled-new",
      invocation_type: "scheduled",
      idempotency_key: "scheduled:page-1:2026-W35",
      triggered_by_user_id: null,
    };

    const mockClient = {
      from: vi.fn((table: string) => {
        if (table === "audit_runs") {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
            insert: vi.fn().mockReturnValue({
              select: vi.fn().mockReturnValue({
                single: vi.fn().mockResolvedValue({ data: newRunRow, error: null }),
              }),
            }),
          };
        } else if (table === "monitored_pages") {
          return {
            update: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnThis(),
            }),
          };
        }
        return {};
      }),
    } as any;

    const store = new SupabaseWorkflowPersistenceStore(mockClient);
    const result = await store.createScheduledAuditRun(
      {
        id: "page-1",
        projectId,
        organizationId: orgId,
        canonicalUrl: "https://example.com",
        cadence: "weekly",
        status: "active",
        ownerId: null,
        tags: [],
        latestAuditRunId: null,
        latestSuccessfulAuditRunId: null,
        createdAt: "2026-08-20T00:00:00Z",
        updatedAt: "2026-08-20T00:00:00Z",
      },
      "scheduled:page-1:2026-W35",
    );

    expect(result.isExisting).toBe(false);
    expect(result.run.id).toBe("run-scheduled-new");
    expect(result.run.invocationType).toBe("scheduled");
    expect(result.run.triggeredByUserId).toBeNull();
  });

  it("createScheduledAuditRun detects existing run and returns isExisting = true", async () => {
    const existingRunRow = {
      ...rawRunRow,
      id: "run-scheduled-existing",
      invocation_type: "scheduled",
      idempotency_key: "scheduled:page-1:2026-W35",
    };

    const mockClient = {
      from: vi.fn((table: string) => {
        expect(table).toBe("audit_runs");
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn().mockResolvedValue({ data: existingRunRow, error: null }),
        };
      }),
    } as any;

    const store = new SupabaseWorkflowPersistenceStore(mockClient);
    const result = await store.createScheduledAuditRun(
      {
        id: "page-1",
        projectId,
        organizationId: orgId,
        canonicalUrl: "https://example.com",
        cadence: "weekly",
        status: "active",
        ownerId: null,
        tags: [],
        latestAuditRunId: null,
        latestSuccessfulAuditRunId: null,
        createdAt: "2026-08-20T00:00:00Z",
        updatedAt: "2026-08-20T00:00:00Z",
      },
      "scheduled:page-1:2026-W35",
    );

    expect(result.isExisting).toBe(true);
    expect(result.run.id).toBe("run-scheduled-existing");
  });

  it("getPreviousSuccessfulAuditReport returns report payload from latest report", async () => {
    const mockClient = {
      from: vi.fn((table: string) => {
        expect(table).toBe("audit_reports");
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          order: vi.fn().mockReturnThis(),
          neq: vi.fn().mockReturnThis(),
          limit: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn().mockResolvedValue({
            data: { report_payload: sampleReport },
            error: null,
          }),
        };
      }),
    } as any;

    const store = new SupabaseWorkflowPersistenceStore(mockClient);
    const report = await store.getPreviousSuccessfulAuditReport(
      orgId,
      projectId,
      pageId,
      runId,
    );

    expect(report).not.toBeNull();
    expect(report?.overallScore).toBe(sampleReport.overallScore);
  });

  it("persistAlert inserts new alert and handles 24-hour suppression for identical ongoing conditions", async () => {
    const rawAlertRow = {
      id: "alert-1",
      organization_id: orgId,
      project_id: projectId,
      monitored_page_id: pageId,
      audit_run_id: runId,
      rule_type: "overall_score_drop",
      severity: "high",
      title: "Overall UX Score Regressed",
      reason_code: "SCORE_DROP_EXCEEDED",
      reason_summary: "Score dropped by 15 pts.",
      reason_details: null,
      category: null,
      target_id: null,
      score_delta: -15,
      previous_value: "80",
      current_value: "65",
      deduplication_key: `alert:${pageId}:overall_score_drop`,
      schema_version: "1.0.0",
      status: "created",
      metadata: {},
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    let selectCallCount = 0;
    const mockClient = {
      from: vi.fn((table: string) => {
        expect(table).toBe("alerts");
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          gte: vi.fn().mockReturnThis(),
          order: vi.fn().mockReturnThis(),
          limit: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn().mockImplementation(async () => {
            selectCallCount++;
            if (selectCallCount === 1) {
              // First call: no recent alert found
              return { data: null, error: null };
            } else {
              // Second call: recent alert found
              return { data: rawAlertRow, error: null };
            }
          }),
          insert: vi.fn().mockReturnValue({
            select: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue({ data: rawAlertRow, error: null }),
            }),
          }),
        };
      }),
    } as any;

    const store = new SupabaseWorkflowPersistenceStore(mockClient);

    // First call: fresh alert insertion
    const firstResult = await store.persistAlert({
      organizationId: orgId,
      projectId,
      monitoredPageId: pageId,
      auditRunId: runId,
      ruleType: "overall_score_drop",
      severity: "high",
      title: "Overall UX Score Regressed",
      reasonCode: "SCORE_DROP_EXCEEDED",
      reasonSummary: "Score dropped by 15 pts.",
      deduplicationKey: `alert:${pageId}:overall_score_drop`,
      scoreDelta: -15,
      previousValue: "80",
      currentValue: "65",
      schemaVersion: "1.0.0",
      status: "created",
      metadata: {},
    });

    expect(firstResult.isSuppressed).toBe(false);
    expect(firstResult.isExisting).toBe(false);
    expect(firstResult.alert.id).toBe("alert-1");

    // Second call: identical ongoing regression condition within 24h is suppressed
    const secondResult = await store.persistAlert({
      organizationId: orgId,
      projectId,
      monitoredPageId: pageId,
      auditRunId: "another-run-id",
      ruleType: "overall_score_drop",
      severity: "high",
      title: "Overall UX Score Regressed",
      reasonCode: "SCORE_DROP_EXCEEDED",
      reasonSummary: "Score dropped by 15 pts.",
      deduplicationKey: `alert:${pageId}:overall_score_drop`,
      scoreDelta: -15,
      previousValue: "80",
      currentValue: "65",
      schemaVersion: "1.0.0",
      status: "created",
      metadata: {},
    });

    expect(secondResult.isSuppressed).toBe(true);
    expect(secondResult.isExisting).toBe(false);
  });

  it("listOrganizationRecipients returns owner and admin emails", async () => {
    const mockClient = {
      from: vi.fn((table: string) => {
        expect(table).toBe("memberships");
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          in: vi.fn().mockResolvedValue({
            data: [
              { user_id: "user-1", role: "owner", profiles: { email: "owner@test.com" } },
              { user_id: "user-2", role: "admin", profiles: { email: "admin@test.com" } },
            ],
            error: null,
          }),
        };
      }),
    } as any;

    const store = new SupabaseWorkflowPersistenceStore(mockClient);
    const recipients = await store.listOrganizationRecipients(orgId);

    expect(recipients).toHaveLength(2);
    expect(recipients[0]?.email).toBe("owner@test.com");
    expect(recipients[1]?.role).toBe("admin");
  });

  it("getOrCreateDelivery creates delivery record and handles conflict idempotently", async () => {
    const rawDeliveryRow = {
      id: "del-1",
      alert_id: "alert-1",
      organization_id: orgId,
      channel: "email",
      recipient: "admin@test.com",
      delivery_key: "alert-1:email:admin@test.com",
      status: "pending",
      attempts: 0,
      metadata: {},
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    let findCalled = false;
    const mockClient = {
      from: vi.fn((table: string) => {
        expect(table).toBe("alert_deliveries");
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn().mockImplementation(async () => {
            if (!findCalled) {
              findCalled = true;
              return { data: null, error: null };
            }
            return { data: rawDeliveryRow, error: null };
          }),
          insert: vi.fn().mockReturnValue({
            select: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue({ data: rawDeliveryRow, error: null }),
            }),
          }),
        };
      }),
    } as any;

    const store = new SupabaseWorkflowPersistenceStore(mockClient);

    const first = await store.getOrCreateDelivery({
      alertId: "alert-1",
      organizationId: orgId,
      channel: "email",
      recipient: "admin@test.com",
      deliveryKey: "alert-1:email:admin@test.com",
      status: "pending",
      attempts: 0,
      metadata: {},
    });

    expect(first.isExisting).toBe(false);
    expect(first.delivery.deliveryKey).toBe("alert-1:email:admin@test.com");

    const second = await store.getOrCreateDelivery({
      alertId: "alert-1",
      organizationId: orgId,
      channel: "email",
      recipient: "admin@test.com",
      deliveryKey: "alert-1:email:admin@test.com",
      status: "pending",
      attempts: 0,
      metadata: {},
    });

    expect(second.isExisting).toBe(true);
    expect(second.delivery.id).toBe("del-1");
  });

  it("listSubscribedIntegrations queries active integrations, decrypts credentials, and filters by event", async () => {
    const { encryptCredentials } = await import("../src/integrations/crypto.js");
    const { encrypted: enc1 } = encryptCredentials({
      targetUrl: "https://hooks.slack.com/services/T00/B00/SECRET",
    });
    const { encrypted: enc2 } = encryptCredentials({
      targetUrl: "https://api.example.com/wh",
      signingSecret: "whsec_123",
    });

    const mockRows = [
      {
        id: "int-1",
        organization_id: orgId,
        project_id: projectId,
        provider: "slack",
        name: "Team Slack",
        status: "active",
        encrypted_credentials: enc1,
        events: ["overall_score_drop"],
        config: {},
      },
      {
        id: "int-2",
        organization_id: orgId,
        project_id: null, // Org-wide
        provider: "webhook",
        name: "Org Webhook",
        status: "active",
        encrypted_credentials: enc2,
        events: ["overall_score_drop", "new_high_severity_finding"],
        config: {},
      },
      {
        id: "int-3",
        organization_id: orgId,
        project_id: projectId,
        provider: "slack",
        name: "Other Events Slack",
        status: "active",
        encrypted_credentials: enc1,
        events: ["category_score_drop"], // Not subscribed to overall_score_drop
        config: {},
      },
    ];

    const mockClient = {
      from: vi.fn((table: string) => {
        expect(table).toBe("integration_connections");
        const query: any = {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          or: vi.fn().mockResolvedValue({ data: mockRows, error: null }),
        };
        return query;
      }),
    } as any;

    const store = new SupabaseWorkflowPersistenceStore(mockClient);
    const integrations = await store.listSubscribedIntegrations(
      orgId,
      projectId,
      "overall_score_drop",
    );

    expect(integrations).toHaveLength(2);
    expect(integrations[0]?.id).toBe("int-1");
    expect(integrations[0]?.targetUrl).toBe(
      "https://hooks.slack.com/services/T00/B00/SECRET",
    );
    expect(integrations[1]?.id).toBe("int-2");
    expect(integrations[1]?.signingSecret).toBe("whsec_123");
  });
});


