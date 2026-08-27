import type {
  CreateMonitoredPageInput,
  CreateProjectInput,
  MonitoredPageListResponse,
  MonitoredPageResponse,
  ProjectListResponse,
  ProjectResponse,
  UpdateMonitoredPageInput,
  UpdateProjectInput,
} from "@pagepilot/contracts";
import {
  monitoredPageListResponseSchema,
  monitoredPageResponseSchema,
  projectListResponseSchema,
  projectResponseSchema,
} from "@pagepilot/contracts";
import { getSupabaseClient } from "../auth/supabase-client.js";

export interface RequestOptions {
  token?: string;
  baseUrl?: string;
}

export class ProjectApiClientError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "ProjectApiClientError";
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
    const code = errorObj?.code || (res.status === 401 ? "UNAUTHENTICATED" : res.status === 403 ? "FORBIDDEN" : res.status === 404 ? "NOT_FOUND" : "REQUEST_FAILED");
    const message = errorObj?.message || `Request failed with status ${res.status}`;
    throw new ProjectApiClientError(res.status, code, message);
  }

  return body as T;
}

// ---------------------------------------------------------------------------
// Projects API Client
// ---------------------------------------------------------------------------

export async function listProjects(options?: RequestOptions): Promise<ProjectListResponse> {
  const data = await authenticatedFetch<unknown>("/api/projects", { method: "GET" }, options);
  return projectListResponseSchema.parse(data);
}

export async function createProject(
  input: CreateProjectInput,
  options?: RequestOptions,
): Promise<ProjectResponse> {
  const data = await authenticatedFetch<unknown>(
    "/api/projects",
    {
      method: "POST",
      body: JSON.stringify(input),
    },
    options,
  );
  return projectResponseSchema.parse(data);
}

export async function getProject(
  projectId: string,
  options?: RequestOptions,
): Promise<ProjectResponse> {
  const data = await authenticatedFetch<unknown>(
    `/api/projects/${projectId}`,
    { method: "GET" },
    options,
  );
  return projectResponseSchema.parse(data);
}

export async function updateProject(
  projectId: string,
  input: UpdateProjectInput,
  options?: RequestOptions,
): Promise<ProjectResponse> {
  const data = await authenticatedFetch<unknown>(
    `/api/projects/${projectId}`,
    {
      method: "PATCH",
      body: JSON.stringify(input),
    },
    options,
  );
  return projectResponseSchema.parse(data);
}

export async function deleteProject(
  projectId: string,
  options?: RequestOptions,
): Promise<{ success: boolean; deletedProjectId: string }> {
  return authenticatedFetch<{ success: boolean; deletedProjectId: string }>(
    `/api/projects/${projectId}`,
    { method: "DELETE" },
    options,
  );
}

// ---------------------------------------------------------------------------
// Monitored Pages API Client
// ---------------------------------------------------------------------------

export async function listMonitoredPages(
  projectId: string,
  options?: RequestOptions,
): Promise<MonitoredPageListResponse> {
  const data = await authenticatedFetch<unknown>(
    `/api/projects/${projectId}/pages`,
    { method: "GET" },
    options,
  );
  return monitoredPageListResponseSchema.parse(data);
}

export async function createMonitoredPage(
  projectId: string,
  input: CreateMonitoredPageInput,
  options?: RequestOptions,
): Promise<MonitoredPageResponse> {
  const data = await authenticatedFetch<unknown>(
    `/api/projects/${projectId}/pages`,
    {
      method: "POST",
      body: JSON.stringify(input),
    },
    options,
  );
  return monitoredPageResponseSchema.parse(data);
}

export async function getMonitoredPage(
  projectId: string,
  pageId: string,
  options?: RequestOptions,
): Promise<MonitoredPageResponse> {
  const data = await authenticatedFetch<unknown>(
    `/api/projects/${projectId}/pages/${pageId}`,
    { method: "GET" },
    options,
  );
  return monitoredPageResponseSchema.parse(data);
}

export async function updateMonitoredPage(
  projectId: string,
  pageId: string,
  input: UpdateMonitoredPageInput,
  options?: RequestOptions,
): Promise<MonitoredPageResponse> {
  const data = await authenticatedFetch<unknown>(
    `/api/projects/${projectId}/pages/${pageId}`,
    {
      method: "PATCH",
      body: JSON.stringify(input),
    },
    options,
  );
  return monitoredPageResponseSchema.parse(data);
}

export async function deleteMonitoredPage(
  projectId: string,
  pageId: string,
  options?: RequestOptions,
): Promise<{ success: boolean; deletedPageId: string }> {
  return authenticatedFetch<{ success: boolean; deletedPageId: string }>(
    `/api/projects/${projectId}/pages/${pageId}`,
    { method: "DELETE" },
    options,
  );
}
