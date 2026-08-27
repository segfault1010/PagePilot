import { Router } from "express";
import type { Request, Response } from "express";
import {
  API_ERROR_CODES,
  triggerAuditRequestSchema,
} from "@pagepilot/contracts";
import type { AnalysisOutcome } from "@pagepilot/audit-engine";
import { requireOrgRole } from "../auth/middleware.js";
import { SupabaseProjectsStore } from "../projects/projects-store.js";
import type { ProjectsStore } from "../projects/projects-store.js";
import { AuditService } from "./audit-service.js";
import { SupabaseAuditPersistenceStore } from "./audit-store.js";
import type { AuditPersistenceStore } from "./audit-store.js";

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

export interface AuditRoutesOptions {
  getProjectsStore?: (req: Request) => ProjectsStore;
  getAuditStore?: (req: Request) => AuditPersistenceStore;
  analyzeUrl?: (url: string) => Promise<AnalysisOutcome>;
}

export function createAuditsRouter(options: AuditRoutesOptions = {}): Router {
  const router = Router({ mergeParams: true });

  const getProjectsStore =
    options.getProjectsStore ??
    ((req: Request) => new SupabaseProjectsStore(undefined, req.authToken));

  const getAuditStore =
    options.getAuditStore ??
    ((req: Request) => new SupabaseAuditPersistenceStore(undefined, req.authToken));

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

  // 1. POST /api/projects/:projectId/pages/:pageId/audits (owner, admin, member)
  router.post(
    "/",
    requireOrgRole(["owner", "admin", "member"]),
    async (req: Request, res: Response): Promise<void> => {
      const projectId = getParam(req, "projectId");
      const pageId = getParam(req, "pageId");
      if (
        !projectId ||
        !isValidUuid(projectId) ||
        !pageId ||
        !isValidUuid(pageId)
      ) {
        sendError(res, 404, API_ERROR_CODES.notFound, "Monitored page not found.");
        return;
      }

      const parseResult = triggerAuditRequestSchema.safeParse(req.body || {});
      if (!parseResult.success) {
        sendError(
          res,
          400,
          API_ERROR_CODES.badRequest,
          parseResult.error.issues[0]?.message || "Invalid audit request data.",
        );
        return;
      }

      const orgId = req.workspace!.organization.id;
      const userId = req.user!.id;
      const projectsStore = getProjectsStore(req);
      const auditStore = getAuditStore(req);

      const service = new AuditService({
        projectsStore,
        auditStore,
        analyzeUrl: options.analyzeUrl,
      });

      try {
        const result = await service.executeManualAudit(
          orgId,
          projectId,
          pageId,
          userId,
          parseResult.data.idempotencyKey,
        );

        if ("error" in result) {
          sendError(
            res,
            result.status,
            result.error.code,
            result.error.message,
            result.error.retryable,
          );
          return;
        }

        res.status(result.status).json({
          auditRun: result.auditRun,
          report: result.report,
          auditReportId: result.auditReportId,
          isIdempotentReplay: result.isIdempotentReplay,
        });
      } catch (err: any) {
        console.error("[audits] route handler error:", err);
        sendError(
          res,
          500,
          API_ERROR_CODES.internalError,
          "Failed to execute manual audit.",
        );
      }
    },
  );

  // 2. GET /api/projects/:projectId/pages/:pageId/audits (owner, admin, member, viewer)
  router.get(
    "/",
    requireOrgRole(["owner", "admin", "member", "viewer"]),
    async (req: Request, res: Response): Promise<void> => {
      const projectId = getParam(req, "projectId");
      const pageId = getParam(req, "pageId");
      if (
        !projectId ||
        !isValidUuid(projectId) ||
        !pageId ||
        !isValidUuid(pageId)
      ) {
        sendError(res, 404, API_ERROR_CODES.notFound, "Monitored page not found.");
        return;
      }

      const orgId = req.workspace!.organization.id;
      const projectsStore = getProjectsStore(req);
      const auditStore = getAuditStore(req);

      // Verify page belongs to project/org
      const page = await projectsStore.getMonitoredPageById(
        orgId,
        projectId,
        pageId,
      );
      if (!page) {
        sendError(res, 404, API_ERROR_CODES.notFound, "Monitored page not found.");
        return;
      }

      const limit = Math.min(
        100,
        Math.max(1, parseInt((req.query.limit as string) || "20", 10) || 20),
      );
      const offset = Math.max(
        0,
        parseInt((req.query.offset as string) || "0", 10) || 0,
      );

      try {
        const { audits, total } = await auditStore.listAuditHistory(
          orgId,
          projectId,
          pageId,
          limit,
          offset,
        );
        res.status(200).json({ audits, total });
      } catch (err: any) {
        console.error("[audits] list history error:", err);
        sendError(
          res,
          500,
          API_ERROR_CODES.internalError,
          "Failed to list audit history.",
        );
      }
    },
  );

  // 3. GET /api/projects/:projectId/pages/:pageId/audits/latest (owner, admin, member, viewer)
  router.get(
    "/latest",
    requireOrgRole(["owner", "admin", "member", "viewer"]),
    async (req: Request, res: Response): Promise<void> => {
      const projectId = getParam(req, "projectId");
      const pageId = getParam(req, "pageId");
      if (
        !projectId ||
        !isValidUuid(projectId) ||
        !pageId ||
        !isValidUuid(pageId)
      ) {
        sendError(res, 404, API_ERROR_CODES.notFound, "Monitored page not found.");
        return;
      }

      const orgId = req.workspace!.organization.id;
      const projectsStore = getProjectsStore(req);
      const auditStore = getAuditStore(req);

      // Verify page belongs to project/org
      const page = await projectsStore.getMonitoredPageById(
        orgId,
        projectId,
        pageId,
      );
      if (!page) {
        sendError(res, 404, API_ERROR_CODES.notFound, "Monitored page not found.");
        return;
      }

      try {
        const latest = await auditStore.getLatestSuccessfulAudit(
          orgId,
          projectId,
          pageId,
        );
        if (!latest) {
          sendError(
            res,
            404,
            API_ERROR_CODES.notFound,
            "No successful audit report found for this page.",
          );
          return;
        }
        res.status(200).json(latest);
      } catch (err: any) {
        console.error("[audits] get latest audit error:", err);
        sendError(
          res,
          500,
          API_ERROR_CODES.internalError,
          "Failed to retrieve latest audit report.",
        );
      }
    },
  );

  // 4. GET /api/projects/:projectId/pages/:pageId/audits/:auditRunId (owner, admin, member, viewer)
  router.get(
    "/:auditRunId",
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
        sendError(
          res,
          404,
          API_ERROR_CODES.notFound,
          "Audit report not found.",
        );
        return;
      }

      const orgId = req.workspace!.organization.id;
      const projectsStore = getProjectsStore(req);
      const auditStore = getAuditStore(req);

      // Verify page belongs to project/org
      const page = await projectsStore.getMonitoredPageById(
        orgId,
        projectId,
        pageId,
      );
      if (!page) {
        sendError(res, 404, API_ERROR_CODES.notFound, "Monitored page not found.");
        return;
      }

      try {
        const persisted = await auditStore.getAuditReportByRunId(
          orgId,
          projectId,
          pageId,
          auditRunId,
        );
        if (!persisted) {
          sendError(
            res,
            404,
            API_ERROR_CODES.notFound,
            "Audit report not found.",
          );
          return;
        }
        res.status(200).json(persisted);
      } catch (err: any) {
        console.error("[audits] get audit report error:", err);
        sendError(
          res,
          500,
          API_ERROR_CODES.internalError,
          "Failed to retrieve audit report.",
        );
      }
    },
  );

  return router;
}
