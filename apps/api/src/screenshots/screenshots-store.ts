import type { SupabaseClient } from "@supabase/supabase-js";
import {
  SCREENSHOT_STORAGE_BUCKET,
  SIGNED_URL_TTL_SECONDS,
} from "@pagepilot/contracts";
import type {
  AuditScreenshotMetadata,
  ScreenshotMimeType,
} from "@pagepilot/contracts";
import type { WorkflowScreenshotStore } from "@pagepilot/workflows";
import {
  createPrivilegedSupabaseClient,
  createServerSupabaseClient,
  getServerAuthConfig,
} from "../auth/supabase-server.js";

function mapScreenshotRow(row: any, signedUrl?: string): AuditScreenshotMetadata {
  return {
    id: row.id,
    auditRunId: row.audit_run_id,
    auditReportId: row.audit_report_id ?? null,
    monitoredPageId: row.monitored_page_id,
    projectId: row.project_id,
    organizationId: row.organization_id,
    deviceType: row.device_type,
    captureType: row.capture_type,
    storagePath: row.storage_path,
    storageBucket: row.storage_bucket ?? SCREENSHOT_STORAGE_BUCKET,
    fileSizeBytes: row.file_size_bytes,
    mimeType: row.mime_type,
    width: row.width,
    height: row.height,
    capturedAt: row.captured_at,
    createdAt: row.created_at,
    signedUrl,
    perceptualHash: row.perceptual_hash ?? null,
    blockHashes: row.block_hashes ?? null,
  };
}

export interface ScreenshotsStore extends WorkflowScreenshotStore {
  getScreenshotsForAuditRun(params: {
    organizationId: string;
    projectId: string;
    pageId: string;
    auditRunId: string;
    generateSignedUrls?: boolean;
  }): Promise<AuditScreenshotMetadata[]>;

  createSignedUrl(
    storagePath: string,
    expiresInSeconds?: number
  ): Promise<string>;
}

export class SupabaseScreenshotsStore implements ScreenshotsStore {
  private client: SupabaseClient;

  constructor(client?: SupabaseClient, authToken?: string) {
    if (client) {
      this.client = client;
    } else {
      const created = authToken
        ? createServerSupabaseClient(getServerAuthConfig(), authToken)
        : createPrivilegedSupabaseClient(getServerAuthConfig());

      if (!created) {
        throw new Error(
          "Failed to initialize Supabase client for screenshots store: missing environment credentials."
        );
      }
      this.client = created;
    }
  }

  async listScreenshots(auditRunId: string): Promise<AuditScreenshotMetadata[]> {
    const { data, error } = await this.client
      .from("audit_screenshots")
      .select("*")
      .eq("audit_run_id", auditRunId)
      .order("created_at", { ascending: true });

    if (error) {
      throw new Error(`Failed to query screenshots: ${error.message}`);
    }

    return (data || []).map((row) => mapScreenshotRow(row));
  }

  async uploadScreenshot(params: {
    storagePath: string;
    buffer: Buffer;
    mimeType: ScreenshotMimeType;
  }): Promise<{ storagePath: string }> {
    const { error } = await this.client.storage
      .from(SCREENSHOT_STORAGE_BUCKET)
      .upload(params.storagePath, params.buffer, {
        contentType: params.mimeType,
        upsert: true,
      });

    if (error) {
      throw new Error(`Failed to upload screenshot: ${error.message}`);
    }

    return { storagePath: params.storagePath };
  }

  async downloadScreenshot(storagePath: string): Promise<Buffer | null> {
    const { data, error } = await this.client.storage
      .from(SCREENSHOT_STORAGE_BUCKET)
      .download(storagePath);

    if (error || !data) {
      console.warn(
        `[screenshots-store] failed to download ${storagePath}: ${error?.message}`
      );
      return null;
    }

    const arrayBuffer = await data.arrayBuffer();
    return Buffer.from(arrayBuffer);
  }

  async persistScreenshotMetadata(
    metadata: Omit<AuditScreenshotMetadata, "id" | "createdAt" | "signedUrl">
  ): Promise<AuditScreenshotMetadata> {
    const { data, error } = await this.client
      .from("audit_screenshots")
      .upsert(
        {
          organization_id: metadata.organizationId,
          project_id: metadata.projectId,
          monitored_page_id: metadata.monitoredPageId,
          audit_run_id: metadata.auditRunId,
          audit_report_id: metadata.auditReportId ?? null,
          device_type: metadata.deviceType,
          capture_type: metadata.captureType,
          storage_path: metadata.storagePath,
          storage_bucket: metadata.storageBucket ?? SCREENSHOT_STORAGE_BUCKET,
          file_size_bytes: metadata.fileSizeBytes,
          mime_type: metadata.mimeType,
          width: metadata.width,
          height: metadata.height,
          captured_at: metadata.capturedAt,
          perceptual_hash: metadata.perceptualHash ?? null,
          block_hashes: metadata.blockHashes ?? null,
        },
        { onConflict: "audit_run_id,device_type,capture_type" }
      )
      .select()
      .single();

    if (error || !data) {
      throw new Error(
        `Failed to persist screenshot metadata: ${error?.message || "No data returned"}`
      );
    }

    return mapScreenshotRow(data);
  }

  async createSignedUrl(
    storagePath: string,
    expiresInSeconds = SIGNED_URL_TTL_SECONDS
  ): Promise<string> {
    const { data, error } = await this.client.storage
      .from(SCREENSHOT_STORAGE_BUCKET)
      .createSignedUrl(storagePath, expiresInSeconds);

    if (error || !data?.signedUrl) {
      throw new Error(
        `Failed to generate signed URL for ${storagePath}: ${error?.message || "No signed URL generated"}`
      );
    }

    return data.signedUrl;
  }

  async getScreenshotsForAuditRun(params: {
    organizationId: string;
    projectId: string;
    pageId: string;
    auditRunId: string;
    generateSignedUrls?: boolean;
  }): Promise<AuditScreenshotMetadata[]> {
    const { data, error } = await this.client
      .from("audit_screenshots")
      .select("*")
      .eq("audit_run_id", params.auditRunId)
      .eq("organization_id", params.organizationId)
      .eq("project_id", params.projectId)
      .eq("monitored_page_id", params.pageId)
      .order("created_at", { ascending: true });

    if (error) {
      throw new Error(`Failed to query screenshots: ${error.message}`);
    }

    const rows = data || [];
    const shouldSign = params.generateSignedUrls ?? true;

    if (!shouldSign) {
      return rows.map((row) => mapScreenshotRow(row));
    }

    // Generate signed URLs in parallel with error tolerance
    const results = await Promise.all(
      rows.map(async (row) => {
        try {
          const signedUrl = await this.createSignedUrl(row.storage_path);
          return mapScreenshotRow(row, signedUrl);
        } catch (signErr) {
          console.warn(
            `[screenshots-store] Warning: failed to sign URL for ${row.storage_path}:`,
            signErr
          );
          return mapScreenshotRow(row);
        }
      })
    );

    return results;
  }
}
