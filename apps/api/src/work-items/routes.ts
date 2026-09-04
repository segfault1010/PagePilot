import { Router } from "express";
import type { Request, Response } from "express";
import {
  API_ERROR_CODES,
  createWorkItemSchema,
  serializeCsvRow,
  serializeWorkItemCsvRow,
  updateWorkItemSchema,
  UTF8_BOM,
  WORK_ITEM_CSV_HEADERS,
  workItemFiltersSchema,
} from "@pagepilot/contracts";

import { requireOrgRole } from "../auth/middleware.js";
import {
  DuplicateResourceError,
  InvalidAssigneeError,
  SupabaseWorkItemsStore,
} from "./work-items-store.js";
import type { WorkItemsStore } from "./work-items-store.js";
import type { ProjectsStore } from "../projects/projects-store.js";
import { SupabaseProjectsStore } from "../projects/projects-store.js";

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

export interface WorkItemsRoutesOptions {
  getStore?: (req: Request) => WorkItemsStore;
  getProjectsStore?: (req: Request) => ProjectsStore;
}

export function createWorkItemsRouter(
  options: WorkItemsRoutesOptions = {},
): Router {
  const router = Router({ mergeParams: true });
  const getStore =
    options.getStore ??
    ((req: Request) => new SupabaseWorkItemsStore(undefined, req.authToken));
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

  // =========================================================================
  // POST /api/projects/:projectId/work-items (owner, admin, member)
  // =========================================================================
  router.post(
    "/",
    requireOrgRole(["owner", "admin", "member"]),
    async (req: Request, res: Response): Promise<void> => {
      const projectId = getParam(req, "projectId");
      if (!projectId || !isValidUuid(projectId)) {
        sendError(res, 404, API_ERROR_CODES.notFound, "Project not found.");
        return;
      }

      const orgId = req.workspace!.organization.id;
      const userId = req.user!.id;

      // 1. Verify project exists in org
      const projectsStore = getProjectsStore(req);
      const project = await projectsStore.getProjectById(orgId, projectId);
      if (!project) {
        sendError(res, 404, API_ERROR_CODES.notFound, "Project not found.");
        return;
      }

      // 2. Validate input schema
      const parseResult = createWorkItemSchema.safeParse(req.body);
      if (!parseResult.success) {
        sendError(
          res,
          400,
          API_ERROR_CODES.badRequest,
          parseResult.error.issues[0]?.message || "Invalid work item data.",
        );
        return;
      }

      const store = getStore(req);

      // 3. Verify referenced finding / recommendation belongs to this project
      const sourceId =
        parseResult.data.sourceType === "finding"
          ? parseResult.data.findingId!
          : parseResult.data.recommendationId!;

      const validatedSource = await store.validateSourceEntity(
        orgId,
        projectId,
        parseResult.data.sourceType,
        sourceId,
      );

      if (!validatedSource) {
        sendError(
          res,
          404,
          API_ERROR_CODES.notFound,
          `The referenced ${parseResult.data.sourceType} was not found in this project.`,
        );
        return;
      }

      // 4. Create work item
      try {
        const workItem = await store.createWorkItem(
          orgId,
          projectId,
          userId,
          parseResult.data,
          validatedSource,
        );
        res.status(201).json({ workItem });
      } catch (err: any) {
        if (err instanceof DuplicateResourceError) {
          sendError(res, 409, API_ERROR_CODES.conflict, err.message);
          return;
        }
        if (err instanceof InvalidAssigneeError) {
          sendError(res, 400, API_ERROR_CODES.badRequest, err.message);
          return;
        }
        console.error("[work_items] create error:", err);
        sendError(
          res,
          500,
          API_ERROR_CODES.internalError,
          "Failed to create work item.",
        );
      }
    },
  );

  // =========================================================================
  // GET /api/projects/:projectId/work-items (owner, admin, member, viewer)
  // =========================================================================
  router.get(
    "/",
    requireOrgRole(["owner", "admin", "member", "viewer"]),
    async (req: Request, res: Response): Promise<void> => {
      const projectId = getParam(req, "projectId");
      if (!projectId || !isValidUuid(projectId)) {
        sendError(res, 404, API_ERROR_CODES.notFound, "Project not found.");
        return;
      }

      const orgId = req.workspace!.organization.id;
      const projectsStore = getProjectsStore(req);
      const project = await projectsStore.getProjectById(orgId, projectId);
      if (!project) {
        sendError(res, 404, API_ERROR_CODES.notFound, "Project not found.");
        return;
      }

      const filterParse = workItemFiltersSchema.safeParse(req.query);
      if (!filterParse.success) {
        sendError(
          res,
          400,
          API_ERROR_CODES.badRequest,
          filterParse.error.issues[0]?.message || "Invalid filter parameters.",
        );
        return;
      }

      try {
        const store = getStore(req);
        const result = await store.listWorkItems(
          orgId,
          projectId,
          filterParse.data,
        );
        res.status(200).json({
          workItems: result.workItems,
          total: result.total,
        });
      } catch (err: any) {
        console.error("[work_items] list error:", err);
        sendError(
          res,
          500,
          API_ERROR_CODES.internalError,
          "Failed to list work items.",
        );
      }
    },
  );

  // =========================================================================
  // GET /api/projects/:projectId/work-items/export (owner, admin, member, viewer)
  // =========================================================================
  router.get(
    "/export",
    requireOrgRole(["owner", "admin", "member", "viewer"]),
    async (req: Request, res: Response): Promise<void> => {
      const projectId = getParam(req, "projectId");
      if (!projectId || !isValidUuid(projectId)) {
        sendError(res, 404, API_ERROR_CODES.notFound, "Project not found.");
        return;
      }

      const orgId = req.workspace!.organization.id;
      const projectsStore = getProjectsStore(req);
      const project = await projectsStore.getProjectById(orgId, projectId);
      if (!project) {
        sendError(res, 404, API_ERROR_CODES.notFound, "Project not found.");
        return;
      }

      const filterParse = workItemFiltersSchema.safeParse(req.query);
      if (!filterParse.success) {
        sendError(
          res,
          400,
          API_ERROR_CODES.badRequest,
          filterParse.error.issues[0]?.message || "Invalid filter parameters.",
        );
        return;
      }

      try {
        const store = getStore(req);
        const slug = (project.name || "project")
          .toLowerCase()
          .replace(/[^a-z0-9_-]/g, "-")
          .replace(/-+/g, "-")
          .slice(0, 40);
        const dateStr = new Date().toISOString().split("T")[0];
        const filename = `pagepilot-work-items-${slug}-${dateStr}.csv`;

        res.setHeader("Content-Type", "text/csv; charset=utf-8");
        res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
        res.setHeader("Cache-Control", "no-store");

        // Write UTF-8 BOM and CSV header row
        res.write(UTF8_BOM + serializeCsvRow([...WORK_ITEM_CSV_HEADERS]));

        // Stream work items batch by batch
        await store.exportWorkItems(orgId, projectId, filterParse.data, (batch) => {
          for (const item of batch) {
            res.write(serializeWorkItemCsvRow(item));
          }
        });

        res.end();
      } catch (err: any) {
        console.error("[work_items] export error:", err);
        if (!res.headersSent) {
          sendError(
            res,
            500,
            API_ERROR_CODES.internalError,
            "Failed to export work items.",
          );
        } else {
          res.end();
        }
      }
    },
  );

  // =========================================================================
  // GET /api/projects/:projectId/work-items/:workItemId (owner, admin, member, viewer)
  // =========================================================================
  router.get(
    "/:workItemId",
    requireOrgRole(["owner", "admin", "member", "viewer"]),
    async (req: Request, res: Response): Promise<void> => {
      const projectId = getParam(req, "projectId");
      const workItemId = getParam(req, "workItemId");
      if (
        !projectId ||
        !isValidUuid(projectId) ||
        !workItemId ||
        !isValidUuid(workItemId)
      ) {
        sendError(res, 404, API_ERROR_CODES.notFound, "Work item not found.");
        return;
      }

      const orgId = req.workspace!.organization.id;
      try {
        const store = getStore(req);
        const detail = await store.getWorkItemWithActivities(
          orgId,
          projectId,
          workItemId,
        );
        if (!detail) {
          sendError(
            res,
            404,
            API_ERROR_CODES.notFound,
            "Work item not found.",
          );
          return;
        }
        res.status(200).json(detail);
      } catch (err: any) {
        console.error("[work_items] get error:", err);
        sendError(
          res,
          500,
          API_ERROR_CODES.internalError,
          "Failed to retrieve work item.",
        );
      }
    },
  );

  // =========================================================================
  // PATCH /api/projects/:projectId/work-items/:workItemId (owner, admin, member)
  // =========================================================================
  router.patch(
    "/:workItemId",
    requireOrgRole(["owner", "admin", "member"]),
    async (req: Request, res: Response): Promise<void> => {
      const projectId = getParam(req, "projectId");
      const workItemId = getParam(req, "workItemId");
      if (
        !projectId ||
        !isValidUuid(projectId) ||
        !workItemId ||
        !isValidUuid(workItemId)
      ) {
        sendError(res, 404, API_ERROR_CODES.notFound, "Work item not found.");
        return;
      }

      const parseResult = updateWorkItemSchema.safeParse(req.body);
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
      const userId = req.user!.id;

      try {
        const store = getStore(req);
        const updated = await store.updateWorkItem(
          orgId,
          projectId,
          userId,
          workItemId,
          parseResult.data,
        );

        if (!updated) {
          sendError(
            res,
            404,
            API_ERROR_CODES.notFound,
            "Work item not found.",
          );
          return;
        }

        res.status(200).json({ workItem: updated });
      } catch (err: any) {
        if (err instanceof InvalidAssigneeError) {
          sendError(res, 400, API_ERROR_CODES.badRequest, err.message);
          return;
        }
        console.error("[work_items] patch error:", err);
        sendError(
          res,
          500,
          API_ERROR_CODES.internalError,
          "Failed to update work item.",
        );
      }
    },
  );

  // =========================================================================
  // DELETE /api/projects/:projectId/work-items/:workItemId (owner, admin, member)
  // =========================================================================
  router.delete(
    "/:workItemId",
    requireOrgRole(["owner", "admin", "member"]),
    async (req: Request, res: Response): Promise<void> => {
      const projectId = getParam(req, "projectId");
      const workItemId = getParam(req, "workItemId");
      if (
        !projectId ||
        !isValidUuid(projectId) ||
        !workItemId ||
        !isValidUuid(workItemId)
      ) {
        sendError(res, 404, API_ERROR_CODES.notFound, "Work item not found.");
        return;
      }

      const orgId = req.workspace!.organization.id;
      try {
        const store = getStore(req);
        const deleted = await store.deleteWorkItem(orgId, projectId, workItemId);
        if (!deleted) {
          sendError(
            res,
            404,
            API_ERROR_CODES.notFound,
            "Work item not found.",
          );
          return;
        }

        res.status(200).json({
          success: true,
          deletedWorkItemId: workItemId,
        });
      } catch (err: any) {
        console.error("[work_items] delete error:", err);
        sendError(
          res,
          500,
          API_ERROR_CODES.internalError,
          "Failed to delete work item.",
        );
      }
    },
  );

  return router;
}
