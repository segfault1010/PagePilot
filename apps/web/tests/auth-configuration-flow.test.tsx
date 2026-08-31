// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AuthProvider } from "../src/features/auth/auth-context";
import { AuthModal } from "../src/features/auth/components/auth-modal";
import { resetSupabaseClient } from "../src/features/auth/supabase-client";

describe("Auth Configuration in UI", () => {
  beforeEach(() => {
    resetSupabaseClient();
    vi.unstubAllEnvs();
  });

  afterEach(() => {
    cleanup();
    resetSupabaseClient();
    vi.unstubAllEnvs();
  });

  it("shows 'Authentication is not configured.' error when env vars are missing and user submits modal", async () => {
    vi.stubEnv("VITE_SUPABASE_URL", "");
    vi.stubEnv("VITE_SUPABASE_ANON_KEY", "");

    render(
      <AuthProvider client={null}>
        <AuthModal isOpen={true} onClose={() => {}} initialMode="signin" />
      </AuthProvider>,
    );

    const emailInput = screen.getByLabelText(/Email address/i);
    const passwordInput = screen.getByLabelText(/Password/i);
    const submitBtn = screen.getByRole("button", { name: /Sign in to workspace/i });

    fireEvent.change(emailInput, { target: { value: "user@example.com" } });
    fireEvent.change(passwordInput, { target: { value: "password123" } });
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(screen.getByRole("alert").textContent).toContain("Authentication is not configured.");
    });
  });

  it("does NOT show 'Authentication is not configured.' when Supabase is configured", async () => {
    const mockClient: any = {
      auth: {
        getSession: vi.fn().mockResolvedValue({ data: { session: null } }),
        onAuthStateChange: vi.fn().mockReturnValue({
          data: { subscription: { unsubscribe: vi.fn() } },
        }),
        signInWithPassword: vi.fn().mockResolvedValue({
          data: { session: null },
          error: { message: "Invalid login credentials" },
        }),
      },
    };

    render(
      <AuthProvider client={mockClient}>
        <AuthModal isOpen={true} onClose={() => {}} initialMode="signin" />
      </AuthProvider>,
    );

    const emailInput = screen.getByLabelText(/Email address/i);
    const passwordInput = screen.getByLabelText(/Password/i);
    const submitBtn = screen.getByRole("button", { name: /Sign in to workspace/i });

    fireEvent.change(emailInput, { target: { value: "user@example.com" } });
    fireEvent.change(passwordInput, { target: { value: "password123" } });
    fireEvent.click(submitBtn);

    await waitFor(() => {
      // The error should come from the configured Supabase provider, NOT "Authentication is not configured."
      expect(screen.getByRole("alert").textContent).toBe("Invalid login credentials");
      expect(screen.getByRole("alert").textContent).not.toContain("Authentication is not configured.");
    });
  });
});
