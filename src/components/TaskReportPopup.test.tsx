import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { I18nProvider } from "../i18n";
import TaskReportPopup from "./TaskReportPopup";

const baseReport = {
  task: {
    id: "task-1",
    title: "Ship feature",
    description: null,
    department_id: "planning",
    assigned_agent_id: "agent-1",
    status: "done",
    project_path: "/tmp/project",
    created_at: 1000,
    completed_at: 2000,
    agent_name: "Ari",
    agent_name_ko: "아리",
    agent_role: "team_leader",
    dept_name: "Planning",
    dept_name_ko: "기획팀",
  },
  logs: [
    { kind: "system", message: "Final branch verification: passed (ref=main, commits=1, files=1)", created_at: 1500 },
  ],
  subtasks: [],
  meeting_minutes: [],
  planning_summary: {
    title: "Planning Lead Consolidated Summary",
    content: "Summary body",
    source_task_id: "task-1",
    source_agent_name: "Ari",
    source_department_name: "Planning",
    generated_at: 1600,
    documents: [],
  },
  team_reports: [],
  project: {
    root_task_id: "task-1",
    project_name: "Project",
    project_path: "/tmp/project",
    core_goal: "Goal",
  },
};

describe("TaskReportPopup", () => {
  it("shows final branch verification logs in the report popup", () => {
    render(
      <I18nProvider language="en">
        <TaskReportPopup
          report={baseReport as any}
          agents={[{ id: "agent-1", name: "Ari", name_ko: "아리", avatar_emoji: "A" } as any]}
          departments={[{ id: "planning", name: "Planning", name_ko: "기획팀", color: "#00aa88", icon: "P" } as any]}
          uiLanguage="en"
          onClose={() => {}}
        />
      </I18nProvider>,
    );

    expect(screen.getByText("Final Branch Verification")).toBeInTheDocument();
    expect(screen.getByText(/Final branch verification: passed/)).toBeInTheDocument();
    expect(screen.getByRole("dialog", { name: "Task Completion Report" })).toHaveClass("max-h-[calc(100dvh-2rem)]");
    expect(screen.getByTestId("task-report-scroll-region")).toHaveClass("overflow-y-auto");
  });

  it("keeps a sprite avatar when the assigned agent is missing from the active agent list", () => {
    render(
      <I18nProvider language="en">
        <TaskReportPopup report={baseReport as any} agents={[]} departments={[]} uiLanguage="en" onClose={() => {}} />
      </I18nProvider>,
    );

    expect(screen.getByAltText("Ari")).toBeInTheDocument();
  });

  it("shows sanitized execution evidence when remote run and artifact summary are present", () => {
    const report = {
      ...baseReport,
      remote_runs: [
        {
          provider: "hermes",
          remote_run_id: "run_123456789abcdef",
          status: "completed",
          base_url: "https://token@hermes.example.com/v1/runs?api_key=secret-value",
          last_event: "run.completed",
        },
      ],
      artifact_summary: {
        artifact_count: 2,
        document_count: 1,
        verification_highlights: ["Artifact verified token=secret-value"],
      },
    };

    render(
      <I18nProvider language="en">
        <TaskReportPopup report={report as any} agents={[]} departments={[]} uiLanguage="en" onClose={() => {}} />
      </I18nProvider>,
    );

    expect(screen.getByText("Execution Evidence")).toBeInTheDocument();
    expect(screen.getByText("hermes")).toBeInTheDocument();
    expect(screen.getByText("https://hermes.example.com")).toBeInTheDocument();
    expect(screen.getByText("2 artifacts")).toBeInTheDocument();
    expect(screen.getByText("Artifact verified token=[redacted]")).toBeInTheDocument();
    expect(screen.queryByText(/secret-value/)).not.toBeInTheDocument();
    expect(screen.queryByText(/api_key/)).not.toBeInTheDocument();
  });
});
