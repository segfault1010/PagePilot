import type {
  CreateShareLinkInput,
  CreateShareLinkResponse,
  ShareLinkMetadata,
  SharedAuditReportResponse,
} from "@pagepilot/contracts";
import { getSupabaseClient } from "../auth/supabase-client";

async function getAuthHeaders(): Promise<Record<string, string>> {
  const supabase = getSupabaseClient();
  if (!supabase) {
    return { "Content-Type": "application/json" };
  }
  const session = (await supabase.auth.getSession()).data.session;
  const token = session?.access_token;
  return {
    "Content-Type": "application/json",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

/**
 * Creates a new read-only share link for a historical audit run.
 */
export async function createShareLink(
  projectId: string,
  pageId: string,
  auditRunId: string,
  input: CreateShareLinkInput = {},
): Promise<CreateShareLinkResponse> {
  const headers = await getAuthHeaders();
  const res = await fetch(
    `/api/projects/${projectId}/pages/${pageId}/audits/${auditRunId}/share`,
    {
      method: "POST",
      headers,
      body: JSON.stringify(input),
    },
  );

  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error?.message || "Failed to create share link.");
  }

  return data as CreateShareLinkResponse;
}

/**
 * Retrieves the active share link metadata for an audit run (if any).
 */
export async function getActiveShareLink(
  projectId: string,
  pageId: string,
  auditRunId: string,
): Promise<ShareLinkMetadata | null> {
  const headers = await getAuthHeaders();
  const res = await fetch(
    `/api/projects/${projectId}/pages/${pageId}/audits/${auditRunId}/share`,
    {
      method: "GET",
      headers,
    },
  );

  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error?.message || "Failed to retrieve share status.");
  }

  return data.shareLink as ShareLinkMetadata | null;
}

/**
 * Revokes a report share link by ID.
 */
export async function revokeShareLink(
  projectId: string,
  shareId: string,
): Promise<boolean> {
  const headers = await getAuthHeaders();
  const res = await fetch(`/api/projects/${projectId}/share-links/${shareId}`, {
    method: "DELETE",
    headers,
  });

  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error?.message || "Failed to revoke share link.");
  }

  return Boolean(data.success);
}

/**
 * Public unauthenticated resolver for a shared report by opaque bearer token.
 */
export async function getPublicSharedReport(
  token: string,
): Promise<SharedAuditReportResponse> {
  const res = await fetch(`/api/shared/reports/${encodeURIComponent(token)}`, {
    method: "GET",
    headers: {
      "Content-Type": "application/json",
    },
  });

  const data = await res.json();
  if (!res.ok) {
    const error = new Error(
      data.error?.message || "This report link is no longer available.",
    );
    (error as any).status = res.status;
    (error as any).code = data.error?.code;
    throw error;
  }

  return data as SharedAuditReportResponse;
}
