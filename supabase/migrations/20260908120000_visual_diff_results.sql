-- ============================================================================
-- PagePilot — Milestone 6 Task 6.3: Visual Regression & Perceptual Change Detection
-- Migration: 20260908120000_visual_diff_results.sql
-- ============================================================================

-- ============================================================================
-- 1. ADD PERCEPTUAL HASH COLUMNS TO AUDIT SCREENSHOTS TABLE
-- ============================================================================
ALTER TABLE public.audit_screenshots
  ADD COLUMN IF NOT EXISTS perceptual_hash TEXT,
  ADD COLUMN IF NOT EXISTS block_hashes JSONB;

-- ============================================================================
-- 2. VISUAL DIFF RESULTS TABLE
-- ============================================================================
-- Persists deterministic visual regression comparisons between consecutive audit runs.
CREATE TABLE IF NOT EXISTS public.visual_diff_results (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  monitored_page_id UUID NOT NULL REFERENCES public.monitored_pages(id) ON DELETE CASCADE,
  current_audit_run_id UUID NOT NULL REFERENCES public.audit_runs(id) ON DELETE CASCADE,
  baseline_audit_run_id UUID REFERENCES public.audit_runs(id) ON DELETE SET NULL,
  current_screenshot_id UUID REFERENCES public.audit_screenshots(id) ON DELETE SET NULL,
  baseline_screenshot_id UUID REFERENCES public.audit_screenshots(id) ON DELETE SET NULL,
  device_type TEXT NOT NULL CHECK (device_type IN ('desktop', 'mobile')),
  capture_type TEXT NOT NULL CHECK (capture_type IN ('viewport', 'full_page')),
  schema_version TEXT NOT NULL DEFAULT '1.0.0',
  diff_algorithm TEXT NOT NULL DEFAULT 'block_perceptual_hash_v1',
  status TEXT NOT NULL CHECK (status IN ('completed', 'baseline', 'failed', 'skipped')),
  is_meaningful_change BOOLEAN NOT NULL DEFAULT false,
  visual_change_score NUMERIC(5,2) NOT NULL CHECK (visual_change_score >= 0 AND visual_change_score <= 100),
  change_severity TEXT NOT NULL CHECK (change_severity IN ('negligible', 'minor', 'moderate', 'significant', 'major')),
  hero_zone_change NUMERIC(5,2) NOT NULL DEFAULT 0 CHECK (hero_zone_change >= 0 AND hero_zone_change <= 100),
  body_zone_change NUMERIC(5,2) NOT NULL DEFAULT 0 CHECK (body_zone_change >= 0 AND body_zone_change <= 100),
  footer_zone_change NUMERIC(5,2) NOT NULL DEFAULT 0 CHECK (footer_zone_change >= 0 AND footer_zone_change <= 100),
  changed_blocks_count INTEGER NOT NULL DEFAULT 0 CHECK (changed_blocks_count >= 0),
  total_blocks_count INTEGER NOT NULL DEFAULT 32 CHECK (total_blocks_count > 0),
  height_delta_px INTEGER NOT NULL DEFAULT 0,
  change_reasons TEXT[] NOT NULL DEFAULT '{}',
  details JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Unique index guaranteeing idempotent comparison per run, baseline, device, and capture type
CREATE UNIQUE INDEX IF NOT EXISTS uq_visual_diff_runs
  ON public.visual_diff_results (
    current_audit_run_id,
    COALESCE(baseline_audit_run_id, '00000000-0000-0000-0000-000000000000'::uuid),
    device_type,
    capture_type
  );

-- ============================================================================
-- 3. INDEXES
-- ============================================================================
CREATE INDEX IF NOT EXISTS idx_visual_diff_results_current_run
  ON public.visual_diff_results(current_audit_run_id);

CREATE INDEX IF NOT EXISTS idx_visual_diff_results_page
  ON public.visual_diff_results(monitored_page_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_visual_diff_results_project
  ON public.visual_diff_results(project_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_visual_diff_results_org
  ON public.visual_diff_results(organization_id);

-- ============================================================================
-- 4. ROW-LEVEL SECURITY (RLS)
-- ============================================================================
ALTER TABLE public.visual_diff_results ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.visual_diff_results FORCE ROW LEVEL SECURITY;

-- SELECT: Any organization member (owner, admin, member, viewer) can view visual diff results.
CREATE POLICY visual_diff_select_policy ON public.visual_diff_results
  FOR SELECT
  USING (public.is_org_member(organization_id));

-- INSERT: Organization members (owner, admin, member) or server workflows can record visual diff results.
-- Viewers are restricted (read-only).
CREATE POLICY visual_diff_insert_policy ON public.visual_diff_results
  FOR INSERT
  WITH CHECK (
    public.is_org_member(organization_id) AND
    public.get_org_role(organization_id) IN ('owner', 'admin', 'member')
  );

-- UPDATE: Organization members (owner, admin, member) can update visual diff results.
-- Viewers are restricted (read-only).
CREATE POLICY visual_diff_update_policy ON public.visual_diff_results
  FOR UPDATE
  USING (
    public.is_org_member(organization_id) AND
    public.get_org_role(organization_id) IN ('owner', 'admin', 'member')
  )
  WITH CHECK (
    public.is_org_member(organization_id) AND
    public.get_org_role(organization_id) IN ('owner', 'admin', 'member')
  );

-- DELETE: Only organization admin or owner can delete visual diff results.
CREATE POLICY visual_diff_delete_policy ON public.visual_diff_results
  FOR DELETE
  USING (public.is_org_admin_or_owner(organization_id));
