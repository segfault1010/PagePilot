import { Router } from "express";
import type { Request, Response } from "express";
import {
  API_ERROR_CODES,
  createIntegrationConnectionSchema,
  updateIntegrationConnectionSchema,
} from "@pagepilot/contracts";
import { requireOrgRole } from "../auth/middleware.js";
import type { IntegrationsStore } from "./integrations-store.js";
import { SupabaseIntegrationsStore } from "./integrations-store.js";
import type { ProjectsStore } from "../projects/projects-store.js";
import { SupabaseProjectsStore } from "../projects/projects-store.js";
import { validateOutboundWebhookUrl } from "./destination-guard.js";

import type { DnsResolver } from "@pagepilot/audit-engine";

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

export interface IntegrationsRouterOptions {
  getStore?: (req: Request) => IntegrationsStore;
  getProjectsStore?: (req: Request) => ProjectsStore;
  dnsResolver?: DnsResolver;
}

export function createIntegrationsRouter(
  options: IntegrationsRouterOptions = {},
): Router {
  const router = Router({ mergeParams: true });
  const dnsResolver = options.dnsResolver;

  const getStore =
    options.getStore ??
    ((req: Request) => new SupabaseIntegrationsStore(undefined, req.authToken));

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

  // Middleware: verify project exists and belongs to current tenant organization
  async function verifyProjectScope(
    req: Request,
    res: Response,
    next: () => void,
  ): Promise<void> {
    const projectId = getParam(req, "projectId");
    if (!projectId || !isValidUuid(projectId)) {
      sendError(res, 404, API_ERROR_CODES.notFound, "Project not found.");
      return;
    }

    const orgId = req.workspace!.organization.id;
    try {
      const pStore = getProjectsStore(req);
      const project = await pStore.getProjectById(orgId, projectId);
      if (!project) {
        sendError(res, 404, API_ERROR_CODES.notFound, "Project not found.");
        return;
      }
      next();
    } catch (err) {
      console.error("[integrations] verify project scope error:", err);
      sendError(res, 500, API_ERROR_CODES.internalError, "Internal error.");
    }
  }

  router.use(verifyProjectScope);

  // =========================================================================
  // 1. GET /api/projects/:projectId/integrations (all roles)
  // =========================================================================
  router.get(
    "/",
    requireOrgRole(["owner", "admin", "member", "viewer"]),
    async (req: Request, res: Response): Promise<void> => {
      const orgId = req.workspace!.organization.id;
      const projectId = getParam(req, "projectId");

      try {
        const store = getStore(req);
        const integrations = await store.listIntegrations(orgId, projectId);
        res.status(200).json({
          integrations,
          total: integrations.length,
        });
      } catch (err: any) {
        console.error("[integrations] list error:", err);
        sendError(
          res,
          500,
          API_ERROR_CODES.internalError,
          "Failed to list integrations.",
        );
      }
    },
  );

  // =========================================================================
  // 2. POST /api/projects/:projectId/integrations (owner, admin ONLY)
  // =========================================================================
  router.post(
    "/",
    requireOrgRole(["owner", "admin"]),
    async (req: Request, res: Response): Promise<void> => {
      const orgId = req.workspace!.organization.id;
      const userId = req.user!.id;
      const projectId = getParam(req, "projectId");

      const parseResult = createIntegrationConnectionSchema.safeParse(req.body);
      if (!parseResult.success) {
        sendError(
          res,
          400,
          API_ERROR_CODES.badRequest,
          parseResult.error.issues[0]?.message || "Invalid integration payload.",
        );
        return;
      }

      // Outbound SSRF destination policy validation
      const destinationCheck = await validateOutboundWebhookUrl(
        parseResult.data.targetUrl,
        dnsResolver,
      );
      if (!destinationCheck.ok) {
        sendError(
          res,
          destinationCheck.code === "BLOCKED_DESTINATION" ? 403 : 400,
          destinationCheck.code || API_ERROR_CODES.badRequest,
          destinationCheck.message || "Target URL is not allowed.",
        );
        return;
      }

      // Check if caller wants this integration to be project-scoped or organization-wide
      // Default to project-scoped if registered under a project
      const scopeProjectId = req.body.isOrganizationWide ? undefined : projectId;

      try {
        const store = getStore(req);
        const integration = await store.createIntegration(
          orgId,
          userId,
          parseResult.data,
          scopeProjectId,
        );
        res.status(201).json({ integration });
      } catch (err: any) {
        console.error("[integrations] create error:", err);
        sendError(
          res,
          500,
          API_ERROR_CODES.internalError,
          "Failed to create integration.",
        );
      }
    },
  );

  // =========================================================================
  // 3. GET /api/projects/:projectId/integrations/:integrationId (all roles)
  // =========================================================================
  router.get(
    "/:integrationId",
    requireOrgRole(["owner", "admin", "member", "viewer"]),
    async (req: Request, res: Response): Promise<void> => {
      const orgId = req.workspace!.organization.id;
      const projectId = getParam(req, "projectId");
      const integrationId = getParam(req, "integrationId");

      if (!isValidUuid(integrationId)) {
        sendError(
          res,
          404,
          API_ERROR_CODES.notFound,
          "Integration not found.",
        );
        return;
      }

      try {
        const store = getStore(req);
        const integration = await store.getIntegrationById(
          orgId,
          integrationId,
          projectId,
        );
        if (!integration) {
          sendError(
            res,
            404,
            API_ERROR_CODES.notFound,
            "Integration not found.",
          );
          return;
        }

        res.status(200).json({ integration });
      } catch (err: any) {
        console.error("[integrations] get error:", err);
        sendError(
          res,
          500,
          API_ERROR_CODES.internalError,
          "Failed to retrieve integration.",
        );
      }
    },
  );

  // =========================================================================
  // 4. PATCH /api/projects/:projectId/integrations/:integrationId (owner, admin ONLY)
  // =========================================================================
  router.patch(
    "/:integrationId",
    requireOrgRole(["owner", "admin"]),
    async (req: Request, res: Response): Promise<void> => {
      const orgId = req.workspace!.organization.id;
      const projectId = getParam(req, "projectId");
      const integrationId = getParam(req, "integrationId");

      if (!isValidUuid(integrationId)) {
        sendError(
          res,
          404,
          API_ERROR_CODES.notFound,
          "Integration not found.",
        );
        return;
      }

      const parseResult = updateIntegrationConnectionSchema.safeParse(req.body);
      if (!parseResult.success) {
        sendError(
          res,
          400,
          API_ERROR_CODES.badRequest,
          parseResult.error.issues[0]?.message || "Invalid update data.",
        );
        return;
      }

      // If targetUrl is updated, enforce SSRF destination policy
      if (parseResult.data.targetUrl) {
        const destinationCheck = await validateOutboundWebhookUrl(
          parseResult.data.targetUrl,
          dnsResolver,
        );
        if (!destinationCheck.ok) {
          sendError(
            res,
            destinationCheck.code === "BLOCKED_DESTINATION" ? 403 : 400,
            destinationCheck.code || API_ERROR_CODES.badRequest,
            destinationCheck.message || "Target URL is not allowed.",
          );
          return;
        }
      }

      try {
        const store = getStore(req);
        const integration = await store.updateIntegration(
          orgId,
          integrationId,
          parseResult.data,
          projectId,
        );

        if (!integration) {
          sendError(
            res,
            404,
            API_ERROR_CODES.notFound,
            "Integration not found.",
          );
          return;
        }

        res.status(200).json({ integration });
      } catch (err: any) {
        console.error("[integrations] update error:", err);
        sendError(
          res,
          500,
          API_ERROR_CODES.internalError,
          "Failed to update integration.",
        );
      }
    },
  );

  // =========================================================================
  // 5. DELETE /api/projects/:projectId/integrations/:integrationId (owner, admin ONLY)
  // =========================================================================
  router.delete(
    "/:integrationId",
    requireOrgRole(["owner", "admin"]),
    async (req: Request, res: Response): Promise<void> => {
      const orgId = req.workspace!.organization.id;
      const projectId = getParam(req, "projectId");
      const integrationId = getParam(req, "integrationId");

      if (!isValidUuid(integrationId)) {
        sendError(
          res,
          404,
          API_ERROR_CODES.notFound,
          "Integration not found.",
        );
        return;
      }

      try {
        const store = getStore(req);
        const deleted = await store.deleteIntegration(
          orgId,
          integrationId,
          projectId,
        );
        if (!deleted) {
          sendError(
            res,
            404,
            API_ERROR_CODES.notFound,
            "Integration not found.",
          );
          return;
        }

        res.status(200).json({
          success: true,
          deletedIntegrationId: integrationId,
        });
      } catch (err: any) {
        console.error("[integrations] delete error:", err);
        sendError(
          res,
          500,
          API_ERROR_CODES.internalError,
          "Failed to delete integration.",
        );
      }
    },
  );

  // =========================================================================
  // 6. POST /api/projects/:projectId/integrations/:integrationId/test (owner, admin ONLY)
  // =========================================================================
  router.post(
    "/:integrationId/test",
    requireOrgRole(["owner", "admin"]),
    async (req: Request, res: Response): Promise<void> => {
      const orgId = req.workspace!.organization.id;
      const integrationId = getParam(req, "integrationId");

      if (!isValidUuid(integrationId)) {
        sendError(
          res,
          404,
          API_ERROR_CODES.notFound,
          "Integration not found.",
        );
        return;
      }

      try {
        const store = getStore(req);
        const testResult = await store.testIntegration(orgId, integrationId);
        res.status(200).json(testResult);
      } catch (err: any) {
        console.error("[integrations] test error:", err);
        sendError(
          res,
          500,
          API_ERROR_CODES.internalError,
          "Failed to test integration.",
        );
      }
    },
  );

  return router;
}
