import { describe, expect, it } from "vitest";
import { buildAlertEmailContent } from "../src/notifications/email-template.js";
import type { NotificationPayload } from "../src/notifications/types.js";

describe("Alert Email Template Builder", () => {
  const basePayload: NotificationPayload = {
    alertId: "11111111-1111-4111-8111-111111111111",
    organizationId: "22222222-2222-4222-8222-222222222222",
    projectId: "33333333-3333-4333-8333-333333333333",
    projectName: "Acme SaaS",
    monitoredPageId: "44444444-4444-4444-8444-444444444444",
    pageUrl: "https://example.com/landing",
    ruleType: "overall_score_drop",
    severity: "high",
    title: "Overall UX Score Regressed",
    reasonSummary: "Overall UX score dropped by 14 points (82 -> 68).",
    reasonDetails: "Score drop exceeded the meaningful regression threshold of 10 points.",
    category: null,
    scoreDelta: -14,
    previousValue: 82,
    currentValue: 68,
    appBaseUrl: "https://pagepilot.dev",
    recipientEmail: "growth@example.com",
  };

  it("builds clean subject and content for overall score regression", () => {
    const rendered = buildAlertEmailContent(basePayload);

    expect(rendered.subject).toBe(
      "[PagePilot Alert] [HIGH] [Acme SaaS] Overall UX Score Regressed — example.com",
    );

    expect(rendered.text).toContain("PAGEPILOT UX ALERT — HIGH");
    expect(rendered.text).toContain("Score Change: 82 -> 68 (-14 pts)");
    expect(rendered.text).toContain("https://pagepilot.dev/workspace?project=33333333-3333-4333-8333-333333333333&page=44444444-4444-4444-8444-444444444444");

    expect(rendered.html).toContain("HIGH SEVERITY ALERT");
    expect(rendered.html).toContain("Overall UX Score Regressed");
    expect(rendered.html).toContain("82 &rarr; 68");
    expect(rendered.html).toContain("(-14 pts)");
  });

  it("builds content for category score drop alerts", () => {
    const payload: NotificationPayload = {
      ...basePayload,
      ruleType: "category_score_drop",
      severity: "medium",
      title: "Clarity Score Regressed",
      category: "clarity",
      reasonSummary: "Clarity category score dropped by 18 points (80 -> 62).",
      scoreDelta: -18,
      previousValue: 80,
      currentValue: 62,
    };

    const rendered = buildAlertEmailContent(payload);
    expect(rendered.subject).toContain("[MEDIUM]");
    expect(rendered.text).toContain("Category: clarity");
    expect(rendered.html).toContain("Category:</strong> clarity");
  });

  it("builds content for new high severity finding alerts", () => {
    const payload: NotificationPayload = {
      ...basePayload,
      ruleType: "new_high_severity_finding",
      severity: "high",
      title: "New High-Severity Finding in conversion",
      category: "conversion",
      reasonSummary: 'Newly detected high-severity finding: "No visible primary CTA button above the fold".',
      reasonDetails: "Hero viewport contains zero call-to-action anchor elements.",
      scoreDelta: null,
      previousValue: null,
      currentValue: "high",
    };

    const rendered = buildAlertEmailContent(payload);
    expect(rendered.text).toContain("No visible primary CTA button above the fold");
    expect(rendered.html).toContain("Hero viewport contains zero call-to-action anchor elements.");
  });

  it("builds content for repeated scan failures", () => {
    const payload: NotificationPayload = {
      ...basePayload,
      ruleType: "repeated_scan_failure",
      severity: "high",
      title: "Repeated Audit Scan Failures",
      category: null,
      reasonSummary: "Monitored page has failed 3 consecutive scheduled audit scan attempts.",
      reasonDetails: "Latest error [TIMEOUT]: Request timed out after 8000ms",
      scoreDelta: null,
      previousValue: null,
      currentValue: 3,
    };

    const rendered = buildAlertEmailContent(payload);
    expect(rendered.text).toContain("failed 3 consecutive scheduled audit scan attempts");
    expect(rendered.html).toContain("Latest error [TIMEOUT]: Request timed out after 8000ms");
  });

  it("escapes user-derived and target strings properly to prevent HTML injection", () => {
    const payload: NotificationPayload = {
      ...basePayload,
      title: 'Malicious <script>alert("xss")</script> Title',
      reasonSummary: 'Finding & "Quotes" <tag>',
      reasonDetails: 'Evidence with <b>bold</b> & <script>',
    };

    const rendered = buildAlertEmailContent(payload);
    expect(rendered.html).not.toContain('<script>alert("xss")</script>');
    expect(rendered.html).toContain("&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;");
    expect(rendered.html).toContain("&amp; &quot;Quotes&quot; &lt;tag&gt;");
  });

  it("never includes server secrets, IP addresses, or raw HTML in rendered output", () => {
    const rendered = buildAlertEmailContent(basePayload);
    expect(rendered.text).not.toContain("SUPABASE_SERVICE_ROLE_KEY");
    expect(rendered.text).not.toContain("GEMINI_API_KEY");
    expect(rendered.html).not.toContain("SUPABASE_SERVICE_ROLE_KEY");
    expect(rendered.html).not.toContain("GEMINI_API_KEY");
  });
});
