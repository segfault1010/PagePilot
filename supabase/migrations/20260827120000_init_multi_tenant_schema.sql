-- ============================================================================
-- PagePilot — Milestone 2: Multi-Tenant Foundation Schema & RLS Policies
-- Migration: 20260827120000_init_multi_tenant_schema.sql
-- ============================================================================

-- Ensure pgcrypto / uuid extensions are available
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ============================================================================
-- 1. PROFILES
-- ============================================================================
-- Maps directly 1:1 to auth.users.id
CREATE TABLE IF NOT EXISTS public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  full_name TEXT,
  avatar_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Automatic profile sync trigger for Supabase auth.users
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
BEGIN
  INSERT INTO public.profiles (id, email, full_name, avatar_url)
  VALUES (
    new.id,
    COALESCE(new.email, ''),
    new.raw_user_meta_data->>'full_name',
    new.raw_user_meta_data->>'avatar_url'
  )
  ON CONFLICT (id) DO UPDATE
  SET
    email = EXCLUDED.email,
    full_name = COALESCE(EXCLUDED.full_name, public.profiles.full_name),
    avatar_url = COALESCE(EXCLUDED.avatar_url, public.profiles.avatar_url),
    updated_at = now();
  RETURN new;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT OR UPDATE ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ============================================================================
-- 2. ORGANIZATIONS
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.organizations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================================
-- 3. MEMBERSHIPS
-- ============================================================================
-- Roles: owner, admin, member, viewer
CREATE TABLE IF NOT EXISTS public.memberships (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('owner', 'admin', 'member', 'viewer')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_memberships_org_user UNIQUE (organization_id, user_id)
);

-- ============================================================================
-- SECURITY DEFINER HELPER FUNCTIONS (Avoid RLS recursion on memberships)
-- ============================================================================
CREATE OR REPLACE FUNCTION public.is_org_member(_org_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.memberships
    WHERE organization_id = _org_id
      AND user_id = auth.uid()
  );
$$;

CREATE OR REPLACE FUNCTION public.get_org_role(_org_id UUID)
RETURNS TEXT
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
  SELECT role FROM public.memberships
  WHERE organization_id = _org_id
    AND user_id = auth.uid()
  LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.is_org_admin_or_owner(_org_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.memberships
    WHERE organization_id = _org_id
      AND user_id = auth.uid()
      AND role IN ('owner', 'admin')
  );
$$;

CREATE OR REPLACE FUNCTION public.is_org_owner(_org_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.memberships
    WHERE organization_id = _org_id
      AND user_id = auth.uid()
      AND role = 'owner'
  );
$$;

-- ============================================================================
-- 4. PROJECTS
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.projects (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  domain TEXT,
  timezone TEXT NOT NULL DEFAULT 'UTC',
  goals TEXT,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================================
-- 5. MONITORED PAGES
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.monitored_pages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  canonical_url TEXT NOT NULL,
  cadence TEXT NOT NULL DEFAULT 'weekly' CHECK (cadence IN ('weekly', 'manual')),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'paused', 'archived')),
  owner_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  tags TEXT[] NOT NULL DEFAULT '{}',
  latest_audit_run_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================================
-- 6. AUDIT RUNS
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.audit_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  monitored_page_id UUID NOT NULL REFERENCES public.monitored_pages(id) ON DELETE CASCADE,
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  invocation_type TEXT NOT NULL CHECK (invocation_type IN ('manual', 'scheduled')),
  status TEXT NOT NULL DEFAULT 'requested' CHECK (status IN ('requested', 'queued', 'running', 'completed', 'failed')),
  target_url TEXT NOT NULL,
  final_url TEXT,
  triggered_by_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  failed_at TIMESTAMPTZ,
  error_code TEXT,
  error_message TEXT,
  retryable BOOLEAN,
  model_version TEXT NOT NULL,
  check_version TEXT NOT NULL,
  prompt_version TEXT NOT NULL,
  scoring_version TEXT NOT NULL,
  retry_count INTEGER NOT NULL DEFAULT 0,
  max_retries INTEGER NOT NULL DEFAULT 3,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Add forward foreign key for monitored_pages.latest_audit_run_id
ALTER TABLE public.monitored_pages
  DROP CONSTRAINT IF EXISTS fk_monitored_pages_latest_run;

ALTER TABLE public.monitored_pages
  ADD CONSTRAINT fk_monitored_pages_latest_run
  FOREIGN KEY (latest_audit_run_id)
  REFERENCES public.audit_runs(id)
  ON DELETE SET NULL;

-- ============================================================================
-- 7. AUDIT REPORTS (Immutable historical evidence)
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.audit_reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  audit_run_id UUID NOT NULL UNIQUE REFERENCES public.audit_runs(id) ON DELETE CASCADE,
  monitored_page_id UUID NOT NULL REFERENCES public.monitored_pages(id) ON DELETE CASCADE,
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  schema_version TEXT NOT NULL DEFAULT '1.0.0',
  model_identifier TEXT NOT NULL,
  check_version TEXT NOT NULL,
  scoring_version TEXT NOT NULL,
  summary TEXT NOT NULL,
  overall_score INTEGER NOT NULL CHECK (overall_score >= 0 AND overall_score <= 100),
  score_confidence TEXT NOT NULL CHECK (score_confidence IN ('blended', 'ai-led')),
  report_payload JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================================
-- 8. SCORE SNAPSHOTS
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.score_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  audit_report_id UUID NOT NULL REFERENCES public.audit_reports(id) ON DELETE CASCADE,
  audit_run_id UUID NOT NULL REFERENCES public.audit_runs(id) ON DELETE CASCADE,
  monitored_page_id UUID NOT NULL REFERENCES public.monitored_pages(id) ON DELETE CASCADE,
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  category TEXT NOT NULL CHECK (category IN ('clarity', 'visualHierarchy', 'ctaEffectiveness', 'copy', 'accessibility', 'mobileUx', 'trustCredibility')),
  score INTEGER NOT NULL CHECK (score >= 0 AND score <= 100),
  confidence TEXT NOT NULL CHECK (confidence IN ('blended', 'ai-led')),
  explanation TEXT NOT NULL,
  severity TEXT NOT NULL CHECK (severity IN ('low', 'medium', 'high')),
  scoring_version TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_report_category_snapshot UNIQUE (audit_report_id, category)
);

-- ============================================================================
-- 9. FINDINGS
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.findings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  audit_report_id UUID NOT NULL REFERENCES public.audit_reports(id) ON DELETE CASCADE,
  audit_run_id UUID NOT NULL REFERENCES public.audit_runs(id) ON DELETE CASCADE,
  monitored_page_id UUID NOT NULL REFERENCES public.monitored_pages(id) ON DELETE CASCADE,
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  finding_type TEXT NOT NULL CHECK (finding_type IN ('top_problem', 'category_finding')),
  category TEXT NOT NULL CHECK (category IN ('clarity', 'visualHierarchy', 'ctaEffectiveness', 'copy', 'accessibility', 'mobileUx', 'trustCredibility')),
  title TEXT NOT NULL,
  severity TEXT NOT NULL CHECK (severity IN ('low', 'medium', 'high')),
  evidence TEXT NOT NULL,
  basis TEXT NOT NULL CHECK (basis IN ('observed', 'inferred')),
  signal_ids TEXT[] NOT NULL DEFAULT '{}',
  recommendation TEXT NOT NULL,
  display_order INTEGER NOT NULL DEFAULT 0,
  work_status TEXT NOT NULL DEFAULT 'open' CHECK (work_status IN ('open', 'in_progress', 'resolved', 'dismissed')),
  resolved_at TIMESTAMPTZ,
  resolved_by_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================================
-- 10. RECOMMENDATIONS
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.recommendations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  audit_report_id UUID NOT NULL REFERENCES public.audit_reports(id) ON DELETE CASCADE,
  audit_run_id UUID NOT NULL REFERENCES public.audit_runs(id) ON DELETE CASCADE,
  monitored_page_id UUID NOT NULL REFERENCES public.monitored_pages(id) ON DELETE CASCADE,
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  recommendation_type TEXT NOT NULL CHECK (recommendation_type IN ('quick_win', 'detailed')),
  category TEXT CHECK (category IS NULL OR category IN ('clarity', 'visualHierarchy', 'ctaEffectiveness', 'copy', 'accessibility', 'mobileUx', 'trustCredibility')),
  title TEXT NOT NULL,
  detail TEXT NOT NULL,
  display_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================================
-- INDEXES
-- ============================================================================
CREATE INDEX IF NOT EXISTS idx_memberships_user ON public.memberships(user_id);
CREATE INDEX IF NOT EXISTS idx_memberships_org ON public.memberships(organization_id);
CREATE INDEX IF NOT EXISTS idx_projects_org ON public.projects(organization_id);
CREATE INDEX IF NOT EXISTS idx_monitored_pages_project ON public.monitored_pages(project_id);
CREATE INDEX IF NOT EXISTS idx_monitored_pages_org ON public.monitored_pages(organization_id);
CREATE INDEX IF NOT EXISTS idx_audit_runs_page ON public.audit_runs(monitored_page_id);
CREATE INDEX IF NOT EXISTS idx_audit_runs_org ON public.audit_runs(organization_id);
CREATE INDEX IF NOT EXISTS idx_audit_runs_status ON public.audit_runs(status);
CREATE INDEX IF NOT EXISTS idx_audit_reports_run ON public.audit_reports(audit_run_id);
CREATE INDEX IF NOT EXISTS idx_audit_reports_page ON public.audit_reports(monitored_page_id);
CREATE INDEX IF NOT EXISTS idx_audit_reports_org ON public.audit_reports(organization_id);
CREATE INDEX IF NOT EXISTS idx_score_snapshots_report ON public.score_snapshots(audit_report_id);
CREATE INDEX IF NOT EXISTS idx_findings_report ON public.findings(audit_report_id);
CREATE INDEX IF NOT EXISTS idx_recommendations_report ON public.recommendations(audit_report_id);

-- ============================================================================
-- ROW LEVEL SECURITY (RLS) POLICIES
-- ============================================================================

-- 1. PROFILES
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.profiles FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "profiles_select_policy" ON public.profiles;
CREATE POLICY "profiles_select_policy" ON public.profiles
  FOR SELECT TO authenticated
  USING (
    id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.memberships m1
      JOIN public.memberships m2 ON m1.organization_id = m2.organization_id
      WHERE m1.user_id = auth.uid() AND m2.user_id = public.profiles.id
    )
  );

DROP POLICY IF EXISTS "profiles_update_policy" ON public.profiles;
CREATE POLICY "profiles_update_policy" ON public.profiles
  FOR UPDATE TO authenticated
  USING (id = auth.uid())
  WITH CHECK (id = auth.uid());

DROP POLICY IF EXISTS "profiles_insert_policy" ON public.profiles;
CREATE POLICY "profiles_insert_policy" ON public.profiles
  FOR INSERT TO authenticated
  WITH CHECK (id = auth.uid());

-- 2. ORGANIZATIONS
ALTER TABLE public.organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.organizations FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "organizations_select_policy" ON public.organizations;
CREATE POLICY "organizations_select_policy" ON public.organizations
  FOR SELECT TO authenticated
  USING (public.is_org_member(id));

DROP POLICY IF EXISTS "organizations_insert_policy" ON public.organizations;
CREATE POLICY "organizations_insert_policy" ON public.organizations
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS "organizations_update_policy" ON public.organizations;
CREATE POLICY "organizations_update_policy" ON public.organizations
  FOR UPDATE TO authenticated
  USING (public.is_org_admin_or_owner(id))
  WITH CHECK (public.is_org_admin_or_owner(id));

DROP POLICY IF EXISTS "organizations_delete_policy" ON public.organizations;
CREATE POLICY "organizations_delete_policy" ON public.organizations
  FOR DELETE TO authenticated
  USING (public.is_org_owner(id));

-- 3. MEMBERSHIPS
ALTER TABLE public.memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.memberships FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "memberships_select_policy" ON public.memberships;
CREATE POLICY "memberships_select_policy" ON public.memberships
  FOR SELECT TO authenticated
  USING (public.is_org_member(organization_id));

DROP POLICY IF EXISTS "memberships_insert_policy" ON public.memberships;
CREATE POLICY "memberships_insert_policy" ON public.memberships
  FOR INSERT TO authenticated
  WITH CHECK (
    public.is_org_admin_or_owner(organization_id)
    OR (
      role = 'owner'
      AND user_id = auth.uid()
      AND NOT EXISTS (
        SELECT 1 FROM public.memberships
        WHERE organization_id = memberships.organization_id
      )
    )
  );

DROP POLICY IF EXISTS "memberships_update_policy" ON public.memberships;
CREATE POLICY "memberships_update_policy" ON public.memberships
  FOR UPDATE TO authenticated
  USING (public.is_org_admin_or_owner(organization_id))
  WITH CHECK (public.is_org_admin_or_owner(organization_id));

DROP POLICY IF EXISTS "memberships_delete_policy" ON public.memberships;
CREATE POLICY "memberships_delete_policy" ON public.memberships
  FOR DELETE TO authenticated
  USING (
    public.is_org_admin_or_owner(organization_id)
    OR (user_id = auth.uid() AND role <> 'owner')
  );

-- 4. PROJECTS
ALTER TABLE public.projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.projects FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "projects_select_policy" ON public.projects;
CREATE POLICY "projects_select_policy" ON public.projects
  FOR SELECT TO authenticated
  USING (public.is_org_member(organization_id));

DROP POLICY IF EXISTS "projects_insert_policy" ON public.projects;
CREATE POLICY "projects_insert_policy" ON public.projects
  FOR INSERT TO authenticated
  WITH CHECK (
    public.is_org_member(organization_id)
    AND public.get_org_role(organization_id) IN ('owner', 'admin', 'member')
  );

DROP POLICY IF EXISTS "projects_update_policy" ON public.projects;
CREATE POLICY "projects_update_policy" ON public.projects
  FOR UPDATE TO authenticated
  USING (
    public.is_org_member(organization_id)
    AND public.get_org_role(organization_id) IN ('owner', 'admin', 'member')
  )
  WITH CHECK (
    public.is_org_member(organization_id)
    AND public.get_org_role(organization_id) IN ('owner', 'admin', 'member')
  );

DROP POLICY IF EXISTS "projects_delete_policy" ON public.projects;
CREATE POLICY "projects_delete_policy" ON public.projects
  FOR DELETE TO authenticated
  USING (public.is_org_admin_or_owner(organization_id));

-- 5. MONITORED PAGES
ALTER TABLE public.monitored_pages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.monitored_pages FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "monitored_pages_select_policy" ON public.monitored_pages;
CREATE POLICY "monitored_pages_select_policy" ON public.monitored_pages
  FOR SELECT TO authenticated
  USING (public.is_org_member(organization_id));

DROP POLICY IF EXISTS "monitored_pages_insert_policy" ON public.monitored_pages;
CREATE POLICY "monitored_pages_insert_policy" ON public.monitored_pages
  FOR INSERT TO authenticated
  WITH CHECK (
    public.is_org_member(organization_id)
    AND public.get_org_role(organization_id) IN ('owner', 'admin', 'member')
  );

DROP POLICY IF EXISTS "monitored_pages_update_policy" ON public.monitored_pages;
CREATE POLICY "monitored_pages_update_policy" ON public.monitored_pages
  FOR UPDATE TO authenticated
  USING (
    public.is_org_member(organization_id)
    AND public.get_org_role(organization_id) IN ('owner', 'admin', 'member')
  )
  WITH CHECK (
    public.is_org_member(organization_id)
    AND public.get_org_role(organization_id) IN ('owner', 'admin', 'member')
  );

DROP POLICY IF EXISTS "monitored_pages_delete_policy" ON public.monitored_pages;
CREATE POLICY "monitored_pages_delete_policy" ON public.monitored_pages
  FOR DELETE TO authenticated
  USING (
    public.is_org_member(organization_id)
    AND public.get_org_role(organization_id) IN ('owner', 'admin', 'member')
  );

-- 6. AUDIT RUNS
ALTER TABLE public.audit_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_runs FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "audit_runs_select_policy" ON public.audit_runs;
CREATE POLICY "audit_runs_select_policy" ON public.audit_runs
  FOR SELECT TO authenticated
  USING (public.is_org_member(organization_id));

DROP POLICY IF EXISTS "audit_runs_insert_policy" ON public.audit_runs;
CREATE POLICY "audit_runs_insert_policy" ON public.audit_runs
  FOR INSERT TO authenticated
  WITH CHECK (
    public.is_org_member(organization_id)
    AND public.get_org_role(organization_id) IN ('owner', 'admin', 'member')
  );

DROP POLICY IF EXISTS "audit_runs_update_policy" ON public.audit_runs;
CREATE POLICY "audit_runs_update_policy" ON public.audit_runs
  FOR UPDATE TO authenticated
  USING (
    public.is_org_member(organization_id)
    AND public.get_org_role(organization_id) IN ('owner', 'admin', 'member')
  )
  WITH CHECK (
    public.is_org_member(organization_id)
    AND public.get_org_role(organization_id) IN ('owner', 'admin', 'member')
  );

DROP POLICY IF EXISTS "audit_runs_delete_policy" ON public.audit_runs;
CREATE POLICY "audit_runs_delete_policy" ON public.audit_runs
  FOR DELETE TO authenticated
  USING (public.is_org_admin_or_owner(organization_id));

-- 7. AUDIT REPORTS (Immutable: SELECT and INSERT only for members/admins/owners, DELETE for admin/owner)
ALTER TABLE public.audit_reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_reports FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "audit_reports_select_policy" ON public.audit_reports;
CREATE POLICY "audit_reports_select_policy" ON public.audit_reports
  FOR SELECT TO authenticated
  USING (public.is_org_member(organization_id));

DROP POLICY IF EXISTS "audit_reports_insert_policy" ON public.audit_reports;
CREATE POLICY "audit_reports_insert_policy" ON public.audit_reports
  FOR INSERT TO authenticated
  WITH CHECK (
    public.is_org_member(organization_id)
    AND public.get_org_role(organization_id) IN ('owner', 'admin', 'member')
  );

DROP POLICY IF EXISTS "audit_reports_delete_policy" ON public.audit_reports;
CREATE POLICY "audit_reports_delete_policy" ON public.audit_reports
  FOR DELETE TO authenticated
  USING (public.is_org_admin_or_owner(organization_id));

-- 8. SCORE SNAPSHOTS (Immutable: SELECT and INSERT only)
ALTER TABLE public.score_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.score_snapshots FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "score_snapshots_select_policy" ON public.score_snapshots;
CREATE POLICY "score_snapshots_select_policy" ON public.score_snapshots
  FOR SELECT TO authenticated
  USING (public.is_org_member(organization_id));

DROP POLICY IF EXISTS "score_snapshots_insert_policy" ON public.score_snapshots;
CREATE POLICY "score_snapshots_insert_policy" ON public.score_snapshots
  FOR INSERT TO authenticated
  WITH CHECK (
    public.is_org_member(organization_id)
    AND public.get_org_role(organization_id) IN ('owner', 'admin', 'member')
  );

DROP POLICY IF EXISTS "score_snapshots_delete_policy" ON public.score_snapshots;
CREATE POLICY "score_snapshots_delete_policy" ON public.score_snapshots
  FOR DELETE TO authenticated
  USING (public.is_org_admin_or_owner(organization_id));

-- 9. FINDINGS
ALTER TABLE public.findings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.findings FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "findings_select_policy" ON public.findings;
CREATE POLICY "findings_select_policy" ON public.findings
  FOR SELECT TO authenticated
  USING (public.is_org_member(organization_id));

DROP POLICY IF EXISTS "findings_insert_policy" ON public.findings;
CREATE POLICY "findings_insert_policy" ON public.findings
  FOR INSERT TO authenticated
  WITH CHECK (
    public.is_org_member(organization_id)
    AND public.get_org_role(organization_id) IN ('owner', 'admin', 'member')
  );

DROP POLICY IF EXISTS "findings_update_policy" ON public.findings;
CREATE POLICY "findings_update_policy" ON public.findings
  FOR UPDATE TO authenticated
  USING (
    public.is_org_member(organization_id)
    AND public.get_org_role(organization_id) IN ('owner', 'admin', 'member')
  )
  WITH CHECK (
    public.is_org_member(organization_id)
    AND public.get_org_role(organization_id) IN ('owner', 'admin', 'member')
  );

DROP POLICY IF EXISTS "findings_delete_policy" ON public.findings;
CREATE POLICY "findings_delete_policy" ON public.findings
  FOR DELETE TO authenticated
  USING (public.is_org_admin_or_owner(organization_id));

-- 10. RECOMMENDATIONS (Immutable: SELECT and INSERT only)
ALTER TABLE public.recommendations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.recommendations FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "recommendations_select_policy" ON public.recommendations;
CREATE POLICY "recommendations_select_policy" ON public.recommendations
  FOR SELECT TO authenticated
  USING (public.is_org_member(organization_id));

DROP POLICY IF EXISTS "recommendations_insert_policy" ON public.recommendations;
CREATE POLICY "recommendations_insert_policy" ON public.recommendations
  FOR INSERT TO authenticated
  WITH CHECK (
    public.is_org_member(organization_id)
    AND public.get_org_role(organization_id) IN ('owner', 'admin', 'member')
  );

DROP POLICY IF EXISTS "recommendations_delete_policy" ON public.recommendations;
CREATE POLICY "recommendations_delete_policy" ON public.recommendations
  FOR DELETE TO authenticated
  USING (public.is_org_admin_or_owner(organization_id));
