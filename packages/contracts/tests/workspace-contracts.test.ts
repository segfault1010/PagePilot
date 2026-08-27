import { describe, expect, it } from "vitest";
import {
  workspaceContextSchema,
  workspaceResponseSchema,
} from "../src/index.js";

describe("Workspace Contracts", () => {
  const validUuid = "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11";
  const validTimestamp = "2026-08-27T12:00:00.000Z";

  it("validates WorkspaceContext and WorkspaceResponse", () => {
    const validContext = {
      user: {
        id: validUuid,
        email: "growth@example.com",
      },
      profile: {
        id: validUuid,
        email: "growth@example.com",
        fullName: "Alex Growth",
        avatarUrl: null,
        createdAt: validTimestamp,
        updatedAt: validTimestamp,
      },
      organization: {
        id: validUuid,
        name: "Acme Growth",
        slug: "acme-growth",
        createdBy: validUuid,
        createdAt: validTimestamp,
        updatedAt: validTimestamp,
      },
      membership: {
        id: validUuid,
        organizationId: validUuid,
        userId: validUuid,
        role: "owner" as const,
        createdAt: validTimestamp,
        updatedAt: validTimestamp,
      },
      role: "owner" as const,
    };

    expect(workspaceContextSchema.parse(validContext)).toEqual(validContext);

    const validResponse = {
      workspace: validContext,
    };
    expect(workspaceResponseSchema.parse(validResponse)).toEqual(validResponse);
  });

  it("rejects invalid role in WorkspaceContext", () => {
    const invalidContext = {
      user: {
        id: validUuid,
        email: "growth@example.com",
      },
      profile: null,
      organization: {
        id: validUuid,
        name: "Acme Growth",
        slug: "acme-growth",
        createdBy: validUuid,
        createdAt: validTimestamp,
        updatedAt: validTimestamp,
      },
      membership: {
        id: validUuid,
        organizationId: validUuid,
        userId: validUuid,
        role: "invalid_role",
        createdAt: validTimestamp,
        updatedAt: validTimestamp,
      },
      role: "invalid_role",
    };

    expect(() => workspaceContextSchema.parse(invalidContext)).toThrow();
  });
});
