// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ProjectDetail } from "../src/features/workspace/components/project-detail";
import type { MonitoredPage, Project } from "@pagepilot/contracts";

describe("Monitored Pages Management UI", () => {
  afterEach(() => {
    cleanup();
  });

  const sampleProject: Project = {
    id: "c0eebc99-9c0b-4ef8-bb6d-6bb9bd380a33",
    organizationId: "d0eebc99-9c0b-4ef8-bb6d-6bb9bd380a44",
    name: "Growth App",
    domain: "growth.app",
    timezone: "UTC",
    goals: "Convert visitors",
    createdBy: "u-1",
    createdAt: "2026-08-27T12:00:00.000Z",
    updatedAt: "2026-08-27T12:00:00.000Z",
  };

  const samplePages: MonitoredPage[] = [
    {
      id: "b0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11",
      projectId: sampleProject.id,
      organizationId: sampleProject.organizationId,
      canonicalUrl: "https://growth.app/pricing",
      cadence: "weekly",
      status: "active",
      ownerId: "u-1",
      tags: ["pricing", "tier-test"],
      latestAuditRunId: "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11",
      latestSuccessfulAuditRunId: "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11",
      createdAt: "2026-08-27T12:00:00.000Z",
      updatedAt: "2026-08-27T12:00:00.000Z",
    },
    {
      id: "b0eebc99-9c0b-4ef8-bb6d-6bb9bd380a22",
      projectId: sampleProject.id,
      organizationId: sampleProject.organizationId,
      canonicalUrl: "https://growth.app/signup",
      cadence: "weekly",
      status: "paused",
      ownerId: "u-1",
      tags: [],
      latestAuditRunId: null,
      latestSuccessfulAuditRunId: null,
      createdAt: "2026-08-27T12:00:00.000Z",
      updatedAt: "2026-08-27T12:00:00.000Z",
    },
  ];

  it("renders monitored pages list and tags", () => {
    render(
      <ProjectDetail
        project={sampleProject}
        pages={samplePages}
        role="owner"
        isLoading={false}
        onBackToProjects={vi.fn()}
        onSelectPage={vi.fn()}
        onCreatePage={vi.fn()}
        onUpdatePage={vi.fn()}
        onDeletePage={vi.fn()}
      />,
    );

    expect(screen.getByRole("heading", { name: "Growth App" })).toBeTruthy();
    expect(screen.getByText("https://growth.app/pricing")).toBeTruthy();
    expect(screen.getByText("#pricing")).toBeTruthy();
    expect(screen.getByText("#tier-test")).toBeTruthy();
    expect(screen.getByText("https://growth.app/signup")).toBeTruthy();
  });

  it("renders empty state when no pages are monitored", () => {
    render(
      <ProjectDetail
        project={sampleProject}
        pages={[]}
        role="member"
        isLoading={false}
        onBackToProjects={vi.fn()}
        onSelectPage={vi.fn()}
        onCreatePage={vi.fn()}
        onUpdatePage={vi.fn()}
        onDeletePage={vi.fn()}
      />,
    );

    expect(screen.getByText("No pages monitored yet")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Add Page" })).toBeTruthy();
  });

  it("handles adding a new page with URL validation and tag parsing", async () => {
    const onCreatePage = vi.fn().mockResolvedValue(undefined);

    render(
      <ProjectDetail
        project={sampleProject}
        pages={samplePages}
        role="member"
        isLoading={false}
        onBackToProjects={vi.fn()}
        onSelectPage={vi.fn()}
        onCreatePage={onCreatePage}
        onUpdatePage={vi.fn()}
        onDeletePage={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "+ Add Page" }));

    expect(screen.getByRole("dialog")).toBeTruthy();

    const urlInput = screen.getByLabelText(/landing page url/i);
    const tagsInput = screen.getByLabelText(/tags/i);

    fireEvent.change(urlInput, { target: { value: "https://growth.app/features" } });
    fireEvent.change(tagsInput, { target: { value: "hero, v2-redesign" } });

    fireEvent.click(screen.getByRole("button", { name: "Add Page" }));

    expect(onCreatePage).toHaveBeenCalledWith({
      canonicalUrl: "https://growth.app/features",
      cadence: "weekly",
      status: "active",
      tags: ["hero", "v2-redesign"],
    });
  });

  it("rejects invalid URL format with URL policy error message", async () => {
    const onCreatePage = vi.fn();

    render(
      <ProjectDetail
        project={sampleProject}
        pages={samplePages}
        role="member"
        isLoading={false}
        onBackToProjects={vi.fn()}
        onSelectPage={vi.fn()}
        onCreatePage={onCreatePage}
        onUpdatePage={vi.fn()}
        onDeletePage={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "+ Add Page" }));

    const urlInput = screen.getByLabelText(/landing page url/i);
    fireEvent.change(urlInput, { target: { value: "ftp://invalid-scheme.com" } });

    fireEvent.click(screen.getByRole("button", { name: "Add Page" }));

    expect(screen.getByRole("alert").textContent).toMatch(/only http:\/\/ and https:\/\/ urls are supported/i);
    expect(onCreatePage).not.toHaveBeenCalled();
  });

  it("handles toggling active/paused status", async () => {
    const onUpdatePage = vi.fn().mockResolvedValue(undefined);

    render(
      <ProjectDetail
        project={sampleProject}
        pages={samplePages}
        role="member"
        isLoading={false}
        onBackToProjects={vi.fn()}
        onSelectPage={vi.fn()}
        onCreatePage={vi.fn()}
        onUpdatePage={onUpdatePage}
        onDeletePage={vi.fn()}
      />,
    );

    // Click on "active" status pill on the pricing page
    const activePill = screen.getByText("active");
    fireEvent.click(activePill);

    expect(onUpdatePage).toHaveBeenCalledWith(
      "b0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11",
      { status: "paused" },
    );
  });

  it("handles deleting a monitored page with confirmation dialog", async () => {
    const onDeletePage = vi.fn().mockResolvedValue(undefined);

    render(
      <ProjectDetail
        project={sampleProject}
        pages={samplePages}
        role="owner"
        isLoading={false}
        onBackToProjects={vi.fn()}
        onSelectPage={vi.fn()}
        onCreatePage={vi.fn()}
        onUpdatePage={vi.fn()}
        onDeletePage={onDeletePage}
      />,
    );

    fireEvent.click(screen.getByLabelText("Delete https://growth.app/pricing"));

    expect(screen.getByRole("dialog")).toBeTruthy();
    expect(screen.getByText(/are you sure you want to delete "https:\/\/growth\.app\/pricing"/i)).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Delete" }));

    expect(onDeletePage).toHaveBeenCalledWith("b0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11");
  });

  it("hides management actions for viewer role", () => {
    render(
      <ProjectDetail
        project={sampleProject}
        pages={samplePages}
        role="viewer"
        isLoading={false}
        onBackToProjects={vi.fn()}
        onSelectPage={vi.fn()}
        onCreatePage={vi.fn()}
        onUpdatePage={vi.fn()}
        onDeletePage={vi.fn()}
      />,
    );

    expect(screen.queryByRole("button", { name: "+ Add Page" })).toBeNull();
    expect(screen.queryByLabelText("Edit https://growth.app/pricing")).toBeNull();
    expect(screen.queryByLabelText("Delete https://growth.app/pricing")).toBeNull();
  });
});
