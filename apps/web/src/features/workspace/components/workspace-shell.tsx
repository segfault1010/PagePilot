import { useCallback, useEffect, useState } from "react";
import type {
  AuditHistoryItem,
  CreateMonitoredPageInput,
  CreateProjectInput,
  MonitoredPage,
  OrganizationMember,
  PersistedAuditReportResponse,
  Project,
  Role,
  UpdateMonitoredPageInput,
  UpdateProjectInput,
} from "@pagepilot/contracts";
import { useAuth } from "../../auth/auth-context";
import { BrandMark } from "../../analysis/components/brand-mark";
import {
  createMonitoredPage,
  createProject,
  deleteMonitoredPage,
  deleteProject,
  getMonitoredPage,
  getProject,
  listMonitoredPages,
  listProjects,
  updateMonitoredPage,
  updateProject,
} from "../../projects/api";
import {
  getAuditReportByRunId,
  getLatestAuditReport,
  listAuditHistory,
  triggerManualAudit,
} from "../../audits/api";
import { listOrganizationMembers } from "../../work-items/api";
import { ProjectList } from "./project-list";
import { ProjectDetail } from "./project-detail";
import { PageDetail } from "./page-detail";
import { HistoricalReportView } from "./historical-report-view";
import { WorkItemsBacklog } from "../../work-items/components/work-items-backlog";

const PAGE_SIZE = 10;

export interface WorkspaceShellProps {
  onSwitchToOneOffAudit: () => void;
}

export function WorkspaceShell({ onSwitchToOneOffAudit }: WorkspaceShellProps) {
  const { user, workspace, signOut } = useAuth();
  const role: Role = workspace?.role || "owner";
  const orgName = workspace?.organization.name || "Workspace";

  // Navigation tab state
  const [navSection, setNavSection] = useState<"projects" | "work">("projects");

  // Organization Members
  const [members, setMembers] = useState<OrganizationMember[]>([]);

  // Navigation / Selection State
  const [projects, setProjects] = useState<Project[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(() => {
    return sessionStorage.getItem("pagepilot_selected_project_id");
  });
  const [selectedProject, setSelectedProject] = useState<Project | null>(null);

  const [pages, setPages] = useState<MonitoredPage[]>([]);
  const [selectedPageId, setSelectedPageId] = useState<string | null>(() => {
    return sessionStorage.getItem("pagepilot_selected_page_id");
  });
  const [selectedPage, setSelectedPage] = useState<MonitoredPage | null>(null);

  // Audit History State
  const [history, setHistory] = useState<AuditHistoryItem[]>([]);
  const [historyTotal, setHistoryTotal] = useState(0);
  const [historyPage, setHistoryPage] = useState(1);
  const [isLoadingHistory, setIsLoadingHistory] = useState(false);

  // Active Report View State
  const [activeReport, setActiveReport] = useState<PersistedAuditReportResponse | null>(null);
  const [isLatestReportView, setIsLatestReportView] = useState(false);

  // Loading States
  const [isLoadingProjects, setIsLoadingProjects] = useState(true);
  const [isLoadingPages, setIsLoadingPages] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // ---------------------------------------------------------------------------
  // 1. Fetch Projects & Validate Stored Selection Safely
  // ---------------------------------------------------------------------------
  const fetchProjects = useCallback(async () => {
    setIsLoadingProjects(true);
    setErrorMessage(null);
    try {
      const res = await listProjects();
      setProjects(res.projects);

      // Re-validate stored project selection safely through API
      if (selectedProjectId) {
        const found = res.projects.find((p) => p.id === selectedProjectId);
        if (found) {
          setSelectedProject(found);
        } else {
          try {
            const fetched = await getProject(selectedProjectId);
            setSelectedProject(fetched.project);
          } catch {
            // If stored project no longer exists or belongs to another org, safely clear
            setSelectedProjectId(null);
            setSelectedProject(null);
            sessionStorage.removeItem("pagepilot_selected_project_id");
          }
        }
      }
    } catch (err: any) {
      setErrorMessage(err?.message || "Failed to load projects.");
    } finally {
      setIsLoadingProjects(false);
    }
  }, [selectedProjectId]);

  useEffect(() => {
    fetchProjects();
  }, [fetchProjects]);

  // ---------------------------------------------------------------------------
  // Fetch Organization Members
  // ---------------------------------------------------------------------------
  const fetchMembers = useCallback(async () => {
    try {
      const res = await listOrganizationMembers();
      setMembers(res.members);
    } catch (err: any) {
      console.error("[workspace] failed to load organization members:", err);
    }
  }, []);

  useEffect(() => {
    fetchMembers();
  }, [fetchMembers]);

  // ---------------------------------------------------------------------------
  // 2. Fetch Pages for Selected Project & Validate Stored Page Safely
  // ---------------------------------------------------------------------------
  const fetchPages = useCallback(async (projectId: string) => {
    setIsLoadingPages(true);
    try {
      const res = await listMonitoredPages(projectId);
      setPages(res.pages);

      // Re-validate stored page selection safely
      if (selectedPageId) {
        const found = res.pages.find((p) => p.id === selectedPageId);
        if (found) {
          setSelectedPage(found);
        } else {
          try {
            const fetched = await getMonitoredPage(projectId, selectedPageId);
            setSelectedPage(fetched.page);
          } catch {
            setSelectedPageId(null);
            setSelectedPage(null);
            sessionStorage.removeItem("pagepilot_selected_page_id");
          }
        }
      }
    } catch (err: any) {
      setErrorMessage(err?.message || "Failed to load monitored pages.");
    } finally {
      setIsLoadingPages(false);
    }
  }, [selectedPageId]);

  useEffect(() => {
    if (selectedProject) {
      fetchPages(selectedProject.id);
    } else {
      setPages([]);
      setSelectedPage(null);
      setSelectedPageId(null);
    }
  }, [selectedProject, fetchPages]);

  // ---------------------------------------------------------------------------
  // 3. Fetch Audit History for Selected Page
  // ---------------------------------------------------------------------------
  const fetchHistory = useCallback(
    async (projectId: string, pageId: string, pageNum: number) => {
      setIsLoadingHistory(true);
      try {
        const offset = (pageNum - 1) * PAGE_SIZE;
        const res = await listAuditHistory(projectId, pageId, {
          limit: PAGE_SIZE,
          offset,
        });
        setHistory(res.audits);
        setHistoryTotal(res.total);
      } catch (err: any) {
        console.error("[workspace] failed to load audit history:", err);
      } finally {
        setIsLoadingHistory(false);
      }
    },
    [],
  );

  useEffect(() => {
    if (selectedProject && selectedPage) {
      fetchHistory(selectedProject.id, selectedPage.id, historyPage);
    } else {
      setHistory([]);
      setHistoryTotal(0);
    }
  }, [selectedProject, selectedPage, historyPage, fetchHistory]);

  // ---------------------------------------------------------------------------
  // 4. Project Actions
  // ---------------------------------------------------------------------------
  const handleSelectProject = (project: Project) => {
    setSelectedProjectId(project.id);
    setSelectedProject(project);
    sessionStorage.setItem("pagepilot_selected_project_id", project.id);
    setSelectedPageId(null);
    setSelectedPage(null);
    sessionStorage.removeItem("pagepilot_selected_page_id");
    setActiveReport(null);
    setNavSection("projects");
  };

  const handleBackToProjects = () => {
    setSelectedProjectId(null);
    setSelectedProject(null);
    sessionStorage.removeItem("pagepilot_selected_project_id");
    setSelectedPageId(null);
    setSelectedPage(null);
    sessionStorage.removeItem("pagepilot_selected_page_id");
    setActiveReport(null);
    setNavSection("projects");
  };

  const handleCreateProject = async (data: CreateProjectInput) => {
    const res = await createProject(data);
    setProjects((prev) => [res.project, ...prev]);
    handleSelectProject(res.project);
  };

  const handleUpdateProject = async (projectId: string, data: UpdateProjectInput) => {
    const res = await updateProject(projectId, data);
    setProjects((prev) =>
      prev.map((p) => (p.id === projectId ? res.project : p)),
    );
    if (selectedProject?.id === projectId) {
      setSelectedProject(res.project);
    }
  };

  const handleDeleteProject = async (projectId: string) => {
    await deleteProject(projectId);
    setProjects((prev) => prev.filter((p) => p.id !== projectId));
    if (selectedProjectId === projectId) {
      handleBackToProjects();
    }
  };

  // ---------------------------------------------------------------------------
  // 5. Monitored Page Actions
  // ---------------------------------------------------------------------------
  const handleSelectPage = (page: MonitoredPage) => {
    setSelectedPageId(page.id);
    setSelectedPage(page);
    sessionStorage.setItem("pagepilot_selected_page_id", page.id);
    setHistoryPage(1);
    setActiveReport(null);
    setNavSection("projects");
  };

  const handleBackToProject = () => {
    setSelectedPageId(null);
    setSelectedPage(null);
    sessionStorage.removeItem("pagepilot_selected_page_id");
    setActiveReport(null);
    setNavSection("projects");
  };

  const handleCreatePage = async (data: CreateMonitoredPageInput) => {
    if (!selectedProject) return;
    const res = await createMonitoredPage(selectedProject.id, data);
    setPages((prev) => [res.page, ...prev]);
  };

  const handleUpdatePage = async (pageId: string, data: UpdateMonitoredPageInput) => {
    if (!selectedProject) return;
    const res = await updateMonitoredPage(selectedProject.id, pageId, data);
    setPages((prev) =>
      prev.map((p) => (p.id === pageId ? res.page : p)),
    );
    if (selectedPage?.id === pageId) {
      setSelectedPage(res.page);
    }
  };

  const handleDeletePage = async (pageId: string) => {
    if (!selectedProject) return;
    await deleteMonitoredPage(selectedProject.id, pageId);
    setPages((prev) => prev.filter((p) => p.id !== pageId));
    if (selectedPageId === pageId) {
      handleBackToProject();
    }
  };

  // ---------------------------------------------------------------------------
  // 6. Audit Execution & Report Viewing Actions
  // ---------------------------------------------------------------------------
  const handleRunAudit = async (idempotencyKey: string) => {
    if (!selectedProject || !selectedPage) return;
    const res = await triggerManualAudit(selectedProject.id, selectedPage.id, {
      idempotencyKey,
    });

    // Refresh page state and history
    const refreshed = await getMonitoredPage(selectedProject.id, selectedPage.id);
    setSelectedPage(refreshed.page);
    setPages((prev) =>
      prev.map((p) => (p.id === refreshed.page.id ? refreshed.page : p)),
    );
    await fetchHistory(selectedProject.id, selectedPage.id, 1);
    setHistoryPage(1);

    // If report is returned, user can immediately view it or stay on page
    if (res.report && res.auditReportId) {
      // Latest audit succeeded
    }
  };

  const handleViewLatestReport = async () => {
    if (!selectedProject || !selectedPage) return;
    try {
      const persisted = await getLatestAuditReport(selectedProject.id, selectedPage.id);
      setActiveReport(persisted);
      setIsLatestReportView(true);
    } catch (err: any) {
      setErrorMessage(err?.message || "Failed to load latest audit report.");
    }
  };

  const handleViewHistoricalReport = async (runId: string) => {
    if (!selectedProject || !selectedPage) return;
    try {
      const persisted = await getAuditReportByRunId(selectedProject.id, selectedPage.id, runId);
      setActiveReport(persisted);
      setIsLatestReportView(false);
    } catch (err: any) {
      setErrorMessage(err?.message || "Failed to load historical audit report.");
    }
  };

  const handleBackToPageDetail = () => {
    setActiveReport(null);
  };

  return (
    <div className="min-h-screen bg-neutral-950 text-neutral-100">
      {/* Workspace Header */}
      <header className="border-b border-neutral-900 bg-neutral-950/80 backdrop-blur-md sticky top-0 z-30">
        <div className="mx-auto flex w-full max-w-6xl items-center justify-between px-6 py-4">
          <div className="flex items-center gap-6">
            <div className="flex items-center gap-2.5">
              <BrandMark />
              <span className="text-xs font-semibold uppercase tracking-wider text-neutral-400">
                Workspace
              </span>
            </div>

            {/* Navigation Tabs */}
            <nav className="hidden sm:flex items-center gap-2 border-l border-neutral-800 pl-6 text-xs">
              <button
                type="button"
                onClick={() => {
                  setNavSection("projects");
                  setActiveReport(null);
                }}
                className={`rounded-md px-3 py-1.5 font-medium transition ${
                  navSection === "projects"
                    ? "bg-neutral-900 text-neutral-100"
                    : "text-neutral-400 hover:text-neutral-200"
                }`}
              >
                Projects
              </button>
              <button
                type="button"
                onClick={() => {
                  setNavSection("work");
                  setActiveReport(null);
                }}
                className={`rounded-md px-3 py-1.5 font-medium transition ${
                  navSection === "work"
                    ? "bg-neutral-900 text-neutral-100"
                    : "text-neutral-400 hover:text-neutral-200"
                }`}
              >
                Work Backlog
              </button>
              <button
                type="button"
                onClick={onSwitchToOneOffAudit}
                className="rounded-md px-3 py-1.5 font-medium text-neutral-400 transition hover:text-neutral-200"
              >
                One-Off Audit
              </button>
            </nav>
          </div>

          {/* User & Role & Sign Out */}
          <div className="flex items-center gap-3">
            <div className="hidden sm:flex flex-col text-right">
              <span className="text-xs font-medium text-neutral-200">{orgName}</span>
              <span className="text-[10px] text-neutral-400">{user?.email}</span>
            </div>
            <span className="rounded border border-neutral-800 bg-neutral-900 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-neutral-400">
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
        </div>
      </header>

      {/* Main Workspace Body */}
      <main className="mx-auto w-full max-w-6xl px-6 py-8">
        {errorMessage && (
          <div
            role="alert"
            className="mb-6 flex items-center justify-between rounded-xl border border-red-900/50 bg-red-950/40 p-4 text-xs text-red-300"
          >
            <span>{errorMessage}</span>
            <button
              type="button"
              onClick={() => setErrorMessage(null)}
              className="rounded px-2 py-1 text-red-400 hover:text-red-200"
            >
              Dismiss
            </button>
          </div>
        )}

        {/* View Routing */}
        {navSection === "work" ? (
          <WorkItemsBacklog
            projects={projects}
            selectedProjectId={selectedProjectId}
            onSelectProject={(pId) => {
              setSelectedProjectId(pId);
              const found = projects.find((p) => p.id === pId);
              if (found) setSelectedProject(found);
            }}
            pages={pages}
            members={members}
            role={role}
            onNavigateToPage={(projId, pageId) => {
              setSelectedProjectId(projId);
              const foundP = projects.find((p) => p.id === projId);
              if (foundP) setSelectedProject(foundP);
              setSelectedPageId(pageId);
              const foundPg = pages.find((p) => p.id === pageId);
              if (foundPg) setSelectedPage(foundPg);
              setNavSection("projects");
              setActiveReport(null);
            }}
            onNavigateToReport={(projId, pageId, runId) => {
              setSelectedProjectId(projId);
              const foundP = projects.find((p) => p.id === projId);
              if (foundP) setSelectedProject(foundP);
              setSelectedPageId(pageId);
              const foundPg = pages.find((p) => p.id === pageId);
              if (foundPg) setSelectedPage(foundPg);
              setNavSection("projects");
              handleViewHistoricalReport(runId);
            }}
          />
        ) : activeReport ? (
          <HistoricalReportView
            persistedReport={activeReport}
            isLatest={isLatestReportView}
            role={role}
            members={members}
            pages={pages}
            onBack={handleBackToPageDetail}
          />
        ) : selectedProject && selectedPage ? (
          <PageDetail
            project={selectedProject}
            page={selectedPage}
            role={role}
            history={history}
            historyTotal={historyTotal}
            isLoadingHistory={isLoadingHistory}
            historyPage={historyPage}
            pageSize={PAGE_SIZE}
            onPageChange={(p) => setHistoryPage(p)}
            onBackToProject={handleBackToProject}
            onRunAudit={handleRunAudit}
            onViewLatestReport={handleViewLatestReport}
            onViewHistoricalReport={handleViewHistoricalReport}
          />
        ) : selectedProject ? (
          <ProjectDetail
            project={selectedProject}
            pages={pages}
            role={role}
            isLoading={isLoadingPages}
            onBackToProjects={handleBackToProjects}
            onSelectPage={handleSelectPage}
            onCreatePage={handleCreatePage}
            onUpdatePage={handleUpdatePage}
            onDeletePage={handleDeletePage}
          />
        ) : (
          <ProjectList
            projects={projects}
            role={role}
            isLoading={isLoadingProjects}
            onSelectProject={handleSelectProject}
            onCreateProject={handleCreateProject}
            onUpdateProject={handleUpdateProject}
            onDeleteProject={handleDeleteProject}
          />
        )}
      </main>
    </div>
  );
}
