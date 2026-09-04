import type { SupabaseClient } from "@supabase/supabase-js";
import {
  TOTAL_GRID_BLOCKS,
  VISUAL_DIFF_ALGORITHM,
  VISUAL_REGRESSION_SCHEMA_VERSION,
  type AuditScreenshotMetadata,
  type VisualDiffResponse,
  type VisualDiffResult,
} from "@pagepilot/contracts";
import {
  VisualDiffEngine,
  buildVisualDiffSummary,
} from "@pagepilot/audit-engine";
import type { WorkflowVisualDiffStore } from "@pagepilot/workflows";
import {
  createPrivilegedSupabaseClient,
  createServerSupabaseClient,
  getServerAuthConfig,
} from "../auth/supabase-server.js";
import { SupabaseScreenshotsStore } from "../screenshots/screenshots-store.js";

function mapVisualDiffRow(row: any, currentSignedUrl?: string, baselineSignedUrl?: string): VisualDiffResult {
  return {
    id: row.id,
    organizationId: row.organization_id,
    projectId: row.project_id,
    monitoredPageId: row.monitored_page_id,
    currentAuditRunId: row.current_audit_run_id,
    baselineAuditRunId: row.baseline_audit_run_id ?? null,
    currentScreenshotId: row.current_screenshot_id ?? null,
    baselineScreenshotId: row.baseline_screenshot_id ?? null,
    deviceType: row.device_type,
    captureType: row.capture_type,
    schemaVersion: row.schema_version ?? VISUAL_REGRESSION_SCHEMA_VERSION,
    diffAlgorithm: row.diff_algorithm ?? VISUAL_DIFF_ALGORITHM,
    status: row.status,
    isBaseline: row.is_meaningful_change === false && row.baseline_audit_run_id === null,
    isMeaningfulChange: Boolean(row.is_meaningful_change),
    visualChangeScore: Number(row.visual_change_score ?? 0),
    changeSeverity: row.change_severity,
    heroZoneChange: Number(row.hero_zone_change ?? 0),
    bodyZoneChange: Number(row.body_zone_change ?? 0),
    footerZoneChange: Number(row.footer_zone_change ?? 0),
    changedBlocksCount: Number(row.changed_blocks_count ?? 0),
    totalBlocksCount: Number(row.total_blocks_count ?? TOTAL_GRID_BLOCKS),
    heightDeltaPx: Number(row.height_delta_px ?? 0),
    changeReasons: row.change_reasons ?? [],
    blockDiffs: row.details?.blockDiffs ?? [],
    currentSignedUrl,
    baselineSignedUrl,
    createdAt: row.created_at,
  };
}

export interface VisualDiffStore extends WorkflowVisualDiffStore {
  getVisualDiffResponse(params: {
    organizationId: string;
    projectId: string;
    pageId: string;
    auditRunId: string;
    compareRunId?: string;
  }): Promise<VisualDiffResponse | null>;
}

export class SupabaseVisualDiffStore implements VisualDiffStore {
  private client: SupabaseClient;
  private screenshotsStore: SupabaseScreenshotsStore;
  private diffEngine: VisualDiffEngine;

  constructor(client?: SupabaseClient, authToken?: string) {
    if (client) {
      this.client = client;
    } else {
      const created = authToken
        ? createServerSupabaseClient(getServerAuthConfig(), authToken)
        : createPrivilegedSupabaseClient(getServerAuthConfig());

      if (!created) {
        throw new Error(
          "Failed to initialize Supabase client for visual diff store: missing credentials."
        );
      }
      this.client = created;
    }
    this.screenshotsStore = new SupabaseScreenshotsStore(this.client);
    this.diffEngine = new VisualDiffEngine();
  }

  async getVisualDiffsForRun(auditRunId: string): Promise<VisualDiffResult[]> {
    const { data, error } = await this.client
      .from("visual_diff_results")
      .select("*")
      .eq("current_audit_run_id", auditRunId)
      .order("created_at", { ascending: true });

    if (error) {
      throw new Error(`Failed to query visual diff results: ${error.message}`);
    }

    return (data || []).map((row) => mapVisualDiffRow(row));
  }

  async persistVisualDiff(diff: VisualDiffResult): Promise<VisualDiffResult> {
    const { data, error } = await this.client
      .from("visual_diff_results")
      .upsert(
        {
          organization_id: diff.organizationId,
          project_id: diff.projectId,
          monitored_page_id: diff.monitoredPageId,
          current_audit_run_id: diff.currentAuditRunId,
          baseline_audit_run_id: diff.baselineAuditRunId ?? null,
          current_screenshot_id: diff.currentScreenshotId ?? null,
          baseline_screenshot_id: diff.baselineScreenshotId ?? null,
          device_type: diff.deviceType,
          capture_type: diff.captureType,
          schema_version: diff.schemaVersion,
          diff_algorithm: diff.diffAlgorithm,
          status: diff.status,
          is_meaningful_change: diff.isMeaningfulChange,
          visual_change_score: diff.visualChangeScore,
          change_severity: diff.changeSeverity,
          hero_zone_change: diff.heroZoneChange,
          body_zone_change: diff.bodyZoneChange,
          footer_zone_change: diff.footerZoneChange,
          changed_blocks_count: diff.changedBlocksCount,
          total_blocks_count: diff.totalBlocksCount,
          height_delta_px: diff.heightDeltaPx,
          change_reasons: diff.changeReasons,
          details: { blockDiffs: diff.blockDiffs ?? [] },
        },
        {
          onConflict:
            "current_audit_run_id,baseline_audit_run_id,device_type,capture_type",
        }
      )
      .select()
      .single();

    if (error || !data) {
      throw new Error(
        `Failed to persist visual diff result: ${error?.message || "No data returned"}`
      );
    }

    return mapVisualDiffRow(data);
  }

  async getPreviousAuditScreenshots(
    organizationId: string,
    monitoredPageId: string,
    currentRunId: string,
    compareRunId?: string
  ): Promise<AuditScreenshotMetadata[]> {
    let baselineRunId = compareRunId;

    if (!baselineRunId) {
      // Find the latest completed audit run for the page prior to currentRunId
      const { data: runData } = await this.client
        .from("audit_runs")
        .select("id, created_at")
        .eq("organization_id", organizationId)
        .eq("monitored_page_id", monitoredPageId)
        .eq("status", "completed")
        .neq("id", currentRunId)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (runData) {
        baselineRunId = runData.id;
      }
    }

    if (!baselineRunId) {
      return [];
    }

    return await this.screenshotsStore.listScreenshots(baselineRunId);
  }

  async recordVisualDiffFailure(params: {
    auditRunId: string;
    organizationId?: string;
    projectId?: string;
    monitoredPageId?: string;
    errorMessage: string;
  }): Promise<void> {
    const { error } = await this.client.from("visual_diff_results").insert({
      organization_id: params.organizationId,
      project_id: params.projectId,
      monitored_page_id: params.monitoredPageId,
      current_audit_run_id: params.auditRunId,
      device_type: "desktop",
      capture_type: "viewport",
      schema_version: VISUAL_REGRESSION_SCHEMA_VERSION,
      diff_algorithm: VISUAL_DIFF_ALGORITHM,
      status: "failed",
      is_meaningful_change: false,
      visual_change_score: 0,
      change_severity: "negligible",
      change_reasons: [params.errorMessage],
    });

    if (error) {
      console.warn(
        `[visual-diff-store] failed to record visual diff failure: ${error.message}`
      );
    }
  }

  async getVisualDiffResponse(params: {
    organizationId: string;
    projectId: string;
    pageId: string;
    auditRunId: string;
    compareRunId?: string;
  }): Promise<VisualDiffResponse | null> {
    const { organizationId, projectId, pageId, auditRunId, compareRunId } =
      params;

    // Load current screenshots with signed URLs
    const currentScreenshots =
      await this.screenshotsStore.getScreenshotsForAuditRun({
        organizationId,
        projectId,
        pageId,
        auditRunId,
        generateSignedUrls: true,
      });

    if (!currentScreenshots || currentScreenshots.length === 0) {
      return null;
    }

    // Load baseline screenshots with signed URLs
    const baselineScreenshots =
      await this.getPreviousAuditScreenshots(
        organizationId,
        pageId,
        auditRunId,
        compareRunId
      );

    let baselineScreenshotsWithUrls: AuditScreenshotMetadata[] = [];
    if (baselineScreenshots.length > 0) {
      const baselineRunId = baselineScreenshots[0]!.auditRunId;
      baselineScreenshotsWithUrls =
        await this.screenshotsStore.getScreenshotsForAuditRun({
          organizationId,
          projectId,
          pageId,
          auditRunId: baselineRunId,
          generateSignedUrls: true,
        });
    }

    const baselineRunId =
      baselineScreenshotsWithUrls.length > 0
        ? baselineScreenshotsWithUrls[0]!.auditRunId
        : null;

    // Load persisted diff results for this run & baseline
    let query = this.client
      .from("visual_diff_results")
      .select("*")
      .eq("organization_id", organizationId)
      .eq("monitored_page_id", pageId)
      .eq("current_audit_run_id", auditRunId);

    if (baselineRunId) {
      query = query.eq("baseline_audit_run_id", baselineRunId);
    } else {
      query = query.is("baseline_audit_run_id", null);
    }

    const { data: existingRows } = await query;
    let diffResults: VisualDiffResult[] = [];

    if (existingRows && existingRows.length > 0) {
      diffResults = existingRows.map((row) => {
        const curr = currentScreenshots.find(
          (s) =>
            s.deviceType === row.device_type && s.captureType === row.capture_type
        );
        const base = baselineScreenshotsWithUrls.find(
          (s) =>
            s.deviceType === row.device_type && s.captureType === row.capture_type
        );
        return mapVisualDiffRow(row, curr?.signedUrl, base?.signedUrl);
      });
    } else {
      // Compute on-the-fly using stored hashes (takes < 0.1ms, zero image download)
      for (const curr of currentScreenshots) {
        const base = baselineScreenshotsWithUrls.find(
          (s) =>
            s.deviceType === curr.deviceType && s.captureType === curr.captureType
        );

        const diff = this.diffEngine.compare({
          organizationId,
          projectId,
          monitoredPageId: pageId,
          current: {
            auditRunId,
            screenshotId: curr.id,
            deviceType: curr.deviceType,
            captureType: curr.captureType,
            width: curr.width,
            height: curr.height,
            perceptualHash: curr.perceptualHash,
            blockHashes: curr.blockHashes,
            signedUrl: curr.signedUrl,
          },
          baseline: base
            ? {
                auditRunId: base.auditRunId,
                screenshotId: base.id,
                deviceType: base.deviceType,
                captureType: base.captureType,
                width: base.width,
                height: base.height,
                perceptualHash: base.perceptualHash,
                blockHashes: base.blockHashes,
                signedUrl: base.signedUrl,
              }
            : null,
        });

        diffResults.push(diff);
      }
    }

    const summary = buildVisualDiffSummary(diffResults);

    return {
      diffs: diffResults,
      summary,
      baselineRunId,
      currentRunId: auditRunId,
    };
  }
}
