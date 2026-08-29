import type { NotificationPayload } from "./types.js";

function escapeHtml(unsafe: string): string {
  return unsafe
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

export interface RenderedEmailContent {
  subject: string;
  text: string;
  html: string;
}

/**
 * Pure deterministic email builder for alert notifications.
 *
 * Requirements:
 * - Normalized product info (project, page URL, severity, score change, finding summary).
 * - Clear action link to PagePilot workspace.
 * - Strictly excludes raw HTML, provider payloads, internal IP/DNS, and secrets.
 */
export function buildAlertEmailContent(
  payload: NotificationPayload,
): RenderedEmailContent {
  const severityUpper = payload.severity.toUpperCase();
  const projectLabel = payload.projectName ? `[${payload.projectName}] ` : "";
  const pageHost = (() => {
    try {
      return new URL(payload.pageUrl).hostname;
    } catch {
      return payload.pageUrl;
    }
  })();

  const subject = `[PagePilot Alert] [${severityUpper}] ${projectLabel}${payload.title} — ${pageHost}`;

  const workspaceLink = `${payload.appBaseUrl.replace(/\/+$/, "")}/workspace?project=${encodeURIComponent(payload.projectId)}&page=${encodeURIComponent(payload.monitoredPageId)}`;

  // Metric line
  let metricLineText = "";
  let metricLineHtml = "";

  if (payload.scoreDelta !== undefined && payload.scoreDelta !== null) {
    const deltaSign = payload.scoreDelta > 0 ? `+${payload.scoreDelta}` : `${payload.scoreDelta}`;
    metricLineText = `Score Change: ${payload.previousValue ?? "N/A"} -> ${payload.currentValue ?? "N/A"} (${deltaSign} pts)\n`;
    metricLineHtml = `<p style="margin: 8px 0; font-size: 15px;"><strong>Score Change:</strong> ${escapeHtml(String(payload.previousValue ?? "N/A"))} &rarr; ${escapeHtml(String(payload.currentValue ?? "N/A"))} <span style="color: #e11d48; font-weight: bold;">(${deltaSign} pts)</span></p>`;
  } else if (payload.previousValue !== undefined && payload.previousValue !== null && payload.currentValue !== undefined && payload.currentValue !== null) {
    metricLineText = `Status Change: ${payload.previousValue} -> ${payload.currentValue}\n`;
    metricLineHtml = `<p style="margin: 8px 0; font-size: 15px;"><strong>Status Change:</strong> ${escapeHtml(String(payload.previousValue))} &rarr; ${escapeHtml(String(payload.currentValue))}</p>`;
  } else if (payload.currentValue !== undefined && payload.currentValue !== null) {
    metricLineText = `Value: ${payload.currentValue}\n`;
    metricLineHtml = `<p style="margin: 8px 0; font-size: 15px;"><strong>Value:</strong> ${escapeHtml(String(payload.currentValue))}</p>`;
  }

  const categoryText = payload.category ? `Category: ${payload.category}\n` : "";
  const categoryHtml = payload.category
    ? `<p style="margin: 8px 0; font-size: 15px;"><strong>Category:</strong> ${escapeHtml(payload.category)}</p>`
    : "";

  const detailsText = payload.reasonDetails ? `Details: ${payload.reasonDetails}\n` : "";
  const detailsHtml = payload.reasonDetails
    ? `<p style="margin: 8px 0; font-size: 14px; color: #475569; background: #f8fafc; padding: 12px; border-radius: 6px; border-left: 4px solid #cbd5e1;">${escapeHtml(payload.reasonDetails)}</p>`
    : "";

  // Plaintext body
  const text = [
    `PAGEPILOT UX ALERT — ${severityUpper}`,
    `========================================`,
    ``,
    `Title: ${payload.title}`,
    `Severity: ${severityUpper}`,
    `Page: ${payload.pageUrl}`,
    payload.projectName ? `Project: ${payload.projectName}` : "",
    categoryText,
    metricLineText,
    `Summary: ${payload.reasonSummary}`,
    detailsText,
    `View report in PagePilot:`,
    workspaceLink,
    ``,
    `----------------------------------------`,
    `This is an automated alert from PagePilot continuous landing page monitoring.`,
  ]
    .filter((line) => line !== undefined && line !== "")
    .join("\n");

  const severityColor =
    payload.severity === "high"
      ? "#e11d48"
      : payload.severity === "medium"
        ? "#d97706"
        : "#2563eb";

  const severityBg =
    payload.severity === "high"
      ? "#ffe4e6"
      : payload.severity === "medium"
        ? "#fef3c7"
        : "#dbeafe";

  // Semantic HTML body
  const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${escapeHtml(subject)}</title>
</head>
<body style="margin: 0; padding: 0; background-color: #f1f5f9; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color: #0f172a;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #f1f5f9; padding: 24px 0;">
    <tr>
      <td align="center">
        <table width="600" cellpadding="0" cellspacing="0" style="max-width: 600px; width: 100%; background: #ffffff; border-radius: 12px; overflow: hidden; border: 1px solid #e2e8f0; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.05);">
          <!-- Header -->
          <tr>
            <td style="padding: 24px 32px; background: #0f172a; color: #ffffff;">
              <span style="font-size: 18px; font-weight: bold; letter-spacing: -0.5px;">PagePilot</span>
              <span style="font-size: 13px; color: #94a3b8; margin-left: 8px;">Continuous UX Intelligence</span>
            </td>
          </tr>

          <!-- Main Content -->
          <tr>
            <td style="padding: 32px;">
              <div style="display: inline-block; padding: 4px 10px; border-radius: 9999px; background: ${severityBg}; color: ${severityColor}; font-size: 12px; font-weight: bold; letter-spacing: 0.5px; text-transform: uppercase; margin-bottom: 12px;">
                ${severityUpper} SEVERITY ALERT
              </div>

              <h1 style="margin: 0 0 16px 0; font-size: 22px; font-weight: 700; color: #0f172a; line-height: 1.3;">
                ${escapeHtml(payload.title)}
              </h1>

              <p style="margin: 0 0 20px 0; font-size: 16px; color: #334155; line-height: 1.5;">
                ${escapeHtml(payload.reasonSummary)}
              </p>

              <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 16px 20px; margin-bottom: 24px;">
                <p style="margin: 0 0 8px 0; font-size: 14px; color: #64748b;">
                  <strong>Monitored Page:</strong> <a href="${escapeHtml(payload.pageUrl)}" style="color: #2563eb; text-decoration: none;" target="_blank">${escapeHtml(payload.pageUrl)}</a>
                </p>
                ${payload.projectName ? `<p style="margin: 0 0 8px 0; font-size: 14px; color: #64748b;"><strong>Project:</strong> ${escapeHtml(payload.projectName)}</p>` : ""}
                ${categoryHtml}
                ${metricLineHtml}
              </div>

              ${detailsHtml}

              <!-- Action CTA -->
              <div style="margin-top: 32px; text-align: center;">
                <a href="${escapeHtml(workspaceLink)}" style="display: inline-block; background: #0f172a; color: #ffffff; padding: 12px 28px; border-radius: 8px; font-size: 15px; font-weight: 600; text-decoration: none; box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);" target="_blank">
                  View Full Audit & Findings &rarr;
                </a>
              </div>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="padding: 20px 32px; background: #f8fafc; border-top: 1px solid #e2e8f0; font-size: 12px; color: #64748b; text-align: center;">
              This is an automated alert from PagePilot continuous landing page monitoring.<br />
              You are receiving this because you are an owner or administrator in this workspace.
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;

  return {
    subject,
    text,
    html,
  };
}
