-- ============================================================================
-- PagePilot — Milestone 4 Task 4.1: Collaboration & Work Items Schema & RLS
-- Migration: 20260830120000_work_items_and_collaboration.sql
-- ============================================================================

-- ============================================================================
-- 1. WORK ITEMS
-- ============================================================================
-- Mutable collaborative task items derived from immutable findings or recommendations.
CREATE TABLE IF NOT EXISTS public.work_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  monitored_page_id UUID NOT NULL REFERENCES public.monitored_pages(id) ON DELETE CASCADE,
  audit_run_id UUID REFERENCES public.audit_runs(id) ON DELETE SET NULL,
  audit_report_id UUID REFERENCES public.audit_reports(id) ON DELETE SET NULL,
  source_type TEXT NOT NULL CHECK (source_type IN ('finding', 'recommendation')),
  finding_id UUID REFERENCES public.findings(id) ON DELETE SET NULL,
  recommendation_id UUID REFERENCES public.recommendations(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  description TEXT,
  category TEXT CHECK (category IS NULL OR category IN ('clarity', 'visualHierarchy', 'ctaEffectiveness', 'copy', 'accessibility', 'mobileUx', 'trustCredibility')),
  severity TEXT CHECK (severity IS NULL OR severity IN ('low', 'medium', 'high')),
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'in_progress', 'resolved', 'dismissed')),
  assignee_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  notes TEXT,
  tags TEXT[] NOT NULL DEFAULT '{}',
  resolution_rationale TEXT,
  resolved_at TIMESTAMPTZ,
  resolved_by_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_by_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  last_modified_by_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT chk_work_items_source CHECK (
    (source_type = 'finding' AND finding_id IS NOT NULL) OR
    (source_type = 'recommendation' AND recommendation_id IS NOT NULL)
  )
);

-- Unique index per monitored page & finding (prevents duplicate work items for the same finding)
CREATE UNIQUE INDEX IF NOT EXISTS uq_work_items_page_finding
  ON public.work_items(monitored_page_id, finding_id)
  WHERE finding_id IS NOT NULL;

-- Unique index per monitored page & recommendation (prevents duplicate work items for the same recommendation)
CREATE UNIQUE INDEX IF NOT EXISTS uq_work_items_page_recommendation
  ON public.work_items(monitored_page_id, recommendation_id)
  WHERE recommendation_id IS NOT NULL;

-- Lookup indexes for query performance
CREATE INDEX IF NOT EXISTS idx_work_items_org ON public.work_items(organization_id);
CREATE INDEX IF NOT EXISTS idx_work_items_project ON public.work_items(project_id);
CREATE INDEX IF NOT EXISTS idx_work_items_page ON public.work_items(monitored_page_id);
CREATE INDEX IF NOT EXISTS idx_work_items_status ON public.work_items(status);
CREATE INDEX IF NOT EXISTS idx_work_items_assignee ON public.work_items(assignee_id);
CREATE INDEX IF NOT EXISTS idx_work_items_created ON public.work_items(created_at DESC);

-- ============================================================================
-- 2. DATABASE-LEVEL ASSIGNEE MEMBERSHIP VALIDATION
-- ============================================================================
-- Guarantees that assignees MUST be valid active members of the tenant organization.
CREATE OR REPLACE FUNCTION public.check_work_item_assignee_org()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
BEGIN
  IF NEW.assignee_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.memberships
      WHERE organization_id = NEW.organization_id
        AND user_id = NEW.assignee_id
    ) THEN
      RAISE EXCEPTION 'Assignee must be a member of the organization.'
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_check_work_item_assignee ON public.work_items;
CREATE TRIGGER trg_check_work_item_assignee
  BEFORE INSERT OR UPDATE OF assignee_id, organization_id ON public.work_items
  FOR EACH ROW
  EXECUTE FUNCTION public.check_work_item_assignee_org();

-- ============================================================================
-- 3. WORK ITEM ACTIVITIES
-- ============================================================================
-- Immutable append-only audit trail for work item lifecycle events.
CREATE TABLE IF NOT EXISTS public.work_item_activities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  work_item_id UUID NOT NULL REFERENCES public.work_items(id) ON DELETE CASCADE,
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  actor_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  action TEXT NOT NULL CHECK (action IN ('created', 'status_changed', 'assigned', 'unassigned', 'updated', 'notes_updated')),
  from_status TEXT CHECK (from_status IS NULL OR from_status IN ('open', 'in_progress', 'resolved', 'dismissed')),
  to_status TEXT CHECK (to_status IS NULL OR to_status IN ('open', 'in_progress', 'resolved', 'dismissed')),
  details JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_work_item_activities_item ON public.work_item_activities(work_item_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_work_item_activities_org ON public.work_item_activities(organization_id, created_at DESC);

-- ============================================================================
-- 4. ROW LEVEL SECURITY (RLS) POLICIES
-- ============================================================================

-- Work Items RLS
ALTER TABLE public.work_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.work_items FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "work_items_select_policy" ON public.work_items;
CREATE POLICY "work_items_select_policy" ON public.work_items
  FOR SELECT TO authenticated
  USING (public.is_org_member(organization_id));

DROP POLICY IF EXISTS "work_items_insert_policy" ON public.work_items;
CREATE POLICY "work_items_insert_policy" ON public.work_items
  FOR INSERT TO authenticated
  WITH CHECK (
    public.is_org_member(organization_id)
    AND public.get_org_role(organization_id) IN ('owner', 'admin', 'member')
  );

DROP POLICY IF EXISTS "work_items_update_policy" ON public.work_items;
CREATE POLICY "work_items_update_policy" ON public.work_items
  FOR UPDATE TO authenticated
  USING (
    public.is_org_member(organization_id)
    AND public.get_org_role(organization_id) IN ('owner', 'admin', 'member')
  )
  WITH CHECK (
    public.is_org_member(organization_id)
    AND public.get_org_role(organization_id) IN ('owner', 'admin', 'member')
  );

DROP POLICY IF EXISTS "work_items_delete_policy" ON public.work_items;
CREATE POLICY "work_items_delete_policy" ON public.work_items
  FOR DELETE TO authenticated
  USING (
    public.is_org_member(organization_id)
    AND public.get_org_role(organization_id) IN ('owner', 'admin', 'member')
  );

-- Work Item Activities RLS (Append-only)
ALTER TABLE public.work_item_activities ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.work_item_activities FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "work_item_activities_select_policy" ON public.work_item_activities;
CREATE POLICY "work_item_activities_select_policy" ON public.work_item_activities
  FOR SELECT TO authenticated
  USING (public.is_org_member(organization_id));

DROP POLICY IF EXISTS "work_item_activities_insert_policy" ON public.work_item_activities;
CREATE POLICY "work_item_activities_insert_policy" ON public.work_item_activities
  FOR INSERT TO authenticated
  WITH CHECK (
    public.is_org_member(organization_id)
    AND public.get_org_role(organization_id) IN ('owner', 'admin', 'member')
  );

DROP POLICY IF EXISTS "work_item_activities_delete_policy" ON public.work_item_activities;
CREATE POLICY "work_item_activities_delete_policy" ON public.work_item_activities
  FOR DELETE TO authenticated
  USING (public.is_org_admin_or_owner(organization_id));

-- ============================================================================
-- 5. ATOMIC RPC FUNCTIONS FOR COLLABORATION MUTATIONS & ACTIVITY LOGGING
-- ============================================================================

-- Atomic creation of a work item and its initial 'created' activity record
CREATE OR REPLACE FUNCTION public.create_work_item_atomic(
  p_org_id UUID,
  p_project_id UUID,
  p_page_id UUID,
  p_user_id UUID,
  p_source_type TEXT,
  p_finding_id UUID,
  p_recommendation_id UUID,
  p_title TEXT,
  p_description TEXT,
  p_category TEXT,
  p_severity TEXT,
  p_status TEXT,
  p_assignee_id UUID,
  p_notes TEXT,
  p_tags TEXT[],
  p_audit_run_id UUID,
  p_audit_report_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_role TEXT;
  v_work_item public.work_items%ROWTYPE;
  v_now TIMESTAMPTZ := now();
  v_resolved_at TIMESTAMPTZ := NULL;
  v_resolved_by UUID := NULL;
BEGIN
  -- 1. Authorization check
  v_role := public.get_org_role(p_org_id);
  IF v_role IS NULL OR v_role = 'viewer' THEN
    RAISE EXCEPTION 'Insufficient permissions to create work items.'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- 2. Determine initial resolution metadata if created in terminal status
  IF p_status IN ('resolved', 'dismissed') THEN
    v_resolved_at := v_now;
    v_resolved_by := p_user_id;
  END IF;

  -- 3. Insert work item
  INSERT INTO public.work_items (
    organization_id,
    project_id,
    monitored_page_id,
    audit_run_id,
    audit_report_id,
    source_type,
    finding_id,
    recommendation_id,
    title,
    description,
    category,
    severity,
    status,
    assignee_id,
    notes,
    tags,
    resolved_at,
    resolved_by_user_id,
    created_by_user_id,
    last_modified_by_user_id,
    created_at,
    updated_at
  ) VALUES (
    p_org_id,
    p_project_id,
    p_page_id,
    p_audit_run_id,
    p_audit_report_id,
    p_source_type,
    p_finding_id,
    p_recommendation_id,
    p_title,
    p_description,
    p_category,
    p_severity,
    COALESCE(p_status, 'open'),
    p_assignee_id,
    p_notes,
    COALESCE(p_tags, '{}'),
    v_resolved_at,
    v_resolved_by,
    p_user_id,
    p_user_id,
    v_now,
    v_now
  )
  RETURNING * INTO v_work_item;

  -- 4. Atomically insert initial activity log
  INSERT INTO public.work_item_activities (
    work_item_id,
    organization_id,
    project_id,
    actor_user_id,
    action,
    from_status,
    to_status,
    details,
    created_at
  ) VALUES (
    v_work_item.id,
    p_org_id,
    p_project_id,
    p_user_id,
    'created',
    NULL,
    v_work_item.status,
    jsonb_build_object(
      'source_type', p_source_type,
      'title', p_title,
      'assignee_id', p_assignee_id
    ),
    v_now
  );

  RETURN to_jsonb(v_work_item);
END;
$$;

-- Atomic update of work item and logging of activity records
CREATE OR REPLACE FUNCTION public.update_work_item_atomic(
  p_org_id UUID,
  p_project_id UUID,
  p_work_item_id UUID,
  p_user_id UUID,
  p_status TEXT,
  p_has_status_update BOOLEAN,
  p_assignee_id UUID,
  p_has_assignee_update BOOLEAN,
  p_notes TEXT,
  p_has_notes_update BOOLEAN,
  p_tags TEXT[],
  p_has_tags_update BOOLEAN,
  p_resolution_rationale TEXT,
  p_has_rationale_update BOOLEAN
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_role TEXT;
  v_old public.work_items%ROWTYPE;
  v_new public.work_items%ROWTYPE;
  v_now TIMESTAMPTZ := now();
  v_new_status TEXT;
  v_new_assignee UUID;
  v_new_notes TEXT;
  v_new_tags TEXT[];
  v_new_rationale TEXT;
  v_new_resolved_at TIMESTAMPTZ;
  v_new_resolved_by UUID;
BEGIN
  -- 1. Authorization check
  v_role := public.get_org_role(p_org_id);
  IF v_role IS NULL OR v_role = 'viewer' THEN
    RAISE EXCEPTION 'Insufficient permissions to update work items.'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- 2. Select work item FOR UPDATE
  SELECT * INTO v_old
  FROM public.work_items
  WHERE id = p_work_item_id
    AND organization_id = p_org_id
    AND project_id = p_project_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  -- 3. Compute new values
  v_new_status := CASE WHEN p_has_status_update THEN p_status ELSE v_old.status END;
  v_new_assignee := CASE WHEN p_has_assignee_update THEN p_assignee_id ELSE v_old.assignee_id END;
  v_new_notes := CASE WHEN p_has_notes_update THEN p_notes ELSE v_old.notes END;
  v_new_tags := CASE WHEN p_has_tags_update THEN p_tags ELSE v_old.tags END;
  v_new_rationale := CASE WHEN p_has_rationale_update THEN p_resolution_rationale ELSE v_old.resolution_rationale END;

  -- Resolution lifecycle
  IF p_has_status_update AND v_new_status <> v_old.status THEN
    IF v_new_status IN ('resolved', 'dismissed') THEN
      v_new_resolved_at := v_now;
      v_new_resolved_by := p_user_id;
    ELSE
      v_new_resolved_at := NULL;
      v_new_resolved_by := NULL;
    END IF;
  ELSE
    v_new_resolved_at := v_old.resolved_at;
    v_new_resolved_by := v_old.resolved_by_user_id;
  END IF;

  -- 4. Update work_items row
  UPDATE public.work_items
  SET
    status = v_new_status,
    assignee_id = v_new_assignee,
    notes = v_new_notes,
    tags = v_new_tags,
    resolution_rationale = v_new_rationale,
    resolved_at = v_new_resolved_at,
    resolved_by_user_id = v_new_resolved_by,
    last_modified_by_user_id = p_user_id,
    updated_at = v_now
  WHERE id = p_work_item_id
  RETURNING * INTO v_new;

  -- 5. Insert activity record(s)
  IF p_has_status_update AND v_new.status <> v_old.status THEN
    INSERT INTO public.work_item_activities (
      work_item_id,
      organization_id,
      project_id,
      actor_user_id,
      action,
      from_status,
      to_status,
      details,
      created_at
    ) VALUES (
      v_new.id,
      p_org_id,
      p_project_id,
      p_user_id,
      'status_changed',
      v_old.status,
      v_new.status,
      jsonb_build_object(
        'resolution_rationale', v_new.resolution_rationale
      ),
      v_now
    );
  END IF;

  IF p_has_assignee_update AND (v_new.assignee_id IS DISTINCT FROM v_old.assignee_id) THEN
    INSERT INTO public.work_item_activities (
      work_item_id,
      organization_id,
      project_id,
      actor_user_id,
      action,
      from_status,
      to_status,
      details,
      created_at
    ) VALUES (
      v_new.id,
      p_org_id,
      p_project_id,
      p_user_id,
      CASE WHEN v_new.assignee_id IS NULL THEN 'unassigned' ELSE 'assigned' END,
      v_new.status,
      v_new.status,
      jsonb_build_object(
        'previous_assignee_id', v_old.assignee_id,
        'new_assignee_id', v_new.assignee_id
      ),
      v_now
    );
  END IF;

  IF (p_has_notes_update AND (v_new.notes IS DISTINCT FROM v_old.notes)) OR
     (p_has_tags_update AND (v_new.tags IS DISTINCT FROM v_old.tags)) THEN
    INSERT INTO public.work_item_activities (
      work_item_id,
      organization_id,
      project_id,
      actor_user_id,
      action,
      from_status,
      to_status,
      details,
      created_at
    ) VALUES (
      v_new.id,
      p_org_id,
      p_project_id,
      p_user_id,
      'updated',
      v_new.status,
      v_new.status,
      jsonb_build_object(
        'notes_updated', (p_has_notes_update AND (v_new.notes IS DISTINCT FROM v_old.notes)),
        'tags_updated', (p_has_tags_update AND (v_new.tags IS DISTINCT FROM v_old.tags))
      ),
      v_now
    );
  END IF;

  RETURN to_jsonb(v_new);
END;
$$;
