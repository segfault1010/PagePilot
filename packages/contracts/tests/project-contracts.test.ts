import { describe, expect, it } from "vitest";
import {
  createMonitoredPageSchema,
  createProjectSchema,
  normalizeDomain,
  updateMonitoredPageSchema,
  updateProjectSchema,
} from "../src/database-types.js";
import { enforceUrlPolicy } from "../src/url-policy.js";

describe("Project & Monitored Page Contracts", () => {
  describe("normalizeDomain", () => {
    it("normalizes domains by lowercasing and trimming whitespace", () => {
      expect(normalizeDomain("  Example.COM  ")).toBe("example.com");
      expect(normalizeDomain("Sub.Domain.IO")).toBe("sub.domain.io");
    });

    it("strips http and https schemes, ports, and trailing paths", () => {
      expect(normalizeDomain("https://app.growthpilot.io/dashboard?tab=1")).toBe("app.growthpilot.io");
      expect(normalizeDomain("http://example.com:8080/landing")).toBe("example.com");
    });

    it("returns empty string for empty input", () => {
      expect(normalizeDomain("")).toBe("");
      expect(normalizeDomain("   ")).toBe("");
    });

    it("maintains distinct responsibility from enforceUrlPolicy", () => {
      const testUrl = "https://example.com/pricing?utm_source=test#hero";

      // normalizeDomain extracts only hostname for project metadata
      expect(normalizeDomain(testUrl)).toBe("example.com");

      // enforceUrlPolicy validates and preserves canonical destination href
      const policyRes = enforceUrlPolicy(testUrl);
      expect(policyRes.ok).toBe(true);
      if (policyRes.ok) {
        expect(policyRes.url).toBe("https://example.com/pricing?utm_source=test#hero");
      }
    });
  });

  describe("createProjectSchema", () => {
    it("validates a standard project creation payload", () => {
      const parsed = createProjectSchema.parse({
        name: "Acme SaaS",
        domain: "https://ACME.io/landing",
        timezone: "America/New_York",
        goals: "Increase landing page trial conversion by 20%",
      });

      expect(parsed.name).toBe("Acme SaaS");
      expect(parsed.domain).toBe("acme.io");
      expect(parsed.timezone).toBe("America/New_York");
      expect(parsed.goals).toBe("Increase landing page trial conversion by 20%");
    });

    it("defaults timezone to UTC when omitted", () => {
      const parsed = createProjectSchema.parse({
        name: "Minimal Project",
      });

      expect(parsed.name).toBe("Minimal Project");
      expect(parsed.domain).toBeNull();
      expect(parsed.timezone).toBe("UTC");
      expect(parsed.goals).toBeUndefined();
    });

    it("rejects empty name", () => {
      expect(() =>
        createProjectSchema.parse({
          name: "   ",
        }),
      ).toThrow();
    });

    it("rejects oversized names and goals", () => {
      expect(() =>
        createProjectSchema.parse({
          name: "A".repeat(101),
        }),
      ).toThrow();

      expect(() =>
        createProjectSchema.parse({
          name: "Valid Name",
          goals: "G".repeat(2001),
        }),
      ).toThrow();
    });
  });

  describe("updateProjectSchema", () => {
    it("allows partial updates", () => {
      const parsed = updateProjectSchema.parse({
        name: "Updated Name",
      });
      expect(parsed.name).toBe("Updated Name");
      expect(parsed.domain).toBeUndefined();
    });

    it("normalizes domain when provided in update", () => {
      const parsed = updateProjectSchema.parse({
        domain: "HTTPS://NEWDOMAIN.COM/PATH",
      });
      expect(parsed.domain).toBe("newdomain.com");
    });

    it("rejects empty name if provided", () => {
      expect(() =>
        updateProjectSchema.parse({
          name: " ",
        }),
      ).toThrow();
    });
  });

  describe("createMonitoredPageSchema", () => {
    it("validates and normalizes valid canonical URL", () => {
      const parsed = createMonitoredPageSchema.parse({
        canonicalUrl: "https://example.com/signup",
        cadence: "weekly",
        tags: ["core-funnel", "landing-v2"],
      });

      expect(parsed.canonicalUrl).toBe("https://example.com/signup");
      expect(parsed.cadence).toBe("weekly");
      expect(parsed.status).toBe("active");
      expect(parsed.tags).toEqual(["core-funnel", "landing-v2"]);
    });

    it("rejects invalid URLs according to enforceUrlPolicy", () => {
      expect(() =>
        createMonitoredPageSchema.parse({
          canonicalUrl: "ftp://example.com",
        }),
      ).toThrow("Only http:// and https:// URLs are supported.");

      expect(() =>
        createMonitoredPageSchema.parse({
          canonicalUrl: "https://user:pass@example.com",
        }),
      ).toThrow("URLs with embedded usernames or passwords aren't supported.");

      expect(() =>
        createMonitoredPageSchema.parse({
          canonicalUrl: "https://example.com:8443",
        }),
      ).toThrow("Only standard ports are supported (80 for http, 443 for https).");

      expect(() =>
        createMonitoredPageSchema.parse({
          canonicalUrl: "not-a-valid-url",
        }),
      ).toThrow("That doesn't look like a valid URL.");
    });

    it("enforces bounds on tags array", () => {
      expect(() =>
        createMonitoredPageSchema.parse({
          canonicalUrl: "https://example.com",
          tags: Array.from({ length: 21 }, (_, i) => `tag-${i}`),
        }),
      ).toThrow("Cannot exceed 20 tags.");

      expect(() =>
        createMonitoredPageSchema.parse({
          canonicalUrl: "https://example.com",
          tags: ["T".repeat(51)],
        }),
      ).toThrow("Tag must be 50 characters or fewer.");
    });
  });

  describe("updateMonitoredPageSchema", () => {
    it("allows updating specific fields", () => {
      const parsed = updateMonitoredPageSchema.parse({
        status: "paused",
        cadence: "manual",
        ownerId: "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11",
      });

      expect(parsed.status).toBe("paused");
      expect(parsed.cadence).toBe("manual");
      expect(parsed.ownerId).toBe("a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11");
    });

    it("validates updated canonical URL", () => {
      const parsed = updateMonitoredPageSchema.parse({
        canonicalUrl: "https://example.com/new-landing",
      });
      expect(parsed.canonicalUrl).toBe("https://example.com/new-landing");
    });

    it("rejects non-UUID ownerId", () => {
      expect(() =>
        updateMonitoredPageSchema.parse({
          ownerId: "invalid-user-id",
        }),
      ).toThrow("Invalid owner user ID.");
    });
  });
});
