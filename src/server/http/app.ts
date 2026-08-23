import express from "express";
import type { Express, NextFunction, Request, Response } from "express";
import { API_ERROR_CODES } from "../../shared/audit-types";
import { enforceUrlPolicy } from "../../shared/url-policy";
import { analyzeRequestSchema } from "../../shared/audit-types";
import type { AnalysisOutcome } from "../pipeline";
import { analyzeTarget } from "../pipeline";

// Matches the planned 4 KB JSON request limit.
const MAX_JSON_BODY_BYTES = "4kb";
const MAX_JSON_BODY_LIMIT_BYTES = 4096;

export interface AppOptions {
  /** Injectable for tests; production uses the real safe-fetch pipeline. */
  analyzeUrl?: (url: string) => Promise<AnalysisOutcome>;
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

  app.post("/api/analyze", (req, res) => {
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
