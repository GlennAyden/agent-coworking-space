import { describe, expect, it } from "vitest";
import type { Agent, Department, Project, Task } from "../../types";
import { PROJECT_COWORKING_MIN_W, createProjectCoworkingLayout } from "./project-coworking-layout";
import { deriveProjectCoworkingSummary } from "./project-coworking-model";

function makeDepartment(overrides: Partial<Department> = {}): Department {
  return {
    id: "dev",
    name: "Development",
    name_ko: "Development",
    icon: "",
    color: "#6c96b7",
    description: null,
    prompt: null,
    sort_order: 1,
    created_at: 1,
    ...overrides,
  };
}

function makeAgent(overrides: Partial<Agent> = {}): Agent {
  return {
    id: "agent-1",
    name: "Leibniz",
    name_ko: "Leibniz",
    department_id: "dev",
    role: "senior",
    cli_provider: "codex",
    avatar_emoji: "",
    personality: null,
    status: "idle",
    current_task_id: null,
    stats_tasks_done: 0,
    stats_xp: 0,
    created_at: 1,
    ...overrides,
  };
}

function makeProject(overrides: Partial<Project> = {}): Project {
  return {
    id: "project-1",
    name: "Orbit Console",
    project_path: "C:\\Work\\Orbit",
    core_goal: "Build the console",
    assignment_mode: "auto",
    assigned_agent_ids: [],
    last_used_at: null,
    created_at: 1,
    updated_at: 1,
    ...overrides,
  };
}

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: "task-1",
    title: "Implement room",
    description: null,
    department_id: "dev",
    assigned_agent_id: null,
    project_id: null,
    status: "inbox",
    priority: 3,
    task_type: "development",
    project_path: null,
    result: null,
    started_at: null,
    completed_at: null,
    created_at: 1,
    updated_at: 1,
    ...overrides,
  };
}

describe("project coworking office model", () => {
  it("creates a room for every project even before work is assigned", () => {
    const summary = deriveProjectCoworkingSummary({
      projects: [makeProject()],
      tasks: [],
      agents: [],
      departments: [makeDepartment()],
    });

    expect(summary.projectRooms).toHaveLength(1);
    expect(summary.projectRooms[0]).toMatchObject({
      projectId: "project-1",
      name: "Orbit Console",
      agentIds: [],
      taskIds: [],
      fallback: false,
    });
  });

  it("moves an agent with active project work out of the department commons", () => {
    const task = makeTask({
      id: "task-active",
      assigned_agent_id: "agent-1",
      project_id: "project-1",
      status: "in_progress",
    });
    const agent = makeAgent({ current_task_id: task.id, status: "working" });
    const summary = deriveProjectCoworkingSummary({
      projects: [makeProject()],
      tasks: [task],
      agents: [agent],
      departments: [makeDepartment()],
    });

    expect(summary.projectRooms[0].agentIds).toEqual(["agent-1"]);
    expect(summary.projectRooms[0].activeTaskIds).toEqual(["task-active"]);
    expect(summary.departmentCommons.find((room) => room.key === "dev")?.agentIds).toEqual([]);
    expect(summary.agentProjectAssignments).toEqual([
      {
        agentId: "agent-1",
        taskId: "task-active",
        projectRoomKey: "project:project-1",
        departmentId: "dev",
      },
    ]);
  });

  it("creates a fallback room for orphan project tasks", () => {
    const task = makeTask({
      assigned_agent_id: "agent-1",
      project_id: "missing-project",
      project_path: "C:\\Work\\Orphan",
      status: "in_progress",
    });
    const summary = deriveProjectCoworkingSummary({
      projects: [],
      tasks: [task],
      agents: [makeAgent({ current_task_id: task.id })],
      departments: [makeDepartment()],
    });

    expect(summary.projectRooms).toHaveLength(1);
    expect(summary.projectRooms[0]).toMatchObject({
      projectId: "missing-project",
      name: "Orphan",
      fallback: true,
      agentIds: ["agent-1"],
    });
  });

  it("matches path-only tasks to the existing project room", () => {
    const task = makeTask({
      project_id: null,
      project_path: "c:/work/orbit/",
      status: "planned",
    });
    const summary = deriveProjectCoworkingSummary({
      projects: [makeProject()],
      tasks: [task],
      agents: [],
      departments: [makeDepartment()],
    });

    expect(summary.projectRooms).toHaveLength(1);
    expect(summary.projectRooms[0]).toMatchObject({
      projectId: "project-1",
      taskIds: ["task-1"],
      fallback: false,
    });
  });

  it("keeps agents in their department commons after project work is completed", () => {
    const task = makeTask({
      assigned_agent_id: "agent-1",
      project_id: "project-1",
      status: "done",
    });
    const summary = deriveProjectCoworkingSummary({
      projects: [makeProject()],
      tasks: [task],
      agents: [makeAgent({ current_task_id: task.id })],
      departments: [makeDepartment()],
    });

    expect(summary.projectRooms[0].agentIds).toEqual([]);
    expect(summary.departmentCommons.find((room) => room.key === "dev")?.agentIds).toEqual(["agent-1"]);
  });

  it("keeps agents without a department in an unassigned commons room", () => {
    const summary = deriveProjectCoworkingSummary({
      projects: [makeProject()],
      tasks: [],
      agents: [makeAgent({ department_id: null })],
      departments: [makeDepartment()],
    });

    expect(summary.departmentCommons.find((room) => room.key === "unassigned")).toMatchObject({
      departmentId: null,
      agentIds: ["agent-1"],
    });
  });

  it("keeps every assigned agent in a crowded project room model", () => {
    const agents = Array.from({ length: 8 }, (_, index) =>
      makeAgent({
        id: `agent-${index + 1}`,
        current_task_id: `task-${index + 1}`,
        status: "working",
      }),
    );
    const tasks = agents.map((agent, index) =>
      makeTask({
        id: `task-${index + 1}`,
        assigned_agent_id: agent.id,
        project_id: "project-1",
        status: "in_progress",
      }),
    );
    const summary = deriveProjectCoworkingSummary({
      projects: [makeProject()],
      tasks,
      agents,
      departments: [makeDepartment()],
    });

    expect(summary.projectRooms[0].agentIds).toHaveLength(8);
    expect(summary.agentProjectAssignments).toHaveLength(8);
  });

  it("uses the mockup-style wide layout with project rooms, center hub, and two-column commons", () => {
    const departments = ["planning", "dev", "design", "qa", "devsecops", "ops"].map((id, index) =>
      makeDepartment({ id, name: id, sort_order: index + 1 }),
    );
    const projects = Array.from({ length: 3 }, (_, index) =>
      makeProject({
        id: `project-${index + 1}`,
        name: `Project ${index + 1}`,
        project_path: `C:\\Work\\Project-${index + 1}`,
      }),
    );

    const layout = createProjectCoworkingLayout({
      OFFICE_W: PROJECT_COWORKING_MIN_W,
      projects,
      tasks: [],
      agents: [],
      departments,
    });

    expect(layout.projectCols).toBe(2);
    expect(layout.commonsCols).toBe(2);
    expect(layout.dispatchGateRect.x).toBeGreaterThan(layout.projectRoomStartX + layout.projectRoomW * 2);
    expect(layout.commonsRoomStartX).toBeGreaterThan(layout.dispatchGateRect.x + layout.dispatchGateRect.w);
    expect(layout.bottomPanelRect.y).toBeGreaterThan(layout.projectStartY + layout.projectRoomH);
  });
});
