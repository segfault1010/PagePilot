import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  getSupabaseClient,
  isSupabaseConfigured,
  resetSupabaseClient,
} from "../src/features/auth/supabase-client";

describe("supabase-client configuration", () => {
  beforeEach(() => {
    resetSupabaseClient();
    vi.unstubAllEnvs();
  });

  afterEach(() => {
    resetSupabaseClient();
    vi.unstubAllEnvs();
  });

  it("returns isSupabaseConfigured = false and null client when env vars are missing", () => {
    vi.stubEnv("VITE_SUPABASE_URL", "");
    vi.stubEnv("VITE_SUPABASE_ANON_KEY", "");

    expect(isSupabaseConfigured()).toBe(false);
    expect(getSupabaseClient()).toBeNull();
  });

  it("returns isSupabaseConfigured = false when only URL is provided", () => {
    vi.stubEnv("VITE_SUPABASE_URL", "https://example.supabase.co");
    vi.stubEnv("VITE_SUPABASE_ANON_KEY", "");

    expect(isSupabaseConfigured()).toBe(false);
    expect(getSupabaseClient()).toBeNull();
  });

  it("returns isSupabaseConfigured = false when only ANON key is provided", () => {
    vi.stubEnv("VITE_SUPABASE_URL", "");
    vi.stubEnv("VITE_SUPABASE_ANON_KEY", "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.dummy");

    expect(isSupabaseConfigured()).toBe(false);
    expect(getSupabaseClient()).toBeNull();
  });

  it("returns isSupabaseConfigured = true and returns client when both env vars are provided", () => {
    vi.stubEnv("VITE_SUPABASE_URL", "https://xyzcompany.supabase.co");
    vi.stubEnv(
      "VITE_SUPABASE_ANON_KEY",
      "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inh5emNvbXBhbnkiLCJyb2xlIjoiYW5vbiJ9.dummy",
    );

    expect(isSupabaseConfigured()).toBe(true);
    const client = getSupabaseClient();
    expect(client).not.toBeNull();
    expect(client?.auth).toBeDefined();

    // Re-retrieving should return the cached singleton
    const sameClient = getSupabaseClient();
    expect(sameClient).toBe(client);
  });
});
