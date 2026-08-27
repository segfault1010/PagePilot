-- ============================================================================
-- PagePilot — Milestone 2: Monitored Page Uniqueness Constraint
-- Migration: 20260827130000_monitored_page_uniqueness.sql
-- ============================================================================

-- Ensure a project cannot register duplicate monitored pages for the same canonical URL
CREATE UNIQUE INDEX IF NOT EXISTS uq_monitored_pages_project_url
  ON public.monitored_pages(project_id, canonical_url);
