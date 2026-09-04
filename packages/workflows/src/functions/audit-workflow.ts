import { NonRetriableError } from "inngest";
import {
  ALERT_CREATED_EVENT,
  AUDIT_REQUESTED_EVENT,
  auditRequestedPayloadSchema,
  buildScreenshotStoragePath,
  SCREENSHOT_STORAGE_BUCKET,
} from "@pagepilot/contracts";
import type { AlertCreatedEvent } from "@pagepilot/contracts";
import {
  analyzeTarget,
  computeAuditDiff,
  createGeminiVisionAuditor,
  PlaywrightBrowserCaptureProvider,
  VisualDiffEngine,
} from "@pagepilot/audit-engine";
import { inngestClient } from "../client.js";
import type { WorkflowDeps } from "../types.js";
import { evaluateAuditAlerts } from "../alerts/alert-evaluation.js";

/**
 * Creates the durable background audit execution workflow with injectable dependencies.
 */
export function createAuditWorkflow(deps: WorkflowDeps) {
  const client = deps.client ?? inngestClient;

  return client.createFunction(
    {
      id: "execute-audit-workflow",
      name: "Execute Audit Workflow",
      retries: 3,
      triggers: [{ event: AUDIT_REQUESTED_EVENT }],
    },
    async ({ event, step }) => {
      // 0. Validate incoming event payload against strict Zod schema
      const parseResult = auditRequestedPayloadSchema.safeParse(event.data);
      if (!parseResult.success) {
        throw new NonRetriableError(
          `Invalid audit/requested event payload: ${parseResult.error.issues[0]?.message || "Validation failed"}`,
        );
      }
      const payload = parseResult.data;

      // -----------------------------------------------------------------------
      // Step 1: Claim and validate audit run
      // -----------------------------------------------------------------------
      const claimResult = await step.run("claim-and-validate-run", async () => {
        // 1a. Load audit run from persistence store
        const run = await deps.auditStore.getAuditRun(payload.auditRunId);
        if (!run) {
          throw new NonRetriableError(`Audit run ${payload.auditRunId} not found.`);
        }

        // 1b. Strict Tenant & Resource Boundary Verification
        if (
          run.organizationId !== payload.organizationId ||
          run.projectId !== payload.projectId ||
          run.monitoredPageId !== payload.monitoredPageId
        ) {
          throw new NonRetriableError(
            `Tenant or resource mismatch for audit run ${payload.auditRunId}.`,
          );
        }

        // 1c. Check if already completed (Idempotent replay protection)
        if (run.status === "completed") {
          return {
            action: "skip" as const,
            reason: "already_completed" as const,
            runId: run.id,
          };
        }

        // 1d. Load monitored page to ensure target exists and belongs to tenant
        const page = await deps.auditStore.getMonitoredPage(
          payload.organizationId,
          payload.projectId,
          payload.monitoredPageId,
        );
        if (!page) {
          throw new NonRetriableError(
            `Monitored page ${payload.monitoredPageId} not found in organization.`,
          );
        }

        // 1e. Atomically claim execution in database (DB-backed concurrency lock)
        const claim = await deps.auditStore.claimRunForExecution(
          payload.organizationId,
          payload.auditRunId,
        );

        if (claim.state === "already_completed") {
          return {
            action: "skip" as const,
            reason: "already_completed" as const,
            runId: run.id,
          };
        }

        if (claim.state === "already_running") {
          // Another worker is actively executing this run
          return {
            action: "skip" as const,
            reason: "already_running" as const,
            runId: run.id,
          };
        }

        if (claim.state === "not_found") {
          throw new NonRetriableError(`Audit run ${payload.auditRunId} not found.`);
        }

        return {
          action: "proceed" as const,
          runId: run.id,
          targetUrl: page.canonicalUrl,
          orgId: payload.organizationId,
          projectId: payload.projectId,
          pageId: payload.monitoredPageId,
        };
      });

      if (claimResult.action === "skip") {
        return {
          ok: true,
          skipped: true,
          reason: claimResult.reason,
          runId: claimResult.runId,
        };
      }

      // -----------------------------------------------------------------------
      // Step 2: Execute Audit Engine
      // -----------------------------------------------------------------------
      const analysisResult = await step.run("execute-audit-engine", async () => {
        const analyzeFn = deps.analyzeUrl ?? analyzeTarget;
        try {
          const outcome = await analyzeFn(claimResult.targetUrl);
          if (!outcome.ok) {
            return {
              ok: false as const,
              status: outcome.status,
              code: outcome.code,
              message: outcome.message,
              retryable: outcome.retryable,
            };
          }
          return {
            ok: true as const,
            report: outcome.report,
          };
        } catch (err: unknown) {
          console.error("[workflows/audit-workflow] unexpected engine failure:", err);
          return {
            ok: false as const,
            status: 502,
            code: "UPSTREAM_FAILURE",
            message: "Failed to analyze landing page.",
            retryable: true,
          };
        }
      });

      // -----------------------------------------------------------------------
      // Step 3: Persist Audit Result
      // -----------------------------------------------------------------------
      const persistResult = await step.run("persist-audit-result", async () => {
        if (analysisResult.ok) {
          const { auditReportId } = await deps.auditStore.persistCompletedAudit(
            claimResult.orgId,
            claimResult.projectId,
            claimResult.pageId,
            claimResult.runId,
            analysisResult.report.source.finalUrl,
            analysisResult.report,
          );
          return {
            status: "completed" as const,
            auditReportId,
            overallScore: analysisResult.report.overallScore,
          };
        } else {
          // Record failure while preserving latest_successful_audit_run_id
          await deps.auditStore.recordRunFailure(
            claimResult.orgId,
            claimResult.projectId,
            claimResult.pageId,
            claimResult.runId,
            {
              code: analysisResult.code,
              message: analysisResult.message,
              retryable: analysisResult.retryable,
            },
          );

          if (!analysisResult.retryable) {
            throw new NonRetriableError(
              `Audit failed with non-retryable error [${analysisResult.code}]: ${analysisResult.message}`,
            );
          } else {
            throw new Error(
              `Audit failed with retryable error [${analysisResult.code}]: ${analysisResult.message}`,
            );
          }
        }
      });

      // -----------------------------------------------------------------------
      // Step 4: Capture Page Screenshots (Decoupled Visual Evidence)
      // -----------------------------------------------------------------------
      const visualOutcome = await step.run("capture-page-screenshots", async () => {
        if (!analysisResult.ok || !deps.screenshotStore) {
          return {
            status: "skipped" as const,
            reason: !analysisResult.ok ? ("audit_failed" as const) : ("no_store" as const),
          };
        }

        try {
          // Idempotency: skip if screenshots already exist for this run
          const existing = await deps.screenshotStore.listScreenshots(claimResult.runId);
          if (existing && existing.length >= 2) {
            return {
              status: "already_completed" as const,
              count: existing.length,
            };
          }

          const browserProvider =
            deps.browserCapture ?? new PlaywrightBrowserCaptureProvider();

          const targetCaptureUrl =
            analysisResult.report.source.finalUrl || claimResult.targetUrl;

          const captureResult = await browserProvider.capture(targetCaptureUrl, {
            viewports: ["desktop", "mobile"],
            captureType: "viewport",
          });

          const savedScreenshots = [];
          for (const cap of captureResult.captures) {
            const ext =
              cap.mimeType === "image/webp"
                ? "webp"
                : cap.mimeType === "image/jpeg"
                  ? "jpg"
                  : "png";

            const storagePath = buildScreenshotStoragePath({
              organizationId: claimResult.orgId,
              projectId: claimResult.projectId,
              monitoredPageId: claimResult.pageId,
              auditRunId: claimResult.runId,
              deviceType: cap.deviceType,
              captureType: cap.captureType,
              extension: ext,
            });

            await deps.screenshotStore.uploadScreenshot({
              storagePath,
              buffer: cap.buffer,
              mimeType: cap.mimeType,
            });

            const meta = await deps.screenshotStore.persistScreenshotMetadata({
              organizationId: claimResult.orgId,
              projectId: claimResult.projectId,
              monitoredPageId: claimResult.pageId,
              auditRunId: claimResult.runId,
              auditReportId:
                persistResult.status === "completed"
                  ? persistResult.auditReportId
                  : undefined,
              deviceType: cap.deviceType,
              captureType: cap.captureType,
              storagePath,
              storageBucket: SCREENSHOT_STORAGE_BUCKET,
              fileSizeBytes: cap.fileSizeBytes,
              mimeType: cap.mimeType,
              width: cap.width,
              height: cap.height,
              capturedAt: cap.capturedAt,
              perceptualHash: cap.perceptualHash,
              blockHashes: cap.blockHashes,
            });

            savedScreenshots.push(meta);
          }

          return {
            status: "completed" as const,
            count: savedScreenshots.length,
          };
        } catch (visualErr: unknown) {
          // Critical Invariant 10: Screenshot failure must NEVER fail or invalidate the static audit
          const message =
            visualErr instanceof Error ? visualErr.message : String(visualErr);
          console.warn(
            `[workflows/audit-workflow] capture-page-screenshots isolated failure: ${message}`
          );
          return {
            status: "failed" as const,
            error: message,
          };
        }
      });

      // -----------------------------------------------------------------------
      // Step 5: Review Visual Hierarchy (Multimodal Vision Analysis - Task 6.2)
      // -----------------------------------------------------------------------
      const visualReviewOutcome = await step.run("review-visual-hierarchy", async () => {
        const hasScreenshots =
          visualOutcome.status === "completed" ||
          visualOutcome.status === "already_completed";

        if (
          !analysisResult.ok ||
          !hasScreenshots ||
          !deps.screenshotStore ||
          !deps.visualAnalysisStore
        ) {
          return {
            status: "skipped" as const,
            reason: !analysisResult.ok
              ? ("audit_failed" as const)
              : !hasScreenshots
                ? ("no_screenshots" as const)
                : ("no_store" as const),
          };
        }

        try {
          // Idempotency check: skip if review already exists
          const existing = await deps.visualAnalysisStore.getVisualReview(claimResult.runId);
          if (existing && existing.status === "completed") {
            return {
              status: "already_completed" as const,
              findingsCount: existing.findings.length,
            };
          }

          const screenshots = await deps.screenshotStore.listScreenshots(claimResult.runId);
          const desktopMeta = screenshots.find((s) => s.deviceType === "desktop");
          const mobileMeta = screenshots.find((s) => s.deviceType === "mobile");

          if (!desktopMeta && !mobileMeta) {
            return {
              status: "skipped" as const,
              reason: "no_screenshots" as const,
            };
          }

          let desktopBuffer: Buffer | null = null;
          let mobileBuffer: Buffer | null = null;

          if (desktopMeta && deps.screenshotStore.downloadScreenshot) {
            desktopBuffer = await deps.screenshotStore.downloadScreenshot(desktopMeta.storagePath);
          }
          if (mobileMeta && deps.screenshotStore.downloadScreenshot) {
            mobileBuffer = await deps.screenshotStore.downloadScreenshot(mobileMeta.storagePath);
          }

          if (!desktopBuffer && !mobileBuffer) {
            return {
              status: "skipped" as const,
              reason: "buffers_unavailable" as const,
            };
          }

          const visionAuditor = deps.visionAuditor ?? createGeminiVisionAuditor();

          const visualReview = await visionAuditor.runVisualReview({
            auditRunId: claimResult.runId,
            auditReportId:
              persistResult.status === "completed"
                ? persistResult.auditReportId
                : undefined,
            targetUrl: analysisResult.report.source.finalUrl || claimResult.targetUrl,
            pageTitle: analysisResult.report.source.title,
            desktopScreenshot: desktopBuffer && desktopMeta
              ? {
                  buffer: desktopBuffer,
                  mimeType: desktopMeta.mimeType,
                  width: desktopMeta.width,
                  height: desktopMeta.height,
                  screenshotId: desktopMeta.id,
                }
              : undefined,
            mobileScreenshot: mobileBuffer && mobileMeta
              ? {
                  buffer: mobileBuffer,
                  mimeType: mobileMeta.mimeType,
                  width: mobileMeta.width,
                  height: mobileMeta.height,
                  screenshotId: mobileMeta.id,
                }
              : undefined,
          });

          const persisted = await deps.visualAnalysisStore.persistVisualReview({
            ...visualReview,
            organizationId: claimResult.orgId,
            projectId: claimResult.projectId,
            monitoredPageId: claimResult.pageId,
            auditReportId:
              persistResult.status === "completed"
                ? persistResult.auditReportId
                : null,
          });

          return {
            status: "completed" as const,
            findingsCount: persisted.findings.length,
          };
        } catch (visionErr: unknown) {
          // Critical Invariant: Vision failure must NEVER fail or invalidate the static audit
          const message =
            visionErr instanceof Error ? visionErr.message : String(visionErr);
          console.warn(
            `[workflows/audit-workflow] review-visual-hierarchy isolated failure: ${message}`
          );
          if (deps.visualAnalysisStore.recordVisualReviewFailure) {
            try {
              await deps.visualAnalysisStore.recordVisualReviewFailure({
                auditRunId: claimResult.runId,
                organizationId: claimResult.orgId,
                projectId: claimResult.projectId,
                monitoredPageId: claimResult.pageId,
                errorMessage: message,
              });
            } catch {
              // Ignore failure recording error
            }
          }
          return {
            status: "failed" as const,
            error: message,
          };
        }
      });

      // -----------------------------------------------------------------------
      // Step 6: Detect Visual Regression (Deterministic Perceptual Diff - Task 6.3)
      // -----------------------------------------------------------------------
      const visualDiffOutcome = await step.run("detect-visual-regression", async () => {
        const hasScreenshots =
          visualOutcome.status === "completed" ||
          visualOutcome.status === "already_completed";

        if (
          !analysisResult.ok ||
          !hasScreenshots ||
          !deps.screenshotStore ||
          !deps.visualDiffStore
        ) {
          return {
            status: "skipped" as const,
            reason: !analysisResult.ok
              ? ("audit_failed" as const)
              : !hasScreenshots
                ? ("no_screenshots" as const)
                : ("no_store" as const),
          };
        }

        try {
          // Idempotency check: skip if diffs already exist
          const existing = await deps.visualDiffStore.getVisualDiffsForRun(claimResult.runId);
          if (existing && existing.length >= 2) {
            return {
              status: "already_completed" as const,
              count: existing.length,
            };
          }

          const currentScreenshots = await deps.screenshotStore.listScreenshots(claimResult.runId);
          if (!currentScreenshots || currentScreenshots.length === 0) {
            return {
              status: "skipped" as const,
              reason: "no_screenshots" as const,
            };
          }

          // Load previous compatible screenshot baseline
          const baselineScreenshots = await deps.visualDiffStore.getPreviousAuditScreenshots(
            claimResult.orgId,
            claimResult.pageId,
            claimResult.runId,
            payload.compareRunId || undefined
          );

          const diffEngine = deps.visualDiffEngine ?? new VisualDiffEngine();
          const savedDiffs = [];

          for (const currentCap of currentScreenshots) {
            const baselineCap = baselineScreenshots.find(
              (b) =>
                b.deviceType === currentCap.deviceType &&
                b.captureType === currentCap.captureType
            );

            const diffResult = diffEngine.compare({
              organizationId: claimResult.orgId,
              projectId: claimResult.projectId,
              monitoredPageId: claimResult.pageId,
              current: {
                auditRunId: claimResult.runId,
                screenshotId: currentCap.id,
                deviceType: currentCap.deviceType,
                captureType: currentCap.captureType,
                width: currentCap.width,
                height: currentCap.height,
                perceptualHash: currentCap.perceptualHash,
                blockHashes: currentCap.blockHashes,
              },
              baseline: baselineCap
                ? {
                    auditRunId: baselineCap.auditRunId,
                    screenshotId: baselineCap.id,
                    deviceType: baselineCap.deviceType,
                    captureType: baselineCap.captureType,
                    width: baselineCap.width,
                    height: baselineCap.height,
                    perceptualHash: baselineCap.perceptualHash,
                    blockHashes: baselineCap.blockHashes,
                  }
                : null,
            });

            const persisted = await deps.visualDiffStore.persistVisualDiff(diffResult);
            savedDiffs.push(persisted);
          }

          return {
            status: "completed" as const,
            count: savedDiffs.length,
          };
        } catch (diffErr: unknown) {
          // Critical Invariant: Visual diff failure must NEVER fail or invalidate static audit or alerts
          const message =
            diffErr instanceof Error ? diffErr.message : String(diffErr);
          console.warn(
            `[workflows/audit-workflow] detect-visual-regression isolated failure: ${message}`
          );
          if (deps.visualDiffStore.recordVisualDiffFailure) {
            try {
              await deps.visualDiffStore.recordVisualDiffFailure({
                auditRunId: claimResult.runId,
                organizationId: claimResult.orgId,
                projectId: claimResult.projectId,
                monitoredPageId: claimResult.pageId,
                errorMessage: message,
              });
            } catch {
              // Ignore failure recording error
            }
          }
          return {
            status: "failed" as const,
            error: message,
          };
        }
      });

      // -----------------------------------------------------------------------
      // Step 7: Evaluate regressions and dispatch alert notifications
      // -----------------------------------------------------------------------
      const alertOutcome = await step.run("evaluate-and-dispatch-alerts", async () => {
        if (!analysisResult.ok) {
          return { dispatchedAlertsCount: 0 };
        }

        // 1. Fetch previous successful audit report (excluding current run)
        const previousReport =
          await deps.auditStore.getPreviousSuccessfulAuditReport(
            claimResult.orgId,
            claimResult.projectId,
            claimResult.pageId,
            claimResult.runId,
          );

        // 2. Compute pure deterministic regression diff
        const diff = computeAuditDiff({
          previousReport,
          currentReport: analysisResult.report,
        });

        // 3. Pure alert evaluation
        const evaluation = evaluateAuditAlerts(diff, {
          organizationId: claimResult.orgId,
          projectId: claimResult.projectId,
          monitoredPageId: claimResult.pageId,
          auditRunId: claimResult.runId,
          consecutiveFailureCount: 0,
          evaluatedAt: new Date().toISOString(),
        });

        if (!evaluation.hasAlerts || evaluation.decisions.length === 0) {
          return { dispatchedAlertsCount: 0 };
        }

        let dispatchedCount = 0;
        const eventsToEmit: AlertCreatedEvent[] = [];

        // 4. Persist alerts with state-aware 24-hour suppression & deduplication
        for (const decision of evaluation.decisions) {
          const { alert, isExisting, isSuppressed } =
            await deps.auditStore.persistAlert({
              organizationId: claimResult.orgId,
              projectId: claimResult.projectId,
              monitoredPageId: claimResult.pageId,
              auditRunId: claimResult.runId,
              ruleType: decision.ruleType,
              severity: decision.severity,
              title: decision.title,
              reasonCode: decision.reason.code,
              reasonSummary: decision.reason.summary,
              reasonDetails: decision.reason.details ?? null,
              category: decision.category ?? null,
              targetId: decision.targetId ?? null,
              scoreDelta: decision.scoreDelta ?? null,
              previousValue:
                decision.previousValue !== undefined
                  ? String(decision.previousValue)
                  : null,
              currentValue:
                decision.currentValue !== undefined
                  ? String(decision.currentValue)
                  : null,
              deduplicationKey: decision.deduplicationKey,
              schemaVersion: decision.schemaVersion,
              status: "created",
              metadata: decision.metadata ?? {},
            });

          // If freshly created (not duplicate and not suppressed by 24h window), queue event
          if (!isExisting && !isSuppressed) {
            eventsToEmit.push({
              name: ALERT_CREATED_EVENT,
              data: {
                alertId: alert.id,
                organizationId: alert.organizationId,
                projectId: alert.projectId,
                monitoredPageId: alert.monitoredPageId,
                auditRunId: alert.auditRunId ?? null,
              },
            });
            dispatchedCount++;
          }
        }

        // 5. Emit Inngest delivery events
        if (eventsToEmit.length > 0 && client.send) {
          await client.send(eventsToEmit);
        }

        return { dispatchedAlertsCount: dispatchedCount };
      });

      return {
        ok: true,
        runId: claimResult.runId,
        status: persistResult.status,
        auditReportId: persistResult.auditReportId,
        overallScore: persistResult.overallScore,
        visualCapturesCount:
          visualOutcome.status === "completed" ? visualOutcome.count : 0,
        visualStatus: visualOutcome.status,
        visualReviewStatus: visualReviewOutcome.status,
        visualDiffStatus: visualDiffOutcome.status,
        visualDiffCount:
          visualDiffOutcome.status === "completed" ? visualDiffOutcome.count : 0,
        dispatchedAlertsCount: alertOutcome.dispatchedAlertsCount,
      };
    },
  );
}

