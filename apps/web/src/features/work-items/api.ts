import type {
  CreateWorkItemInput,
  OrganizationMemberListResponse,
  UpdateWorkItemInput,
  WorkItemFilters,
  WorkItemListResponse,
  WorkItemResponse,
} from "@pagepilot/contracts";
import {
  organizationMemberListResponseSchema,
  workItemListResponseSchema,
  workItemResponseSchema,
} from "@pagepilot/contracts";
import { getSupabaseClient } from "../auth/supabase-client.js";

export interface RequestOptions {
  token?: string;
  baseUrl?: string;
}

export class WorkItemsApiClientError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "WorkItemsApiClientError";
    this.status = status;
    this.code = code;
  }
}

export async function getActiveAccessToken(overrideToken?: string): Promise<string | null> {
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
              : "REQUEST_FAILED");
    const message = errorObj?.message || `Request failed with status ${res.status}`;
    throw new WorkItemsApiClientError(res.status, code, message);
  }

  return body as T;
}

// ---------------------------------------------------------------------------
// Work Items API Client
// ---------------------------------------------------------------------------

export async function listWorkItems(
  projectId: string,
  filters: WorkItemFilters = {},
  options?: RequestOptions,
): Promise<WorkItemListResponse> {
  const params = new URLSearchParams();
  if (filters.pageId) params.set("pageId", filters.pageId);
  if (filters.status) params.set("status", filters.status);
  if (filters.assigneeId) params.set("assigneeId", filters.assigneeId);
  if (filters.sourceType) params.set("sourceType", filters.sourceType);
  if (filters.category) params.set("category", filters.category);
  if (filters.severity) params.set("severity", filters.severity);
  if (filters.limit) params.set("limit", String(filters.limit));
  if (filters.offset) params.set("offset", String(filters.offset));

  const qs = params.toString();
  const endpoint = `/api/projects/${projectId}/work-items${qs ? `?${qs}` : ""}`;

  const data = await authenticatedFetch<unknown>(endpoint, { method: "GET" }, options);
  return workItemListResponseSchema.parse(data);
}

export async function getWorkItem(
  projectId: string,
  workItemId: string,
  options?: RequestOptions,
): Promise<WorkItemResponse> {
  const data = await authenticatedFetch<unknown>(
    `/api/projects/${projectId}/work-items/${workItemId}`,
    { method: "GET" },
    options,
  );
  return workItemResponseSchema.parse(data);
}

export async function createWorkItem(
  projectId: string,
  input: CreateWorkItemInput,
  options?: RequestOptions,
): Promise<WorkItemResponse> {
  const data = await authenticatedFetch<unknown>(
    `/api/projects/${projectId}/work-items`,
    {
      method: "POST",
      body: JSON.stringify(input),
    },
    options,
  );
  return workItemResponseSchema.parse(data);
}

export async function updateWorkItem(
  projectId: string,
  workItemId: string,
  input: UpdateWorkItemInput,
  options?: RequestOptions,
): Promise<WorkItemResponse> {
  const data = await authenticatedFetch<unknown>(
    `/api/projects/${projectId}/work-items/${workItemId}`,
    {
      method: "PATCH",
      body: JSON.stringify(input),
    },
    options,
  );
  return workItemResponseSchema.parse(data);
}

export async function deleteWorkItem(
  projectId: string,
  workItemId: string,
  options?: RequestOptions,
): Promise<{ success: boolean; deletedWorkItemId: string }> {
  return authenticatedFetch<{ success: boolean; deletedWorkItemId: string }>(
    `/api/projects/${projectId}/work-items/${workItemId}`,
    { method: "DELETE" },
    options,
  );
}

// ---------------------------------------------------------------------------
// Workspace Organization Members API Client
// ---------------------------------------------------------------------------

export async function listOrganizationMembers(
  options?: RequestOptions,
): Promise<OrganizationMemberListResponse> {
  const data = await authenticatedFetch<unknown>(
    "/api/workspace/members",
    { method: "GET" },
    options,
  );
  return organizationMemberListResponseSchema.parse(data);
}

// ---------------------------------------------------------------------------
// CSV Export Client
// ---------------------------------------------------------------------------

export async function exportWorkItemsCsv(
  projectId: string,
  filters?: WorkItemFilters,
  options?: RequestOptions,
): Promise<Blob> {
  const token = await getActiveAccessToken(options?.token);
  const baseUrl = options?.baseUrl ?? "";
  const params = new URLSearchParams();

  if (filters?.pageId) params.set("pageId", filters.pageId);
  if (filters?.status) params.set("status", filters.status);
  if (filters?.assigneeId) params.set("assigneeId", filters.assigneeId);
  if (filters?.sourceType) params.set("sourceType", filters.sourceType);
  if (filters?.category) params.set("category", filters.category);
  if (filters?.severity) params.set("severity", filters.severity);

  const qs = params.toString();
  const url = `${baseUrl}/api/projects/${projectId}/work-items/export${qs ? `?${qs}` : ""}`;

  const headers = new Headers();
  if (token) {
    headers.set("Authorization", `Bearer ${token}`);
  }

  const res = await fetch(url, {
    method: "GET",
    headers,
  });

  if (!res.ok) {
    const errorBody = await res.json().catch(() => null);
    const code =
      errorBody?.error?.code ||
      (res.status === 401
        ? "UNAUTHENTICATED"
        : res.status === 403
          ? "FORBIDDEN"
          : "API_ERROR");
    const message = errorBody?.error?.message || `Failed to export CSV (${res.status})`;
    throw new WorkItemsApiClientError(res.status, code, message);
  }

  return res.blob();
}

export function triggerBlobDownload(blob: Blob, filename: string): void {
  const url = window.URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.style.display = "none";
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    document.body.removeChild(a);
    window.URL.revokeObjectURL(url);
  }, 100);
}

