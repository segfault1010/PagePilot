-- ============================================================================
-- PagePilot — Milestone 4 Task 4.3: Read-Only Shared Report Links Schema & RLS
-- Migration: 20260830130000_report_share_links.sql
-- ============================================================================

-- ============================================================================
-- 1. REPORT SHARE LINKS
-- ============================================================================
-- Stores revocable, expiring bearer share records for individual historical audit reports.
-- Raw tokens are never persisted in the database; only SHA-256 token hashes are stored.
CREATE TABLE IF NOT EXISTS public.report_share_links (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  monitored_page_id UUID NOT NULL REFERENCES public.monitored_pages(id) ON DELETE CASCADE,
  audit_run_id UUID NOT NULL REFERENCES public.audit_runs(id) ON DELETE CASCADE,
  audit_report_id UUID NOT NULL REFERENCES public.audit_reports(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  created_by_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  expires_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_accessed_at TIMESTAMPTZ
);

-- Unique index on token_hash for constant-time cryptographic hash lookup
CREATE UNIQUE INDEX IF NOT EXISTS uq_report_share_links_token_hash
  ON public.report_share_links(token_hash);

-- Fast lookup indexes for project/page/run queries and organization management
CREATE INDEX IF NOT EXISTS idx_report_share_links_audit_run
  ON public.report_share_links(audit_run_id);

CREATE INDEX IF NOT EXISTS idx_report_share_links_org
  ON public.report_share_links(organization_id);

CREATE INDEX IF NOT EXISTS idx_report_share_links_project
  ON public.report_share_links(project_id);

CREATE INDEX IF NOT EXISTS idx_report_share_links_page
  ON public.report_share_links(monitored_page_id);

-- Helper function for array-based role check
CREATE OR REPLACE FUNCTION public.has_org_role(_org_id UUID, _roles TEXT[])
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
      AND role = ANY(_roles)
  );
$$;

-- Enable and Force RLS on report_share_links
ALTER TABLE public.report_share_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.report_share_links FORCE ROW LEVEL SECURITY;

-- ----------------------------------------------------------------------------
-- RLS Policies for Authenticated Share Management
-- ----------------------------------------------------------------------------
-- SELECT: All organization members (owner, admin, member, viewer) can view existing share links in their org
CREATE POLICY report_share_links_select_policy ON public.report_share_links
  FOR SELECT
  USING (public.is_org_member(organization_id));

-- INSERT: Authorized roles (owner, admin, member) can create share links
CREATE POLICY report_share_links_insert_policy ON public.report_share_links
  FOR INSERT
  WITH CHECK (public.has_org_role(organization_id, ARRAY['owner', 'admin', 'member']));

-- UPDATE: Authorized roles (owner, admin, member) can revoke/update share links
CREATE POLICY report_share_links_update_policy ON public.report_share_links
  FOR UPDATE
  USING (public.has_org_role(organization_id, ARRAY['owner', 'admin', 'member']))
  WITH CHECK (public.has_org_role(organization_id, ARRAY['owner', 'admin', 'member']));

-- DELETE: Authorized roles (owner, admin, member) can delete share links
CREATE POLICY report_share_links_delete_policy ON public.report_share_links
  FOR DELETE
  USING (public.has_org_role(organization_id, ARRAY['owner', 'admin', 'member']));

-- ============================================================================
-- 2. PUBLIC SHARED REPORT RESOLVER (SECURITY DEFINER)
-- ============================================================================
-- Strictly isolated public resolver function.
-- Validates token hash, enforces active (non-revoked, non-expired) state,
-- atomically updates last_accessed_at, and returns ONLY the sanitized report payload.
-- NEVER returns organization_id, user_ids, emails, membership data, work items, or alerts.
CREATE OR REPLACE FUNCTION public.get_shared_audit_report(p_token_hash text)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_share RECORD;
  v_report RECORD;
  v_run RECORD;
  v_snapshots JSONB;
  v_findings JSONB;
  v_recommendations JSONB;
BEGIN
  -- 1. Find the active share record by token hash
  SELECT *
  INTO v_share
  FROM public.report_share_links
  WHERE token_hash = p_token_hash
    AND revoked_at IS NULL
    AND (expires_at IS NULL OR expires_at > now())
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  -- 2. Atomically record access timestamp
  UPDATE public.report_share_links
  SET last_accessed_at = now()
  WHERE id = v_share.id;

  -- 3. Fetch the linked immutable audit report
  SELECT *
  INTO v_report
  FROM public.audit_reports
  WHERE id = v_share.audit_report_id;

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  -- 4. Fetch the linked audit run metadata (sanitized, excluding tenant-internal IDs)
  SELECT *
  INTO v_run
  FROM public.audit_runs
  WHERE id = v_share.audit_run_id;

  -- 5. Fetch score snapshots
  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'id', s.id,
      'auditReportId', s.audit_report_id,
      'category', s.category,
      'score', s.score,
      'confidence', s.confidence,
      'observedSignalsCount', s.observed_signals_count,
      'warningCount', s.warning_count,
      'neutralCount', s.neutral_count,
      'createdAt', s.created_at
    ) ORDER BY s.category
  ), '[]'::jsonb)
  INTO v_snapshots
  FROM public.score_snapshots s
  WHERE s.audit_report_id = v_share.audit_report_id;

  -- 6. Fetch findings (sanitized)
  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'id', f.id,
      'auditReportId', f.audit_report_id,
      'auditRunId', f.audit_run_id,
      'monitoredPageId', f.monitored_page_id,
      'projectId', f.project_id,
      'organizationId', f.organization_id,
      'findingType', f.finding_type,
      'category', f.category,
      'severity', f.severity,
      'title', f.title,
      'evidence', f.evidence,
      'recommendation', f.recommendation,
      'signalIds', f.signal_ids,
      'displayOrder', f.display_order,
      'createdAt', f.created_at
    ) ORDER BY f.display_order
  ), '[]'::jsonb)
  INTO v_findings
  FROM public.findings f
  WHERE f.audit_report_id = v_share.audit_report_id;

  -- 7. Fetch recommendations (sanitized)
  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'id', r.id,
      'auditReportId', r.audit_report_id,
      'auditRunId', r.audit_run_id,
      'monitoredPageId', r.monitored_page_id,
      'projectId', r.project_id,
      'organizationId', r.organization_id,
      'recommendationType', r.recommendation_type,
      'category', r.category,
      'title', r.title,
      'detail', r.detail,
      'displayOrder', r.display_order,
      'createdAt', r.created_at
    ) ORDER BY r.display_order
  ), '[]'::jsonb)
  INTO v_recommendations
  FROM public.recommendations r
  WHERE r.audit_report_id = v_share.audit_report_id;

  -- 8. Return strictly the sanitized report response matching sharedAuditReportResponseSchema
  RETURN jsonb_build_object(
    'report', jsonb_build_object(
      'id', v_report.id,
      'auditRunId', v_report.audit_run_id,
      'monitoredPageId', v_report.monitored_page_id,
      'projectId', v_report.project_id,
      'organizationId', v_report.organization_id,
      'schemaVersion', v_report.schema_version,
      'modelIdentifier', v_report.model_identifier,
      'checkVersion', v_report.check_version,
      'scoringVersion', v_report.scoring_version,
      'summary', v_report.summary,
      'overallScore', v_report.overall_score,
      'scoreConfidence', v_report.score_confidence,
      'reportPayload', v_report.report_payload,
      'createdAt', v_report.created_at
    ),
    'auditRun', jsonb_build_object(
      'id', v_run.id,
      'monitoredPageId', v_run.monitored_page_id,
      'projectId', v_run.project_id,
      'organizationId', v_run.organization_id,
      'invocationType', v_run.invocation_type,
      'status', v_run.status,
      'targetUrl', v_run.target_url,
      'finalUrl', v_run.final_url,
      'startedAt', v_run.started_at,
      'completedAt', v_run.completed_at,
      'failedAt', v_run.failed_at,
      'errorCode', v_run.error_code,
      'errorMessage', v_run.error_message,
      'retryable', v_run.retryable,
      'modelVersion', v_run.model_version,
      'checkVersion', v_run.check_version,
      'promptVersion', v_run.prompt_version,
      'scoringVersion', v_run.scoring_version,
      'retryCount', v_run.retry_count,
      'maxRetries', v_run.max_retries,
      'createdAt', v_run.created_at,
      'updatedAt', v_run.updated_at
    ),
    'scoreSnapshots', v_snapshots,
    'findings', v_findings,
    'recommendations', v_recommendations,
    'shareMetadata', jsonb_build_object(
      'id', v_share.id,
      'createdAt', v_share.created_at,
      'expiresAt', v_share.expires_at
    )
  );
END;
$$;
