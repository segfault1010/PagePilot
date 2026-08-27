// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ProjectList } from "../src/features/workspace/components/project-list";
import type { Project } from "@pagepilot/contracts";

describe("Projects Management UI", () => {
  afterEach(() => {
    cleanup();
  });

  const sampleProjects: Project[] = [
    {
      id: "c0eebc99-9c0b-4ef8-bb6d-6bb9bd380a33",
      organizationId: "d0eebc99-9c0b-4ef8-bb6d-6bb9bd380a44",
      name: "SaaS App",
      domain: "saas.app",
      timezone: "UTC",
      goals: "Improve CTA conversions",
      createdBy: "u-1",
      createdAt: "2026-08-27T12:00:00.000Z",
      updatedAt: "2026-08-27T12:00:00.000Z",
    },
    {
      id: "c0eebc99-9c0b-4ef8-bb6d-6bb9bd380a99",
      organizationId: "d0eebc99-9c0b-4ef8-bb6d-6bb9bd380a44",
      name: "Ecommerce Store",
      domain: "shop.com",
      timezone: "America/New_York",
      goals: null,
      createdBy: "u-1",
      createdAt: "2026-08-27T11:00:00.000Z",
      updatedAt: "2026-08-27T11:00:00.000Z",
    },
  ];

  it("renders projects list and project details", () => {
    render(
      <ProjectList
        projects={sampleProjects}
        role="owner"
        isLoading={false}
        onSelectProject={vi.fn()}
        onCreateProject={vi.fn()}
        onUpdateProject={vi.fn()}
        onDeleteProject={vi.fn()}
      />,
    );

    expect(screen.getByRole("heading", { name: "Projects" })).toBeTruthy();
    expect(screen.getByText("SaaS App")).toBeTruthy();
    expect(screen.getByText("saas.app")).toBeTruthy();
    expect(screen.getByText("Improve CTA conversions")).toBeTruthy();
    expect(screen.getByText("Ecommerce Store")).toBeTruthy();
  });

  it("renders empty state when no projects exist", () => {
    render(
      <ProjectList
        projects={[]}
        role="owner"
        isLoading={false}
        onSelectProject={vi.fn()}
        onCreateProject={vi.fn()}
        onUpdateProject={vi.fn()}
        onDeleteProject={vi.fn()}
      />,
    );

    expect(screen.getByText("No projects found")).toBeTruthy();
    expect(screen.getByText(/create your first project to organize/i)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Create Project" })).toBeTruthy();
  });

  it("handles creating a new project via modal", async () => {
    const onCreateProject = vi.fn().mockResolvedValue(undefined);

    render(
      <ProjectList
        projects={sampleProjects}
        role="owner"
        isLoading={false}
        onSelectProject={vi.fn()}
        onCreateProject={onCreateProject}
        onUpdateProject={vi.fn()}
        onDeleteProject={vi.fn()}
      />,
    );

    // Click "+ New Project"
    fireEvent.click(screen.getByRole("button", { name: "+ New Project" }));

    expect(screen.getByRole("dialog")).toBeTruthy();

    // Fill form
    fireEvent.change(screen.getByLabelText(/project name/i), {
      target: { value: "Mobile App Landing" },
    });
    fireEvent.change(screen.getByLabelText(/primary domain/i), {
      target: { value: "mobile.app" },
    });
    fireEvent.change(screen.getByLabelText(/project goals/i), {
      target: { value: "Double mobile downloads" },
    });

    // Submit
    fireEvent.click(screen.getByRole("button", { name: "Create Project" }));

    expect(onCreateProject).toHaveBeenCalledWith({
      name: "Mobile App Landing",
      domain: "mobile.app",
      timezone: "UTC",
      goals: "Double mobile downloads",
    });
  });

  it("handles editing an existing project", async () => {
    const onUpdateProject = vi.fn().mockResolvedValue(undefined);

    render(
      <ProjectList
        projects={sampleProjects}
        role="member"
        isLoading={false}
        onSelectProject={vi.fn()}
        onCreateProject={vi.fn()}
        onUpdateProject={onUpdateProject}
        onDeleteProject={vi.fn()}
      />,
    );

    // Click edit on "SaaS App"
    fireEvent.click(screen.getByLabelText("Edit SaaS App"));

    expect(screen.getByRole("dialog")).toBeTruthy();
    const nameInput = screen.getByLabelText(/project name/i);
    expect((nameInput as HTMLInputElement).value).toBe("SaaS App");

    fireEvent.change(nameInput, { target: { value: "SaaS Platform Pro" } });
    fireEvent.click(screen.getByRole("button", { name: "Save Changes" }));

    expect(onUpdateProject).toHaveBeenCalledWith(
      "c0eebc99-9c0b-4ef8-bb6d-6bb9bd380a33",
      expect.objectContaining({ name: "SaaS Platform Pro" }),
    );
  });

  it("handles deleting a project with confirmation dialog (owner/admin)", async () => {
    const onDeleteProject = vi.fn().mockResolvedValue(undefined);

    render(
      <ProjectList
        projects={sampleProjects}
        role="owner"
        isLoading={false}
        onSelectProject={vi.fn()}
        onCreateProject={vi.fn()}
        onUpdateProject={vi.fn()}
        onDeleteProject={onDeleteProject}
      />,
    );

    // Click delete on "SaaS App"
    fireEvent.click(screen.getByLabelText("Delete SaaS App"));

    // Confirmation modal opens
    expect(screen.getByRole("dialog")).toBeTruthy();
    expect(screen.getByText(/are you sure you want to delete "SaaS App"/i)).toBeTruthy();

    // Confirm
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));

    expect(onDeleteProject).toHaveBeenCalledWith("c0eebc99-9c0b-4ef8-bb6d-6bb9bd380a33");
  });

  it("enforces role permissions matrix in UI", () => {
    // 1. Viewer: cannot create, edit, or delete
    const { rerender } = render(
      <ProjectList
        projects={sampleProjects}
        role="viewer"
        isLoading={false}
        onSelectProject={vi.fn()}
        onCreateProject={vi.fn()}
        onUpdateProject={vi.fn()}
        onDeleteProject={vi.fn()}
      />,
    );

    expect(screen.queryByRole("button", { name: "+ New Project" })).toBeNull();
    expect(screen.queryByLabelText("Edit SaaS App")).toBeNull();
    expect(screen.queryByLabelText("Delete SaaS App")).toBeNull();

    // 2. Member: can create and edit, but CANNOT delete
    rerender(
      <ProjectList
        projects={sampleProjects}
        role="member"
        isLoading={false}
        onSelectProject={vi.fn()}
        onCreateProject={vi.fn()}
        onUpdateProject={vi.fn()}
        onDeleteProject={vi.fn()}
      />,
    );

    expect(screen.getByRole("button", { name: "+ New Project" })).toBeTruthy();
    expect(screen.getByLabelText("Edit SaaS App")).toBeTruthy();
    expect(screen.queryByLabelText("Delete SaaS App")).toBeNull();

    // 3. Admin: can create, edit, and delete
    rerender(
      <ProjectList
        projects={sampleProjects}
        role="admin"
        isLoading={false}
        onSelectProject={vi.fn()}
        onCreateProject={vi.fn()}
        onUpdateProject={vi.fn()}
        onDeleteProject={vi.fn()}
      />,
    );

    expect(screen.getByRole("button", { name: "+ New Project" })).toBeTruthy();
    expect(screen.getByLabelText("Edit SaaS App")).toBeTruthy();
    expect(screen.getByLabelText("Delete SaaS App")).toBeTruthy();
  });
});
