import { describe, expect, it } from "vitest";
import {
  ALERT_SCHEMA_VERSION,
  alertCreatedPayloadSchema,
  alertDeliveryEntitySchema,
  alertEntitySchema,
  buildAlertDeliveryKey,
} from "../src/index.js";

describe("Alert Persistence Contracts", () => {
  const validAlert = {
    id: "11111111-1111-4111-8111-111111111111",
    organizationId: "22222222-2222-4222-8222-222222222222",
    projectId: "33333333-3333-4333-8333-333333333333",
    monitoredPageId: "44444444-4444-4444-8444-444444444444",
    auditRunId: "55555555-5555-4555-8555-555555555555",
    ruleType: "overall_score_drop",
    severity: "high",
    title: "Overall UX Score Regressed",
    reasonCode: "SCORE_DROP_EXCEEDED",
    reasonSummary: "Overall score dropped by 12 points.",
    reasonDetails: "Score dropped from 80 to 68.",
    category: null,
    targetId: null,
    scoreDelta: -12,
    previousValue: 80,
    currentValue: 68,
    deduplicationKey: "alert:44444444-4444-4444-8444-444444444444:overall_score_drop",
    schemaVersion: ALERT_SCHEMA_VERSION,
    status: "created",
    metadata: {},
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  const validDelivery = {
    id: "66666666-6666-4666-8666-666666666666",
    alertId: "11111111-1111-4111-8111-111111111111",
    organizationId: "22222222-2222-4222-8222-222222222222",
    channel: "email",
    recipient: "admin@example.com",
    deliveryKey: "11111111-1111-4111-8111-111111111111:email:admin@example.com",
    status: "pending",
    attempts: 0,
    lastAttemptedAt: null,
    deliveredAt: null,
    errorMessage: null,
    metadata: {},
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  it("validates well-formed AlertEntity schemas", () => {
    const parsed = alertEntitySchema.parse(validAlert);
    expect(parsed.id).toBe(validAlert.id);
    expect(parsed.severity).toBe("high");
    expect(parsed.status).toBe("created");
  });

  it("rejects AlertEntity with invalid status or severity", () => {
    expect(() =>
      alertEntitySchema.parse({
        ...validAlert,
        status: "invalid_status",
      }),
    ).toThrow();

    expect(() =>
      alertEntitySchema.parse({
        ...validAlert,
        severity: "extreme",
      }),
    ).toThrow();
  });

  it("validates well-formed AlertDeliveryEntity schemas", () => {
    const parsed = alertDeliveryEntitySchema.parse(validDelivery);
    expect(parsed.id).toBe(validDelivery.id);
    expect(parsed.channel).toBe("email");
    expect(parsed.status).toBe("pending");
  });

  it("rejects AlertDeliveryEntity with invalid channel or status", () => {
    expect(() =>
      alertDeliveryEntitySchema.parse({
        ...validDelivery,
        channel: "sms",
      }),
    ).toThrow();

    expect(() =>
      alertDeliveryEntitySchema.parse({
        ...validDelivery,
        status: "in_progress",
      }),
    ).toThrow();
  });

  it("builds normalized deterministic delivery keys", () => {
    const key = buildAlertDeliveryKey(
      "11111111-1111-1111-1111-111111111111",
      "email",
      "  Admin@Example.COM  ",
    );
    expect(key).toBe("11111111-1111-1111-1111-111111111111:email:admin@example.com");
  });

  it("validates alertCreatedPayloadSchema", () => {
    const payload = {
      alertId: "11111111-1111-4111-8111-111111111111",
      organizationId: "22222222-2222-4222-8222-222222222222",
      projectId: "33333333-3333-4333-8333-333333333333",
      monitoredPageId: "44444444-4444-4444-8444-444444444444",
      auditRunId: "55555555-5555-4555-8555-555555555555",
    };

    const parsed = alertCreatedPayloadSchema.parse(payload);
    expect(parsed.alertId).toBe(payload.alertId);
    expect(parsed.monitoredPageId).toBe(payload.monitoredPageId);

    // Rejects non-UUID
    expect(() =>
      alertCreatedPayloadSchema.parse({
        ...payload,
        alertId: "invalid-uuid",
      }),
    ).toThrow();
  });
});
