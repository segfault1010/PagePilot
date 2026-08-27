// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AuthModal } from "../src/features/auth/components/auth-modal";
import { AuthProvider } from "../src/features/auth/auth-context";

describe("AuthModal Component", () => {
  afterEach(() => {
    cleanup();
  });

  it("renders sign in form with accessible attributes", () => {
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
        <AuthModal isOpen={true} onClose={vi.fn()} initialMode="signin" />
      </AuthProvider>,
    );

    expect(screen.getByRole("dialog")).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Welcome back" })).toBeTruthy();
    expect(screen.getByLabelText("Email address")).toBeTruthy();
    expect(screen.getByLabelText("Password")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Sign in to workspace" })).toBeTruthy();
  });

  it("switches to create account tab and shows Full name field", async () => {
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
        <AuthModal isOpen={true} onClose={vi.fn()} initialMode="signin" />
      </AuthProvider>,
    );

    expect(screen.queryByLabelText("Full name")).toBeNull();

    fireEvent.click(screen.getByRole("tab", { name: "Create account" }));

    expect(screen.getByRole("heading", { name: "Create your workspace" })).toBeTruthy();
    expect(screen.getByLabelText("Full name")).toBeTruthy();
  });

  it("displays error message when sign in fails", async () => {
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
        <AuthModal isOpen={true} onClose={vi.fn()} initialMode="signin" />
      </AuthProvider>,
    );

    fireEvent.change(screen.getByLabelText("Email address"), {
      target: { value: "bad@example.com" },
    });
    fireEvent.change(screen.getByLabelText("Password"), {
      target: { value: "wrongpassword" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Sign in to workspace" }));

    await waitFor(() => {
      expect(screen.getByRole("alert").textContent).toContain("Invalid login credentials");
    });
  });
});
