#!/usr/bin/env node
/**
 * One-command real Supabase Auth & Multi-Tenant verification: `npm run verify:supabase`.
 *
 * Spawns vitest for apps/api/tests/supabase-runtime-auth.test.ts with RUN_LIVE_TESTS=1
 * and verifies all live Supabase auth, trigger, workspace auto-provisioning,
 * RBAC, and tenant isolation flows against the dedicated project.
 */

import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const ENV_FILE = join(ROOT, ".env");

if (!existsSync(ENV_FILE)) {
  console.error("verify:supabase — FAIL: .env file not found.");
  process.exit(1);
}

const envContent = readFileSync(ENV_FILE, "utf8");
const hasUrl = /^(?:VITE_)?SUPABASE_URL=/m.test(envContent);
const hasAnon = /^(?:VITE_)?SUPABASE_ANON_KEY=/m.test(envContent);
const hasServiceRole = /^SUPABASE_SERVICE_ROLE_KEY=/m.test(envContent);

console.log("verify:supabase — configuration:");
console.log(`  .env found:                   true`);
console.log(`  SUPABASE_URL:                 ${hasUrl ? "present" : "MISSING"}`);
console.log(`  SUPABASE_ANON_KEY:            ${hasAnon ? "present" : "MISSING"}`);
console.log(`  SUPABASE_SERVICE_ROLE_KEY:    ${hasServiceRole ? "present" : "MISSING"}`);
console.log("");

if (!hasUrl || !hasAnon || !hasServiceRole) {
  console.error("verify:supabase — FAIL: Missing required Supabase credentials in .env");
  process.exit(1);
}

const child = spawn("npx", ["vitest", "run", "apps/api/tests/supabase-runtime-auth.test.ts"], {
  cwd: ROOT,
  stdio: "inherit",
  shell: true,
  env: {
    ...process.env,
    RUN_LIVE_TESTS: "1",
  },
});

child.on("exit", (code) => {
  if (code === 0) {
    console.log("\nverify:supabase — PASS");
    process.exit(0);
  } else {
    console.error(`\nverify:supabase — FAIL: exited with code ${code}`);
    process.exit(code || 1);
  }
});
