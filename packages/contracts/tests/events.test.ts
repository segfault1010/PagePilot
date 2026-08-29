import { describe, expect, it } from "vitest";
import {
  AUDIT_COMPLETED_EVENT,
  AUDIT_FAILED_EVENT,
  AUDIT_REQUESTED_EVENT,
  auditCompletedPayloadSchema,
  auditFailedPayloadSchema,
  auditRequestedEventSchema,
  auditRequestedPayloadSchema,
} from "../src/events.js";

describe("Workflow Event Contracts", () => {
  const validPayload = {
    auditRunId: "550e8400-e29b-41d4-a716-446655440000",
    organizationId: "550e8400-e29b-41d4-a716-446655440001",
    projectId: "550e8400-e29b-41d4-a716-446655440002",
    monitoredPageId: "550e8400-e29b-41d4-a716-446655440003",
    requestedByUserId: "550e8400-e29b-41d4-a716-446655440004",
  };

  it("validates valid audit/requested payload", () => {
    const result = auditRequestedPayloadSchema.safeParse(validPayload);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.auditRunId).toBe(validPayload.auditRunId);
      expect(result.data.organizationId).toBe(validPayload.organizationId);
      expect(result.data.projectId).toBe(validPayload.projectId);
      expect(result.data.monitoredPageId).toBe(validPayload.monitoredPageId);
      expect(result.data.requestedByUserId).toBe(validPayload.requestedByUserId);
    }
  });

  it("allows optional/null requestedByUserId for scheduled/automated triggers", () => {
    const { requestedByUserId, ...withoutUser } = validPayload;
    const res1 = auditRequestedPayloadSchema.safeParse(withoutUser);
    expect(res1.success).toBe(true);

    const res2 = auditRequestedPayloadSchema.safeParse({
      ...validPayload,
      requestedByUserId: null,
    });
    expect(res2.success).toBe(true);
  });

  it("rejects non-UUID identifiers in audit/requested payload", () => {
    const invalid = {
      ...validPayload,
      auditRunId: "not-a-uuid",
    };
    const result = auditRequestedPayloadSchema.safeParse(invalid);
    expect(result.success).toBe(false);
  });

  it("rejects missing mandatory fields", () => {
    const missing = {
      auditRunId: validPayload.auditRunId,
      organizationId: validPayload.organizationId,
    };
    const result = auditRequestedPayloadSchema.safeParse(missing);
    expect(result.success).toBe(false);
  });

  it("validates full Inngest event structure", () => {
    const fullEvent = {
      name: AUDIT_REQUESTED_EVENT,
      data: validPayload,
      id: "event_123",
      ts: Date.now(),
    };
    const result = auditRequestedEventSchema.safeParse(fullEvent);
    expect(result.success).toBe(true);
  });

  it("rejects event with wrong name", () => {
    const wrongEvent = {
      name: "other/event",
      data: validPayload,
    };
    const result = auditRequestedEventSchema.safeParse(wrongEvent);
    expect(result.success).toBe(false);
  });

  it("validates audit/completed and audit/failed payloads", () => {
    const completedResult = auditCompletedPayloadSchema.safeParse({
      auditRunId: validPayload.auditRunId,
      organizationId: validPayload.organizationId,
      projectId: validPayload.projectId,
      monitoredPageId: validPayload.monitoredPageId,
      auditReportId: "550e8400-e29b-41d4-a716-446655440005",
      overallScore: 88,
      completedAt: new Date().toISOString(),
    });
    expect(completedResult.success).toBe(true);

    const failedResult = auditFailedPayloadSchema.safeParse({
      auditRunId: validPayload.auditRunId,
      organizationId: validPayload.organizationId,
      projectId: validPayload.projectId,
      monitoredPageId: validPayload.monitoredPageId,
      errorCode: "UPSTREAM_FAILURE",
      errorMessage: "Target timed out.",
      retryable: true,
      failedAt: new Date().toISOString(),
    });
    expect(failedResult.success).toBe(true);
  });

  it("event names are strictly defined constants", () => {
    expect(AUDIT_REQUESTED_EVENT).toBe("audit/requested");
    expect(AUDIT_COMPLETED_EVENT).toBe("audit/completed");
    expect(AUDIT_FAILED_EVENT).toBe("audit/failed");
  });
});
