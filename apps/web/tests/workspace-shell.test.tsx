// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "../src/App";

// Mock Supabase client
const mockGetSession = vi.fn();
const mockOnAuthStateChange = vi.fn();
const mockSignOut = vi.fn();
const mockListProjects = vi.fn();

vi.mock("../src/features/auth/supabase-client.js", () => ({
  getSupabaseClient: vi.fn(() => ({
    auth: {
      getSession: mockGetSession,
      onAuthStateChange: mockOnAuthStateChange,
      signOut: mockSignOut,
    },
  })),
  isSupabaseConfigured: vi.fn(() => true),
}));

// Mock Projects & Audits API
vi.mock("../src/features/projects/api.js", () => ({
  listProjects: (...args: any[]) => mockListProjects(...args),
  listMonitoredPages: vi.fn().mockResolvedValue({ pages: [] }),
  getProject: vi.fn(),
  getMonitoredPage: vi.fn(),
  createProject: vi.fn(),
  updateProject: vi.fn(),
  deleteProject: vi.fn(),
}));

describe("Workspace Shell & App Integration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sessionStorage.clear();
    mockOnAuthStateChange.mockReturnValue({
      data: { subscription: { unsubscribe: vi.fn() } },
    });
    mockListProjects.mockResolvedValue({
      projects: [
        {
          id: "c0eebc99-9c0b-4ef8-bb6d-6bb9bd380a33",
          organizationId: "d0eebc99-9c0b-4ef8-bb6d-6bb9bd380a44",
          name: "Growth Project",
          domain: "growth.app",
          timezone: "UTC",
          goals: "Boost conversion",
          createdBy: "e0eebc99-9c0b-4ef8-bb6d-6bb9bd380a55",
          createdAt: "2026-08-27T12:00:00.000Z",
          updatedAt: "2026-08-27T12:00:00.000Z",
        },
      ],
    });
  });

  afterEach(() => {
    cleanup();
  });

  it("renders anonymous landing page with one-off audit form when user is not signed in", async () => {
    mockGetSession.mockResolvedValue({ data: { session: null } });

    render(<App />);

    expect(await screen.findByRole("button", { name: /analyze website/i })).toBeTruthy();
    expect(await screen.findByRole("button", { name: /sign in/i })).toBeTruthy();
    expect(await screen.findByRole("button", { name: /get started/i })).toBeTruthy();
    expect(screen.queryByText(/workspace/i)).toBeNull();
  });

  it("renders authenticated workspace shell when user is signed in", async () => {
    mockGetSession.mockResolvedValue({
      data: {
        session: {
          access_token: "test-jwt-token",
          user: {
            id: "user-123",
            email: "growth@company.com",
          },
        },
      },
    });

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        workspace: {
          user: { id: "user-123", email: "growth@company.com" },
          profile: {
            id: "user-123",
            email: "growth@company.com",
            fullName: "Alex",
            avatarUrl: null,
            createdAt: "2026-08-27T12:00:00.000Z",
            updatedAt: "2026-08-27T12:00:00.000Z",
          },
          organization: {
            id: "d0eebc99-9c0b-4ef8-bb6d-6bb9bd380a44",
            name: "Growth Ops",
            slug: "growth-ops",
            createdAt: "2026-08-27T12:00:00.000Z",
            updatedAt: "2026-08-27T12:00:00.000Z",
          },
          membership: {
            id: "m-123",
            organizationId: "d0eebc99-9c0b-4ef8-bb6d-6bb9bd380a44",
            userId: "user-123",
            role: "owner",
            createdAt: "2026-08-27T12:00:00.000Z",
            updatedAt: "2026-08-27T12:00:00.000Z",
          },
          role: "owner",
        },
      }),
    });

    render(<App />);

    // Shows Workspace header with organization name, user email, and role
    expect(await screen.findByText("Growth Ops")).toBeTruthy();
    expect(screen.getByText("growth@company.com")).toBeTruthy();
    expect(screen.getByText("owner")).toBeTruthy();
    expect(screen.getByRole("button", { name: /sign out/i })).toBeTruthy();

    // Shows Project list
    expect(await screen.findByRole("heading", { name: "Projects" })).toBeTruthy();
    expect(screen.getByText("Growth Project")).toBeTruthy();
  });

  it("allows switching between Workspace and One-Off Audit mode for authenticated users", async () => {
    mockGetSession.mockResolvedValue({
      data: {
        session: {
          access_token: "test-jwt-token",
          user: {
            id: "user-123",
            email: "growth@company.com",
          },
        },
      },
    });

    global.fetch = vi.fn().mockImplementation(async (url: string) => {
      if (typeof url === "string" && url.includes("/api/projects")) {
        return {
          ok: true,
          json: async () => ({
            projects: [
              {
                id: "p-123",
                organizationId: "d0eebc99-9c0b-4ef8-bb6d-6bb9bd380a44",
                name: "Growth Project",
                domain: "growth.com",
                timezone: "UTC",
                goals: "Improve conversions",
                createdAt: "2026-08-27T12:00:00.000Z",
                updatedAt: "2026-08-27T12:00:00.000Z",
              },
            ],
            total: 1,
          }),
        };
      }
      return {
        ok: true,
        json: async () => ({
          workspace: {
            user: { id: "user-123", email: "growth@company.com" },
            profile: {
              id: "user-123",
              email: "growth@company.com",
              fullName: "Alex",
              avatarUrl: null,
              createdAt: "2026-08-27T12:00:00.000Z",
              updatedAt: "2026-08-27T12:00:00.000Z",
            },
            organization: {
              id: "d0eebc99-9c0b-4ef8-bb6d-6bb9bd380a44",
              name: "Growth Ops",
              slug: "growth-ops",
              createdAt: "2026-08-27T12:00:00.000Z",
              updatedAt: "2026-08-27T12:00:00.000Z",
            },
            membership: {
              id: "m-123",
              organizationId: "d0eebc99-9c0b-4ef8-bb6d-6bb9bd380a44",
              userId: "user-123",
              role: "owner",
              createdAt: "2026-08-27T12:00:00.000Z",
              updatedAt: "2026-08-27T12:00:00.000Z",
            },
            role: "owner",
          },
        }),
      };
    });

    render(<App />);

    // In workspace initially
    expect(await screen.findByRole("heading", { name: "Projects" })).toBeTruthy();

    // Click One-Off Audit
    const oneOffBtn = screen.getByRole("button", { name: "One-Off Audit" });
    fireEvent.click(oneOffBtn);

    // Now in Landing view with "Return to Workspace" banner
    expect(await screen.findByRole("button", { name: /analyze website/i })).toBeTruthy();
    expect(screen.getByText(/one-off audit mode/i)).toBeTruthy();

    // Click Return to Workspace
    const returnBtn = screen.getByRole("button", { name: /return to workspace/i });
    fireEvent.click(returnBtn);

    // Back to Projects
    expect(await screen.findByRole("heading", { name: "Projects" })).toBeTruthy();
  });
});
