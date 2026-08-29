-- ============================================================================
-- PagePilot — Milestone 3 Task 3.5: Alert Persistence & Notification Delivery
-- Migration: 20260829120000_alerts_and_delivery.sql
-- ============================================================================

-- ============================================================================
-- 1. ALERTS
-- ============================================================================
-- Durable representation of evaluated alert decisions for monitored pages.
CREATE TABLE IF NOT EXISTS public.alerts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  monitored_page_id UUID NOT NULL REFERENCES public.monitored_pages(id) ON DELETE CASCADE,
  audit_run_id UUID REFERENCES public.audit_runs(id) ON DELETE SET NULL,
  rule_type TEXT NOT NULL,
  severity TEXT NOT NULL CHECK (severity IN ('high', 'medium', 'low')),
  title TEXT NOT NULL,
  reason_code TEXT NOT NULL,
  reason_summary TEXT NOT NULL,
  reason_details TEXT,
  category TEXT,
  target_id TEXT,
  score_delta NUMERIC,
  previous_value TEXT,
  current_value TEXT,
  deduplication_key TEXT NOT NULL,
  schema_version TEXT NOT NULL DEFAULT '1.0.0',
  status TEXT NOT NULL DEFAULT 'created' CHECK (status IN ('created', 'queued', 'delivered', 'failed')),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Unique index per audit run & deduplication key (prevents duplicate alert rows on run retries)
CREATE UNIQUE INDEX IF NOT EXISTS uq_alerts_run_dedup
  ON public.alerts(audit_run_id, deduplication_key)
  WHERE audit_run_id IS NOT NULL;

-- Indexes for 24-hour suppression and tenant lookup queries
CREATE INDEX IF NOT EXISTS idx_alerts_monitored_page_dedup
  ON public.alerts(monitored_page_id, deduplication_key, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_alerts_org_created
  ON public.alerts(organization_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_alerts_page_created
  ON public.alerts(monitored_page_id, created_at DESC);

-- Enable and Force RLS on alerts
ALTER TABLE public.alerts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.alerts FORCE ROW LEVEL SECURITY;

CREATE POLICY alerts_select_policy ON public.alerts
  FOR SELECT
  USING (public.is_org_member(organization_id));

CREATE POLICY alerts_insert_policy ON public.alerts
  FOR INSERT
  WITH CHECK (public.is_org_member(organization_id));

CREATE POLICY alerts_update_policy ON public.alerts
  FOR UPDATE
  USING (public.is_org_member(organization_id))
  WITH CHECK (public.is_org_member(organization_id));

CREATE POLICY alerts_delete_policy ON public.alerts
  FOR DELETE
  USING (public.is_org_admin_or_owner(organization_id));

-- ============================================================================
-- 2. ALERT DELIVERIES
-- ============================================================================
-- Durable tracking of notification delivery attempts to specific recipients.
CREATE TABLE IF NOT EXISTS public.alert_deliveries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  alert_id UUID NOT NULL REFERENCES public.alerts(id) ON DELETE CASCADE,
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  channel TEXT NOT NULL DEFAULT 'email' CHECK (channel IN ('email')),
  recipient TEXT NOT NULL,
  delivery_key TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'delivered', 'failed')),
  attempts INTEGER NOT NULL DEFAULT 0,
  last_attempted_at TIMESTAMPTZ,
  delivered_at TIMESTAMPTZ,
  error_message TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Unique index on delivery_key (alert_id:channel:recipient) prevents duplicate delivery records
CREATE UNIQUE INDEX IF NOT EXISTS uq_alert_deliveries_key
  ON public.alert_deliveries(delivery_key);

-- Lookup indexes for deliveries
CREATE INDEX IF NOT EXISTS idx_alert_deliveries_alert
  ON public.alert_deliveries(alert_id);

CREATE INDEX IF NOT EXISTS idx_alert_deliveries_org
  ON public.alert_deliveries(organization_id, created_at DESC);

-- Enable and Force RLS on alert_deliveries
ALTER TABLE public.alert_deliveries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.alert_deliveries FORCE ROW LEVEL SECURITY;

CREATE POLICY alert_deliveries_select_policy ON public.alert_deliveries
  FOR SELECT
  USING (public.is_org_member(organization_id));

CREATE POLICY alert_deliveries_insert_policy ON public.alert_deliveries
  FOR INSERT
  WITH CHECK (public.is_org_member(organization_id));

CREATE POLICY alert_deliveries_update_policy ON public.alert_deliveries
  FOR UPDATE
  USING (public.is_org_member(organization_id))
  WITH CHECK (public.is_org_member(organization_id));

CREATE POLICY alert_deliveries_delete_policy ON public.alert_deliveries
  FOR DELETE
  USING (public.is_org_admin_or_owner(organization_id));
