import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("Supabase Multi-Tenant SQL Migration Validation", () => {
  const migrationPath = resolve(
    process.cwd(),
    "supabase/migrations/20260827120000_init_multi_tenant_schema.sql"
  );
  const sql = readFileSync(migrationPath, "utf-8");

  const requiredTables = [
    "profiles",
    "organizations",
    "memberships",
    "projects",
    "monitored_pages",
    "audit_runs",
    "audit_reports",
    "score_snapshots",
    "findings",
    "recommendations",
  ];

  it("defines all 10 required Milestone 2 tables", () => {
    for (const table of requiredTables) {
      expect(sql).toContain(`CREATE TABLE IF NOT EXISTS public.${table}`);
    }
  });

  it("links profiles to auth.users with CASCADE deletion", () => {
    expect(sql).toMatch(/id\s+UUID\s+PRIMARY\s+KEY\s+REFERENCES\s+auth\.users\(id\)\s+ON\s+DELETE\s+CASCADE/i);
    expect(sql).toContain("handle_new_user");
    expect(sql).toContain("TRIGGER on_auth_user_created");
  });

  it("enforces membership uniqueness and valid roles", () => {
    expect(sql).toContain("CONSTRAINT uq_memberships_org_user UNIQUE (organization_id, user_id)");
    expect(sql).toContain("CHECK (role IN ('owner', 'admin', 'member', 'viewer'))");
  });

  it("enforces foreign key cascading from project down to recommendations", () => {
    // projects -> organizations
    expect(sql).toMatch(/organization_id\s+UUID\s+NOT\s+NULL\s+REFERENCES\s+public\.organizations\(id\)\s+ON\s+DELETE\s+CASCADE/i);
    // monitored_pages -> projects
    expect(sql).toMatch(/project_id\s+UUID\s+NOT\s+NULL\s+REFERENCES\s+public\.projects\(id\)\s+ON\s+DELETE\s+CASCADE/i);
    // audit_runs -> monitored_pages
    expect(sql).toMatch(/monitored_page_id\s+UUID\s+NOT\s+NULL\s+REFERENCES\s+public\.monitored_pages\(id\)\s+ON\s+DELETE\s+CASCADE/i);
    // audit_reports -> audit_runs
    expect(sql).toMatch(/audit_run_id\s+UUID\s+NOT\s+NULL\s+UNIQUE\s+REFERENCES\s+public\.audit_runs\(id\)\s+ON\s+DELETE\s+CASCADE/i);
    // score_snapshots -> audit_reports
    expect(sql).toMatch(/audit_report_id\s+UUID\s+NOT\s+NULL\s+REFERENCES\s+public\.audit_reports\(id\)\s+ON\s+DELETE\s+CASCADE/i);
    // findings -> audit_reports
    expect(sql).toMatch(/audit_report_id\s+UUID\s+NOT\s+NULL\s+REFERENCES\s+public\.audit_reports\(id\)\s+ON\s+DELETE\s+CASCADE/i);
    // recommendations -> audit_reports
    expect(sql).toMatch(/audit_report_id\s+UUID\s+NOT\s+NULL\s+REFERENCES\s+public\.audit_reports\(id\)\s+ON\s+DELETE\s+CASCADE/i);
  });

  it("prevents circular cascade on monitored_pages.latest_audit_run_id with ON DELETE SET NULL", () => {
    expect(sql).toContain("ADD CONSTRAINT fk_monitored_pages_latest_run");
    expect(sql).toContain("FOREIGN KEY (latest_audit_run_id)");
    expect(sql).toContain("REFERENCES public.audit_runs(id)");
    expect(sql).toContain("ON DELETE SET NULL");
  });

  it("defines SECURITY DEFINER helper functions with fixed search_path", () => {
    const helpers = ["is_org_member", "get_org_role", "is_org_admin_or_owner", "is_org_owner"];
    for (const helper of helpers) {
      expect(sql).toContain(`FUNCTION public.${helper}`);
      expect(sql).toContain("SECURITY DEFINER");
      expect(sql).toContain("SET search_path = public, auth, pg_temp");
    }
  });

  it("enables and forces RLS on all 10 tables", () => {
    for (const table of requiredTables) {
      expect(sql).toContain(`ALTER TABLE public.${table} ENABLE ROW LEVEL SECURITY;`);
      expect(sql).toContain(`ALTER TABLE public.${table} FORCE ROW LEVEL SECURITY;`);
    }
  });

  it("never uses USING (true) or WITH CHECK (true) on tenant-owned tables", () => {
    const tenantTables = [
      "organizations",
      "memberships",
      "projects",
      "monitored_pages",
      "audit_runs",
      "audit_reports",
      "score_snapshots",
      "findings",
      "recommendations",
    ];

    for (const table of tenantTables) {
      const tableRegex = new RegExp(`CREATE\\s+POLICY\\s+"${table}_[^"]+"\\s+ON\\s+public\\.${table}[^;]+;`, "gi");
      const matches = sql.match(tableRegex) || [];
      expect(matches.length).toBeGreaterThan(0);
      for (const policy of matches) {
        expect(policy).not.toMatch(/USING\s*\(\s*true\s*\)/i);
        expect(policy).not.toMatch(/WITH\s+CHECK\s*\(\s*true\s*\)/i);
      }
    }
  });

  it("enforces tenant-isolation on SELECT for all tenant tables via is_org_member", () => {
    const orgScopedTables = [
      "organizations",
      "memberships",
      "projects",
      "monitored_pages",
      "audit_runs",
      "audit_reports",
      "score_snapshots",
      "findings",
      "recommendations",
    ];

    for (const table of orgScopedTables) {
      const selectPolicyRegex = new RegExp(
        `CREATE\\s+POLICY\\s+"${table}_select_policy"\\s+ON\\s+public\\.${table}\\s+FOR\\s+SELECT\\s+TO\\s+authenticated\\s+USING\\s*\\((?:public\\.)?is_org_member\\((?:organization_id|id)\\)\\);`,
        "i"
      );
      expect(sql).toMatch(selectPolicyRegex);
    }
  });

  it("restricts mutations (INSERT/UPDATE/DELETE) so that viewer role is denied write access", () => {
    const mutableTenantTables = [
      "projects",
      "monitored_pages",
      "audit_runs",
      "audit_reports",
      "score_snapshots",
      "findings",
      "recommendations",
    ];

    for (const table of mutableTenantTables) {
      // INSERT policy requires owner, admin, or member (never viewer)
      const insertRegex = new RegExp(
        `CREATE\\s+POLICY\\s+"${table}_insert_policy"\\s+ON\\s+public\\.${table}[^;]+get_org_role\\(organization_id\\)\\s+IN\\s+\\('owner',\\s*'admin',\\s*'member'\\)`,
        "i"
      );
      expect(sql).toMatch(insertRegex);
    }
  });

  it("preserves historical report immutability by omitting UPDATE policies on reports, snapshots, and recommendations", () => {
    expect(sql).not.toContain('CREATE POLICY "audit_reports_update_policy"');
    expect(sql).not.toContain('CREATE POLICY "score_snapshots_update_policy"');
    expect(sql).not.toContain('CREATE POLICY "recommendations_update_policy"');
  });

  it("does not store raw HTML in any table, preserving data minimization and 90-day retention rules", () => {
    expect(sql).not.toContain("raw_html");
    expect(sql).not.toContain("html_content");
    expect(sql).not.toContain("body_html");
    expect(sql).toContain("report_payload JSONB NOT NULL");
  });

  it("defines unique index on monitored_pages(project_id, canonical_url) in migration", () => {
    const uniquenessMigrationPath = resolve(
      process.cwd(),
      "supabase/migrations/20260827130000_monitored_page_uniqueness.sql",
    );
    const uniquenessSql = readFileSync(uniquenessMigrationPath, "utf-8");
    expect(uniquenessSql).toContain("uq_monitored_pages_project_url");
    expect(uniquenessSql).toMatch(/CREATE\s+UNIQUE\s+INDEX\s+IF\s+NOT\s+EXISTS\s+uq_monitored_pages_project_url\s+ON\s+public\.monitored_pages\s*\(\s*project_id\s*,\s*canonical_url\s*\)/i);
  });
});

