import { Router } from "express";
import type { Request, Response } from "express";
import {
  API_ERROR_CODES,
  createMonitoredPageSchema,
  createProjectSchema,
  updateMonitoredPageSchema,
  updateProjectSchema,
} from "@pagepilot/contracts";
import { requireOrgRole } from "../auth/middleware.js";
import {
  DuplicateResourceError,
  SupabaseProjectsStore,
} from "./projects-store.js";
import type { ProjectsStore } from "./projects-store.js";
import { createAuditsRouter } from "../audits/routes.js";
import type { AuditPersistenceStore } from "../audits/audit-store.js";
import type { AnalysisOutcome } from "@pagepilot/audit-engine";
import { createWorkItemsRouter } from "../work-items/routes.js";
import type { WorkItemsStore } from "../work-items/work-items-store.js";
import { createShareRouter } from "../share/routes.js";
import type { SharePersistenceStore } from "../share/share-store.js";
import { createIntegrationsRouter } from "../integrations/routes.js";
import type { IntegrationsStore } from "../integrations/integrations-store.js";
import { createAnalyticsRouter } from "../analytics/routes.js";
import type { AnalyticsStore } from "../analytics/analytics-store.js";

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

import type { DnsResolver } from "@pagepilot/audit-engine";

export interface ProjectRoutesOptions {
  getStore?: (req: Request) => ProjectsStore;
  getAuditStore?: (req: Request) => AuditPersistenceStore;
  getWorkItemsStore?: (req: Request) => WorkItemsStore;
  getShareStore?: (req: Request) => SharePersistenceStore;
  getIntegrationsStore?: (req: Request) => IntegrationsStore;
  getAnalyticsStore?: (req: Request) => AnalyticsStore;
  dnsResolver?: DnsResolver;
  analyzeUrl?: (url: string) => Promise<AnalysisOutcome>;
}

export function createProjectsRouter(options: ProjectRoutesOptions = {}): Router {
  const router = Router();
  const getStore =
    options.getStore ??
    ((req: Request) => new SupabaseProjectsStore(undefined, req.authToken));

  // Helper to send typed errors
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

  // =========================================================================
  // 1. Projects CRUD
  // =========================================================================

  // POST /api/projects (owner, admin, member)
  router.post(
    "/",
    requireOrgRole(["owner", "admin", "member"]),
    async (req: Request, res: Response): Promise<void> => {
      const orgId = req.workspace!.organization.id;
      const userId = req.user!.id;

      const parseResult = createProjectSchema.safeParse(req.body);
      if (!parseResult.success) {
        sendError(
          res,
          400,
          API_ERROR_CODES.badRequest,
          parseResult.error.issues[0]?.message || "Invalid project data.",
        );
        return;
      }

      try {
        const store = getStore(req);
        const project = await store.createProject(orgId, userId, parseResult.data);
        res.status(201).json({ project });
      } catch (err: any) {
        console.error("[projects] create error:", err);
        sendError(
          res,
          500,
          API_ERROR_CODES.internalError,
          "Failed to create project.",
        );
      }
    },
  );

  // GET /api/projects (owner, admin, member, viewer)
  router.get(
    "/",
    requireOrgRole(["owner", "admin", "member", "viewer"]),
    async (req: Request, res: Response): Promise<void> => {
      const orgId = req.workspace!.organization.id;

      try {
        const store = getStore(req);
        const projects = await store.listProjects(orgId);
        res.status(200).json({
          projects,
          total: projects.length,
        });
      } catch (err: any) {
        console.error("[projects] list error:", err);
        sendError(
          res,
          500,
          API_ERROR_CODES.internalError,
          "Failed to list projects.",
        );
      }
    },
  );

  // GET /api/projects/:projectId (owner, admin, member, viewer)
  router.get(
    "/:projectId",
    requireOrgRole(["owner", "admin", "member", "viewer"]),
    async (req: Request, res: Response): Promise<void> => {
      const projectId = getParam(req, "projectId");
      if (!projectId || !isValidUuid(projectId)) {
        sendError(res, 404, API_ERROR_CODES.notFound, "Project not found.");
        return;
      }

      const orgId = req.workspace!.organization.id;
      try {
        const store = getStore(req);
        const project = await store.getProjectById(orgId, projectId);
        if (!project) {
          sendError(res, 404, API_ERROR_CODES.notFound, "Project not found.");
          return;
        }
        res.status(200).json({ project });
      } catch (err: any) {
        console.error("[projects] get error:", err);
        sendError(
          res,
          500,
          API_ERROR_CODES.internalError,
          "Failed to retrieve project.",
        );
      }
    },
  );

  // PATCH /api/projects/:projectId (owner, admin, member)
  router.patch(
    "/:projectId",
    requireOrgRole(["owner", "admin", "member"]),
    async (req: Request, res: Response): Promise<void> => {
      const projectId = getParam(req, "projectId");
      if (!projectId || !isValidUuid(projectId)) {
        sendError(res, 404, API_ERROR_CODES.notFound, "Project not found.");
        return;
      }

      const parseResult = updateProjectSchema.safeParse(req.body);
      if (!parseResult.success) {
        sendError(
          res,
          400,
          API_ERROR_CODES.badRequest,
          parseResult.error.issues[0]?.message || "Invalid update data.",
        );
        return;
      }

      const orgId = req.workspace!.organization.id;
      try {
        const store = getStore(req);
        const project = await store.updateProject(
          orgId,
          projectId,
          parseResult.data,
        );
        if (!project) {
          sendError(res, 404, API_ERROR_CODES.notFound, "Project not found.");
          return;
        }
        res.status(200).json({ project });
      } catch (err: any) {
        console.error("[projects] update error:", err);
        sendError(
          res,
          500,
          API_ERROR_CODES.internalError,
          "Failed to update project.",
        );
      }
    },
  );

  // DELETE /api/projects/:projectId (owner, admin ONLY — member returns 403)
  router.delete(
    "/:projectId",
    requireOrgRole(["owner", "admin"]),
    async (req: Request, res: Response): Promise<void> => {
      const projectId = getParam(req, "projectId");
      if (!projectId || !isValidUuid(projectId)) {
        sendError(res, 404, API_ERROR_CODES.notFound, "Project not found.");
        return;
      }

      const orgId = req.workspace!.organization.id;
      try {
        const store = getStore(req);
        const deleted = await store.deleteProject(orgId, projectId);
        if (!deleted) {
          sendError(res, 404, API_ERROR_CODES.notFound, "Project not found.");
          return;
        }
        res.status(200).json({
          success: true,
          deletedProjectId: projectId,
        });
      } catch (err: any) {
        console.error("[projects] delete error:", err);
        sendError(
          res,
          500,
          API_ERROR_CODES.internalError,
          "Failed to delete project.",
        );
      }
    },
  );

  // =========================================================================
  // 2. Monitored Pages CRUD (Nested under /:projectId/pages)
  // =========================================================================

  // POST /api/projects/:projectId/pages (owner, admin, member)
  router.post(
    "/:projectId/pages",
    requireOrgRole(["owner", "admin", "member"]),
    async (req: Request, res: Response): Promise<void> => {
      const projectId = getParam(req, "projectId");
      if (!projectId || !isValidUuid(projectId)) {
        sendError(res, 404, API_ERROR_CODES.notFound, "Project not found.");
        return;
      }

      const orgId = req.workspace!.organization.id;
      const userId = req.user!.id;
      const store = getStore(req);

      // Verify project exists in org
      const project = await store.getProjectById(orgId, projectId);
      if (!project) {
        sendError(res, 404, API_ERROR_CODES.notFound, "Project not found.");
        return;
      }

      const parseResult = createMonitoredPageSchema.safeParse(req.body);
      if (!parseResult.success) {
        sendError(
          res,
          400,
          API_ERROR_CODES.badRequest,
          parseResult.error.issues[0]?.message || "Invalid monitored page data.",
        );
        return;
      }

      try {
        const page = await store.createMonitoredPage(
          orgId,
          projectId,
          userId,
          parseResult.data,
        );
        res.status(201).json({ page });
      } catch (err: any) {
        if (err instanceof DuplicateResourceError) {
          sendError(res, 409, API_ERROR_CODES.conflict, err.message);
          return;
        }
        console.error("[monitored_pages] create error:", err);
        sendError(
          res,
          500,
          API_ERROR_CODES.internalError,
          "Failed to register monitored page.",
        );
      }
    },
  );

  // GET /api/projects/:projectId/pages (owner, admin, member, viewer)
  router.get(
    "/:projectId/pages",
    requireOrgRole(["owner", "admin", "member", "viewer"]),
    async (req: Request, res: Response): Promise<void> => {
      const projectId = getParam(req, "projectId");
      if (!projectId || !isValidUuid(projectId)) {
        sendError(res, 404, API_ERROR_CODES.notFound, "Project not found.");
        return;
      }

      const orgId = req.workspace!.organization.id;
      const store = getStore(req);

      const project = await store.getProjectById(orgId, projectId);
      if (!project) {
        sendError(res, 404, API_ERROR_CODES.notFound, "Project not found.");
        return;
      }

      try {
        const pages = await store.listMonitoredPages(orgId, projectId);
        res.status(200).json({
          pages,
          total: pages.length,
        });
      } catch (err: any) {
        console.error("[monitored_pages] list error:", err);
        sendError(
          res,
          500,
          API_ERROR_CODES.internalError,
          "Failed to list monitored pages.",
        );
      }
    },
  );

  // GET /api/projects/:projectId/pages/:pageId (owner, admin, member, viewer)
  router.get(
    "/:projectId/pages/:pageId",
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
        sendError(
          res,
          404,
          API_ERROR_CODES.notFound,
          "Monitored page not found.",
        );
        return;
      }

      const orgId = req.workspace!.organization.id;
      try {
        const store = getStore(req);
        const page = await store.getMonitoredPageById(
          orgId,
          projectId,
          pageId,
        );
        if (!page) {
          sendError(
            res,
            404,
            API_ERROR_CODES.notFound,
            "Monitored page not found.",
          );
          return;
        }
        res.status(200).json({ page });
      } catch (err: any) {
        console.error("[monitored_pages] get error:", err);
        sendError(
          res,
          500,
          API_ERROR_CODES.internalError,
          "Failed to retrieve monitored page.",
        );
      }
    },
  );

  // PATCH /api/projects/:projectId/pages/:pageId (owner, admin, member)
  router.patch(
    "/:projectId/pages/:pageId",
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
        sendError(
          res,
          404,
          API_ERROR_CODES.notFound,
          "Monitored page not found.",
        );
        return;
      }

      const parseResult = updateMonitoredPageSchema.safeParse(req.body);
      if (!parseResult.success) {
        sendError(
          res,
          400,
          API_ERROR_CODES.badRequest,
          parseResult.error.issues[0]?.message || "Invalid update data.",
        );
        return;
      }

      const orgId = req.workspace!.organization.id;
      try {
        const store = getStore(req);
        const page = await store.updateMonitoredPage(
          orgId,
          projectId,
          pageId,
          parseResult.data,
        );
        if (!page) {
          sendError(
            res,
            404,
            API_ERROR_CODES.notFound,
            "Monitored page not found.",
          );
          return;
        }
        res.status(200).json({ page });
      } catch (err: any) {
        if (err instanceof DuplicateResourceError) {
          sendError(res, 409, API_ERROR_CODES.conflict, err.message);
          return;
        }
        console.error("[monitored_pages] update error:", err);
        sendError(
          res,
          500,
          API_ERROR_CODES.internalError,
          "Failed to update monitored page.",
        );
      }
    },
  );

  // DELETE /api/projects/:projectId/pages/:pageId (owner, admin, member)
  router.delete(
    "/:projectId/pages/:pageId",
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
        sendError(
          res,
          404,
          API_ERROR_CODES.notFound,
          "Monitored page not found.",
        );
        return;
      }

      const orgId = req.workspace!.organization.id;
      try {
        const store = getStore(req);
        const deleted = await store.deleteMonitoredPage(
          orgId,
          projectId,
          pageId,
        );
        if (!deleted) {
          sendError(
            res,
            404,
            API_ERROR_CODES.notFound,
            "Monitored page not found.",
          );
          return;
        }
        res.status(200).json({
          success: true,
          deletedPageId: pageId,
        });
      } catch (err: any) {
        console.error("[monitored_pages] delete error:", err);
        sendError(
          res,
          500,
          API_ERROR_CODES.internalError,
          "Failed to delete monitored page.",
        );
      }
    },
  );

  // =========================================================================
  // 3. Monitored Page Audits & History (Nested under /:projectId/pages/:pageId/audits)
  // =========================================================================
  router.use(
    "/:projectId/pages/:pageId/audits",
    createAuditsRouter({
      getProjectsStore: getStore,
      getAuditStore: options.getAuditStore,
      analyzeUrl: options.analyzeUrl,
    }),
  );

  // =========================================================================
  // 4. Collaborative Work Items (Nested under /:projectId/work-items)
  // =========================================================================
  router.use(
    "/:projectId/work-items",
    createWorkItemsRouter({
      getStore: options.getWorkItemsStore,
      getProjectsStore: getStore,
    }),
  );

  // =========================================================================
  // 5. External Messaging & Webhook Integrations (Nested under /:projectId/integrations)
  // =========================================================================
  router.use(
    "/:projectId/integrations",
    createIntegrationsRouter({
      getStore: options.getIntegrationsStore,
      getProjectsStore: getStore,
      dnsResolver: options.dnsResolver,
    }),
  );

  // =========================================================================
  // 6. Report Share Links (Nested under /:projectId)
  // =========================================================================
  router.use(
    "/:projectId",
    createShareRouter({
      getProjectsStore: getStore,
      getAuditStore: options.getAuditStore,
      getShareStore: options.getShareStore,
    }),
  );

  // =========================================================================
  // 7. Page Analytics (Nested under /:projectId/pages/:pageId/analytics)
  // =========================================================================
  router.use(
    "/:projectId/pages/:pageId/analytics",
    createAnalyticsRouter({
      getStore: options.getAnalyticsStore,
      getProjectsStore: getStore,
    }),
  );

  return router;
}

