import type {
  WorkItemAction,
  WorkItemSourceType,
  WorkItemStatus,
} from "@pagepilot/contracts";

export const WORK_ITEM_STATUS_LABELS: Record<WorkItemStatus, string> = {
  open: "Open",
  in_progress: "In Progress",
  resolved: "Resolved",
  dismissed: "Dismissed",
};

export const WORK_ITEM_STATUS_STYLES: Record<
  WorkItemStatus,
  { bg: string; text: string; border: string; dot: string }
> = {
  open: {
    bg: "bg-amber-500/10",
    text: "text-amber-400",
    border: "border-amber-500/30",
    dot: "bg-amber-400",
  },
  in_progress: {
    bg: "bg-blue-500/10",
    text: "text-blue-400",
    border: "border-blue-500/30",
    dot: "bg-blue-400",
  },
  resolved: {
    bg: "bg-emerald-500/10",
    text: "text-emerald-400",
    border: "border-emerald-500/30",
    dot: "bg-emerald-400",
  },
  dismissed: {
    bg: "bg-neutral-800/60",
    text: "text-neutral-400",
    border: "border-neutral-700/40",
    dot: "bg-neutral-500",
  },
};

export const WORK_ITEM_SOURCE_LABELS: Record<WorkItemSourceType, string> = {
  finding: "Finding",
  recommendation: "Recommendation",
};

export const WORK_ITEM_ACTION_LABELS: Record<WorkItemAction, string> = {
  created: "Created work item",
  status_changed: "Changed status",
  assigned: "Assigned member",
  unassigned: "Unassigned member",
  updated: "Updated details",
  notes_updated: "Updated notes",
};
