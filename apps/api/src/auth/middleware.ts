import type { NextFunction, Request, Response } from "express";
import type { Role, WorkspaceContext } from "@pagepilot/contracts";
import type { VerifiedUser } from "./supabase-server.js";
import { verifyAccessToken } from "./supabase-server.js";
import { resolveOrProvisionWorkspace } from "./provisioning.js";

// Augment Express Request to hold verified user and workspace
declare global {
  namespace Express {
    interface Request {
      user?: VerifiedUser;
      authToken?: string;
      workspace?: WorkspaceContext;
    }
  }
}

export interface AuthMiddlewareOptions {
  verifyToken?: (token: string) => Promise<VerifiedUser | null>;
  resolveWorkspace?: (user: VerifiedUser, token?: string) => Promise<WorkspaceContext>;
}

export function extractBearerToken(req: Request): string | null {
  const authHeader = req.headers.authorization;
  if (!authHeader || typeof authHeader !== "string") return null;
  const match = /^Bearer\s+(.+)$/i.exec(authHeader.trim());
  return match ? match[1] : null;
}

export async function authenticateRequest(
  req: Request,
  options: AuthMiddlewareOptions = {},
): Promise<VerifiedUser | null> {
  const token = extractBearerToken(req);
  if (!token) return null;

  const verifier = options.verifyToken ?? verifyAccessToken;
  const user = await verifier(token);
  if (!user) return null;

  req.user = user;
  req.authToken = token;
  return user;
}

export function requireAuth(options: AuthMiddlewareOptions = {}) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const user = await authenticateRequest(req, options);
      if (!user) {
        res.status(401).json({
          error: {
            code: "UNAUTHENTICATED",
            message: "Authentication required.",
            retryable: false,
          },
        });
        return;
      }
      next();
    } catch {
      res.status(401).json({
        error: {
          code: "UNAUTHENTICATED",
          message: "Invalid or expired authentication token.",
          retryable: false,
        },
      });
    }
  };
}

export function requireWorkspace(options: AuthMiddlewareOptions = {}) {
  const resolver = options.resolveWorkspace ?? ((user, token) => resolveOrProvisionWorkspace(user, {}, token));

  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    if (!req.user) {
      res.status(401).json({
        error: {
          code: "UNAUTHENTICATED",
          message: "Authentication required.",
          retryable: false,
        },
      });
      return;
    }

    try {
      const workspace = await resolver(req.user, req.authToken);
      req.workspace = workspace;
      next();
    } catch (error) {
      console.error("[auth] workspace resolution error:", error);
      res.status(500).json({
        error: {
          code: "INTERNAL_ERROR",
          message: "Failed to resolve workspace.",
          retryable: true,
        },
      });
    }
  };
}

export function requireOrgRole(allowedRoles: Role[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const role = req.workspace?.role;
    if (!role || !allowedRoles.includes(role)) {
      res.status(403).json({
        error: {
          code: "FORBIDDEN",
          message: "Insufficient permissions for this action.",
          retryable: false,
        },
      });
      return;
    }
    next();
  };
}
