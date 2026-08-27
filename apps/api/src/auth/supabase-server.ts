import { createClient } from "@supabase/supabase-js";
import type { SupabaseClient, User } from "@supabase/supabase-js";

export interface ServerAuthConfig {
  supabaseUrl?: string;
  supabaseAnonKey?: string;
  supabaseServiceRoleKey?: string;
}

export function getServerAuthConfig(): ServerAuthConfig {
  return {
    supabaseUrl: process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL,
    supabaseAnonKey: process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY,
    supabaseServiceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY,
  };
}

/**
 * Creates a server-side Supabase client for standard token validation.
 * Uses anon/public key by default so user JWTs operate under standard RLS rules.
 */
export function createServerSupabaseClient(
  config: ServerAuthConfig = getServerAuthConfig(),
  authToken?: string,
): SupabaseClient | null {
  if (!config.supabaseUrl || (!config.supabaseAnonKey && !config.supabaseServiceRoleKey)) {
    return null;
  }

  const key = config.supabaseAnonKey || config.supabaseServiceRoleKey;
  if (!key) return null;

  return createClient(config.supabaseUrl, key, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
    global: authToken
      ? {
          headers: {
            Authorization: `Bearer ${authToken}`,
          },
        }
      : undefined,
  });
}

/**
 * Creates a privileged service-role Supabase client isolated strictly for
 * atomic first-user workspace provisioning where initial org/membership creation
 * requires administrative execution.
 */
export function createPrivilegedSupabaseClient(
  config: ServerAuthConfig = getServerAuthConfig(),
): SupabaseClient | null {
  if (!config.supabaseUrl || !config.supabaseServiceRoleKey) {
    return null;
  }

  return createClient(config.supabaseUrl, config.supabaseServiceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}

export interface VerifiedUser {
  id: string;
  email: string;
  fullName?: string | null;
  avatarUrl?: string | null;
}

/**
 * Verifies a JWT Bearer access token using Supabase Auth without trusting
 * any client-supplied user IDs or parameters.
 */
export async function verifyAccessToken(
  token: string,
  client?: SupabaseClient | null,
): Promise<VerifiedUser | null> {
  const supabase = client ?? createServerSupabaseClient(getServerAuthConfig(), token);
  if (!supabase) return null;

  try {
    const { data, error } = await supabase.auth.getUser(token);
    if (error || !data.user || !data.user.id || !data.user.email) {
      return null;
    }

    const user: User = data.user;
    return {
      id: user.id,
      email: user.email as string,
      fullName: (user.user_metadata?.full_name as string) || null,
      avatarUrl: (user.user_metadata?.avatar_url as string) || null,
    };
  } catch {
    return null;
  }
}
