// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  IntegrationConnection,
  Project,
} from "@pagepilot/contracts";
import { IntegrationsManager } from "../src/features/integrations/components/integrations-manager";
import {
  createIntegration,
  deleteIntegration,
  listIntegrations,
  testIntegration,
  updateIntegration,
  IntegrationsApiClientError,
} from "../src/features/integrations/api.js";

vi.mock("../src/features/integrations/api.js", () => {
  class IntegrationsApiClientError extends Error {
    readonly status: number;
    readonly code: string;
    constructor(status: number, code: string, message: string) {
      super(message);
      this.name = "IntegrationsApiClientError";
      this.status = status;
      this.code = code;
    }
  }

  return {
    listIntegrations: vi.fn(),
    getIntegration: vi.fn(),
    createIntegration: vi.fn(),
    updateIntegration: vi.fn(),
    deleteIntegration: vi.fn(),
    testIntegration: vi.fn(),
    IntegrationsApiClientError,
  };
});

const sampleProject: Project = {
  id: "11111111-1111-4111-8111-111111111111",
  organizationId: "22222222-2222-4222-8222-222222222222",
  name: "Acme Landing Pages",
  domain: "acme.com",
  timezone: "UTC",
  goals: "Improve conversion",
  createdBy: "33333333-3333-4333-8333-333333333333",
  createdAt: "2026-08-28T10:00:00.000Z",
  updatedAt: "2026-08-28T10:00:00.000Z",
};

const sampleSlackIntegration: IntegrationConnection = {
  id: "int-slack-1",
  organizationId: sampleProject.organizationId,
  projectId: sampleProject.id,
  provider: "slack",
  name: "Engineering Slack Alerts",
  status: "active",
  config: { channel: "#growth-alerts" },
  maskedTargetUrl: "https://hooks.slack.com/services/T01***/*****/********",
  hasSigningSecret: false,
  events: ["overall_score_drop", "new_high_severity_finding"],
  createdByUserId: "user-1",
  createdAt: "2026-09-01T10:00:00.000Z",
  updatedAt: "2026-09-01T10:00:00.000Z",
};

const sampleWebhookIntegration: IntegrationConnection = {
  id: "int-webhook-2",
  organizationId: sampleProject.organizationId,
  projectId: null, // Organization-wide
  provider: "webhook",
  name: "Org Webhook Dispatcher",
  status: "disabled",
  config: {},
  maskedTargetUrl: "https://api.example.com/webhooks/pagepilot",
  hasSigningSecret: true,
  events: ["overall_score_drop", "category_score_drop", "signal_regressed"],
  createdByUserId: "user-1",
  createdAt: "2026-09-01T11:00:00.000Z",
  updatedAt: "2026-09-01T11:00:00.000Z",
};

describe("Integrations Management UI", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(listIntegrations).mockResolvedValue({
      integrations: [sampleSlackIntegration, sampleWebhookIntegration],
      total: 2,
    });
  });

  afterEach(() => {
    cleanup();
  });

  it("renders list of integrations with provider details, masked URLs, and scope badges", async () => {
    render(
      <IntegrationsManager
        project={sampleProject}
        role="admin"
      />,
    );

    await waitFor(() => {
      expect(screen.getByText("Engineering Slack Alerts")).toBeTruthy();
      expect(screen.getByText("Org Webhook Dispatcher")).toBeTruthy();
    });

    // Check scope badges
    expect(screen.getByText("Project-Scoped")).toBeTruthy();
    expect(screen.getAllByText("Org-Wide").length).toBeGreaterThan(0);

    // Check status badges
    expect(screen.getAllByText("Active").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Disabled").length).toBeGreaterThan(0);

    // Check masked URL display
    expect(
      screen.getByText("https://hooks.slack.com/services/T01***/*****/********"),
    ).toBeTruthy();

    // Check HMAC badge on generic webhook
    expect(screen.getByText("HMAC Signed")).toBeTruthy();

    // Check event chips
    expect(screen.getAllByText("Overall Score Drop ≥ 10")).toHaveLength(2);
    expect(screen.getByText("New High-Severity Finding")).toBeTruthy();
  });

  it("enforces role-based permissions: admin/owner can manage, viewer is read-only", async () => {
    const { rerender } = render(
      <IntegrationsManager
        project={sampleProject}
        role="admin"
      />,
    );

    await waitFor(() => {
      expect(screen.getByText("Add Integration")).toBeTruthy();
      expect(screen.getAllByText("Edit")).toHaveLength(2);
      expect(screen.getAllByText("Delete")).toHaveLength(2);
      expect(screen.getAllByText("Test Ping")).toHaveLength(2);
    });

    // Rerender as viewer
    rerender(
      <IntegrationsManager
        project={sampleProject}
        role="viewer"
      />,
    );

    // "+ Add Integration" should be absent
    expect(screen.queryByText("Add Integration")).toBeNull();
    // Edit and Delete should be absent
    expect(screen.queryByText("Edit")).toBeNull();
    expect(screen.queryByText("Delete")).toBeNull();
    // Test Ping buttons should be disabled
    const testPingButtons = screen.getAllByRole("button", { name: /test ping/i });
    expect((testPingButtons[0] as HTMLButtonElement).disabled).toBe(true);
    expect((testPingButtons[1] as HTMLButtonElement).disabled).toBe(true);
  });

  it("opens modal and creates a new Slack integration", async () => {
    const newIntegration: IntegrationConnection = {
      id: "int-slack-new",
      organizationId: sampleProject.organizationId,
      projectId: sampleProject.id,
      provider: "slack",
      name: "New Marketing Channel",
      status: "active",
      config: { channel: "#marketing-ux" },
      maskedTargetUrl: "https://hooks.slack.com/services/T00***/*****/********",
      hasSigningSecret: false,
      events: ["overall_score_drop", "new_high_severity_finding"],
      createdByUserId: "user-1",
      createdAt: "2026-09-02T10:00:00.000Z",
      updatedAt: "2026-09-02T10:00:00.000Z",
    };

    vi.mocked(createIntegration).mockResolvedValueOnce({
      integration: newIntegration,
    });

    render(
      <IntegrationsManager
        project={sampleProject}
        role="admin"
      />,
    );

    await waitFor(() => {
      expect(screen.getByText("Add Integration")).toBeTruthy();
    });

    fireEvent.click(screen.getByText("Add Integration"));

    expect(screen.getByText("Add Alert Integration")).toBeTruthy();

    // Fill form
    fireEvent.change(screen.getByLabelText(/integration name/i), {
      target: { value: "New Marketing Channel" },
    });

    fireEvent.change(screen.getByLabelText(/destination url/i), {
      target: { value: "https://hooks.slack.com/services/T001/B001/SECRET123" },
    });

    fireEvent.change(screen.getByLabelText(/slack channel name/i), {
      target: { value: "#marketing-ux" },
    });

    // Submit
    fireEvent.click(screen.getByRole("button", { name: /create integration/i }));

    await waitFor(() => {
      expect(createIntegration).toHaveBeenCalledTimes(1);
      expect(createIntegration).toHaveBeenCalledWith(
        sampleProject.id,
        expect.objectContaining({
          name: "New Marketing Channel",
          provider: "slack",
          targetUrl: "https://hooks.slack.com/services/T001/B001/SECRET123",
          config: { channel: "#marketing-ux" },
          isOrganizationWide: false,
        }),
      );
      expect(screen.getByText("New Marketing Channel")).toBeTruthy();
    });
  });

  it("handles client URL validation errors and displays inline message", async () => {
    render(
      <IntegrationsManager
        project={sampleProject}
        role="admin"
      />,
    );

    await waitFor(() => {
      expect(screen.getByText("Add Integration")).toBeTruthy();
    });

    fireEvent.click(screen.getByText("Add Integration"));

    fireEvent.change(screen.getByLabelText(/integration name/i), {
      target: { value: "Invalid URL Test" },
    });

    fireEvent.change(screen.getByLabelText(/destination url/i), {
      target: { value: "ftp://example.com/webhook" },
    });

    fireEvent.click(screen.getByRole("button", { name: /create integration/i }));

    await waitFor(() => {
      expect(
        screen.getByText(/Only http:\/\/ and https:\/\/ URLs are supported/i),
      ).toBeTruthy();
      expect(createIntegration).not.toHaveBeenCalled();
    });
  });

  it("surfaces server-side SSRF BLOCKED_DESTINATION error cleanly in the modal", async () => {
    vi.mocked(createIntegration).mockRejectedValueOnce(
      new IntegrationsApiClientError(
        403,
        "BLOCKED_DESTINATION",
        "Target URL resolves to a private IP.",
      ),
    );

    render(
      <IntegrationsManager
        project={sampleProject}
        role="admin"
      />,
    );

    await waitFor(() => {
      expect(screen.getByText("Add Integration")).toBeTruthy();
    });

    fireEvent.click(screen.getByText("Add Integration"));

    fireEvent.change(screen.getByLabelText(/integration name/i), {
      target: { value: "SSRF Integration" },
    });

    fireEvent.change(screen.getByLabelText(/destination url/i), {
      target: { value: "https://127.0.0.1/webhook" },
    });

    fireEvent.click(screen.getByRole("button", { name: /create integration/i }));

    await waitFor(() => {
      expect(
        screen.getByText(/Security Policy Violation: Target URL points to a private, loopback, or non-routable address/i),
      ).toBeTruthy();
    });
  });

  it("allows editing an existing integration and saves changes", async () => {
    const updatedIntegration: IntegrationConnection = {
      ...sampleSlackIntegration,
      name: "Renamed Slack Alerts",
    };

    vi.mocked(updateIntegration).mockResolvedValueOnce({
      integration: updatedIntegration,
    });

    render(
      <IntegrationsManager
        project={sampleProject}
        role="admin"
      />,
    );

    await waitFor(() => {
      expect(screen.getByText("Engineering Slack Alerts")).toBeTruthy();
    });

    const editButtons = screen.getAllByRole("button", { name: "Edit" });
    fireEvent.click(editButtons[0]);

    expect(screen.getByText("Edit Integration")).toBeTruthy();

    fireEvent.change(screen.getByLabelText(/integration name/i), {
      target: { value: "Renamed Slack Alerts" },
    });

    fireEvent.click(screen.getByRole("button", { name: /save changes/i }));

    await waitFor(() => {
      expect(updateIntegration).toHaveBeenCalledTimes(1);
      expect(screen.getByText("Renamed Slack Alerts")).toBeTruthy();
    });
  });

  it("confirms and executes deletion of an integration", async () => {
    vi.mocked(deleteIntegration).mockResolvedValueOnce({
      success: true,
      deletedIntegrationId: sampleSlackIntegration.id,
    });

    render(
      <IntegrationsManager
        project={sampleProject}
        role="admin"
      />,
    );

    await waitFor(() => {
      expect(screen.getByText("Engineering Slack Alerts")).toBeTruthy();
    });

    const deleteButtons = screen.getAllByRole("button", { name: "Delete" });
    fireEvent.click(deleteButtons[0]);

    expect(screen.getByRole("heading", { name: "Delete Integration" })).toBeTruthy();
    expect(
      screen.getByText(/Are you sure you want to delete/i),
    ).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Delete Integration" }));

    await waitFor(() => {
      expect(deleteIntegration).toHaveBeenCalledWith(
        sampleProject.id,
        sampleSlackIntegration.id,
      );
      expect(screen.queryByText("Engineering Slack Alerts")).toBeNull();
    });
  });

  it("dispatches test ping and renders latency and success status feedback", async () => {
    vi.mocked(testIntegration).mockResolvedValueOnce({
      success: true,
      statusCode: 200,
      latencyMs: 118,
    });

    render(
      <IntegrationsManager
        project={sampleProject}
        role="admin"
      />,
    );

    await waitFor(() => {
      expect(screen.getByText("Engineering Slack Alerts")).toBeTruthy();
    });

    const testButtons = screen.getAllByRole("button", { name: /test ping/i });
    fireEvent.click(testButtons[0]);

    await waitFor(() => {
      expect(testIntegration).toHaveBeenCalledWith(
        sampleProject.id,
        sampleSlackIntegration.id,
      );
      expect(screen.getByText("Test Ping Succeeded")).toBeTruthy();
      expect(screen.getByText("118 ms")).toBeTruthy();
      expect(screen.getByText("HTTP 200")).toBeTruthy();
    });
  });

  it("renders failure feedback banner when test ping fails", async () => {
    vi.mocked(testIntegration).mockResolvedValueOnce({
      success: false,
      statusCode: 500,
      latencyMs: 240,
      error: "Remote server returned 500 Internal Server Error",
    });

    render(
      <IntegrationsManager
        project={sampleProject}
        role="admin"
      />,
    );

    await waitFor(() => {
      expect(screen.getByText("Engineering Slack Alerts")).toBeTruthy();
    });

    const testButtons = screen.getAllByRole("button", { name: /test ping/i });
    fireEvent.click(testButtons[0]);

    await waitFor(() => {
      expect(screen.getByText("Test Ping Failed")).toBeTruthy();
      expect(screen.getByText("240 ms")).toBeTruthy();
      expect(
        screen.getByText(/Remote server returned 500 Internal Server Error/i),
      ).toBeTruthy();
    });
  });

  it("filters integrations by provider and scope", async () => {
    render(
      <IntegrationsManager
        project={sampleProject}
        role="admin"
      />,
    );

    await waitFor(() => {
      expect(screen.getByText("Engineering Slack Alerts")).toBeTruthy();
      expect(screen.getByText("Org Webhook Dispatcher")).toBeTruthy();
    });

    // Filter by Slack only
    fireEvent.click(screen.getByRole("button", { name: "Slack" }));
    expect(screen.getByText("Engineering Slack Alerts")).toBeTruthy();
    expect(screen.queryByText("Org Webhook Dispatcher")).toBeNull();

    // Filter by Webhook only
    fireEvent.click(screen.getByRole("button", { name: "Webhook" }));
    expect(screen.queryByText("Engineering Slack Alerts")).toBeNull();
    expect(screen.getByText("Org Webhook Dispatcher")).toBeTruthy();

    // Filter by Org-Wide scope
    fireEvent.click(screen.getByRole("button", { name: /^All$/ }));
    fireEvent.click(screen.getByRole("button", { name: "Org-Wide" }));
    expect(screen.queryByText("Engineering Slack Alerts")).toBeNull();
    expect(screen.getByText("Org Webhook Dispatcher")).toBeTruthy();
  });

  it("renders clean empty state when no integrations exist", async () => {
    vi.mocked(listIntegrations).mockResolvedValueOnce({
      integrations: [],
      total: 0,
    });

    render(
      <IntegrationsManager
        project={sampleProject}
        role="admin"
      />,
    );

    await waitFor(() => {
      expect(screen.getByText("No Integrations Configured")).toBeTruthy();
      expect(
        screen.getByRole("button", { name: /add your first integration/i }),
      ).toBeTruthy();
    });
  });
});
