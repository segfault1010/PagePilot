-- ============================================================================
-- PagePilot — Multi-Tenant Schema Migration
-- 20260827140000_audit_persistence_and_idempotency.sql
--
-- Milestone 2 — Task 2.4: Historical Audit Report Persistence & Association
--
-- 1. Adds latest_successful_audit_run_id to public.monitored_pages so failed runs
--    do not overwrite the last successful report.
-- 2. Adds idempotency_key to public.audit_runs with unique constraint per page.
-- 3. Adds query and ordering indexes for fast history lookups.
-- 4. Introduces atomic PostgreSQL RPC persist_completed_audit_report to guarantee
--    all-or-nothing persistence for reports, score snapshots, findings, and recommendations.
-- ============================================================================

-- 1. Monitored pages: add latest_successful_audit_run_id
ALTER TABLE public.monitored_pages
  ADD COLUMN IF NOT EXISTS latest_successful_audit_run_id UUID
  REFERENCES public.audit_runs(id)
  ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_monitored_pages_latest_successful_run
  ON public.monitored_pages(latest_successful_audit_run_id);

-- 2. Audit runs: add idempotency_key and unique constraint per page
ALTER TABLE public.audit_runs
  ADD COLUMN IF NOT EXISTS idempotency_key TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS uq_audit_runs_idempotency
  ON public.audit_runs(monitored_page_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

-- 3. History retrieval & tenant isolation indexes
CREATE INDEX IF NOT EXISTS idx_audit_runs_page_created
  ON public.audit_runs(monitored_page_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_audit_reports_page_created
  ON public.audit_reports(monitored_page_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_audit_runs_org_page
  ON public.audit_runs(organization_id, monitored_page_id);

CREATE INDEX IF NOT EXISTS idx_audit_reports_org_page
  ON public.audit_reports(organization_id, monitored_page_id);

-- 4. Atomic report persistence RPC
CREATE OR REPLACE FUNCTION public.persist_completed_audit_report(
  p_org_id UUID,
  p_project_id UUID,
  p_page_id UUID,
  p_run_id UUID,
  p_final_url TEXT,
  p_schema_version TEXT,
  p_model_identifier TEXT,
  p_check_version TEXT,
  p_scoring_version TEXT,
  p_summary TEXT,
  p_overall_score INT,
  p_score_confidence TEXT,
  p_report_payload JSONB,
  p_score_snapshots JSONB,
  p_findings JSONB,
  p_recommendations JSONB
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_report_id UUID;
  v_caller_role TEXT;
  v_page_project_id UUID;
BEGIN
  -- Authorization check: caller must be member, admin, or owner in organization
  v_caller_role := public.get_org_role(p_org_id);
  IF v_caller_role IS NULL OR v_caller_role NOT IN ('owner', 'admin', 'member') THEN
    RAISE EXCEPTION 'Unauthorized: insufficient organization permissions'
      USING ERRCODE = '42501';
  END IF;

  -- 1. Validate and lock the monitored page row, ensuring it belongs to the project and org
  SELECT project_id INTO v_page_project_id
  FROM public.monitored_pages
  WHERE id = p_page_id
    AND project_id = p_project_id
    AND organization_id = p_org_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Monitored page not found or does not belong to specified project/organization'
      USING ERRCODE = 'P0002';
  END IF;

  -- 2. Validate, lock, and update the audit_run to completed
  UPDATE public.audit_runs
  SET
    status = 'completed',
    final_url = p_final_url,
    completed_at = now(),
    updated_at = now()
  WHERE id = p_run_id
    AND project_id = p_project_id
    AND monitored_page_id = p_page_id
    AND organization_id = p_org_id
    AND status = 'running';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Audit run not found, not in running status, or does not belong to specified page/project/organization'
      USING ERRCODE = 'P0002';
  END IF;

  -- 3. Insert audit_report
  INSERT INTO public.audit_reports (
    audit_run_id,
    monitored_page_id,
    project_id,
    organization_id,
    schema_version,
    model_identifier,
    check_version,
    scoring_version,
    summary,
    overall_score,
    score_confidence,
    report_payload,
    created_at
  )
  VALUES (
    p_run_id,
    p_page_id,
    p_project_id,
    p_org_id,
    p_schema_version,
    p_model_identifier,
    p_check_version,
    p_scoring_version,
    p_summary,
    p_overall_score,
    p_score_confidence,
    p_report_payload,
    now()
  )
  RETURNING id INTO v_report_id;

  -- 3. Batch insert score snapshots
  IF p_score_snapshots IS NOT NULL AND jsonb_array_length(p_score_snapshots) > 0 THEN
    INSERT INTO public.score_snapshots (
      audit_report_id,
      audit_run_id,
      monitored_page_id,
      project_id,
      organization_id,
      category,
      score,
      confidence,
      explanation,
      severity,
      scoring_version,
      created_at
    )
    SELECT
      v_report_id,
      p_run_id,
      p_page_id,
      p_project_id,
      p_org_id,
      (elem->>'category')::TEXT,
      (elem->>'score')::INT,
      (elem->>'confidence')::TEXT,
      (elem->>'explanation')::TEXT,
      (elem->>'severity')::TEXT,
      p_scoring_version,
      now()
    FROM jsonb_array_elements(p_score_snapshots) AS elem;
  END IF;

  -- 4. Batch insert findings
  IF p_findings IS NOT NULL AND jsonb_array_length(p_findings) > 0 THEN
    INSERT INTO public.findings (
      audit_report_id,
      audit_run_id,
      monitored_page_id,
      project_id,
      organization_id,
      finding_type,
      category,
      title,
      severity,
      evidence,
      basis,
      signal_ids,
      recommendation,
      display_order,
      work_status,
      created_at
    )
    SELECT
      v_report_id,
      p_run_id,
      p_page_id,
      p_project_id,
      p_org_id,
      (elem->>'findingType')::TEXT,
      (elem->>'category')::TEXT,
      (elem->>'title')::TEXT,
      (elem->>'severity')::TEXT,
      (elem->>'evidence')::TEXT,
      (elem->>'basis')::TEXT,
      COALESCE(ARRAY(SELECT jsonb_array_elements_text(elem->'signalIds')), '{}'::TEXT[]),
      (elem->>'recommendation')::TEXT,
      COALESCE((elem->>'displayOrder')::INT, 0),
      'open',
      now()
    FROM jsonb_array_elements(p_findings) AS elem;
  END IF;

  -- 5. Batch insert recommendations
  IF p_recommendations IS NOT NULL AND jsonb_array_length(p_recommendations) > 0 THEN
    INSERT INTO public.recommendations (
      audit_report_id,
      audit_run_id,
      monitored_page_id,
      project_id,
      organization_id,
      recommendation_type,
      category,
      title,
      detail,
      display_order,
      created_at
    )
    SELECT
      v_report_id,
      p_run_id,
      p_page_id,
      p_project_id,
      p_org_id,
      (elem->>'recommendationType')::TEXT,
      (elem->>'category')::TEXT,
      (elem->>'title')::TEXT,
      (elem->>'detail')::TEXT,
      COALESCE((elem->>'displayOrder')::INT, 0),
      now()
    FROM jsonb_array_elements(p_recommendations) AS elem;
  END IF;

  -- 6. Update monitored_pages latest pointers (both latest_audit_run_id and latest_successful_audit_run_id)
  UPDATE public.monitored_pages
  SET
    latest_audit_run_id = p_run_id,
    latest_successful_audit_run_id = p_run_id,
    updated_at = now()
  WHERE id = p_page_id
    AND project_id = p_project_id
    AND organization_id = p_org_id;

  RETURN v_report_id;
END;
$$;
