#!/usr/bin/env node
/**
 * One-command real Gemini verification: `npm run verify:gemini`.
 *
 * Starts `vercel dev` on a private port, performs EXACTLY ONE real request
 * against POST /api/analyze with a known safe public page, validates the
 * response against the Phase 5 report contract, classifies the outcome,
 * stops the server, and exits 0 only on success.
 *
 * Safety rules enforced here:
 * - never prints GEMINI_API_KEY (only whether it exists)
 * - never prints raw provider output (the API never returns it; the script
 *   prints contract fields and sanitized `[ai]` log lines only)
 * - makes no code-path changes; failure classification is read-only
 */

import { spawn } from "node:child_process";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";

const PORT = 3210;
const BASE = `http://127.0.0.1:${PORT}`;
const TARGET_URL = "https://example.com";
const SERVER_READY_TIMEOUT_MS = 60_000;
const REQUEST_TIMEOUT_MS = 90_000;

const ROOT = process.cwd();
const ENV_FILE = join(ROOT, ".env");
const AI_LOG_PATTERN = /\[ai\][^\r\n]*/g;

function fail(message) {
  console.error(`verify:gemini — FAIL: ${message}`);
}

function readEnvFile() {
  if (!existsSync(ENV_FILE)) return { key: "", model: "", fileFound: false };
  const out = { key: "", model: "", fileFound: true };
  for (const line of readFileSync(ENV_FILE, "utf8").split(/\r?\n/)) {
    const match = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (!match) continue;
    if (match[1] === "GEMINI_API_KEY") out.key = match[2].trim();
    if (match[1] === "GEMINI_MODEL") out.model = match[2].trim();
  }
  return out;
}

function waitForServer(deadline) {
  return new Promise((resolve, reject) => {
    const tick = async () => {
      if (Date.now() > deadline) {
        reject(new Error("vercel dev did not become ready in time"));
        return;
      }
      try {
        const res = await fetch(BASE, { signal: AbortSignal.timeout(2000) });
        resolve(res.status);
      } catch {
        setTimeout(tick, 1500);
      }
    };
    tick();
  });
}

function stopServer(child) {
  try {
    if (process.platform === "win32") {
      spawn("taskkill", ["/PID", String(child.pid), "/T", "/F"], { stdio: "ignore" });
    } else {
      process.kill(-child.pid, "SIGTERM");
    }
  } catch {
    /* best effort */
  }
}

function classify({ httpStatus, body, aiLogs, env }) {
  const logText = aiLogs.join(" ");
  if (httpStatus === 429 || /status=429/.test(logText)) {
    return "QUOTA / RATE LIMIT — the configured model's free-tier daily bucket is exhausted. Wait for the daily reset or use billing/another project via GEMINI_MODEL.";
  }
  if (/status=40[13]/.test(logText) || /kind=configuration.*status=40/.test(logText)) {
    return "PROVIDER AUTHENTICATION — the API key was rejected by Google. Check GEMINI_API_KEY.";
  }
  if (env.key === "" || !env.fileFound) {
    return "LOCAL CONFIGURATION — GEMINI_API_KEY is missing from .env.";
  }
  if (httpStatus === 503 && body?.error?.code === "MISSING_CONFIGURATION") {
    return "LOCAL CONFIGURATION — the server reported missing configuration.";
  }
  if (/status=400/.test(logText)) {
    return "MODEL/REQUEST CONFIGURATION REJECTED — Gemini returned 400 for this model/generation config. Check GEMINI_MODEL supports structured output (responseJsonSchema).";
  }
  if (httpStatus === 504 || body?.error?.code === "TIMEOUT") {
    return "UNAVAILABLE (TIMEOUT) — provider accepted the request but exceeded the deadline. Retry later or reduce load.";
  }
  if (httpStatus === 502 || body?.error?.code === "UPSTREAM_FAILURE") {
    return "PROVIDER UNAVAILABLE — Gemini could not complete the audit (overload or malformed model output). Safe generic failure; retry later.";
  }
  if (httpStatus === 500) {
    return "APPLICATION BUG — unexpected INTERNAL_ERROR. Inspect server logs.";
  }
  return `UNCLASSIFIED — HTTP ${httpStatus}.`;
}

function validateReport(report) {
  const problems = [];
  if (!report || typeof report !== "object") return ["response has no report object"];

  const source = report.source ?? {};
  for (const field of ["requestedUrl", "finalUrl", "analyzedAt"]) {
    if (typeof source[field] !== "string" || source[field].length === 0) {
      problems.push(`source.${field} missing`);
    }
  }
  if (!("title" in source)) problems.push("source.title missing");

  if (!Number.isInteger(report.overallScore) || report.overallScore < 0 || report.overallScore > 100) {
    problems.push("overallScore must be an integer 0-100");
  }
  if (!["blended", "ai-led"].includes(report.scoreConfidence)) {
    problems.push("scoreConfidence must be blended|ai-led");
  }
  if (typeof report.summary !== "string" || report.summary.length === 0) {
    problems.push("summary missing");
  }
  if (!Array.isArray(report.categories) || report.categories.length !== 7) {
    problems.push(`categories must contain exactly 7 entries (got ${report.categories?.length})`);
  } else {
    const keys = report.categories.map((category) => category.category);
    if (new Set(keys).size !== 7) problems.push("duplicate categories");
    for (const category of report.categories) {
      if (!Number.isInteger(category.score) || category.score < 0 || category.score > 100) {
        problems.push(`${category.category}: invalid score`);
      }
      if (!Array.isArray(category.findings) || category.findings.length > 3) {
        problems.push(`${category.category}: findings out of bounds`);
      }
      if (!["blended", "ai-led"].includes(category.confidence)) {
        problems.push(`${category.category}: invalid confidence`);
      }
    }
  }
  if (!Array.isArray(report.topProblems) || report.topProblems.length !== 3) {
    problems.push(`topProblems must contain exactly 3 entries (got ${report.topProblems?.length})`);
  }
  const quickWins = report.quickWins?.length;
  if (!(quickWins >= 3 && quickWins <= 5)) problems.push(`quickWins count ${quickWins} outside 3-5`);
  if (!Array.isArray(report.detailedRecommendations) || report.detailedRecommendations.length < 1) {
    problems.push("detailedRecommendations empty");
  }
  if (!Array.isArray(report.observedSignals) || report.observedSignals.length === 0) {
    problems.push("observedSignals empty");
  }

  // Raw-model-output hygiene: none of these may appear anywhere.
  const serialized = JSON.stringify(report);
  for (const marker of ["finishReason", "promptFeedback", "candidates", "systemInstruction"]) {
    if (serialized.includes(marker)) problems.push(`raw provider artifact "${marker}" leaked into response`);
  }
  return problems;
}

const env = readEnvFile();
console.log("verify:gemini — configuration:");
console.log(`  .env found:        ${env.fileFound}`);
console.log(`  GEMINI_API_KEY:    ${env.key ? "present" : "MISSING"}`);
console.log(`  GEMINI_MODEL:      ${env.model || "(unset — server default gemini-3.6-flash)"}`);
console.log(`  target:            POST ${BASE}/api/analyze`);
console.log(`  page:              ${TARGET_URL}`);
console.log("");

if (!env.key) {
  fail("GEMINI_API_KEY is not set in .env — nothing to verify.");
  process.exit(1);
}

const child = spawn("cmd.exe", ["/c", "vercel", "dev", "--listen", String(PORT), "--yes"], {
  cwd: ROOT,
  stdio: ["ignore", "pipe", "pipe"],
});
const aiLogs = [];
const collectAiLines = (chunk) => {
  for (const line of chunk.toString().split(/\r?\n/)) {
    if (line.includes("[ai]")) {
      // Sanitized by the server by design; safe to surface.
      console.log(`  server: ${line.trim()}`);
      aiLogs.push(line.trim());
    }
  }
};
child.stdout.on("data", collectAiLines);
child.stderr.on("data", collectAiLines);

let verdict;
try {
  await waitForServer(Date.now() + SERVER_READY_TIMEOUT_MS);
  console.log("  server ready. sending ONE analysis request…\n");

  const res = await fetch(`${BASE}/api/analyze`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url: TARGET_URL }),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  const payload = await res.json().catch(() => null);

  if (res.status === 200 && payload?.report) {
    const problems = validateReport(payload.report);
    if (problems.length > 0) {
      verdict = `APPLICATION BUG — 200 response violates the report contract: ${problems.join("; ")}`;
    } else {
      const report = payload.report;
      console.log("SUCCESS — real Gemini-audited report received.");
      console.log(`  overallScore:    ${report.overallScore} (${report.scoreConfidence})`);
      console.log(`  title:           ${report.source.title ?? "(none)"}`);
      console.log(`  finalUrl:        ${report.source.finalUrl}`);
      console.log("  category scores:");
      for (const category of report.categories) {
        console.log(
          `    ${category.category.padEnd(18)} ${String(category.score).padStart(3)}  ${category.confidence}`,
        );
      }
      console.log(
        `  topProblems=${report.topProblems.length} quickWins=${report.quickWins.length} detailed=${report.detailedRecommendations.length} observedSignals=${report.observedSignals.length}`,
      );
      verdict = "OK";
    }
  } else {
    verdict = classify({ httpStatus: res.status, body: payload, aiLogs, env });
    console.log(`HTTP ${res.status}: ${JSON.stringify(payload?.error ?? payload)?.slice(0, 300)}`);
  }
} catch (error) {
  verdict = `APPLICATION/ENVIRONMENT ERROR — ${error.message}`;
} finally {
  stopServer(child);
}

console.log("");
if (verdict === "OK") {
  console.log("verify:gemini — PASS");
  process.exit(0);
}
fail(verdict);
process.exit(1);
