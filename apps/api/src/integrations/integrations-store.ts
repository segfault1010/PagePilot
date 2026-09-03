import { createClient } from "@supabase/supabase-js";
import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  CreateIntegrationInput,
  IntegrationConnection,
  IntegrationStatus,
  TestIntegrationResponse,
  UpdateIntegrationInput,
} from "@pagepilot/contracts";
import {
  decryptCredentials,
  encryptCredentials,
  maskCredentialUrl,
} from "./crypto.js";
import { validateOutboundWebhookUrl } from "./destination-guard.js";

/**
 * Interface defining persistent operations on integration connections.
 */
export interface IntegrationsStore {
  listIntegrations(
    orgId: string,
    projectId?: string,
  ): Promise<IntegrationConnection[]>;

  getIntegrationById(
    orgId: string,
    integrationId: string,
    projectId?: string,
  ): Promise<IntegrationConnection | null>;

  getIntegrationWithCredentials(
    orgId: string,
    integrationId: string,
  ): Promise<{
    integration: IntegrationConnection;
    targetUrl: string;
    signingSecret?: string;
  } | null>;

  createIntegration(
    orgId: string,
    userId: string,
    input: CreateIntegrationInput,
    projectId?: string,
  ): Promise<IntegrationConnection>;

  updateIntegration(
    orgId: string,
    integrationId: string,
    input: UpdateIntegrationInput,
    projectId?: string,
  ): Promise<IntegrationConnection | null>;

  deleteIntegration(
    orgId: string,
    integrationId: string,
    projectId?: string,
  ): Promise<boolean>;

  testIntegration(
    orgId: string,
    integrationId: string,
  ): Promise<TestIntegrationResponse>;
}

export interface DatabaseIntegrationRow {
  id: string;
  organization_id: string;
  project_id: string | null;
  provider: "slack" | "webhook";
  name: string;
  status: IntegrationStatus;
  config: Record<string, unknown>;
  encrypted_credentials: string;
  key_id: string;
  events: string[];
  created_by_user_id: string | null;
  created_at: string;
  updated_at: string;
}

/**
 * Converts any valid date representation into a canonical ISO string ending in 'Z'.
 */
function toNormalizedIsoDate(val: unknown): string {
  if (typeof val === "string") {
    const d = new Date(val);
    if (!isNaN(d.getTime())) return d.toISOString();
    return val;
  }
  if (val instanceof Date) return val.toISOString();
  return new Date().toISOString();
}

/**
 * Maps database row to client-safe IntegrationConnection entity with masked credentials.
 */
function rowToIntegration(row: DatabaseIntegrationRow): IntegrationConnection {
  let hasSigningSecret = false;
  let rawUrl = "";
  try {
    const decrypted = decryptCredentials(row.encrypted_credentials);
    rawUrl = decrypted.targetUrl || "";
    hasSigningSecret = Boolean(
      decrypted.signingSecret && decrypted.signingSecret.length > 0,
    );
  } catch {
    rawUrl = "https://***masked***";
  }

  const maskedTargetUrl = maskCredentialUrl(rawUrl, row.provider);

  return {
    id: row.id,
    organizationId: row.organization_id,
    projectId: row.project_id ?? null,
    provider: row.provider,
    name: row.name,
    status: row.status,
    config: row.config || {},
    maskedTargetUrl,
    hasSigningSecret,
    events: (row.events || []) as any,
    createdByUserId: row.created_by_user_id ?? null,
    createdAt: toNormalizedIsoDate(row.created_at),
    updatedAt: toNormalizedIsoDate(row.updated_at),
  };
}

/**
 * Supabase-backed implementation of IntegrationsStore using the user's verified session token.
 */
export class SupabaseIntegrationsStore implements IntegrationsStore {
  private client: SupabaseClient;

  constructor(client?: SupabaseClient, authToken?: string) {
    if (client) {
      this.client = client;
    } else {
      const supabaseUrl =
        process.env.SUPABASE_URL ||
        process.env.VITE_SUPABASE_URL ||
        "http://localhost:54321";
      const supabaseAnonKey =
        process.env.SUPABASE_ANON_KEY ||
        process.env.VITE_SUPABASE_ANON_KEY ||
        "test-anon-key";

      this.client = createClient(supabaseUrl, supabaseAnonKey, {
        auth: {
          persistSession: false,
          autoRefreshToken: false,
        },
        global: {
          headers: authToken ? { Authorization: `Bearer ${authToken}` } : {},
        },
      });
    }
  }

  async listIntegrations(
    orgId: string,
    projectId?: string,
  ): Promise<IntegrationConnection[]> {
    let query = this.client
      .from("integration_connections")
      .select("*")
      .eq("organization_id", orgId);

    if (projectId) {
      // Return project-scoped integrations as well as org-wide integrations (project_id IS NULL)
      query = query.or(`project_id.eq.${projectId},project_id.is.null`);
    }

    query = query.order("created_at", { ascending: false });

    const { data, error } = await query;
    if (error) {
      throw new Error(`Failed to list integrations: ${error.message}`);
    }

    return (data || []).map((row) =>
      rowToIntegration(row as DatabaseIntegrationRow),
    );
  }

  async getIntegrationById(
    orgId: string,
    integrationId: string,
    projectId?: string,
  ): Promise<IntegrationConnection | null> {
    let query = this.client
      .from("integration_connections")
      .select("*")
      .eq("organization_id", orgId)
      .eq("id", integrationId);

    if (projectId) {
      query = query.or(`project_id.eq.${projectId},project_id.is.null`);
    }

    const { data, error } = await query.maybeSingle();
    if (error) {
      throw new Error(`Failed to retrieve integration: ${error.message}`);
    }

    if (!data) return null;
    return rowToIntegration(data as DatabaseIntegrationRow);
  }

  async getIntegrationWithCredentials(
    orgId: string,
    integrationId: string,
  ): Promise<{
    integration: IntegrationConnection;
    targetUrl: string;
    signingSecret?: string;
  } | null> {
    const { data, error } = await this.client
      .from("integration_connections")
      .select("*")
      .eq("organization_id", orgId)
      .eq("id", integrationId)
      .maybeSingle();

    if (error || !data) return null;

    const row = data as DatabaseIntegrationRow;
    const integration = rowToIntegration(row);
    const creds = decryptCredentials(row.encrypted_credentials);

    return {
      integration,
      targetUrl: creds.targetUrl || "",
      signingSecret: creds.signingSecret || undefined,
    };
  }

  async createIntegration(
    orgId: string,
    userId: string,
    input: CreateIntegrationInput,
    projectId?: string,
  ): Promise<IntegrationConnection> {
    const credentialsToEncrypt: Record<string, string> = {
      targetUrl: input.targetUrl,
    };
    if (input.signingSecret && input.signingSecret.length > 0) {
      credentialsToEncrypt.signingSecret = input.signingSecret;
    }

    const { encrypted, keyId } = encryptCredentials(credentialsToEncrypt);

    const insertPayload = {
      organization_id: orgId,
      project_id: projectId || null,
      provider: input.provider,
      name: input.name,
      status: "active" as IntegrationStatus,
      config: input.config || {},
      encrypted_credentials: encrypted,
      key_id: keyId,
      events: input.events || [
        "overall_score_drop",
        "new_high_severity_finding",
      ],
      created_by_user_id: userId,
    };

    const { data, error } = await this.client
      .from("integration_connections")
      .insert(insertPayload)
      .select("*")
      .single();

    if (error) {
      throw new Error(`Failed to create integration: ${error.message}`);
    }

    return rowToIntegration(data as DatabaseIntegrationRow);
  }

  async updateIntegration(
    orgId: string,
    integrationId: string,
    input: UpdateIntegrationInput,
    projectId?: string,
  ): Promise<IntegrationConnection | null> {
    // 1. Fetch current row
    let getQuery = this.client
      .from("integration_connections")
      .select("*")
      .eq("organization_id", orgId)
      .eq("id", integrationId);

    if (projectId) {
      getQuery = getQuery.or(`project_id.eq.${projectId},project_id.is.null`);
    }

    const { data: existing, error: getErr } = await getQuery.maybeSingle();
    if (getErr || !existing) return null;

    const existingRow = existing as DatabaseIntegrationRow;
    const updates: Record<string, unknown> = {
      updated_at: new Date().toISOString(),
    };

    if (input.name !== undefined) updates.name = input.name;
    if (input.status !== undefined) updates.status = input.status;
    if (input.events !== undefined) updates.events = input.events;
    if (input.config !== undefined) updates.config = input.config;

    // Handle credential updates if targetUrl or signingSecret supplied
    if (input.targetUrl !== undefined || input.signingSecret !== undefined) {
      const currentCreds = decryptCredentials(
        existingRow.encrypted_credentials,
      );
      const merged: Record<string, string> = {
        targetUrl: input.targetUrl ?? currentCreds.targetUrl ?? "",
      };
      if (input.signingSecret !== undefined) {
        if (input.signingSecret && input.signingSecret.length > 0) {
          merged.signingSecret = input.signingSecret;
        }
      } else if (currentCreds.signingSecret) {
        merged.signingSecret = currentCreds.signingSecret;
      }

      const { encrypted, keyId } = encryptCredentials(merged);
      updates.encrypted_credentials = encrypted;
      updates.key_id = keyId;
    }

    const { data, error } = await this.client
      .from("integration_connections")
      .update(updates)
      .eq("organization_id", orgId)
      .eq("id", integrationId)
      .select("*")
      .single();

    if (error) {
      throw new Error(`Failed to update integration: ${error.message}`);
    }

    return rowToIntegration(data as DatabaseIntegrationRow);
  }

  async deleteIntegration(
    orgId: string,
    integrationId: string,
    projectId?: string,
  ): Promise<boolean> {
    let query = this.client
      .from("integration_connections")
      .delete()
      .eq("organization_id", orgId)
      .eq("id", integrationId);

    if (projectId) {
      query = query.or(`project_id.eq.${projectId},project_id.is.null`);
    }

    const { error, count } = await query;
    if (error) {
      throw new Error(`Failed to delete integration: ${error.message}`);
    }

    return (count ?? 1) > 0;
  }

  async testIntegration(
    orgId: string,
    integrationId: string,
  ): Promise<TestIntegrationResponse> {
    const credsResult = await this.getIntegrationWithCredentials(
      orgId,
      integrationId,
    );
    if (!credsResult) {
      return {
        success: false,
        latencyMs: 0,
        error: "Integration not found.",
      };
    }

    const { integration, targetUrl, signingSecret } = credsResult;

    // Enforce SSRF destination policy before attempting any network connection
    const destinationCheck = await validateOutboundWebhookUrl(targetUrl);
    if (!destinationCheck.ok) {
      return {
        success: false,
        latencyMs: 0,
        error: `SSRF Validation Failed: ${destinationCheck.message || "Destination is not allowed."}`,
      };
    }

    const startTime = Date.now();
    try {
      let body: string;
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
        "User-Agent": "PagePilot-Webhook-Tester/1.0",
      };

      if (integration.provider === "slack") {
        body = JSON.stringify({
          text: ":white_check_mark: PagePilot integration test ping succeeded.",
          blocks: [
            {
              type: "header",
              text: {
                type: "plain_text",
                text: "PagePilot Integration Test",
                emoji: true,
              },
            },
            {
              type: "section",
              text: {
                type: "mrkdwn",
                text: `Test ping verified for *${integration.name}* (${integration.provider}). Alerts will be delivered to this channel.`,
              },
            },
          ],
        });
      } else {
        const payloadObj = {
          event: "test.ping",
          timestamp: new Date().toISOString(),
          data: {
            integrationId: integration.id,
            integrationName: integration.name,
            organizationId: integration.organizationId,
            projectId: integration.projectId,
          },
        };
        body = JSON.stringify(payloadObj);

        if (signingSecret && signingSecret.length > 0) {
          const nowSeconds = Math.floor(Date.now() / 1000);
          const { createWebhookSignature } = await import("./crypto.js");
          headers["X-PagePilot-Signature"] = createWebhookSignature(
            signingSecret,
            body,
            nowSeconds,
          );
          headers["X-PagePilot-Timestamp"] = String(nowSeconds);
        }
      }

      const response = await fetch(targetUrl, {
        method: "POST",
        headers,
        body,
        signal: AbortSignal.timeout(8000), // 8s bounded timeout
      });

      const latencyMs = Date.now() - startTime;
      const success = response.ok;

      return {
        success,
        statusCode: response.status,
        latencyMs,
        error: success
          ? undefined
          : `Target server responded with status ${response.status}`,
      };
    } catch (err: any) {
      const latencyMs = Date.now() - startTime;
      return {
        success: false,
        latencyMs,
        error: err?.message || "Connection timed out or failed.",
      };
    }
  }
}
