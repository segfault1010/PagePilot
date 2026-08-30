import crypto from "node:crypto";
import { Router } from "express";
import type { Request, Response } from "express";
import {
  API_ERROR_CODES,
  createShareLinkRequestSchema,
  shareLinkMetadataSchema,
} from "@pagepilot/contracts";
import { requireOrgRole } from "../auth/middleware.js";
import { SupabaseProjectsStore } from "../projects/projects-store.js";
import type { ProjectsStore } from "../projects/projects-store.js";
import { SupabaseAuditPersistenceStore } from "../audits/audit-store.js";
import type { AuditPersistenceStore } from "../audits/audit-store.js";
import { SupabaseSharePersistenceStore } from "./share-store.js";
import type { SharePersistenceStore } from "./share-store.js";

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isValidUuid(val: string): boolean {
  return UUID_REGEX.test(val);
}

function getParam(req: Request, name: string): string {
  const val = req.params[name];
  if (typeof val === "string") return val;
  if (Array.isArray(val) && typeof val[0] === "string") return val[0];
  return "";
}

/**
 * Generates a cryptographically secure 256-bit random URL-safe bearer token.
 */
export function generateSecureShareToken(): string {
  return crypto.randomBytes(32).toString("base64url");
}

/**
 * Computes the SHA-256 hex digest of a bearer token.
 */
export function hashShareToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

export interface ShareRoutesOptions {
  getProjectsStore?: (req: Request) => ProjectsStore;
  getAuditStore?: (req: Request) => AuditPersistenceStore;
  getShareStore?: (req: Request) => SharePersistenceStore;
}

function sendError(
  res: Response,
  status: number,
  code: string,
  message: string,
  retryable: boolean = false,
) {
  res.status(status).json({
    error: {
      code,
      message,
      retryable,
    },
  });
}

/**
 * Router for authenticated report share link management.
 * Mounted at /api/projects/:projectId/...
 */
export function createShareRouter(options: ShareRoutesOptions = {}): Router {
  const router = Router({ mergeParams: true });

  const getProjectsStore =
    options.getProjectsStore ??
    ((req: Request) => new SupabaseProjectsStore(undefined, req.authToken));

  const getAuditStore =
    options.getAuditStore ??
    ((req: Request) => new SupabaseAuditPersistenceStore(undefined, req.authToken));

  const getShareStore =
    options.getShareStore ??
    ((req: Request) => new SupabaseSharePersistenceStore(undefined, req.authToken));

  // 1. POST /api/projects/:projectId/pages/:pageId/audits/:auditRunId/share (owner, admin, member)
  router.post(
    "/pages/:pageId/audits/:auditRunId/share",
    requireOrgRole(["owner", "admin", "member"]),
    async (req: Request, res: Response): Promise<void> => {
      const projectId = getParam(req, "projectId");
      const pageId = getParam(req, "pageId");
      const auditRunId = getParam(req, "auditRunId");

      if (
        !projectId ||
        !isValidUuid(projectId) ||
        !pageId ||
        !isValidUuid(pageId) ||
        !auditRunId ||
        !isValidUuid(auditRunId)
      ) {
        sendError(res, 404, API_ERROR_CODES.notFound, "Audit report not found.");
        return;
      }

      const parseResult = createShareLinkRequestSchema.safeParse(req.body || {});
      if (!parseResult.success) {
        sendError(
          res,
          400,
          API_ERROR_CODES.badRequest,
          parseResult.error.issues[0]?.message || "Invalid share request.",
        );
        return;
      }

      const orgId = req.workspace!.organization.id;
      const userId = req.user!.id;
      const projectsStore = getProjectsStore(req);
      const auditStore = getAuditStore(req);
      const shareStore = getShareStore(req);

      // Verify page belongs to project/org
      const page = await projectsStore.getMonitoredPageById(orgId, projectId, pageId);
      if (!page) {
        sendError(res, 404, API_ERROR_CODES.notFound, "Monitored page not found.");
        return;
      }

      // Verify audit report exists
      const persisted = await auditStore.getAuditReportByRunId(
        orgId,
        projectId,
        pageId,
        auditRunId,
      );
      if (!persisted) {
        sendError(res, 404, API_ERROR_CODES.notFound, "Audit report not found.");
        return;
      }

      try {
        const expiresInDays = parseResult.data.expiresInDays ?? 30;
        const expiresAt = new Date(Date.now() + expiresInDays * 24 * 60 * 60 * 1000).toISOString();

        const rawToken = generateSecureShareToken();
        const tokenHash = hashShareToken(rawToken);

        const created = await shareStore.createShareLink(
          orgId,
          projectId,
          pageId,
          auditRunId,
          persisted.report.id,
          userId,
          {
            tokenHash,
            expiresAt,
          },
        );

        const responsePayload = {
          shareLink: {
            id: created.id,
            shareUrl: `/shared/reports/${rawToken}`,
            token: rawToken,
            expiresAt: created.expiresAt ?? null,
            createdAt: created.createdAt,
          },
        };

        res.status(201).json(responsePayload);
      } catch (err: any) {
        console.error("[share] create share link error:", err);
        sendError(res, 500, API_ERROR_CODES.internalError, "Failed to create share link.");
      }
    },
  );

  // 2. GET /api/projects/:projectId/pages/:pageId/audits/:auditRunId/share (owner, admin, member, viewer)
  router.get(
    "/pages/:pageId/audits/:auditRunId/share",
    requireOrgRole(["owner", "admin", "member", "viewer"]),
    async (req: Request, res: Response): Promise<void> => {
      const projectId = getParam(req, "projectId");
      const pageId = getParam(req, "pageId");
      const auditRunId = getParam(req, "auditRunId");

      if (
        !projectId ||
        !isValidUuid(projectId) ||
        !pageId ||
        !isValidUuid(pageId) ||
        !auditRunId ||
        !isValidUuid(auditRunId)
      ) {
        sendError(res, 404, API_ERROR_CODES.notFound, "Audit report not found.");
        return;
      }

      const orgId = req.workspace!.organization.id;
      const projectsStore = getProjectsStore(req);
      const shareStore = getShareStore(req);

      // Verify page belongs to project/org
      const page = await projectsStore.getMonitoredPageById(orgId, projectId, pageId);
      if (!page) {
        sendError(res, 404, API_ERROR_CODES.notFound, "Monitored page not found.");
        return;
      }

      try {
        const activeShare = await shareStore.getActiveShareLinkByRunId(
          orgId,
          projectId,
          pageId,
          auditRunId,
        );

        if (!activeShare) {
          res.status(200).json({ shareLink: null });
          return;
        }

        const now = new Date();
        const isExpired = Boolean(
          activeShare.expiresAt && new Date(activeShare.expiresAt) <= now,
        );
        const isRevoked = Boolean(activeShare.revokedAt);

        const metadata = shareLinkMetadataSchema.parse({
          id: activeShare.id,
          auditRunId: activeShare.auditRunId,
          auditReportId: activeShare.auditReportId,
          expiresAt: activeShare.expiresAt ?? null,
          revokedAt: activeShare.revokedAt ?? null,
          isRevoked,
          isExpired,
          createdAt: activeShare.createdAt,
          lastAccessedAt: activeShare.lastAccessedAt ?? null,
        });

        res.status(200).json({ shareLink: metadata });
      } catch (err: any) {
        console.error("[share] get active share error:", err);
        sendError(res, 500, API_ERROR_CODES.internalError, "Failed to retrieve share status.");
      }
    },
  );

  // 3. DELETE /api/projects/:projectId/share-links/:shareId (owner, admin, member)
  router.delete(
    "/share-links/:shareId",
    requireOrgRole(["owner", "admin", "member"]),
    async (req: Request, res: Response): Promise<void> => {
      const projectId = getParam(req, "projectId");
      const shareId = getParam(req, "shareId");

      if (!projectId || !isValidUuid(projectId) || !shareId || !isValidUuid(shareId)) {
        sendError(res, 404, API_ERROR_CODES.notFound, "Share link not found.");
        return;
      }

      const orgId = req.workspace!.organization.id;
      const shareStore = getShareStore(req);

      try {
        const revoked = await shareStore.revokeShareLink(orgId, projectId, shareId);
        if (!revoked) {
          sendError(res, 404, API_ERROR_CODES.notFound, "Share link not found.");
          return;
        }

        res.status(200).json({
          success: true,
          revokedShareId: shareId,
        });
      } catch (err: any) {
        console.error("[share] revoke share link error:", err);
        sendError(res, 500, API_ERROR_CODES.internalError, "Failed to revoke share link.");
      }
    },
  );

  return router;
}

// -----------------------------------------------------------------------------
// Dedicated In-Memory Rate Limiter for Public Token Resolution
// 60 requests per 10 minutes per IP
// -----------------------------------------------------------------------------
const PUBLIC_SHARE_RATE_LIMIT_MAX = 60;
const PUBLIC_SHARE_RATE_LIMIT_WINDOW_MS = 10 * 60 * 1000;

export function makePublicShareRateLimiter() {
  const ipRateLimit = new Map<string, { count: number; windowStart: number }>();
  return (ip: string): boolean => {
    const now = Date.now();
    const entry = ipRateLimit.get(ip);
    if (!entry || now - entry.windowStart >= PUBLIC_SHARE_RATE_LIMIT_WINDOW_MS) {
      ipRateLimit.set(ip, { count: 1, windowStart: now });
      return false;
    }
    if (entry.count >= PUBLIC_SHARE_RATE_LIMIT_MAX) return true;
    entry.count += 1;
    return false;
  };
}

/**
 * Public unauthenticated handler for resolving shared reports.
 * GET /api/shared/reports/:token
 */
export function createPublicSharedReportHandler(options: {
  getShareStore?: (req: Request) => SharePersistenceStore;
  rateLimiter?: (ip: string) => boolean;
}) {
  const getShareStore =
    options.getShareStore ??
    ((_req: Request) => new SupabaseSharePersistenceStore());

  const rateLimiter = options.rateLimiter ?? makePublicShareRateLimiter();

  return async (req: Request, res: Response): Promise<void> => {
    // 1. Security Headers
    res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
    res.setHeader("Pragma", "no-cache");
    res.setHeader("Expires", "0");
    res.setHeader("X-Robots-Tag", "noindex, nofollow");
    res.setHeader("X-Content-Type-Options", "nosniff");

    // 2. Rate Limiting Check
    const ip = req.ip || req.socket.remoteAddress || "unknown";
    if (rateLimiter(ip)) {
      sendError(
        res,
        429,
        API_ERROR_CODES.rateLimited,
        "Too many requests to shared reports. Please try again later.",
        true,
      );
      return;
    }

    const token = getParam(req, "token");
    if (!token || typeof token !== "string" || token.length < 16 || token.length > 256) {
      sendError(
        res,
        404,
        API_ERROR_CODES.notFound,
        "This report link is no longer available.",
      );
      return;
    }

    const tokenHash = hashShareToken(token);
    const shareStore = getShareStore(req);

    try {
      const sharedReport = await shareStore.resolvePublicSharedReport(tokenHash);
      if (!sharedReport) {
        sendError(
          res,
          404,
          API_ERROR_CODES.notFound,
          "This report link is no longer available.",
        );
        return;
      }

      res.status(200).json(sharedReport);
    } catch (err: any) {
      console.error("[public-share] resolve error:", err);
      sendError(
        res,
        404,
        API_ERROR_CODES.notFound,
        "This report link is no longer available.",
      );
    }
  };
}
