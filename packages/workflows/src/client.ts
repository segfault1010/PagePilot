import { Inngest } from "inngest";
import type {
  AuditCompletedEvent,
  AuditFailedEvent,
  AuditRequestedEvent,
} from "@pagepilot/contracts";

/**
 * Type-safe Inngest event schema mapping for PagePilot workflows.
 */
export type PagePilotEvents = {
  "audit/requested": AuditRequestedEvent;
  "audit/completed": AuditCompletedEvent;
  "audit/failed": AuditFailedEvent;
};

export interface InngestClientConfig {
  id?: string;
  isDev?: boolean;
}

/**
 * Creates an Inngest client instance.
 *
 * Defaults to dev mode if INNGEST_DEV=1 or NODE_ENV !== "production" or
 * INNGEST_SIGNING_KEY is absent.
 */
export function createInngestClient(config: InngestClientConfig = {}): Inngest {
  const isDev =
    config.isDev ??
    (process.env.INNGEST_DEV === "1" ||
      process.env.NODE_ENV !== "production" ||
      !process.env.INNGEST_SIGNING_KEY);

  return new Inngest({
    id: config.id || "pagepilot",
    isDev,
  });
}

/**
 * Default Inngest client instance for PagePilot.
 */
export const inngestClient = createInngestClient();
