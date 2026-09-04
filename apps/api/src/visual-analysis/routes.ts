import { Router } from "express";
import type { Request, Response } from "express";
import { API_ERROR_CODES } from "@pagepilot/contracts";
import { requireOrgRole } from "../auth/middleware.js";
import type { VisualAnalysisStore } from "./visual-analysis-store.js";
import { SupabaseVisualAnalysisStore } from "./visual-analysis-store.js";
import type { ProjectsStore } from "../projects/projects-store.js";
import { SupabaseProjectsStore } from "../projects/projects-store.js";

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

export interface VisualAnalysisRouterOptions {
  getStore?: (req: Request) => VisualAnalysisStore;
  getProjectsStore?: (req: Request) => ProjectsStore;
}

export function createVisualAnalysisRouter(
  options: VisualAnalysisRouterOptions = {}
): Router {
  const router = Router({ mergeParams: true });

  const getStore =
    options.getStore ??
    ((req: Request) =>
      new SupabaseVisualAnalysisStore(undefined, req.authToken));

  const getProjectsStore =
    options.getProjectsStore ??
    ((req: Request) => new SupabaseProjectsStore(undefined, req.authToken));

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

  // Middleware: verify project and page exist and belong to current tenant organization
  async function verifyPageScope(
    req: Request,
    res: Response,
    next: () => void
  ): Promise<void> {
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
      next();
    } catch (err) {
      console.error("[visual-analysis] verify scope error:", err);
      sendError(res, 500, API_ERROR_CODES.internalError, "Internal error.");
    }
  }

  router.use(verifyPageScope);

  // =========================================================================
  // GET /api/projects/:projectId/pages/:pageId/audits/:auditRunId/visual-analysis
  // =========================================================================
  router.get(
    "/",
    requireOrgRole(["owner", "admin", "member", "viewer"]),
    async (req: Request, res: Response): Promise<void> => {
      const projectId = getParam(req, "projectId");
      const pageId = getParam(req, "pageId");
      const auditRunId = getParam(req, "auditRunId");
      const orgId = req.workspace!.organization.id;

      try {
        const store = getStore(req);
        const visualAnalysis = await store.getVisualReviewForAuditRun({
          organizationId: orgId,
          projectId,
          pageId,
          auditRunId,
        });

        res.status(200).json({ visualAnalysis });
      } catch (err) {
        console.error("[visual-analysis] fetch error:", err);
        sendError(
          res,
          500,
          API_ERROR_CODES.internalError,
          "Failed to fetch visual analysis review."
        );
      }
    }
  );

  return router;
}
