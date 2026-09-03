import type {
  CreateIntegrationInput,
  IntegrationConnectionListResponse,
  IntegrationConnectionResponse,
  TestIntegrationInput,
  TestIntegrationResponse,
  UpdateIntegrationInput,
} from "@pagepilot/contracts";
import {
  integrationConnectionListResponseSchema,
  integrationConnectionResponseSchema,
  testIntegrationResponseSchema,
} from "@pagepilot/contracts";
import { getSupabaseClient } from "../auth/supabase-client.js";

export interface RequestOptions {
  token?: string;
  baseUrl?: string;
}

export class IntegrationsApiClientError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "IntegrationsApiClientError";
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
              : "REQUEST_FAILED");
    const message =
      errorObj?.message || `Request failed with status ${res.status}`;
    throw new IntegrationsApiClientError(res.status, code, message);
  }

  return body as T;
}

// ---------------------------------------------------------------------------
// Integrations API Client
// ---------------------------------------------------------------------------

export async function listIntegrations(
  projectId: string,
  options?: RequestOptions,
): Promise<IntegrationConnectionListResponse> {
  const data = await authenticatedFetch<unknown>(
    `/api/projects/${projectId}/integrations`,
    { method: "GET" },
    options,
  );
  return integrationConnectionListResponseSchema.parse(data);
}

export async function getIntegration(
  projectId: string,
  integrationId: string,
  options?: RequestOptions,
): Promise<IntegrationConnectionResponse> {
  const data = await authenticatedFetch<unknown>(
    `/api/projects/${projectId}/integrations/${integrationId}`,
    { method: "GET" },
    options,
  );
  return integrationConnectionResponseSchema.parse(data);
}

export async function createIntegration(
  projectId: string,
  input: CreateIntegrationInput,
  options?: RequestOptions,
): Promise<IntegrationConnectionResponse> {
  const data = await authenticatedFetch<unknown>(
    `/api/projects/${projectId}/integrations`,
    {
      method: "POST",
      body: JSON.stringify(input),
    },
    options,
  );
  return integrationConnectionResponseSchema.parse(data);
}

export async function updateIntegration(
  projectId: string,
  integrationId: string,
  input: UpdateIntegrationInput,
  options?: RequestOptions,
): Promise<IntegrationConnectionResponse> {
  const data = await authenticatedFetch<unknown>(
    `/api/projects/${projectId}/integrations/${integrationId}`,
    {
      method: "PATCH",
      body: JSON.stringify(input),
    },
    options,
  );
  return integrationConnectionResponseSchema.parse(data);
}

export async function deleteIntegration(
  projectId: string,
  integrationId: string,
  options?: RequestOptions,
): Promise<{ success: boolean; deletedIntegrationId: string }> {
  return authenticatedFetch<{ success: boolean; deletedIntegrationId: string }>(
    `/api/projects/${projectId}/integrations/${integrationId}`,
    { method: "DELETE" },
    options,
  );
}

export async function testIntegration(
  projectId: string,
  integrationId: string,
  input?: TestIntegrationInput,
  options?: RequestOptions,
): Promise<TestIntegrationResponse> {
  const data = await authenticatedFetch<unknown>(
    `/api/projects/${projectId}/integrations/${integrationId}/test`,
    {
      method: "POST",
      body: JSON.stringify(input ?? {}),
    },
    options,
  );
  return testIntegrationResponseSchema.parse(data);
}
