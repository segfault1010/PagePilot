import { Router } from "express";
import type { Request, Response } from "express";
import { API_ERROR_CODES } from "@pagepilot/contracts";
import { requireOrgRole } from "../auth/middleware.js";
import type { ScreenshotsStore } from "./screenshots-store.js";
import { SupabaseScreenshotsStore } from "./screenshots-store.js";
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

export interface ScreenshotsRouterOptions {
  getStore?: (req: Request) => ScreenshotsStore;
  getProjectsStore?: (req: Request) => ProjectsStore;
}

export function createScreenshotsRouter(
  options: ScreenshotsRouterOptions = {}
): Router {
  const router = Router({ mergeParams: true });

  const getStore =
    options.getStore ??
    ((req: Request) => new SupabaseScreenshotsStore(undefined, req.authToken));

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
      console.error("[screenshots] verify scope error:", err);
      sendError(res, 500, API_ERROR_CODES.internalError, "Internal error.");
    }
  }

  router.use(verifyPageScope);

  // =========================================================================
  // GET /api/projects/:projectId/pages/:pageId/audits/:auditRunId/screenshots
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
        const screenshots = await store.getScreenshotsForAuditRun({
          organizationId: orgId,
          projectId,
          pageId,
          auditRunId,
          generateSignedUrls: true,
        });

        res.status(200).json({ screenshots });
      } catch (err) {
        console.error("[screenshots] fetch error:", err);
        sendError(
          res,
          500,
          API_ERROR_CODES.internalError,
          "Failed to fetch screenshots."
        );
      }
    }
  );

  return router;
}
