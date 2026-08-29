import express from "express";
import type { Express, NextFunction, Request, Response } from "express";
import {
  API_ERROR_CODES,
  analyzeRequestSchema,
  enforceUrlPolicy,
} from "@pagepilot/contracts";
import type { AnalysisOutcome } from "@pagepilot/audit-engine";
import { analyzeTarget } from "@pagepilot/audit-engine";
import type { AuthMiddlewareOptions } from "../auth/middleware.js";
import { requireAuth, requireWorkspace } from "../auth/middleware.js";
import type { ProjectsStore } from "../projects/projects-store.js";
import { createProjectsRouter } from "../projects/routes.js";

// Matches the planned 4 KB JSON request limit.
const MAX_JSON_BODY_BYTES = "4kb";
const MAX_JSON_BODY_LIMIT_BYTES = 4096;

// Lightweight per-IP throttle: 5 requests per 10 minutes per warm instance.
// Cost protection, not authentication — in-memory only and resets on cold start.
const RATE_LIMIT_MAX = 5;
const RATE_LIMIT_WINDOW_MS = 10 * 60 * 1000;

// Exported for test setup; production code never calls it directly.
const _globalRateLimit = new Map<string, { count: number; windowStart: number }>();
export function clearRateLimit(): void {
  _globalRateLimit.clear();
}

function getClientIp(req: Request): string {
  const forwarded = req.headers["x-forwarded-for"];
  if (typeof forwarded === "string" && forwarded.length > 0) {
    // Vercel sets x-forwarded-for as comma-separated; first is the client.
    const first = forwarded.split(",")[0]?.trim();
    if (first) return first;
  } else if (Array.isArray(forwarded) && forwarded.length > 0) {
    const first = forwarded[0]?.split(",")[0]?.trim();
    if (first) return first;
  }
  const realIp = req.headers["x-real-ip"];
  if (typeof realIp === "string" && realIp.length > 0) return realIp.trim();
  // Express's req.ip is populated when trust proxy is configured; fall back
  // to the socket remote address for plain Node environments (tests).
  const maybeIp = (req as { ip?: string }).ip;
  if (typeof maybeIp === "string" && maybeIp.length > 0) return maybeIp;
  return req.socket.remoteAddress ?? "unknown";
}

function makeRateLimiter() {
  // Per-app (per warm instance) map. When api/analyze.ts creates a single app
  // at module load, this map lives as long as the instance stays warm.
  const ipRateLimit = new Map<string, { count: number; windowStart: number }>();
  return (ip: string): boolean => {
    const now = Date.now();
    const entry = ipRateLimit.get(ip);
    if (!entry || now - entry.windowStart >= RATE_LIMIT_WINDOW_MS) {
      ipRateLimit.set(ip, { count: 1, windowStart: now });
      return false;
    }
    if (entry.count >= RATE_LIMIT_MAX) return true;
    entry.count += 1;
    return false;
  };
}

import type { AuditPersistenceStore } from "../audits/audit-store.js";
import { serve } from "inngest/express";
import type { Inngest } from "inngest";
import {
  createAuditWorkflow,
  createInngestClient,
} from "@pagepilot/workflows";
import type { WorkflowPersistenceStore } from "@pagepilot/workflows";
import { SupabaseWorkflowPersistenceStore } from "../audits/supabase-workflow-store.js";

export interface AppOptions extends AuthMiddlewareOptions {
  /** Injectable for tests; production uses the real safe-fetch pipeline. */
  analyzeUrl?: (url: string) => Promise<AnalysisOutcome>;
  /** Injectable for tests; production instantiates SupabaseProjectsStore with user authToken. */
  getProjectsStore?: (req: Request) => ProjectsStore;
  /** Injectable for tests; production instantiates SupabaseAuditPersistenceStore with user authToken. */
  getAuditStore?: (req: Request) => AuditPersistenceStore;
  /** Injectable for tests; Inngest client */
  inngestClient?: Inngest;
  /** Injectable for tests; Inngest workflow functions */
  inngestFunctions?: any[];
  /** Injectable for tests; workflow persistence store */
  getWorkflowStore?: () => WorkflowPersistenceStore;
}

export function sendApiError(
  res: Response,
  status: number,
  code: string,
  message: string,
  retryable: boolean,
): void {
  res.status(status).json({ error: { code, message, retryable } });
}

/**
 * The Vercel Node runtime pre-parses JSON bodies and consumes the request
 * stream before Express runs, so running express.json afterwards surfaces
 * the platform's generic "Invalid JSON" error as an unclassified 500. When
 * the platform already handed us a parsed object (or a raw buffer), use it;
 * otherwise fall back to express.json for plain Node environments.
 */
function normalizePlatformBody(req: Request): void {
  if (req.body === undefined || req.body === null) return;
  if (Buffer.isBuffer(req.body)) {
    try {
      req.body = JSON.parse(req.body.toString("utf8")) as unknown;
    } catch {
      req.body = undefined;
    }
    return;
  }
}

function classifyBodyParserError(error: unknown): BodyParserFailure | undefined {
  // The Vercel Node runtime rejects malformed JSON bodies with a plain
  // Error("Invalid JSON") that carries no body-parser type marker.
  if (error instanceof Error && error.message === "Invalid JSON") {
    return {
      status: 400,
      code: API_ERROR_CODES.badRequest,
      message: "Request body must be valid JSON.",
    };
  }
  if (typeof error !== "object" || error === null) return undefined;
  const type = (error as { type?: unknown }).type;
  if (type === "entity.parse.failed") {
    return {
      status: 400,
      code: API_ERROR_CODES.badRequest,
      message: "Request body must be valid JSON.",
    };
  }
  if (type === "entity.too.large") {
    return {
      status: 413,
      code: API_ERROR_CODES.requestTooLarge,
      message: `Request body exceeds the ${MAX_JSON_BODY_BYTES} limit.`,
    };
  }
  return undefined;
}

interface BodyParserFailure {
  status: number;
  code: string;
  message: string;
}

export function createApp(options: AppOptions = {}): Express {
  const analyzeUrl = options.analyzeUrl ?? analyzeTarget;
  const isRateLimited = makeRateLimiter();
  const app = express();

  app.disable("x-powered-by");
  app.use((_req, res, next) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    next();
  });

  // Enforce the request-size contract even when the platform parser is
  // skipped (its own limit is much larger than ours).
  app.use((req, res, next) => {
    const declaredLength = Number(req.headers["content-length"] ?? "0");
    if (
      Number.isFinite(declaredLength) &&
      declaredLength > MAX_JSON_BODY_LIMIT_BYTES
    ) {
      sendApiError(
        res,
        413,
        API_ERROR_CODES.requestTooLarge,
        `Request body exceeds the ${MAX_JSON_BODY_BYTES} limit.`,
        false,
      );
      return;
    }
    next();
  });

  app.use((req, _res, next) => {
    if (req.body !== undefined && req.body !== null) {
      normalizePlatformBody(req);
      next();
      return;
    }
    express.json({ limit: MAX_JSON_BODY_BYTES })(req, _res, next);
  });

  // -------------------------------------------------------------------------
  // Anonymous / Public Audit Pipeline (Must remain open and unauthenticated)
  // -------------------------------------------------------------------------
  app.post("/api/analyze", (req, res) => {
    // Cheap cost protection before any heavy work (fetch, AI).
    const clientIp = getClientIp(req);
    if (isRateLimited(clientIp)) {
      sendApiError(
        res,
        429,
        API_ERROR_CODES.rateLimited,
        "Too many requests. Please wait a few minutes and try again.",
        true,
      );
      return;
    }

    const requestParse = analyzeRequestSchema.safeParse(req.body);
    if (!requestParse.success) {
      sendApiError(
        res,
        400,
        API_ERROR_CODES.badRequest,
        "Request body must be a JSON object with a url string.",
        false,
      );
      return;
    }

    // Authoritative server-side validation; the client's checks are only
    // fast feedback and are never trusted.
    const policy = enforceUrlPolicy(requestParse.data.url);
    if (!policy.ok) {
      sendApiError(res, 400, policy.code, policy.message, false);
      return;
    }

    void (async () => {
      let outcome: AnalysisOutcome;
      try {
        outcome = await analyzeUrl(policy.url);
      } catch (error) {
        console.error(
          "[api/analyze] unexpected error:",
          error instanceof Error ? `${error.name}: ${error.message}` : typeof error,
        );
        sendApiError(
          res,
          500,
          "INTERNAL_ERROR",
          "Unexpected server error.",
          false,
        );
        return;
      }

      if (!outcome.ok) {
        sendApiError(
          res,
          outcome.status,
          outcome.code,
          outcome.message,
          outcome.retryable,
        );
        return;
      }

      // The pipeline returns a fully validated, server-scored report.
      res.status(200).json({ report: outcome.report });
    })().catch(() => {
      if (!res.headersSent) {
        sendApiError(
          res,
          500,
          "INTERNAL_ERROR",
          "Unexpected server error.",
          false,
        );
      }
    });
  });

  app.use("/api/analyze", (req, res) => {
    res.set("Allow", "POST");
    sendApiError(
      res,
      405,
      API_ERROR_CODES.methodNotAllowed,
      `Method ${req.method} is not allowed.`,
      false,
    );
  });

  // -------------------------------------------------------------------------
  // Authenticated Tenant Workspace Route (Protected)
  // -------------------------------------------------------------------------
  app.get(
    "/api/workspace/me",
    requireAuth(options),
    requireWorkspace(options),
    (req: Request, res: Response) => {
      res.status(200).json({
        workspace: req.workspace,
      });
    },
  );

  app.use("/api/workspace/me", (req, res) => {
    res.set("Allow", "GET");
    sendApiError(
      res,
      405,
      API_ERROR_CODES.methodNotAllowed,
      `Method ${req.method} is not allowed.`,
      false,
    );
  });

  // -------------------------------------------------------------------------
  // Authenticated Projects & Monitored Pages Routes (Protected)
  // -------------------------------------------------------------------------
  app.use(
    "/api/projects",
    requireAuth(options),
    requireWorkspace(options),
    createProjectsRouter({
      getStore: options.getProjectsStore,
      getAuditStore: options.getAuditStore,
      analyzeUrl: options.analyzeUrl,
    }),
  );

  // -------------------------------------------------------------------------
  // Inngest Durable Workflow Endpoint
  // -------------------------------------------------------------------------
  const getWorkflowFunctions = () => {
    if (options.inngestFunctions) return options.inngestFunctions;
    const store =
      options.getWorkflowStore?.() ?? new SupabaseWorkflowPersistenceStore();
    return [
      createAuditWorkflow({
        auditStore: store,
        analyzeUrl: options.analyzeUrl,
      }),
    ];
  };

  const inngestInstance =
    options.inngestClient ??
    createInngestClient({
      isDev:
        process.env.INNGEST_DEV === "1" ||
        process.env.NODE_ENV !== "production" ||
        !process.env.INNGEST_SIGNING_KEY,
    });

  app.use("/api/inngest", (req: Request, res: Response, next: NextFunction) => {
    const handler = serve({
      client: inngestInstance,
      functions: getWorkflowFunctions(),
    });
    handler(req, res, next);
  });

  app.use("/api", (_req, res) => {
    sendApiError(res, 404, API_ERROR_CODES.notFound, "Unknown API route.", false);
  });

  app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
    const classified = classifyBodyParserError(error);
    if (classified) {
      sendApiError(
        res,
        classified.status,
        classified.code,
        classified.message,
        false,
      );
      return;
    }
    // Server-side sanitized logging only — never exposed to the client.
    console.error(
      "[api/analyze] unexpected error:",
      error instanceof Error ? `${error.name}: ${error.message}` : typeof error,
    );
    sendApiError(
      res,
      500,
      "INTERNAL_ERROR",
      "Unexpected server error.",
      false,
    );
  });

  return app;
}
