-- ============================================================================
-- PagePilot — Milestone 6 Task 6.1: Playwright Screenshot Capture Foundation
-- Migration: 20260906120000_audit_screenshots.sql
-- ============================================================================

-- ============================================================================
-- 1. AUDIT SCREENSHOTS TABLE
-- ============================================================================
-- Persists screenshot metadata and storage pointers for visual audit evidence.
CREATE TABLE IF NOT EXISTS public.audit_screenshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  monitored_page_id UUID NOT NULL REFERENCES public.monitored_pages(id) ON DELETE CASCADE,
  audit_run_id UUID NOT NULL REFERENCES public.audit_runs(id) ON DELETE CASCADE,
  audit_report_id UUID REFERENCES public.audit_reports(id) ON DELETE SET NULL,
  device_type TEXT NOT NULL CHECK (device_type IN ('desktop', 'mobile')),
  capture_type TEXT NOT NULL CHECK (capture_type IN ('viewport', 'full_page')),
  storage_path TEXT NOT NULL,
  storage_bucket TEXT NOT NULL DEFAULT 'audit-screenshots',
  file_size_bytes INTEGER NOT NULL CHECK (file_size_bytes >= 0),
  mime_type TEXT NOT NULL CHECK (mime_type IN ('image/webp', 'image/png', 'image/jpeg')),
  width INTEGER NOT NULL CHECK (width > 0 AND width <= 10000),
  height INTEGER NOT NULL CHECK (height > 0 AND height <= 4000),
  captured_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_audit_screenshots_run_device_capture UNIQUE (audit_run_id, device_type, capture_type)
);

-- ============================================================================
-- 2. INDEXES
-- ============================================================================
CREATE INDEX IF NOT EXISTS idx_audit_screenshots_run
  ON public.audit_screenshots(audit_run_id);

CREATE INDEX IF NOT EXISTS idx_audit_screenshots_page
  ON public.audit_screenshots(monitored_page_id, captured_at DESC);

CREATE INDEX IF NOT EXISTS idx_audit_screenshots_project
  ON public.audit_screenshots(project_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_audit_screenshots_org
  ON public.audit_screenshots(organization_id);

-- ============================================================================
-- 3. ROW-LEVEL SECURITY (RLS)
-- ============================================================================
ALTER TABLE public.audit_screenshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_screenshots FORCE ROW LEVEL SECURITY;

-- SELECT: Any organization member (owner, admin, member, viewer) can view screenshots.
CREATE POLICY audit_screenshots_select_policy ON public.audit_screenshots
  FOR SELECT
  USING (public.is_org_member(organization_id));

-- INSERT: Organization members (owner, admin, member) or server workflows can record screenshots.
-- Viewers are restricted (read-only).
CREATE POLICY audit_screenshots_insert_policy ON public.audit_screenshots
  FOR INSERT
  WITH CHECK (
    public.is_org_member(organization_id) AND
    public.get_org_role(organization_id) IN ('owner', 'admin', 'member')
  );

-- UPDATE: Organization members (owner, admin, member) can update screenshots.
-- Viewers are restricted (read-only).
CREATE POLICY audit_screenshots_update_policy ON public.audit_screenshots
  FOR UPDATE
  USING (
    public.is_org_member(organization_id) AND
    public.get_org_role(organization_id) IN ('owner', 'admin', 'member')
  )
  WITH CHECK (
    public.is_org_member(organization_id) AND
    public.get_org_role(organization_id) IN ('owner', 'admin', 'member')
  );

-- DELETE: Only organization admin or owner can delete screenshots.
CREATE POLICY audit_screenshots_delete_policy ON public.audit_screenshots
  FOR DELETE
  USING (public.is_org_admin_or_owner(organization_id));

-- ============================================================================
-- 4. PRIVATE STORAGE BUCKET
-- ============================================================================
-- Define private bucket for audit screenshots (max 10MB per object)
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'audit-screenshots',
  'audit-screenshots',
  false,
  10485760,
  ARRAY['image/webp', 'image/png', 'image/jpeg']::text[]
)
ON CONFLICT (id) DO NOTHING;
