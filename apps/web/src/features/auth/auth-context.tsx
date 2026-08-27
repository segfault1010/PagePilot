import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import type { Session, SupabaseClient, User } from "@supabase/supabase-js";
import type { WorkspaceContext } from "@pagepilot/contracts";
import { getSupabaseClient, isSupabaseConfigured } from "./supabase-client";

export interface AuthContextValue {
  user: User | null;
  session: Session | null;
  workspace: WorkspaceContext | null;
  isLoading: boolean;
  isConfigured: boolean;
  signIn: (email: string, password: string) => Promise<{ error?: string }>;
  signUp: (email: string, password: string, fullName?: string) => Promise<{ error?: string }>;
  signOut: () => Promise<void>;
  refreshWorkspace: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export interface AuthProviderProps {
  children: ReactNode;
  client?: SupabaseClient | null;
}

export function AuthProvider({ children, client: injectedClient }: AuthProviderProps) {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [workspace, setWorkspace] = useState<WorkspaceContext | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const supabase = injectedClient !== undefined ? injectedClient : getSupabaseClient();
  const isConfigured = Boolean(supabase) || isSupabaseConfigured();

  const fetchWorkspace = useCallback(async (token: string) => {
    try {
      const res = await fetch("/api/workspace/me", {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });
      if (res.ok) {
        const data = await res.json();
        if (data && data.workspace) {
          setWorkspace(data.workspace);
        }
      }
    } catch {
      // Graceful fallback if offline or workspace route fails
    }
  }, []);

  useEffect(() => {
    if (!supabase) {
      setIsLoading(false);
      return;
    }

    let isMounted = true;

    supabase.auth.getSession().then(({ data: { session: initialSession } }) => {
      if (!isMounted) return;
      setSession(initialSession);
      setUser(initialSession?.user ?? null);
      if (initialSession?.access_token) {
        fetchWorkspace(initialSession.access_token).finally(() => {
          if (isMounted) setIsLoading(false);
        });
      } else {
        setIsLoading(false);
      }
    }).catch(() => {
      if (isMounted) setIsLoading(false);
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, currentSession) => {
      if (!isMounted) return;
      setSession(currentSession);
      setUser(currentSession?.user ?? null);
      if (currentSession?.access_token) {
        fetchWorkspace(currentSession.access_token);
      } else {
        setWorkspace(null);
      }
    });

    return () => {
      isMounted = false;
      subscription.unsubscribe();
    };
  }, [supabase, fetchWorkspace]);

  const signIn = useCallback(
    async (email: string, password: string): Promise<{ error?: string }> => {
      if (!supabase) {
        return { error: "Authentication is not configured." };
      }
      try {
        const { data, error } = await supabase.auth.signInWithPassword({
          email,
          password,
        });
        if (error) return { error: error.message };
        if (data.session?.access_token) {
          await fetchWorkspace(data.session.access_token);
        }
        return {};
      } catch (err: any) {
        return { error: err.message || "Failed to sign in." };
      }
    },
    [supabase, fetchWorkspace],
  );

  const signUp = useCallback(
    async (
      email: string,
      password: string,
      fullName?: string,
    ): Promise<{ error?: string }> => {
      if (!supabase) {
        return { error: "Authentication is not configured." };
      }
      try {
        const { data, error } = await supabase.auth.signUp({
          email,
          password,
          options: fullName
            ? {
                data: {
                  full_name: fullName,
                },
              }
            : undefined,
        });
        if (error) return { error: error.message };
        if (data.session?.access_token) {
          await fetchWorkspace(data.session.access_token);
        }
        return {};
      } catch (err: any) {
        return { error: err.message || "Failed to sign up." };
      }
    },
    [supabase, fetchWorkspace],
  );

  const signOut = useCallback(async () => {
    if (!supabase) return;
    try {
      await supabase.auth.signOut();
    } finally {
      setUser(null);
      setSession(null);
      setWorkspace(null);
    }
  }, [supabase]);

  const refreshWorkspace = useCallback(async () => {
    if (session?.access_token) {
      await fetchWorkspace(session.access_token);
    }
  }, [session, fetchWorkspace]);

  const value: AuthContextValue = {
    user,
    session,
    workspace,
    isLoading,
    isConfigured,
    signIn,
    signUp,
    signOut,
    refreshWorkspace,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
}
