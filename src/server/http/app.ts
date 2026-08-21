import express from "express";
import type { Express, NextFunction, Request, Response } from "express";
import { API_ERROR_CODES } from "../../shared/audit-types";

// Matches the planned 4 KB JSON request limit.
const MAX_JSON_BODY_BYTES = "4kb";

export function sendApiError(
  res: Response,
  status: number,
  code: string,
  message: string,
  retryable: boolean,
): void {
  res.status(status).json({ error: { code, message, retryable } });
}

function isJsonParseError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as { type?: unknown }).type === "entity.parse.failed"
  );
}

export function createApp(): Express {
  const app = express();

  app.disable("x-powered-by");
  app.use(express.json({ limit: MAX_JSON_BODY_BYTES }));

  // Phase 1 shell: proves request/response plumbing only. The analysis
  // pipeline (validation, fetch, extraction, Gemini, scoring) lands in
  // Phases 3-5, so this responds with the stable not-implemented envelope.
  app.post("/api/analyze", (_req, res) => {
    sendApiError(
      res,
      501,
      API_ERROR_CODES.notImplemented,
      "Analysis is not implemented yet.",
      false,
    );
  });

  app.use("/api/analyze", (req, res) => {
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
    if (isJsonParseError(error)) {
      sendApiError(
        res,
        400,
        API_ERROR_CODES.badRequest,
        "Request body must be valid JSON.",
        false,
      );
      return;
    }
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
