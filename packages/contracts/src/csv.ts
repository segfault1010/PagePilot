import type {
  AuditCategory,
  Report,
  Severity,
} from "./audit-types.js";
import type {
  WorkItem,
  WorkItemSourceType,
  WorkItemStatus,
} from "./database-types.js";


/**
 * UTF-8 Byte Order Mark (\uFEFF)
 * Ensures Microsoft Excel and other spreadsheet applications automatically
 * recognize the file encoding as UTF-8 without requiring manual import dialogs.
 */
export const UTF8_BOM = "\uFEFF";

/**
 * Characters that trigger formula execution in spreadsheet applications.
 * Any field starting with these characters will be sanitized by prepending a single quote (').
 */
const FORMULA_TRIGGER_REGEX = /^[=+\-@\t\r%]/;

/**
 * Escapes a single CSV field following RFC 4180 rules and OWASP formula injection defenses.
 * 1. If null or undefined, returns empty string.
 * 2. If number or boolean, returns string representation.
 * 3. If string starts with formula triggers (=, +, -, @, \t, \r, %), prepends single quote (').
 * 4. If string contains comma, double quote, newline, or starts with single quote, wraps in quotes
 *    and escapes double quotes as double double-quotes ("").
 */
export function escapeCsvField(value: unknown): string {
  if (value === null || value === undefined) {
    return "";
  }

  if (typeof value === "number") {
    return Number.isFinite(value) ? String(value) : "";
  }

  if (typeof value === "boolean") {
    return String(value);
  }

  let str = Array.isArray(value) ? value.join("; ") : String(value);

  // Normalize line endings to \n inside quoted text for consistency
  str = str.replace(/\r\n/g, "\n").replace(/\r/g, "\n");

  // Prevent Spreadsheet Formula Injection (OWASP CSV Injection)
  const isFormula = FORMULA_TRIGGER_REGEX.test(str);
  if (isFormula) {
    str = "'" + str;
  }

  // RFC 4180 quoting: wrap in double quotes if it contains commas, quotes, newlines, or was formula-sanitized
  const needsQuotes =
    isFormula ||
    str.includes(",") ||
    str.includes('"') ||
    str.includes("\n") ||
    str.startsWith("'");

  if (needsQuotes) {
    return `"${str.replace(/"/g, '""')}"`;
  }

  return str;
}

/**
 * Serializes an array of cell values into an RFC 4180 compliant CSV line ending in CRLF (\r\n).
 */
export function serializeCsvRow(cells: unknown[]): string {
  return cells.map(escapeCsvField).join(",") + "\r\n";
}

/**
 * Deterministic human-readable label mapping for severity.
 */
export function mapSeverityToLabel(severity?: Severity | null): string {
  if (!severity) return "N/A";
  switch (severity) {
    case "high":
      return "High";
    case "medium":
      return "Medium";
    case "low":
      return "Low";
    default:
      return String(severity);
  }
}

/**
 * Deterministic human-readable label mapping for audit categories.
 */
export function mapCategoryToLabel(category?: AuditCategory | null): string {
  if (!category) return "N/A";
  switch (category) {
    case "clarity":
      return "Clarity";
    case "visualHierarchy":
      return "Visual Hierarchy";
    case "ctaEffectiveness":
      return "CTA Effectiveness";
    case "copy":
      return "Copy";
    case "accessibility":
      return "Accessibility";
    case "mobileUx":
      return "Mobile UX";
    case "trustCredibility":
      return "Trust & Credibility";
    default:
      return String(category);
  }
}

/**
 * Deterministic human-readable label mapping for work item status.
 */
export function mapWorkItemStatusToLabel(status?: WorkItemStatus | null): string {
  if (!status) return "Open";
  switch (status) {
    case "open":
      return "Open";
    case "in_progress":
      return "In Progress";
    case "resolved":
      return "Resolved";
    case "dismissed":
      return "Dismissed";
    default:
      return String(status);
  }
}

/**
 * Deterministic human-readable label mapping for effort.
 */
export function mapEffortToLabel(input?: {
  sourceType?: WorkItemSourceType;
  recommendationType?: "quick_win" | "detailed";
  severity?: Severity | null;
}): string {
  if (input?.recommendationType === "quick_win") {
    return "Low (Quick Win)";
  }
  if (input?.recommendationType === "detailed") {
    return "Medium (Detailed Fix)";
  }
  if (input?.sourceType === "recommendation") {
    return "Medium (Detailed Fix)";
  }
  if (input?.sourceType === "finding" || input?.severity) {
    switch (input?.severity) {
      case "high":
        return "High";
      case "medium":
        return "Medium";
      case "low":
        return "Low";
      default:
        return "Standard";
    }
  }
  return "N/A";
}

/**
 * Formats a timestamp into a standardized UTC ISO-8601 string (e.g. 2026-09-04T04:15:00.000Z).
 */
export function formatUtcDateTime(date?: string | Date | null): string {
  if (!date) return "";
  const d = typeof date === "string" ? new Date(date) : date;
  if (isNaN(d.getTime())) return String(date);
  return d.toISOString();
}

// ============================================================================
// WORK ITEMS CSV EXPORT
// ============================================================================

export const WORK_ITEM_CSV_HEADERS = [
  "Work Item ID",
  "Title",
  "Status",
  "Severity",
  "Category",
  "Effort",
  "Source Type",
  "Page URL",
  "Page ID",
  "Assignee Email",
  "Assignee ID",
  "Description",
  "Team Notes",
  "Tags",
  "Resolution Rationale",
  "Created At (UTC)",
  "Updated At (UTC)",
  "Resolved At (UTC)",
] as const;

export interface WorkItemExportRow extends WorkItem {
  pageUrl?: string | null;
  assigneeEmail?: string | null;
}

/**
 * Formats a single WorkItemExportRow into an RFC 4180 CSV line.
 */
export function serializeWorkItemCsvRow(item: WorkItemExportRow): string {
  const effort = mapEffortToLabel({
    sourceType: item.sourceType,
    severity: item.severity,
  });

  return serializeCsvRow([
    item.id,
    item.title,
    mapWorkItemStatusToLabel(item.status),
    mapSeverityToLabel(item.severity),
    mapCategoryToLabel(item.category),
    effort,
    item.sourceType === "finding" ? "Finding" : "Recommendation",
    item.pageUrl || "N/A",
    item.monitoredPageId,
    item.assigneeEmail || "Unassigned",
    item.assigneeId || "",
    item.description || "",
    item.notes || "",
    (item.tags || []).join("; "),
    item.resolutionRationale || "",
    formatUtcDateTime(item.createdAt),
    formatUtcDateTime(item.updatedAt),
    formatUtcDateTime(item.resolvedAt),
  ]);
}

/**
 * Exports a full array of work items into a complete UTF-8 BOM CSV string.
 */
export function exportWorkItemsToCsv(items: WorkItemExportRow[]): string {
  let csv = UTF8_BOM;
  csv += serializeCsvRow([...WORK_ITEM_CSV_HEADERS]);
  for (const item of items) {
    csv += serializeWorkItemCsvRow(item);
  }
  return csv;
}

// ============================================================================
// AUDIT REPORT CSV EXPORT
// ============================================================================

export const AUDIT_REPORT_CSV_HEADERS = [
  "Item Type",
  "Category",
  "Title",
  "Severity",
  "Effort",
  "Basis",
  "Evidence / Details",
  "Recommended Action",
  "Deterministic Signals",
  "Page URL",
  "Overall Page Score",
  "Category Score",
  "Audited At (UTC)",
] as const;

export interface AuditReportCsvRow {
  itemType: "Top Problem" | "Category Finding" | "Quick Win" | "Detailed Recommendation";
  category?: AuditCategory | null;
  title: string;
  severity?: Severity | null;
  effort: string;
  basis?: "Observed on page" | "AI-inferred" | "N/A";
  evidenceOrDetails: string;
  recommendedAction: string;
  deterministicSignals?: string[];
  pageUrl: string;
  overallScore: number;
  categoryScore?: number | null;
  auditedAt: string;
}

/**
 * Formats a single AuditReportCsvRow into an RFC 4180 CSV line.
 */
export function serializeAuditReportCsvRow(row: AuditReportCsvRow): string {
  return serializeCsvRow([
    row.itemType,
    mapCategoryToLabel(row.category),
    row.title,
    mapSeverityToLabel(row.severity),
    row.effort,
    row.basis || "N/A",
    row.evidenceOrDetails,
    row.recommendedAction,
    (row.deterministicSignals || []).join("; "),
    row.pageUrl,
    row.overallScore,
    row.categoryScore !== null && row.categoryScore !== undefined ? row.categoryScore : "N/A",
    formatUtcDateTime(row.auditedAt),
  ]);
}

export interface AuditReportCsvOptions {
  targetUrl?: string;
  auditRunId?: string;
  analyzedAt?: string;
}

/**
 * Converts a validated Report into individual AuditReportCsvRow items.
 */
export function extractAuditReportCsvRows(
  report: Report,
  options?: AuditReportCsvOptions,
): AuditReportCsvRow[] {
  const rows: AuditReportCsvRow[] = [];
  const pageUrl = options?.targetUrl || report.source.requestedUrl || report.source.finalUrl;
  const auditedAt = options?.analyzedAt || report.source.analyzedAt;
  const overallScore = report.overallScore;

  // Category score map
  const categoryScoreMap: Partial<Record<AuditCategory, number>> = {};
  for (const cat of report.categories) {
    categoryScoreMap[cat.category] = cat.score;
  }

  // 1. Top Problems
  for (const tp of report.topProblems) {
    rows.push({
      itemType: "Top Problem",
      category: tp.category || null,
      title: tp.title,
      severity: tp.severity,
      effort: mapEffortToLabel({ sourceType: "finding", severity: tp.severity }),
      basis: tp.basis === "observed" ? "Observed on page" : "AI-inferred",
      evidenceOrDetails: tp.evidence,
      recommendedAction: tp.recommendation,
      deterministicSignals: tp.signalIds,
      pageUrl,
      overallScore,
      categoryScore: tp.category ? categoryScoreMap[tp.category] ?? null : null,
      auditedAt,
    });
  }

  // 2. Category Findings
  for (const cat of report.categories) {
    for (const f of cat.findings) {
      // Avoid duplicate listing if top problem matches
      const isAlreadyTopProblem = report.topProblems.some(
        (tp) => tp.title.trim().toLowerCase() === f.title.trim().toLowerCase(),
      );
      if (!isAlreadyTopProblem) {
        rows.push({
          itemType: "Category Finding",
          category: cat.category,
          title: f.title,
          severity: f.severity,
          effort: mapEffortToLabel({ sourceType: "finding", severity: f.severity }),
          basis: f.basis === "observed" ? "Observed on page" : "AI-inferred",
          evidenceOrDetails: f.evidence,
          recommendedAction: f.recommendation,
          deterministicSignals: f.signalIds,
          pageUrl,
          overallScore,
          categoryScore: cat.score,
          auditedAt,
        });
      }
    }
  }

  // 3. Quick Wins
  for (const qw of report.quickWins) {
    rows.push({
      itemType: "Quick Win",
      category: qw.category || null,
      title: qw.title,
      severity: null,
      effort: mapEffortToLabel({ recommendationType: "quick_win" }),
      basis: "N/A",
      evidenceOrDetails: qw.detail,
      recommendedAction: qw.detail,
      deterministicSignals: [],
      pageUrl,
      overallScore,
      categoryScore: qw.category ? categoryScoreMap[qw.category] ?? null : null,
      auditedAt,
    });
  }

  // 4. Detailed Recommendations
  for (const dr of report.detailedRecommendations) {
    rows.push({
      itemType: "Detailed Recommendation",
      category: dr.category || null,
      title: dr.title,
      severity: null,
      effort: mapEffortToLabel({ recommendationType: "detailed" }),
      basis: "N/A",
      evidenceOrDetails: dr.detail,
      recommendedAction: dr.detail,
      deterministicSignals: [],
      pageUrl,
      overallScore,
      categoryScore: dr.category ? categoryScoreMap[dr.category] ?? null : null,
      auditedAt,
    });
  }

  return rows;
}

/**
 * Exports a validated Report into a complete UTF-8 BOM CSV string.
 */
export function exportAuditReportToCsv(
  report: Report,
  options?: AuditReportCsvOptions,
): string {
  let csv = UTF8_BOM;
  csv += serializeCsvRow([...AUDIT_REPORT_CSV_HEADERS]);
  const rows = extractAuditReportCsvRows(report, options);
  for (const row of rows) {
    csv += serializeAuditReportCsvRow(row);
  }
  return csv;
}
