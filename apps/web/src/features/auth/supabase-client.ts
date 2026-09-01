import { createClient } from "@supabase/supabase-js";
import type { SupabaseClient } from "@supabase/supabase-js";

function getSupabaseUrl(): string | undefined {
  return import.meta.env?.VITE_SUPABASE_URL;
}

function getSupabaseAnonKey(): string | undefined {
  return import.meta.env?.VITE_SUPABASE_ANON_KEY;
}

export function isSupabaseConfigured(): boolean {
  const url = getSupabaseUrl();
  const anonKey = getSupabaseAnonKey();
  return Boolean(url && anonKey);
}

let _client: SupabaseClient | null = null;

export function getSupabaseClient(): SupabaseClient | null {
  const url = getSupabaseUrl();
  const anonKey = getSupabaseAnonKey();
  if (!url || !anonKey) {
    return null;
  }

  if (!_client) {
    _client = createClient(url, anonKey, {
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

