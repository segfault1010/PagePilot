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

    // Verify it is strictly the dedicated PagePilot project
    expect(supabaseUrl).toContain("qzlffxlmrhqfjeohsnkm.supabase.co");

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
    "verifies all 12 end-to-end auth, profile, workspace, session lifecycle, and multi-tenant security requirements",
    async () => {
      const timestamp = Date.now();
      const ownerEmail = `e2e_owner_${timestamp}@example.com`;
      const foreignEmail = `e2e_foreign_${timestamp}@example.com`;
      const password = "TestPassword123!Safe";


      // -------------------------------------------------------------
      // 1. Sign Up succeeds
      // -------------------------------------------------------------
      let signUpData: any;
      let signUpErr: any;
      for (let attempt = 0; attempt < 3; attempt++) {
        const res = await adminClient.auth.admin.createUser({
          email: ownerEmail,
          password,
          email_confirm: true,
          user_metadata: { full_name: "PagePilot Test Owner" },
        });
        signUpData = res.data;
        signUpErr = res.error;
        if (!signUpErr) break;
        await new Promise((r) => setTimeout(r, 1500));
      }
      expect(signUpErr).toBeNull();
      expect(signUpData.user).toBeDefined();
      expect(signUpData.user!.email).toBe(ownerEmail);
      const ownerUser = signUpData.user!;
      createdUserIds.push(ownerUser.id);

      // -------------------------------------------------------------
      // 2. Supabase auth.users contains the test user
      // -------------------------------------------------------------
      let userLookup: any;
      let userLookupErr: any;
      for (let attempt = 0; attempt < 3; attempt++) {
        const res = await adminClient.auth.admin.getUserById(ownerUser.id);
        userLookup = res.data;
        userLookupErr = res.error;
        if (!userLookupErr) break;
        await new Promise((r) => setTimeout(r, 1500));
      }
      expect(userLookupErr).toBeNull();
      expect(userLookup.user).toBeDefined();
      expect(userLookup.user!.id).toBe(ownerUser.id);
      expect(userLookup.user!.email).toBe(ownerEmail);

      // -------------------------------------------------------------
      // 3. profiles row is provisioned
      // -------------------------------------------------------------
      // Allow database trigger to execute
      await new Promise((r) => setTimeout(r, 1500));
      let ownerProfile: any;
      let profileErr: any;
      for (let attempt = 0; attempt < 4; attempt++) {
        const res = await adminClient
          .from("profiles")
          .select()
          .eq("id", ownerUser.id)
          .single();
        ownerProfile = res.data;
        profileErr = res.error;
        if (!profileErr && ownerProfile) break;
        await new Promise((r) => setTimeout(r, 1500));
      }

      expect(profileErr).toBeNull();
      expect(ownerProfile).toBeDefined();
      expect(ownerProfile.id).toBe(ownerUser.id);
      expect(ownerProfile.email).toBe(ownerEmail);
      expect(ownerProfile.full_name).toBe("PagePilot Test Owner");

      // Obtain session token via sign in
      let signInData: any;
      let signInErr: any;
      for (let attempt = 0; attempt < 3; attempt++) {
        const res = await publicClient.auth.signInWithPassword({
          email: ownerEmail,
          password,
        });
        signInData = res.data;
        signInErr = res.error;
        if (!signInErr) break;
        await new Promise((r) => setTimeout(r, 1500));
      }
      expect(signInErr).toBeNull();
      expect(signInData.session).toBeDefined();
      const ownerToken = signInData.session!.access_token;


      // -------------------------------------------------------------
      // 4. organization is provisioned & 5. owner membership is provisioned & 6. GET /api/workspace/me returns correct role
      // -------------------------------------------------------------
      const wsRes = await request(app)
        .get("/api/workspace/me")
        .set("Authorization", `Bearer ${ownerToken}`);

      expect(wsRes.status).toBe(200);
      expect(wsRes.body.workspace).toBeDefined();
      const ws = wsRes.body.workspace;
      const org = ws.organization;
      const membership = ws.membership;

      // 4. organization is provisioned
      expect(org.id).toBeDefined();
      expect(org.slug).toBeDefined();
      const { data: dbOrg, error: dbOrgErr } = await adminClient
        .from("organizations")
        .select()
        .eq("id", org.id)
        .single();
      expect(dbOrgErr).toBeNull();
      expect(dbOrg.id).toBe(org.id);

      // 5. owner membership is provisioned
      expect(membership.role).toBe("owner");
      expect(membership.userId).toBe(ownerUser.id);
      const { data: dbMem, error: dbMemErr } = await adminClient
        .from("memberships")
        .select()
        .eq("organization_id", org.id)
        .eq("user_id", ownerUser.id)
        .single();
      expect(dbMemErr).toBeNull();
      expect(dbMem.role).toBe("owner");

      // 6. GET /api/workspace/me returns the correct user/org/owner role
      expect(ws.user.id).toBe(ownerUser.id);
      expect(ws.user.email).toBe(ownerEmail);
      expect(ws.role).toBe("owner");
      expect(ws.organization.id).toBe(org.id);

      // -------------------------------------------------------------
      // 7. Sign out succeeds
      // -------------------------------------------------------------
      const storageMap = new Map<string, string>();
      const customStorage = {
        getItem: (k: string) => storageMap.get(k) ?? null,
        setItem: (k: string, v: string) => { storageMap.set(k, v); },
        removeItem: (k: string) => { storageMap.delete(k); },
      };

      const browserSimClient = createClient(supabaseUrl!, supabaseAnonKey!, {
        auth: {
          storage: customStorage,
          persistSession: true,
          autoRefreshToken: false,
        },
      });

      // Sign in on browser-sim client to populate persistent storage
      const { data: simSignIn, error: simSignInErr } = await browserSimClient.auth.signInWithPassword({
        email: ownerEmail,
        password,
      });
      expect(simSignInErr).toBeNull();
      expect(simSignIn.session).toBeDefined();
      expect(storageMap.size).toBeGreaterThan(0);

      // Sign out
      const { error: signOutErr } = await browserSimClient.auth.signOut();
      expect(signOutErr).toBeNull();
      const { data: sessionAfterSignOut } = await browserSimClient.auth.getSession();
      expect(sessionAfterSignOut.session).toBeNull();

      // -------------------------------------------------------------
      // 8. Sign back in succeeds
      // -------------------------------------------------------------
      const { data: reSignInData, error: reSignInErr } = await browserSimClient.auth.signInWithPassword({
        email: ownerEmail,
        password,
      });
      expect(reSignInErr).toBeNull();
      expect(reSignInData.session).toBeDefined();
      expect(reSignInData.user).toBeDefined();
      expect(reSignInData.user!.id).toBe(ownerUser.id);

      // -------------------------------------------------------------
      // 9. Session survives page refresh
      // -------------------------------------------------------------
      // Simulate refreshing the page by creating a new Supabase client reading from the same storage
      const refreshedBrowserClient = createClient(supabaseUrl!, supabaseAnonKey!, {
        auth: {
          storage: customStorage,
          persistSession: true,
          autoRefreshToken: false,
        },
      });
      const { data: refreshedSession, error: refreshErr } = await refreshedBrowserClient.auth.getSession();
      expect(refreshErr).toBeNull();
      expect(refreshedSession.session).not.toBeNull();
      expect(refreshedSession.session!.user.id).toBe(ownerUser.id);
      expect(refreshedSession.session!.access_token).toBe(reSignInData.session!.access_token);

      // -------------------------------------------------------------
      // 10. Authenticated project API access works
      // -------------------------------------------------------------
      const activeOwnerToken = reSignInData.session!.access_token;

      const createProjRes = await request(app)
        .post("/api/projects")
        .set("Authorization", `Bearer ${activeOwnerToken}`)
        .send({
          name: "E2E Verified Project",
          domain: "https://example.com",
          timezone: "UTC",
          goals: "Verify project CRUD",
        });

      expect(createProjRes.status).toBe(201);
      const projectId = createProjRes.body.project.id;
      expect(projectId).toBeDefined();

      const listProjRes = await request(app)
        .get("/api/projects")
        .set("Authorization", `Bearer ${activeOwnerToken}`);

      expect(listProjRes.status).toBe(200);
      expect(listProjRes.body.projects.some((p: any) => p.id === projectId)).toBe(true);

      const createPageRes = await request(app)
        .post(`/api/projects/${projectId}/pages`)
        .set("Authorization", `Bearer ${activeOwnerToken}`)
        .send({
          canonicalUrl: "https://example.com/e2e-pricing",
          cadence: "weekly",
          tags: ["pricing"],
        });

      expect(createPageRes.status).toBe(201);
      const pageId = createPageRes.body.page.id;
      expect(pageId).toBeDefined();


      // -------------------------------------------------------------
      // 11. Anonymous POST /api/analyze still works without auth
      // -------------------------------------------------------------
      const anonAnalyzeRes = await request(app)
        .post("/api/analyze")
        .send({ url: "https://example.com" });

      // The core analyze pipeline should NOT return 401 or 403 (no authentication required)
      expect(anonAnalyzeRes.status).not.toBe(401);
      expect(anonAnalyzeRes.status).not.toBe(403);
      expect([200, 422, 502, 503]).toContain(anonAnalyzeRes.status);

      // -------------------------------------------------------------
      // 12. Cross-tenant / client-ID spoofing remains rejected
      // -------------------------------------------------------------
      let foreignSignUp: any;
      let foreignSignUpErr: any;
      for (let attempt = 0; attempt < 3; attempt++) {
        const res = await adminClient.auth.admin.createUser({
          email: foreignEmail,
          password,
          email_confirm: true,
          user_metadata: { full_name: "Foreign Tenant User" },
        });
        foreignSignUp = res.data;
        foreignSignUpErr = res.error;
        if (!foreignSignUpErr) break;
        await new Promise((r) => setTimeout(r, 1500));
      }
      expect(foreignSignUpErr).toBeNull();
      const foreignUser = foreignSignUp.user!;
      createdUserIds.push(foreignUser.id);

      let foreignSignIn: any;
      let foreignSignInErr: any;
      for (let attempt = 0; attempt < 3; attempt++) {
        const res = await publicClient.auth.signInWithPassword({
          email: foreignEmail,
          password,
        });
        foreignSignIn = res.data;
        foreignSignInErr = res.error;
        if (!foreignSignInErr) break;
        await new Promise((r) => setTimeout(r, 1500));
      }
      expect(foreignSignInErr).toBeNull();
      const foreignToken = foreignSignIn.session!.access_token;


      // Auto-provision foreign user's workspace
      await request(app)
        .get("/api/workspace/me")
        .set("Authorization", `Bearer ${foreignToken}`);

      // Attempt to access owner's project with spoofed headers using foreign user's valid token
      const crossTenantRes = await request(app)
        .get(`/api/projects/${projectId}`)
        .set("Authorization", `Bearer ${foreignToken}`)
        .set("x-organization-id", org.id)
        .set("x-user-id", ownerUser.id);

      expect(crossTenantRes.status).toBe(404);

      // Attempt to mutate owner's project with foreign token
      const crossTenantMutationRes = await request(app)
        .post(`/api/projects/${projectId}/pages`)
        .set("Authorization", `Bearer ${foreignToken}`)
        .send({
          canonicalUrl: "https://example.com/unauthorized-page",
        });

      expect(crossTenantMutationRes.status).toBe(404);
    },
    90000,
  );
});
