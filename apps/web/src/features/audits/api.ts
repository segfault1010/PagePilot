import type {
  AuditHistoryListResponse,
  AuditRunResponse,
  PersistedAuditReportResponse,
  TriggerAuditRequest,
} from "@pagepilot/contracts";
import {
  auditHistoryListResponseSchema,
  auditRunResponseSchema,
  persistedAuditReportResponseSchema,
} from "@pagepilot/contracts";
import { getSupabaseClient } from "../auth/supabase-client.js";

export interface AuditRequestOptions {
  token?: string;
  baseUrl?: string;
}

export class AuditApiClientError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "AuditApiClientError";
    this.status = status;
    this.code = code;
  }
}

export async function getActiveAccessToken(
  overrideToken?: string,
): Promise<string | null> {
  if (overrideToken) return overrideToken;
  const client = getSupabaseClient();
  if (!client) return null;
  const { data } = await client.auth.getSession();
  return data.session?.access_token ?? null;
}

async function authenticatedFetch<T>(
  endpoint: string,
  init: RequestInit = {},
  options: AuditRequestOptions = {},
): Promise<T> {
  const token = await getActiveAccessToken(options.token);
  const baseUrl = options.baseUrl ?? "";
  const url = `${baseUrl}${endpoint}`;

  const headers = new Headers(init.headers || {});
  headers.set("Content-Type", "application/json");
  if (token) {
    headers.set("Authorization", `Bearer ${token}`);
  }

  const res = await fetch(url, {
    ...init,
    headers,
  });

  if (!res.ok) {
    let code = "UNKNOWN_ERROR";
    let message = `Request failed with status ${res.status}`;
    try {
      const errJson = await res.json();
      if (errJson?.error) {
        code = errJson.error.code ?? code;
        message = errJson.error.message ?? message;
      }
    } catch {
      // Non-JSON response
    }
    throw new AuditApiClientError(res.status, code, message);
  }

  return res.json();
}

/**
 * Triggers a manual audit for a monitored page.
 * Returns 201 for newly executed audits or 200 for idempotent replayed runs.
 */
export async function triggerManualAudit(
  projectId: string,
  pageId: string,
  data: TriggerAuditRequest = {},
  options: AuditRequestOptions = {},
): Promise<AuditRunResponse> {
  const json = await authenticatedFetch<unknown>(
    `/api/projects/${projectId}/pages/${pageId}/audits`,
    {
      method: "POST",
      body: JSON.stringify(data),
    },
    options,
  );
  return auditRunResponseSchema.parse(json);
}

/**
 * Lists historical audit runs for a monitored page.
 */
export async function listAuditHistory(
  projectId: string,
  pageId: string,
  params: { limit?: number; offset?: number } = {},
  options: AuditRequestOptions = {},
): Promise<AuditHistoryListResponse> {
  const query = new URLSearchParams();
  if (params.limit !== undefined) query.set("limit", String(params.limit));
  if (params.offset !== undefined) query.set("offset", String(params.offset));
  const queryString = query.toString() ? `?${query.toString()}` : "";

  const json = await authenticatedFetch<unknown>(
    `/api/projects/${projectId}/pages/${pageId}/audits${queryString}`,
    {
      method: "GET",
    },
    options,
  );
  return auditHistoryListResponseSchema.parse(json);
}

/**
 * Retrieves the latest successful persisted audit report for a monitored page.
 */
export async function getLatestAuditReport(
  projectId: string,
  pageId: string,
  options: AuditRequestOptions = {},
): Promise<PersistedAuditReportResponse> {
  const json = await authenticatedFetch<unknown>(
    `/api/projects/${projectId}/pages/${pageId}/audits/latest`,
    {
      method: "GET",
    },
    options,
  );
  return persistedAuditReportResponseSchema.parse(json);
}

/**
 * Retrieves a specific historical persisted audit report by its audit run ID.
 */
export async function getAuditReportByRunId(
  projectId: string,
  pageId: string,
  runId: string,
  options: AuditRequestOptions = {},
): Promise<PersistedAuditReportResponse> {
  const json = await authenticatedFetch<unknown>(
    `/api/projects/${projectId}/pages/${pageId}/audits/${runId}`,
    {
      method: "GET",
    },
    options,
  );
  return persistedAuditReportResponseSchema.parse(json);
}
