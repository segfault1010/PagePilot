import { createClient } from "@supabase/supabase-js";
import type { SupabaseClient } from "@supabase/supabase-js";

interface BrowserEnv {
  VITE_SUPABASE_URL?: string;
  VITE_SUPABASE_ANON_KEY?: string;
}

function getEnv(): BrowserEnv {
  return ((import.meta as unknown as { env?: BrowserEnv })?.env ?? {}) as BrowserEnv;
}

export function isSupabaseConfigured(): boolean {
  const env = getEnv();
  return Boolean(env.VITE_SUPABASE_URL && env.VITE_SUPABASE_ANON_KEY);
}

let _client: SupabaseClient | null = null;

export function getSupabaseClient(): SupabaseClient | null {
  const env = getEnv();
  if (!env.VITE_SUPABASE_URL || !env.VITE_SUPABASE_ANON_KEY) {
    return null;
  }

  if (!_client) {
    _client = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_ANON_KEY, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
      },
    });
  }

  return _client;
}

export function resetSupabaseClient(): void {
  _client = null;
}
