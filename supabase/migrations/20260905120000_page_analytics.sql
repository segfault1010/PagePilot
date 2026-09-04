-- ============================================================================
-- PagePilot — Milestone 5 Task 5.4: Page-Level Analytics Context Import
-- Migration: 20260905120000_page_analytics.sql
-- ============================================================================

-- ============================================================================
-- 1. PAGE ANALYTICS SNAPSHOTS TABLE
-- ============================================================================
-- Persists imported business metrics (sessions, conversion rate, bounce rate, etc.)
-- associated with specific monitored landing pages.
CREATE TABLE IF NOT EXISTS public.page_analytics_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  monitored_page_id UUID NOT NULL REFERENCES public.monitored_pages(id) ON DELETE CASCADE,
  source_type TEXT NOT NULL CHECK (source_type IN ('manual', 'posthog', 'ga4', 'custom_api', 'webhook')),
  source_provider_name TEXT NOT NULL,
  schema_version TEXT NOT NULL DEFAULT '1.0.0',
  period_start TIMESTAMPTZ NOT NULL,
  period_end TIMESTAMPTZ NOT NULL,
  sessions INTEGER CHECK (sessions >= 0),
  unique_visitors INTEGER CHECK (unique_visitors >= 0),
  conversions INTEGER CHECK (conversions >= 0),
  conversion_rate NUMERIC(7, 4) CHECK (conversion_rate >= 0 AND conversion_rate <= 100),
  bounce_rate NUMERIC(6, 3) CHECK (bounce_rate >= 0 AND bounce_rate <= 100),
  avg_duration_seconds INTEGER CHECK (avg_duration_seconds >= 0),
  currency TEXT NOT NULL DEFAULT 'USD',
  custom_metrics JSONB NOT NULL DEFAULT '{}'::jsonb,
  provenance JSONB NOT NULL DEFAULT '{"label": "IMPORTED DATA"}'::jsonb,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_by_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT chk_period_order CHECK (period_start <= period_end)
);

-- ============================================================================
-- 2. MONITORED PAGES POINTER
-- ============================================================================
-- Maintain atomic pointer to latest active analytics snapshot for fast lookups
ALTER TABLE public.monitored_pages
  ADD COLUMN IF NOT EXISTS latest_analytics_snapshot_id UUID
  REFERENCES public.page_analytics_snapshots(id) ON DELETE SET NULL;

-- ============================================================================
-- 3. INDEXES
-- ============================================================================
CREATE INDEX IF NOT EXISTS idx_page_analytics_page
  ON public.page_analytics_snapshots(monitored_page_id, period_end DESC);

CREATE INDEX IF NOT EXISTS idx_page_analytics_project
  ON public.page_analytics_snapshots(project_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_page_analytics_org
  ON public.page_analytics_snapshots(organization_id);

CREATE INDEX IF NOT EXISTS idx_monitored_pages_analytics
  ON public.monitored_pages(latest_analytics_snapshot_id);

-- ============================================================================
-- 4. ROW-LEVEL SECURITY (RLS)
-- ============================================================================
ALTER TABLE public.page_analytics_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.page_analytics_snapshots FORCE ROW LEVEL SECURITY;

-- SELECT: Any organization member (owner, admin, member, viewer) can view analytics.
CREATE POLICY page_analytics_select_policy ON public.page_analytics_snapshots
  FOR SELECT
  USING (public.is_org_member(organization_id));

-- INSERT: Organization members (owner, admin, member) can import/record page analytics.
-- Viewers are restricted (read-only).
CREATE POLICY page_analytics_insert_policy ON public.page_analytics_snapshots
  FOR INSERT
  WITH CHECK (
    public.is_org_member(organization_id) AND
    public.get_org_role(organization_id) IN ('owner', 'admin', 'member')
  );

-- UPDATE: Organization members (owner, admin, member) can update page analytics.
-- Viewers are restricted (read-only).
CREATE POLICY page_analytics_update_policy ON public.page_analytics_snapshots
  FOR UPDATE
  USING (
    public.is_org_member(organization_id) AND
    public.get_org_role(organization_id) IN ('owner', 'admin', 'member')
  )
  WITH CHECK (
    public.is_org_member(organization_id) AND
    public.get_org_role(organization_id) IN ('owner', 'admin', 'member')
  );

-- DELETE: Only organization admin or owner can delete analytics snapshots.
CREATE POLICY page_analytics_delete_policy ON public.page_analytics_snapshots
  FOR DELETE
  USING (public.is_org_admin_or_owner(organization_id));
