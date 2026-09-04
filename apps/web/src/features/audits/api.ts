import type {
  AuditDiffResponse,
  AuditHistoryListResponse,
  AuditRunResponse,
  PersistedAuditReportResponse,
  TriggerAuditRequest,
  AuditScreenshotsResponse,
  VisualAnalysisResponse,
  VisualDiffResponse,
} from "@pagepilot/contracts";
import {
  auditDiffResponseSchema,
  auditHistoryListResponseSchema,
  auditRunResponseSchema,
  persistedAuditReportResponseSchema,
  auditScreenshotsResponseSchema,
  visualAnalysisResponseSchema,
  visualDiffResponseSchema,
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

/**
 * Retrieves a deterministic audit comparison diff for a given run vs. its previous run (or an explicitly specified comparison run).
 */
export async function getAuditDiff(
  projectId: string,
  pageId: string,
  runId: string,
  params: { compareRunId?: string; previousRunId?: string } = {},
  options: AuditRequestOptions = {},
): Promise<AuditDiffResponse> {
  const query = new URLSearchParams();
  if (params.compareRunId) query.set("compareRunId", params.compareRunId);
  else if (params.previousRunId) query.set("compareRunId", params.previousRunId);
  const queryString = query.toString() ? `?${query.toString()}` : "";

  const json = await authenticatedFetch<unknown>(
    `/api/projects/${projectId}/pages/${pageId}/audits/${runId}/diff${queryString}`,
    {
      method: "GET",
    },
    options,
  );
  return auditDiffResponseSchema.parse(json);
}

/**
 * Downloads an audit report CSV as a Blob.
 */
export async function exportAuditReportCsv(
  projectId: string,
  pageId: string,
  auditRunId: string,
  options: AuditRequestOptions = {},
): Promise<Blob> {
  const token = await getActiveAccessToken(options.token);
  const baseUrl = options.baseUrl ?? "";
  const url = `${baseUrl}/api/projects/${projectId}/pages/${pageId}/audits/${auditRunId}/export`;

  const headers = new Headers();
  if (token) {
    headers.set("Authorization", `Bearer ${token}`);
  }

  const res = await fetch(url, {
    method: "GET",
    headers,
  });

  if (!res.ok) {
    let code = "UNKNOWN_ERROR";
    let message = `Export failed with status ${res.status}`;
    try {
      const errJson = await res.json();
      if (errJson?.error) {
        code = errJson.error.code ?? code;
        message = errJson.error.message ?? message;
      }
    } catch {
      // Ignored
    }
    throw new AuditApiClientError(res.status, code, message);
  }

  return res.blob();
}

/**
 * Fetches browser screenshot evidence with signed URLs for an audit run.
 */
export async function fetchAuditScreenshots(
  projectId: string,
  pageId: string,
  auditRunId: string,
  options: AuditRequestOptions = {}
): Promise<AuditScreenshotsResponse> {
  const json = await authenticatedFetch<unknown>(
    `/api/projects/${projectId}/pages/${pageId}/audits/${auditRunId}/screenshots`,
    { method: "GET" },
    options
  );
  return auditScreenshotsResponseSchema.parse(json);
}

/**
 * Fetches vision-assisted visual hierarchy review for an audit run.
 */
export async function fetchVisualAnalysis(
  projectId: string,
  pageId: string,
  auditRunId: string,
  options: AuditRequestOptions = {}
): Promise<VisualAnalysisResponse> {
  const json = await authenticatedFetch<unknown>(
    `/api/projects/${projectId}/pages/${pageId}/audits/${auditRunId}/visual-analysis`,
    { method: "GET" },
    options
  );
  return visualAnalysisResponseSchema.parse(json);
}

/**
 * Fetches visual regression diff and perceptual change analysis for an audit run.
 */
export async function fetchVisualDiff(
  projectId: string,
  pageId: string,
  auditRunId: string,
  options: AuditRequestOptions & { compareRunId?: string } = {}
): Promise<VisualDiffResponse> {
  const query = options.compareRunId
    ? `?compareRunId=${encodeURIComponent(options.compareRunId)}`
    : "";
  const json = await authenticatedFetch<unknown>(
    `/api/projects/${projectId}/pages/${pageId}/audits/${auditRunId}/visual-diff${query}`,
    { method: "GET" },
    options
  );
  return visualDiffResponseSchema.parse(json);
}

export const getVisualDiff = fetchVisualDiff;



