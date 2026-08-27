import { describe, expect, it, vi } from "vitest";
import { resolveOrProvisionWorkspace } from "../src/auth/provisioning.js";

describe("Workspace Provisioning & Idempotency", () => {
  const testUser = {
    id: "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11",
    email: "sarah@growthco.com",
    fullName: "Sarah Growth",
  };

  it("provisions first-time user with organization and owner membership", async () => {
    let orgCreated = false;
    let memCreated = false;

    const mockDb: any = {
      from: vi.fn((table: string) => {
        if (table === "memberships") {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                limit: vi.fn().mockResolvedValue({
                  data: orgCreated
                    ? [
                        {
                          id: "mem-1",
                          organization_id: "org-1",
                          user_id: testUser.id,
                          role: "owner",
                          created_at: "2026-08-27T12:00:00.000Z",
                          updated_at: "2026-08-27T12:00:00.000Z",
                          organization: {
                            id: "org-1",
                            name: "Sarah Growth's Workspace",
                            slug: "sarah-a0eebc99",
                            created_by: testUser.id,
                            created_at: "2026-08-27T12:00:00.000Z",
                            updated_at: "2026-08-27T12:00:00.000Z",
                          },
                        },
                      ]
                    : [],
                  error: null,
                }),
              }),
            }),
            upsert: vi.fn().mockReturnValue({
              select: vi.fn().mockReturnValue({
                single: vi.fn().mockImplementation(async () => {
                  memCreated = true;
                  return {
                    data: {
                      id: "mem-1",
                      organization_id: "org-1",
                      user_id: testUser.id,
                      role: "owner",
                      created_at: "2026-08-27T12:00:00.000Z",
                      updated_at: "2026-08-27T12:00:00.000Z",
                    },
                    error: null,
                  };
                }),
              }),
            }),
          };
        }

        if (table === "organizations") {
          return {
            insert: vi.fn().mockReturnValue({
              select: vi.fn().mockReturnValue({
                single: vi.fn().mockImplementation(async () => {
                  orgCreated = true;
                  return {
                    data: {
                      id: "org-1",
                      name: "Sarah Growth's Workspace",
                      slug: "sarah-a0eebc99",
                      created_by: testUser.id,
                      created_at: "2026-08-27T12:00:00.000Z",
                      updated_at: "2026-08-27T12:00:00.000Z",
                    },
                    error: null,
                  };
                }),
              }),
            }),
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                single: vi.fn().mockResolvedValue({
                  data: {
                    id: "org-1",
                    name: "Sarah Growth's Workspace",
                    slug: "sarah-a0eebc99",
                    created_by: testUser.id,
                    created_at: "2026-08-27T12:00:00.000Z",
                    updated_at: "2026-08-27T12:00:00.000Z",
                  },
                  error: null,
                }),
              }),
            }),
          };
        }

        if (table === "profiles") {
          return {
            upsert: vi.fn().mockResolvedValue({ error: null }),
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                single: vi.fn().mockResolvedValue({
                  data: {
                    id: testUser.id,
                    email: testUser.email,
                    full_name: testUser.fullName,
                    avatar_url: null,
                    created_at: "2026-08-27T12:00:00.000Z",
                    updated_at: "2026-08-27T12:00:00.000Z",
                  },
                  error: null,
                }),
              }),
            }),
          };
        }

        return {};
      }),
    };

    const workspace = await resolveOrProvisionWorkspace(testUser, { db: mockDb, privilegedDb: mockDb });

    expect(workspace.user.id).toBe(testUser.id);
    expect(workspace.role).toBe("owner");
    expect(workspace.organization.id).toBe("org-1");
    expect(workspace.membership.role).toBe("owner");
    expect(orgCreated).toBe(true);
    expect(memCreated).toBe(true);
  });

  it("is idempotent on repeated workspace resolutions (no duplicate orgs)", async () => {
    const existingOrg = {
      id: "org-existing-1",
      name: "Existing Org",
      slug: "existing-org",
      created_by: testUser.id,
      created_at: "2026-08-27T12:00:00.000Z",
      updated_at: "2026-08-27T12:00:00.000Z",
    };

    const mockDb: any = {
      from: vi.fn((table: string) => {
        if (table === "memberships") {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                limit: vi.fn().mockResolvedValue({
                  data: [
                    {
                      id: "mem-existing-1",
                      organization_id: existingOrg.id,
                      user_id: testUser.id,
                      role: "owner",
                      created_at: "2026-08-27T12:00:00.000Z",
                      updated_at: "2026-08-27T12:00:00.000Z",
                      organization: existingOrg,
                    },
                  ],
                  error: null,
                }),
              }),
            }),
          };
        }
        if (table === "profiles") {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                single: vi.fn().mockResolvedValue({
                  data: {
                    id: testUser.id,
                    email: testUser.email,
                    full_name: testUser.fullName,
                    avatar_url: null,
                    created_at: "2026-08-27T12:00:00.000Z",
                    updated_at: "2026-08-27T12:00:00.000Z",
                  },
                  error: null,
                }),
              }),
            }),
          };
        }
        return {};
      }),
    };

    const workspace = await resolveOrProvisionWorkspace(testUser, { db: mockDb });

    expect(workspace.organization.id).toBe(existingOrg.id);
    expect(workspace.role).toBe("owner");
    // Ensure no insert was triggered
    expect(mockDb.from).not.toHaveBeenCalledWith("organizations");
  });
});
