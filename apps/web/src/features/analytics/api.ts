import type {
  CreatePageAnalyticsInput,
  PageAnalyticsHistoryResponse,
  PageAnalyticsResponse,
} from "@pagepilot/contracts";
import {
  pageAnalyticsHistoryResponseSchema,
  pageAnalyticsResponseSchema,
} from "@pagepilot/contracts";
import { getSupabaseClient } from "../auth/supabase-client.js";

export interface RequestOptions {
  token?: string;
  baseUrl?: string;
}

export class AnalyticsApiClientError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "AnalyticsApiClientError";
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
  options: RequestOptions = {},
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

  const body = await res.json().catch(() => null);

  if (!res.ok) {
    const errorObj = body?.error;
    const code =
      errorObj?.code ||
      (res.status === 401
        ? "UNAUTHENTICATED"
        : res.status === 403
          ? "FORBIDDEN"
          : res.status === 404
            ? "NOT_FOUND"
            : res.status === 409
              ? "CONFLICT"
              : "INTERNAL_ERROR");

    const message =
      errorObj?.message ||
      (res.status === 403
        ? "You do not have permission to perform this action."
        : res.status === 404
          ? "Page or resource not found."
          : `Request failed with status ${res.status}`);

    throw new AnalyticsApiClientError(res.status, code, message);
  }

  return body as T;
}

/**
 * Retrieves the current active analytics snapshot and history for a monitored page.
 */
export async function getPageAnalytics(
  projectId: string,
  pageId: string,
  options: RequestOptions = {},
): Promise<PageAnalyticsHistoryResponse> {
  const data = await authenticatedFetch<unknown>(
    `/api/projects/${projectId}/pages/${pageId}/analytics`,
    { method: "GET" },
    options,
  );
  return pageAnalyticsHistoryResponseSchema.parse(data);
}

/**
 * Creates / imports a new page analytics snapshot.
 */
export async function createPageAnalytics(
  projectId: string,
  pageId: string,
  input: CreatePageAnalyticsInput,
  options: RequestOptions = {},
): Promise<PageAnalyticsResponse> {
  const data = await authenticatedFetch<unknown>(
    `/api/projects/${projectId}/pages/${pageId}/analytics`,
    {
      method: "POST",
      body: JSON.stringify(input),
    },
    options,
  );
  return pageAnalyticsResponseSchema.parse(data);
}

/**
 * Deletes an analytics snapshot.
 */
export async function deletePageAnalytics(
  projectId: string,
  pageId: string,
  snapshotId: string,
  options: RequestOptions = {},
): Promise<{ success: boolean }> {
  return authenticatedFetch<{ success: boolean }>(
    `/api/projects/${projectId}/pages/${pageId}/analytics/${snapshotId}`,
    { method: "DELETE" },
    options,
  );
}
