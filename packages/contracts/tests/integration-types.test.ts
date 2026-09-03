import { describe, expect, it } from "vitest";
import {
  createIntegrationConnectionSchema,
  integrationConnectionSchema,
  updateIntegrationConnectionSchema,
  testIntegrationResponseSchema,
  PAGEPILOT_SIGNATURE_HEADER,
  PAGEPILOT_TIMESTAMP_HEADER,
  DEFAULT_WEBHOOK_TOLERANCE_SECONDS,
  DELIVERY_CHANNELS,
} from "../src/index.js";

describe("Integration Contracts & Validation", () => {
  it("defines standard headers and constants", () => {
    expect(PAGEPILOT_SIGNATURE_HEADER).toBe("x-pagepilot-signature");
    expect(PAGEPILOT_TIMESTAMP_HEADER).toBe("x-pagepilot-timestamp");
    expect(DEFAULT_WEBHOOK_TOLERANCE_SECONDS).toBe(300);
    expect(DELIVERY_CHANNELS).toContain("email");
    expect(DELIVERY_CHANNELS).toContain("slack");
    expect(DELIVERY_CHANNELS).toContain("webhook");
  });

  describe("createIntegrationConnectionSchema", () => {
    it("accepts valid Slack webhook creation payload", () => {
      const parsed = createIntegrationConnectionSchema.safeParse({
        name: "Dev Slack Alerts",
        provider: "slack",
        targetUrl: "https://hooks.slack.com/services/T00/B00/X00",
        events: ["overall_score_drop", "new_high_severity_finding"],
        config: { channel: "#ux-alerts" },
      });

      expect(parsed.success).toBe(true);
      if (parsed.success) {
        expect(parsed.data.provider).toBe("slack");
        expect(parsed.data.name).toBe("Dev Slack Alerts");
        expect(parsed.data.events).toHaveLength(2);
        expect(parsed.data.isOrganizationWide).toBeUndefined();
      }
    });

    it("accepts isOrganizationWide flag for organization-wide integrations", () => {
      const parsed = createIntegrationConnectionSchema.safeParse({
        name: "Org Slack Alerts",
        provider: "slack",
        targetUrl: "https://hooks.slack.com/services/T00/B00/X00",
        isOrganizationWide: true,
      });

      expect(parsed.success).toBe(true);
      if (parsed.success) {
        expect(parsed.data.isOrganizationWide).toBe(true);
      }
    });

    it("accepts valid generic webhook creation with signing secret", () => {
      const parsed = createIntegrationConnectionSchema.safeParse({
        name: "Custom Webhook",
        provider: "webhook",
        targetUrl: "https://api.example.com/webhooks/pagepilot",
        signingSecret: "whsec_supersecretkey123",
      });

      expect(parsed.success).toBe(true);
      if (parsed.success) {
        expect(parsed.data.provider).toBe("webhook");
        expect(parsed.data.events).toEqual([
          "overall_score_drop",
          "new_high_severity_finding",
        ]);
      }
    });

    it("rejects invalid URLs violating URL policy", () => {
      const parsed = createIntegrationConnectionSchema.safeParse({
        name: "Bad Webhook",
        provider: "webhook",
        targetUrl: "ftp://example.com",
      });

      expect(parsed.success).toBe(false);
      if (!parsed.success) {
        expect(parsed.error.issues[0]?.message).toContain(
          "Only http:// and https:// URLs are supported",
        );
      }
    });

    it("rejects URLs with credentials", () => {
      const parsed = createIntegrationConnectionSchema.safeParse({
        name: "Bad Webhook",
        provider: "webhook",
        targetUrl: "https://user:pass@example.com/webhook",
      });

      expect(parsed.success).toBe(false);
      if (!parsed.success) {
        expect(parsed.error.issues[0]?.message).toContain(
          "URLs with embedded usernames or passwords aren't supported",
        );
      }
    });

    it("rejects empty names or empty events array", () => {
      expect(
        createIntegrationConnectionSchema.safeParse({
          name: "",
          provider: "slack",
          targetUrl: "https://hooks.slack.com/services/T00/B00/X00",
        }).success,
      ).toBe(false);

      expect(
        createIntegrationConnectionSchema.safeParse({
          name: "Test",
          provider: "slack",
          targetUrl: "https://hooks.slack.com/services/T00/B00/X00",
          events: [],
        }).success,
      ).toBe(false);
    });
  });

  describe("updateIntegrationConnectionSchema", () => {
    it("accepts partial updates", () => {
      const parsed = updateIntegrationConnectionSchema.safeParse({
        status: "disabled",
        name: "Updated Name",
      });
      expect(parsed.success).toBe(true);
    });

    it("rejects invalid status", () => {
      const parsed = updateIntegrationConnectionSchema.safeParse({
        status: "invalid_status",
      });
      expect(parsed.success).toBe(false);
    });
  });

  describe("integrationConnectionSchema (entity projection)", () => {
    it("validates a projected integration entity", () => {
      const now = new Date().toISOString();
      const parsed = integrationConnectionSchema.safeParse({
        id: "123e4567-e89b-12d3-a456-426614174000",
        organizationId: "123e4567-e89b-12d3-a456-426614174001",
        projectId: "123e4567-e89b-12d3-a456-426614174002",
        provider: "slack",
        name: "Team Slack",
        status: "active",
        config: { channel: "#alerts" },
        maskedTargetUrl: "https://hooks.slack.com/services/T00/B00/********",
        hasSigningSecret: false,
        events: ["overall_score_drop"],
        createdByUserId: "123e4567-e89b-12d3-a456-426614174003",
        createdAt: now,
        updatedAt: now,
      });

      expect(parsed.success).toBe(true);
      if (parsed.success) {
        expect(parsed.data.projectId).toBe(
          "123e4567-e89b-12d3-a456-426614174002",
        );
      }
    });

    it("allows null projectId for organization-wide integrations", () => {
      const now = new Date().toISOString();
      const parsed = integrationConnectionSchema.safeParse({
        id: "123e4567-e89b-12d3-a456-426614174000",
        organizationId: "123e4567-e89b-12d3-a456-426614174001",
        projectId: null,
        provider: "webhook",
        name: "Org Webhook",
        status: "active",
        config: {},
        maskedTargetUrl: "https://api.example.com/wh/***",
        hasSigningSecret: true,
        events: ["overall_score_drop", "category_score_drop"],
        createdAt: now,
        updatedAt: now,
      });

      expect(parsed.success).toBe(true);
      if (parsed.success) {
        expect(parsed.data.projectId).toBeNull();
      }
    });
  });

  describe("testIntegrationResponseSchema", () => {
    it("validates successful test response", () => {
      const parsed = testIntegrationResponseSchema.safeParse({
        success: true,
        statusCode: 200,
        latencyMs: 145,
      });
      expect(parsed.success).toBe(true);
    });

    it("validates failed test response with error message", () => {
      const parsed = testIntegrationResponseSchema.safeParse({
        success: false,
        statusCode: 500,
        latencyMs: 310,
        error: "Remote server returned 500 Internal Server Error",
      });
      expect(parsed.success).toBe(true);
    });
  });
});
