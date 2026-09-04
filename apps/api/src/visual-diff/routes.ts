import { Router } from "express";
import type { Request, Response } from "express";
import { API_ERROR_CODES } from "@pagepilot/contracts";
import { requireOrgRole } from "../auth/middleware.js";
import type { VisualDiffStore } from "./visual-diff-store.js";
import { SupabaseVisualDiffStore } from "./visual-diff-store.js";
import type { ProjectsStore } from "../projects/projects-store.js";
import { SupabaseProjectsStore } from "../projects/projects-store.js";
import type { AuditPersistenceStore } from "../audits/audit-store.js";
import { SupabaseAuditPersistenceStore } from "../audits/audit-store.js";

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isValidUuid(val: string): boolean {
  return UUID_REGEX.test(val);
}

function getParam(req: Request, name: string): string {
  const val = req.params[name];
  if (typeof val === "string") return val;
  if (Array.isArray(val) && typeof val[0] === "string") return val[0];
  return "";
}

export interface VisualDiffRouterOptions {
  getStore?: (req: Request) => VisualDiffStore;
  getProjectsStore?: (req: Request) => ProjectsStore;
  getAuditStore?: (req: Request) => AuditPersistenceStore;
}

export function createVisualDiffRouter(
  options: VisualDiffRouterOptions = {}
): Router {
  const router = Router({ mergeParams: true });

  const getStore =
    options.getStore ??
    ((req: Request) => new SupabaseVisualDiffStore(undefined, req.authToken));

  const getProjectsStore =
    options.getProjectsStore ??
    ((req: Request) => new SupabaseProjectsStore(undefined, req.authToken));

  const getAuditStore =
    options.getAuditStore ??
    ((req: Request) =>
      new SupabaseAuditPersistenceStore(undefined, req.authToken));

  function sendError(
    res: Response,
    status: number,
    code: string,
    message: string
  ) {
    res.status(status).json({
      error: {
        code,
        message,
        retryable: false,
      },
    });
  }

  // Middleware: verify project, page, and audit run exist and belong to current tenant organization
  async function verifyPageScope(
    req: Request,
    res: Response,
    next: () => void
  ): Promise<void> {
    const projectId = getParam(req, "projectId");
    const pageId = getParam(req, "pageId");
    const auditRunId = getParam(req, "auditRunId");
    const compareRunId =
      typeof req.query.compareRunId === "string" ? req.query.compareRunId : "";

    if (
      !projectId ||
      !isValidUuid(projectId) ||
      !pageId ||
      !isValidUuid(pageId) ||
      !auditRunId ||
      !isValidUuid(auditRunId) ||
      (compareRunId && !isValidUuid(compareRunId))
    ) {
      sendError(res, 404, API_ERROR_CODES.notFound, "Resource not found.");
      return;
    }

    const orgId = req.workspace?.organization?.id;
    if (!orgId) {
      sendError(res, 401, API_ERROR_CODES.unauthenticated, "Workspace required.");
      return;
    }

    try {
      const pStore = getProjectsStore(req);
      const page = await pStore.getMonitoredPageById(orgId, projectId, pageId);
      if (!page) {
        sendError(res, 404, API_ERROR_CODES.notFound, "Monitored page not found.");
        return;
      }

      const aStore = getAuditStore(req);
      const audit = await aStore.getAuditReportByRunId(orgId, projectId, pageId, auditRunId);
      if (!audit) {
        sendError(res, 404, API_ERROR_CODES.notFound, "Audit run not found.");
        return;
      }

      if (compareRunId) {
        const compareAudit = await aStore.getAuditReportByRunId(
          orgId,
          projectId,
          pageId,
          compareRunId
        );
        if (!compareAudit) {
          sendError(
            res,
            404,
            API_ERROR_CODES.notFound,
            "Comparison audit run not found."
          );
          return;
        }
      }

      next();
    } catch (err) {
      console.error("[visual-diff] verify scope error:", err);
      sendError(res, 500, API_ERROR_CODES.internalError, "Internal error.");
    }
  }

  router.use(verifyPageScope);

  // =========================================================================
  // GET /api/projects/:projectId/pages/:pageId/audits/:auditRunId/visual-diff
  // =========================================================================
  router.get(
    "/",
    requireOrgRole(["owner", "admin", "member", "viewer"]),
    async (req: Request, res: Response): Promise<void> => {
      const projectId = getParam(req, "projectId");
      const pageId = getParam(req, "pageId");
      const auditRunId = getParam(req, "auditRunId");
      const compareRunId =
        typeof req.query.compareRunId === "string"
          ? req.query.compareRunId
          : undefined;
      const orgId = req.workspace!.organization.id;

      try {
        const store = getStore(req);
        const result = await store.getVisualDiffResponse({
          organizationId: orgId,
          projectId,
          pageId,
          auditRunId,
          compareRunId,
        });

        if (!result) {
          res.status(200).json({
            diffs: [],
            summary: {
              hasVisualDiff: false,
              isBaseline: true,
              isMeaningfulChange: false,
              maxChangeScore: 0,
              maxChangeSeverity: "negligible",
              desktopChangeScore: null,
              mobileChangeScore: null,
              changeReasons: [],
            },
            baselineRunId: null,
            currentRunId: auditRunId,
          });
          return;
        }

        res.status(200).json(result);
      } catch (err) {
        console.error("[visual-diff] fetch error:", err);
        sendError(
          res,
          500,
          API_ERROR_CODES.internalError,
          "Failed to fetch visual regression diff."
        );
      }
    }
  );

  return router;
}
