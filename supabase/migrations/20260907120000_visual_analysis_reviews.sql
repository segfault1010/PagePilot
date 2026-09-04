-- ============================================================================
-- PagePilot — Milestone 6 Task 6.2: Vision-Assisted Visual Hierarchy Review
-- Migration: 20260907120000_visual_analysis_reviews.sql
-- ============================================================================

-- ============================================================================
-- 1. VISUAL ANALYSIS REVIEWS TABLE
-- ============================================================================
-- Persists multimodal visual hierarchy reviews, dimensions, and findings
-- derived from captured browser screenshots.
CREATE TABLE IF NOT EXISTS public.visual_analysis_reviews (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  monitored_page_id UUID NOT NULL REFERENCES public.monitored_pages(id) ON DELETE CASCADE,
  audit_run_id UUID NOT NULL REFERENCES public.audit_runs(id) ON DELETE CASCADE,
  audit_report_id UUID REFERENCES public.audit_reports(id) ON DELETE SET NULL,
  provenance TEXT NOT NULL DEFAULT 'VISION-ASSISTED AI REVIEW',
  schema_version TEXT NOT NULL DEFAULT '1.0.0',
  prompt_version TEXT NOT NULL DEFAULT '1.0.0',
  model_identifier TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('completed', 'failed', 'skipped')),
  executive_summary TEXT,
  viewports_analyzed TEXT[] NOT NULL DEFAULT '{}',
  dimensions JSONB NOT NULL DEFAULT '{}'::jsonb,
  findings JSONB NOT NULL DEFAULT '[]'::jsonb,
  screenshot_ids UUID[] NOT NULL DEFAULT '{}',
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_visual_reviews_run UNIQUE (audit_run_id)
);

-- ============================================================================
-- 2. INDEXES
-- ============================================================================
CREATE INDEX IF NOT EXISTS idx_visual_reviews_run
  ON public.visual_analysis_reviews(audit_run_id);

CREATE INDEX IF NOT EXISTS idx_visual_reviews_page
  ON public.visual_analysis_reviews(monitored_page_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_visual_reviews_project
  ON public.visual_analysis_reviews(project_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_visual_reviews_org
  ON public.visual_analysis_reviews(organization_id);

-- ============================================================================
-- 3. ROW-LEVEL SECURITY (RLS)
-- ============================================================================
ALTER TABLE public.visual_analysis_reviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.visual_analysis_reviews FORCE ROW LEVEL SECURITY;

-- SELECT: Any organization member (owner, admin, member, viewer) can view visual reviews.
CREATE POLICY visual_reviews_select_policy ON public.visual_analysis_reviews
  FOR SELECT
  USING (public.is_org_member(organization_id));

-- INSERT: Organization members (owner, admin, member) or server workflows can record visual reviews.
-- Viewers are restricted (read-only).
CREATE POLICY visual_reviews_insert_policy ON public.visual_analysis_reviews
  FOR INSERT
  WITH CHECK (
    public.is_org_member(organization_id) AND
    public.get_org_role(organization_id) IN ('owner', 'admin', 'member')
  );

-- UPDATE: Organization members (owner, admin, member) can update visual reviews.
-- Viewers are restricted (read-only).
CREATE POLICY visual_reviews_update_policy ON public.visual_analysis_reviews
  FOR UPDATE
  USING (
    public.is_org_member(organization_id) AND
    public.get_org_role(organization_id) IN ('owner', 'admin', 'member')
  )
  WITH CHECK (
    public.is_org_member(organization_id) AND
    public.get_org_role(organization_id) IN ('owner', 'admin', 'member')
  );

-- DELETE: Only organization admin or owner can delete visual reviews.
CREATE POLICY visual_reviews_delete_policy ON public.visual_analysis_reviews
  FOR DELETE
  USING (public.is_org_admin_or_owner(organization_id));
