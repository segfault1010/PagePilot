import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  Profile,
  Role,
  WorkspaceContext,
} from "@pagepilot/contracts";
import type { VerifiedUser } from "./supabase-server.js";
import {
  createPrivilegedSupabaseClient,
  createServerSupabaseClient,
} from "./supabase-server.js";

export interface ProvisioningClients {
  db?: SupabaseClient | null;
  privilegedDb?: SupabaseClient | null;
}

function generateSlug(email: string, userId: string): string {
  const prefix = (email.split("@")[0] || "workspace")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 24) || "workspace";
  const suffix = userId.replace(/-/g, "").slice(0, 8);
  return `${prefix}-${suffix}`;
}

/**
 * Idempotently resolves or provisions a first-user workspace (organization + owner membership).
 * Concurrency-safe: relies on unique constraints and handles potential parallel initializations cleanly.
 */
export async function resolveOrProvisionWorkspace(
  user: VerifiedUser,
  clients: ProvisioningClients = {},
  authToken?: string,
): Promise<WorkspaceContext> {
  const db =
    clients.db ??
    (authToken ? createServerSupabaseClient(undefined, authToken) : null) ??
    clients.privilegedDb ??
    createPrivilegedSupabaseClient() ??
    createServerSupabaseClient();

  if (!db) {
    throw new Error("Supabase client is not configured for workspace resolution.");
  }

  // 1. Check for an existing membership
  const { data: existingMemberships, error: memberError } = await db
    .from("memberships")
    .select(
      `
      id,
      organization_id,
      user_id,
      role,
      created_at,
      updated_at,
      organization:organizations (
        id,
        name,
        slug,
        created_by,
        created_at,
        updated_at
      )
    `,
    )
    .eq("user_id", user.id)
    .limit(1);

  if (!memberError && existingMemberships && existingMemberships.length > 0) {
    const mem = existingMemberships[0] as any;
    const org = (Array.isArray(mem.organization) ? mem.organization[0] : mem.organization) as any;

    if (org && org.id) {
      const profile = await getProfile(db, user);
      return {
        user: { id: user.id, email: user.email },
        profile,
        organization: {
          id: org.id,
          name: org.name,
          slug: org.slug,
          createdBy: org.created_by ?? org.createdBy ?? null,
          createdAt: org.created_at ?? org.createdAt,
          updatedAt: org.updated_at ?? org.updatedAt,
        },
        membership: {
          id: mem.id,
          organizationId: mem.organization_id,
          userId: mem.user_id,
          role: mem.role as Role,
          createdAt: mem.created_at,
          updatedAt: mem.updated_at,
        },
        role: mem.role as Role,
      };
    }
  }

  // 2. No membership found -> Provision first organization and owner membership.
  // Use privileged client if available for initial atomic onboarding.
  const adminDb = clients.privilegedDb ?? createPrivilegedSupabaseClient() ?? db;

  const orgName = `${user.fullName || user.email.split("@")[0]}'s Workspace`;
  const orgSlug = generateSlug(user.email, user.id);

  // Ensure profile row is synchronized
  try {
    await adminDb
      .from("profiles")
      .upsert({
        id: user.id,
        email: user.email,
        full_name: user.fullName || null,
        avatar_url: user.avatarUrl || null,
        updated_at: new Date().toISOString(),
      });
  } catch {
    // profile trigger might have handled it
  }

  // Create organization
  const { data: newOrg, error: orgError } = await adminDb
    .from("organizations")
    .insert({
      name: orgName,
      slug: orgSlug,
      created_by: user.id,
    })
    .select()
    .single();

  let targetOrgId: string;
  let targetOrgData: any;

  if (orgError) {
    // If slug collided or org already created, find existing org
    const { data: foundOrg } = await adminDb
      .from("organizations")
      .select()
      .eq("slug", orgSlug)
      .single();

    if (!foundOrg) {
      throw new Error(`Failed to provision organization: ${orgError.message}`);
    }
    targetOrgId = foundOrg.id;
    targetOrgData = foundOrg;
  } else {
    targetOrgId = newOrg.id;
    targetOrgData = newOrg;
  }

  // Create owner membership
  const { data: newMembership, error: memInsertError } = await adminDb
    .from("memberships")
    .upsert(
      {
        organization_id: targetOrgId,
        user_id: user.id,
        role: "owner",
      },
      { onConflict: "organization_id,user_id" },
    )
    .select()
    .single();

  if (memInsertError || !newMembership) {
    throw new Error(`Failed to provision membership: ${memInsertError?.message || "unknown"}`);
  }

  const profile = await getProfile(adminDb, user);

  return {
    user: { id: user.id, email: user.email },
    profile,
    organization: {
      id: targetOrgData.id,
      name: targetOrgData.name,
      slug: targetOrgData.slug,
      createdBy: targetOrgData.created_by ?? null,
      createdAt: targetOrgData.created_at,
      updatedAt: targetOrgData.updated_at,
    },
    membership: {
      id: newMembership.id,
      organizationId: newMembership.organization_id,
      userId: newMembership.user_id,
      role: newMembership.role as Role,
      createdAt: newMembership.created_at,
      updatedAt: newMembership.updated_at,
    },
    role: "owner",
  };
}

async function getProfile(db: SupabaseClient, user: VerifiedUser): Promise<Profile | null> {
  const { data, error } = await db.from("profiles").select().eq("id", user.id).single();
  if (error || !data) {
    return {
      id: user.id,
      email: user.email,
      fullName: user.fullName || null,
      avatarUrl: user.avatarUrl || null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
  }
  return {
    id: data.id,
    email: data.email,
    fullName: data.full_name ?? null,
    avatarUrl: data.avatar_url ?? null,
    createdAt: data.created_at,
    updatedAt: data.updated_at,
  };
}
