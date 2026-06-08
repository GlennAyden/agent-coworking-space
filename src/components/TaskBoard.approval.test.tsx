import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ApprovalRequiredError } from "../api";
import { I18nProvider } from "../i18n";
import type { Agent, Department, Task } from "../types";
import TaskBoard from "./TaskBoard";

const agent: Agent = {
  id: "agent-1",
  name: "Ari",
  name_ko: "Ari",
  avatar_emoji: "A",
  role: "Lead",
  department_id: "planning",
  status: "idle",
  current_task_id: null,
  cli_provider: "codex",
} as unknown as Agent;

const department: Department = {
  id: "planning",
  name: "Planning",
  name_ko: "Planning",
  icon: "P",
  color: "#38bdf8",
} as Department;

function task(overrides: Partial<Task> = {}): Task {
  return {
    id: "task-1",
    title: "Deploy production update",
    description: "Deploy and restart production",
    department_id: "planning",
    assigned_agent_id: "agent-1",
    status: "inbox",
    priority: 3,
    task_type: "development",
    project_path: "/workspace/app",
    result: null,
    started_at: null,
    completed_at: null,
    created_at: 1,
    updated_at: 1,
    ...overrides,
  };
}

function renderBoard(tasks: Task[], onRunTask = vi.fn()) {
  render(
    <I18nProvider language="en">
      <TaskBoard
        tasks={tasks}
        agents={[agent]}
        departments={[department]}
        subtasks={[]}
        onCreateTask={() => {}}
        onUpdateTask={() => {}}
        onDeleteTask={() => {}}
        onAssignTask={() => {}}
        onRunTask={onRunTask}
        onStopTask={() => {}}
      />
    </I18nProvider>,
  );
  return onRunTask;
}

describe("TaskBoard approval gate", () => {
  it("shows approval reasons and retries run with explicit confirmation", async () => {
    const user = userEvent.setup();
    const onRunTask = vi
      .fn()
      .mockRejectedValueOnce(
        new ApprovalRequiredError({
          error: "approval_required",
          reasons: ["Production restart can interrupt users"],
          approval_confirmed_field: "approval_confirmed",
        }),
      )
      .mockResolvedValueOnce(undefined);

    renderBoard([task()], onRunTask);

    await user.click(screen.getByTitle("Run task"));

    expect(await screen.findByText("Approval required")).toBeInTheDocument();
    expect(screen.getByText("Production restart can interrupt users")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Approve and Run" }));

    await waitFor(() => expect(onRunTask).toHaveBeenCalledTimes(2));
    expect(onRunTask).toHaveBeenNthCalledWith(1, "task-1", undefined);
    expect(onRunTask).toHaveBeenNthCalledWith(2, "task-1", { approval_confirmed: true });
  });

  it("marks pending tasks when approval metadata is present", () => {
    renderBoard([
      task({
        status: "pending",
        workflow_meta_json: JSON.stringify({ approval_required: true }),
      }),
    ]);

    expect(screen.getByText("Approval required")).toBeInTheDocument();
    expect(screen.getByTitle("Run task")).toBeInTheDocument();
  });
});
