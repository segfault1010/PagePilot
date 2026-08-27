import { useState } from "react";
import { useAuth } from "../auth-context";
import { AuthModal } from "./auth-modal";

export function AuthNav() {
  const { user, workspace, signOut, isLoading } = useAuth();
  const [modalOpen, setModalOpen] = useState(false);
  const [modalMode, setModalMode] = useState<"signin" | "signup">("signin");

  if (isLoading) {
    return (
      <div className="flex items-center gap-2">
        <div className="h-7 w-20 animate-pulse rounded-md bg-neutral-800" />
      </div>
    );
  }

  if (user) {
    const orgName = workspace?.organization.name || "Workspace";
    const role = workspace?.role || "owner";

    return (
      <div className="flex items-center gap-3">
        <div className="hidden sm:flex flex-col text-right">
          <span className="text-xs font-medium text-neutral-200">{orgName}</span>
          <span className="text-[10px] text-neutral-500">{user.email}</span>
        </div>
        <span className="rounded-md border border-neutral-800 bg-neutral-900 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-neutral-400">
          {role}
        </span>
        <button
          type="button"
          onClick={() => signOut()}
          className="rounded-md border border-neutral-800 px-2.5 py-1 text-xs font-medium text-neutral-400 transition hover:bg-neutral-800 hover:text-neutral-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/80"
        >
          Sign out
        </button>
      </div>
    );
  }

  return (
    <>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => {
            setModalMode("signin");
            setModalOpen(true);
          }}
          className="rounded-md px-3 py-1.5 text-xs font-medium text-neutral-300 transition hover:text-neutral-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/80"
        >
          Sign in
        </button>
        <button
          type="button"
          onClick={() => {
            setModalMode("signup");
            setModalOpen(true);
          }}
          className="rounded-md bg-neutral-50 px-3 py-1.5 text-xs font-semibold text-neutral-900 transition hover:bg-neutral-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/80"
        >
          Get started
        </button>
      </div>

      <AuthModal
        isOpen={modalOpen}
        onClose={() => setModalOpen(false)}
        initialMode={modalMode}
      />
    </>
  );
}
