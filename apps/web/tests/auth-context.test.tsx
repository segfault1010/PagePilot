// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AuthProvider, useAuth } from "../src/features/auth/auth-context";

function TestConsumer() {
  const { user, workspace, isLoading, signIn, signOut } = useAuth();
  if (isLoading) return <div>Loading auth...</div>;
  return (
    <div>
      <div data-testid="user-status">{user ? `User: ${user.email}` : "Anonymous"}</div>
      {workspace && <div data-testid="org-name">{workspace.organization.name}</div>}
      <button onClick={() => signIn("test@example.com", "password123")}>Sign In</button>
      <button onClick={() => signOut()}>Sign Out</button>
    </div>
  );
}

describe("AuthContext & AuthProvider", () => {
  afterEach(() => {
    cleanup();
  });

  it("renders anonymous state when no session exists", async () => {
    const mockClient: any = {
      auth: {
        getSession: vi.fn().mockResolvedValue({ data: { session: null } }),
        onAuthStateChange: vi.fn().mockReturnValue({
          data: { subscription: { unsubscribe: vi.fn() } },
        }),
      },
    };

    render(
      <AuthProvider client={mockClient}>
        <TestConsumer />
      </AuthProvider>,
    );

    await waitFor(() => {
      expect(screen.getByTestId("user-status").textContent).toContain("Anonymous");
    });
  });

  it("restores active session and user info", async () => {
    const mockSession = {
      access_token: "mock-jwt-token",
      user: {
        id: "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11",
        email: "sarah@growth.com",
      },
    };

    const mockClient: any = {
      auth: {
        getSession: vi.fn().mockResolvedValue({ data: { session: mockSession } }),
        onAuthStateChange: vi.fn().mockReturnValue({
          data: { subscription: { unsubscribe: vi.fn() } },
        }),
      },
    };

    render(
      <AuthProvider client={mockClient}>
        <TestConsumer />
      </AuthProvider>,
    );

    await waitFor(() => {
      expect(screen.getByTestId("user-status").textContent).toContain("User: sarah@growth.com");
    });
  });

  it("handles sign in and updates user state", async () => {
    let authListener: any = null;
    const mockSession = {
      access_token: "mock-token-2",
      user: {
        id: "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a22",
        email: "test@example.com",
      },
    };

    const mockClient: any = {
      auth: {
        getSession: vi.fn().mockResolvedValue({ data: { session: null } }),
        onAuthStateChange: vi.fn((callback) => {
          authListener = callback;
          return { data: { subscription: { unsubscribe: vi.fn() } } };
        }),
        signInWithPassword: vi.fn().mockImplementation(async () => {
          if (authListener) authListener("SIGNED_IN", mockSession);
          return { data: { session: mockSession }, error: null };
        }),
        signOut: vi.fn().mockImplementation(async () => {
          if (authListener) authListener("SIGNED_OUT", null);
        }),
      },
    };

    render(
      <AuthProvider client={mockClient}>
        <TestConsumer />
      </AuthProvider>,
    );

    await waitFor(() => {
      expect(screen.getByTestId("user-status").textContent).toContain("Anonymous");
    });

    fireEvent.click(screen.getByText("Sign In"));

    await waitFor(() => {
      expect(screen.getByTestId("user-status").textContent).toContain("User: test@example.com");
    });

    fireEvent.click(screen.getByText("Sign Out"));

    await waitFor(() => {
      expect(screen.getByTestId("user-status").textContent).toContain("Anonymous");
    });
  });
});
