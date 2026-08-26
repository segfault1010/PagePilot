import type { ReactNode } from "react";
import type { Severity } from "@pagepilot/contracts";

const TONES = {
  solid: "border-transparent bg-white text-neutral-950",
  muted: "border-transparent bg-neutral-800 text-neutral-200",
  outline: "border-neutral-700 text-neutral-300",
} as const;

export type BadgeTone = keyof typeof TONES;

export const SEVERITY_TONE: Record<Severity, BadgeTone> = {
  low: "outline",
  medium: "muted",
  high: "solid",
};

export function Badge({
  tone = "muted",
  children,
}: {
  tone?: BadgeTone;
  children: ReactNode;
}) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-medium ${TONES[tone]}`}
    >
      {children}
    </span>
  );
}
