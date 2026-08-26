import type { IncomingMessage, ServerResponse } from "node:http";
import { createApp } from "@pagepilot/api";

// Typed against Node primitives instead of @vercel/node: this handler is a
// pure pass-through, and skipping that package keeps its dev-only transitive
// advisories out of the dependency tree.
const app = createApp();

export default function handler(req: IncomingMessage, res: ServerResponse): void {
  app(req, res);
}
