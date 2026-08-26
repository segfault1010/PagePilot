import type { IncomingMessage, ServerResponse } from "node:http";
import { createApp } from "../src/http/app.js";

const app = createApp();

export default function handler(req: IncomingMessage, res: ServerResponse): void {
  app(req, res);
}
