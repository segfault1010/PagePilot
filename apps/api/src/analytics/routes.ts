import { Router } from "express";
import type { Request, Response } from "express";
import {
  API_ERROR_CODES,
  createPageAnalyticsSchema,
} from "@pagepilot/contracts";
import { requireOrgRole } from "../auth/middleware.js";
import type { AnalyticsStore } from "./analytics-store.js";
import { SupabaseAnalyticsStore } from "./analytics-store.js";
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

export interface AnalyticsRouterOptions {
  getStore?: (req: Request) => AnalyticsStore;
  getProjectsStore?: (req: Request) => ProjectsStore;
}

export function createAnalyticsRouter(
  options: AnalyticsRouterOptions = {},
): Router {
  const router = Router({ mergeParams: true });

  const getStore =
    options.getStore ??
    ((req: Request) => new SupabaseAnalyticsStore(undefined, req.authToken));

  const getProjectsStore =
    options.getProjectsStore ??
    ((req: Request) => new SupabaseProjectsStore(undefined, req.authToken));

  function sendError(
    res: Response,
    status: number,
    code: string,
    message: string,
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
    next: () => void,
  ): Promise<void> {
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
    try {
      const pStore = getProjectsStore(req);
      const page = await pStore.getMonitoredPageById(orgId, projectId, pageId);
      if (!page) {
        sendError(res, 404, API_ERROR_CODES.notFound, "Monitored page not found.");
        return;
      }
      next();
    } catch (err) {
      console.error("[analytics] verify page scope error:", err);
      sendError(res, 500, API_ERROR_CODES.internalError, "Internal error.");
    }
  }

  router.use(verifyPageScope);

  // =========================================================================
  // 1. GET /api/projects/:projectId/pages/:pageId/analytics (all roles)
  // =========================================================================
  router.get(
    "/",
    requireOrgRole(["owner", "admin", "member", "viewer"]),
    async (req: Request, res: Response): Promise<void> => {
      const projectId = getParam(req, "projectId");
      const pageId = getParam(req, "pageId");
      const orgId = req.workspace!.organization.id;

      try {
        const store = getStore(req);
        const current = await store.getActiveSnapshot(orgId, projectId, pageId);
        const history = await store.listSnapshots(orgId, projectId, pageId);

        res.status(200).json({
          current,
          history,
          total: history.length,
        });
      } catch (err) {
        console.error("[analytics] getActiveSnapshot error:", err);
        sendError(
          res,
          500,
          API_ERROR_CODES.internalError,
          "Failed to retrieve page analytics.",
        );
      }
    },
  );

  // =========================================================================
  // 2. POST /api/projects/:projectId/pages/:pageId/analytics (owner, admin, member)
  // =========================================================================
  router.post(
    "/",
    requireOrgRole(["owner", "admin", "member"]),
    async (req: Request, res: Response): Promise<void> => {
      const projectId = getParam(req, "projectId");
      const pageId = getParam(req, "pageId");
      const orgId = req.workspace!.organization.id;
      const userId = req.user!.id;
      const userName =
        req.workspace?.profile?.fullName ||
        req.workspace?.profile?.email ||
        undefined;

      const parseResult = createPageAnalyticsSchema.safeParse(req.body);
      if (!parseResult.success) {
        sendError(
          res,
          400,
          API_ERROR_CODES.badRequest,
          parseResult.error.issues[0]?.message ||
            "Invalid page analytics input data.",
        );
        return;
      }

      try {
        const store = getStore(req);
        const created = await store.createSnapshot(
          orgId,
          projectId,
          pageId,
          userId,
          parseResult.data,
          userName,
        );

        res.status(201).json({
          analytics: created,
        });
      } catch (err) {
        console.error("[analytics] createSnapshot error:", err);
        sendError(
          res,
          500,
          API_ERROR_CODES.internalError,
          "Failed to import page analytics.",
        );
      }
    },
  );

  // =========================================================================
  // 3. DELETE /api/projects/:projectId/pages/:pageId/analytics/:snapshotId (owner, admin)
  // =========================================================================
  router.delete(
    "/:snapshotId",
    requireOrgRole(["owner", "admin"]),
    async (req: Request, res: Response): Promise<void> => {
      const projectId = getParam(req, "projectId");
      const pageId = getParam(req, "pageId");
      const snapshotId = getParam(req, "snapshotId");
      const orgId = req.workspace!.organization.id;

      if (!snapshotId || !isValidUuid(snapshotId)) {
        sendError(
          res,
          404,
          API_ERROR_CODES.notFound,
          "Analytics snapshot not found.",
        );
        return;
      }

      try {
        const store = getStore(req);
        const success = await store.deleteSnapshot(
          orgId,
          projectId,
          pageId,
          snapshotId,
        );

        if (!success) {
          sendError(
            res,
            404,
            API_ERROR_CODES.notFound,
            "Analytics snapshot not found.",
          );
          return;
        }

        res.status(200).json({ success: true });
      } catch (err) {
        console.error("[analytics] deleteSnapshot error:", err);
        sendError(
          res,
          500,
          API_ERROR_CODES.internalError,
          "Failed to delete analytics snapshot.",
        );
      }
    },
  );

  return router;
}
