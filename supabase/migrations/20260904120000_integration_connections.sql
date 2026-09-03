-- ============================================================================
-- PagePilot — Milestone 5 Task 5.1: Slack / Webhook Integration Foundation & Alert Subscriptions
-- Migration: 20260904120000_integration_connections.sql
-- ============================================================================

-- ============================================================================
-- 1. INTEGRATION CONNECTIONS
-- ============================================================================
-- Tenant-owned configurations for external messaging and webhook integrations.
-- project_id is nullable:
--   - If NULL: organization-wide integration (receives alerts across all projects)
--   - If NOT NULL: project-scoped integration (receives alerts only for that project)
CREATE TABLE IF NOT EXISTS public.integration_connections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  project_id UUID REFERENCES public.projects(id) ON DELETE CASCADE,
  provider TEXT NOT NULL CHECK (provider IN ('slack', 'webhook')),
  name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled', 'error')),
  config JSONB NOT NULL DEFAULT '{}'::jsonb,
  encrypted_credentials TEXT NOT NULL,
  key_id TEXT NOT NULL DEFAULT 'v1',
  events TEXT[] NOT NULL DEFAULT '{overall_score_drop,new_high_severity_finding}',
  created_by_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================================
-- 2. UPDATE ALERT DELIVERIES FOR MULTI-CHANNEL SUPPORT
-- ============================================================================
-- Expand channel check constraint to support 'slack' and 'webhook' in addition to 'email'
ALTER TABLE public.alert_deliveries
  DROP CONSTRAINT IF EXISTS alert_deliveries_channel_check;

ALTER TABLE public.alert_deliveries
  ADD CONSTRAINT alert_deliveries_channel_check
  CHECK (channel IN ('email', 'slack', 'webhook'));

-- Link delivery attempt optionally to the integration_connection record for observability
ALTER TABLE public.alert_deliveries
  ADD COLUMN IF NOT EXISTS integration_connection_id UUID
  REFERENCES public.integration_connections(id) ON DELETE SET NULL;

-- ============================================================================
-- 3. INDEXES
-- ============================================================================
CREATE INDEX IF NOT EXISTS idx_integration_connections_org
  ON public.integration_connections(organization_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_integration_connections_project
  ON public.integration_connections(project_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_integration_connections_status
  ON public.integration_connections(organization_id, status);

CREATE INDEX IF NOT EXISTS idx_alert_deliveries_integration
  ON public.alert_deliveries(integration_connection_id);

-- ============================================================================
-- 4. ROW-LEVEL SECURITY (RLS)
-- ============================================================================
-- Enable and Force RLS on integration_connections
ALTER TABLE public.integration_connections ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.integration_connections FORCE ROW LEVEL SECURITY;

-- SELECT: Any organization member (owner, admin, member, viewer) can view
-- integrations in their organization (API returns masked credentials).
CREATE POLICY integration_connections_select_policy ON public.integration_connections
  FOR SELECT
  USING (public.is_org_member(organization_id));

-- INSERT: Only organization admin or owner can create integration connections.
CREATE POLICY integration_connections_insert_policy ON public.integration_connections
  FOR INSERT
  WITH CHECK (public.is_org_admin_or_owner(organization_id));

-- UPDATE: Only organization admin or owner can modify integration connections.
CREATE POLICY integration_connections_update_policy ON public.integration_connections
  FOR UPDATE
  USING (public.is_org_admin_or_owner(organization_id))
  WITH CHECK (public.is_org_admin_or_owner(organization_id));

-- DELETE: Only organization admin or owner can delete integration connections.
CREATE POLICY integration_connections_delete_policy ON public.integration_connections
  FOR DELETE
  USING (public.is_org_admin_or_owner(organization_id));
