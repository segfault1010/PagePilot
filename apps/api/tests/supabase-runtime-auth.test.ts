import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createClient } from "@supabase/supabase-js";
import type { SupabaseClient } from "@supabase/supabase-js";
import request from "supertest";
import fs from "node:fs";
import path from "node:path";
import { createApp } from "../src/http/app.js";

const envPath = path.resolve(process.cwd(), ".env");
if (fs.existsSync(envPath)) {
  const lines = fs.readFileSync(envPath, "utf-8").split("\n");
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIdx = trimmed.indexOf("=");
    if (eqIdx !== -1) {
      const key = trimmed.slice(0, eqIdx).trim();
      const val = trimmed.slice(eqIdx + 1).trim();
      if (!process.env[key]) {
        process.env[key] = val;
      }
    }
  }
}

const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY;
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

const shouldRunLiveTests = Boolean(process.env.RUN_LIVE_TESTS && supabaseUrl && supabaseAnonKey && supabaseServiceRoleKey);

describe.skipIf(!shouldRunLiveTests)("Supabase Live Runtime Auth & Multi-Tenant Isolation", () => {
  let publicClient: SupabaseClient;
  let adminClient: SupabaseClient;
  let app: any;
  const createdUserIds: string[] = [];

  beforeAll(() => {
    expect(supabaseUrl).toBeDefined();
    expect(supabaseAnonKey).toBeDefined();
    expect(supabaseServiceRoleKey).toBeDefined();

    publicClient = createClient(supabaseUrl!, supabaseAnonKey!, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    adminClient = createClient(supabaseUrl!, supabaseServiceRoleKey!, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    app = createApp();
  });

  afterAll(async () => {
    for (const uid of createdUserIds) {
      try {
        await adminClient.auth.admin.deleteUser(uid);
      } catch {
        // Best effort cleanup
      }
    }
  });

  it(
    "completes full auth lifecycle, workspace provisioning, RBAC, and cross-tenant isolation against live Supabase",
    async () => {
    const timestamp = Date.now();
    const ownerEmail = `testowner${timestamp}@gmail.com`;
    const viewerEmail = `testviewer${timestamp}@gmail.com`;
    const foreignEmail = `testforeign${timestamp}@gmail.com`;
    const password = "TestPassword123!Safe";

    // 1. Sign Up / Create User — Owner
    const { data: signUpData, error: signUpErr } = await adminClient.auth.admin.createUser({
      email: ownerEmail,
      password,
      email_confirm: true,
      user_metadata: { full_name: "Staging Owner" },
    });
    expect(signUpErr).toBeNull();
    expect(signUpData.user).toBeDefined();
    const ownerUser = signUpData.user!;
    createdUserIds.push(ownerUser.id);

    // Let auth trigger execute and verify profile sync
    await new Promise((r) => setTimeout(r, 1200));
    const { data: ownerProfile, error: profileErr } = await adminClient
      .from("profiles")
      .select()
      .eq("id", ownerUser.id)
      .single();

    expect(profileErr).toBeNull();
    expect(ownerProfile.email).toBe(ownerEmail);
    expect(ownerProfile.full_name).toBe("Staging Owner");

    // 2. Sign In — Owner
    const { data: signInData, error: signInErr } = await publicClient.auth.signInWithPassword({
      email: ownerEmail,
      password,
    });
    expect(signInErr).toBeNull();
    expect(signInData.session).toBeDefined();
    const ownerToken = signInData.session!.access_token;

    // 3. Invalid credentials rejection
    const { error: invalidErr } = await publicClient.auth.signInWithPassword({
      email: ownerEmail,
      password: "WrongPassword999!",
    });
    expect(invalidErr).not.toBeNull();

    // 4. First-User Workspace Provisioning (GET /api/workspace/me)
    const wsRes = await request(app)
      .get("/api/workspace/me")
      .set("Authorization", `Bearer ${ownerToken}`);

    expect(wsRes.status).toBe(200);
    expect(wsRes.body.workspace).toBeDefined();
    const org = wsRes.body.workspace.organization;
    const membership = wsRes.body.workspace.membership;
    expect(org.id).toBeDefined();
    expect(org.slug).toBeDefined();
    expect(membership.role).toBe("owner");
    expect(membership.userId).toBe(ownerUser.id);

    // 5. Authenticated Project & Page CRUD
    const createProjRes = await request(app)
      .post("/api/projects")
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({
        name: "Staging Test Project",
        domain: "https://example.com",
        timezone: "America/New_York",
        goals: "Test conversion",
      });

    expect(createProjRes.status).toBe(201);
    const projectId = createProjRes.body.project.id;
    expect(projectId).toBeDefined();

    const listProjRes = await request(app)
      .get("/api/projects")
      .set("Authorization", `Bearer ${ownerToken}`);

    expect(listProjRes.status).toBe(200);
    expect(listProjRes.body.projects.some((p: any) => p.id === projectId)).toBe(true);

    const createPageRes = await request(app)
      .post(`/api/projects/${projectId}/pages`)
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({
        canonicalUrl: "https://example.com/pricing",
        cadence: "weekly",
        tags: ["pricing"],
      });

    expect(createPageRes.status).toBe(201);
    const pageId = createPageRes.body.page.id;
    expect(pageId).toBeDefined();

    // Duplicate page constraint check
    const dupPageRes = await request(app)
      .post(`/api/projects/${projectId}/pages`)
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({
        canonicalUrl: "https://example.com/pricing",
      });

    expect(dupPageRes.status).toBe(409);

    // 6. Role-Based Access Control (Viewer Role)
    const { data: viewerSignUp, error: viewerSignUpErr } = await adminClient.auth.admin.createUser({
      email: viewerEmail,
      password,
      email_confirm: true,
      user_metadata: { full_name: "Staging Viewer" },
    });
    expect(viewerSignUpErr).toBeNull();
    const viewerUser = viewerSignUp.user!;
    createdUserIds.push(viewerUser.id);

    await adminClient.from("memberships").insert({
      organization_id: org.id,
      user_id: viewerUser.id,
      role: "viewer",
    });

    const { data: viewerSignIn } = await publicClient.auth.signInWithPassword({
      email: viewerEmail,
      password,
    });
    const viewerToken = viewerSignIn.session!.access_token;

    // Viewer read allowed
    const viewerListRes = await request(app)
      .get("/api/projects")
      .set("Authorization", `Bearer ${viewerToken}`);
    expect(viewerListRes.status).toBe(200);

    // Viewer mutation forbidden
    const viewerCreateRes = await request(app)
      .post("/api/projects")
      .set("Authorization", `Bearer ${viewerToken}`)
      .send({
        name: "Viewer Illegal Project",
        domain: "https://illegal.com",
      });
    expect(viewerCreateRes.status).toBe(403);

    // 7. Cross-Tenant Access Isolation & Anti-Spoofing
    const { data: foreignSignUp } = await adminClient.auth.admin.createUser({
      email: foreignEmail,
      password,
      email_confirm: true,
      user_metadata: { full_name: "Foreign User" },
    });
    const foreignUser = foreignSignUp.user!;
    createdUserIds.push(foreignUser.id);

    const { data: foreignSignIn } = await publicClient.auth.signInWithPassword({
      email: foreignEmail,
      password,
    });
    const foreignToken = foreignSignIn.session!.access_token;

    // Provision foreign user's workspace
    await request(app)
      .get("/api/workspace/me")
      .set("Authorization", `Bearer ${foreignToken}`);

    // Attempt to access owner's project with spoofed headers
    const crossTenantRes = await request(app)
      .get(`/api/projects/${projectId}`)
      .set("Authorization", `Bearer ${foreignToken}`)
      .set("x-organization-id", org.id)
      .set("x-user-id", ownerUser.id);

    expect(crossTenantRes.status).toBe(404);

    // 8. Sign Out
    await publicClient.auth.signOut();
  }, 60000);
});
