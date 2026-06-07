import type { Agent, Department, Project, Task } from "../../types";

const TERMINAL_TASK_STATUSES = new Set<Task["status"]>(["done", "cancelled"]);

export interface ProjectRoomSummary {
  key: string;
  projectId: string | null;
  projectPath: string | null;
  name: string;
  project: Project | null;
  taskIds: string[];
  activeTaskIds: string[];
  agentIds: string[];
  fallback: boolean;
}

export interface DepartmentCommonsSummary {
  key: string;
  departmentId: string | null;
  department: Department | null;
  agentIds: string[];
}

export interface AgentProjectAssignment {
  agentId: string;
  taskId: string;
  projectRoomKey: string;
  departmentId: string | null;
}

export interface ProjectCoworkingSummary {
  projectRooms: ProjectRoomSummary[];
  departmentCommons: DepartmentCommonsSummary[];
  agentProjectAssignments: AgentProjectAssignment[];
}

export function deriveProjectCoworkingSummary({
  projects,
  tasks,
  agents,
  departments,
}: {
  projects: Project[];
  tasks: Task[];
  agents: Agent[];
  departments: Department[];
}): ProjectCoworkingSummary {
  const roomDrafts = new Map<
    string,
    Omit<ProjectRoomSummary, "taskIds" | "activeTaskIds" | "agentIds"> & {
      taskIds: Set<string>;
      activeTaskIds: Set<string>;
      agentIds: Set<string>;
    }
  >();
  const roomKeyByProjectId = new Map<string, string>();
  const roomKeyByPath = new Map<string, string>();

  for (const project of projects) {
    const key = projectRoomKey(project.id);
    roomDrafts.set(key, {
      key,
      projectId: project.id,
      projectPath: project.project_path,
      name: project.name,
      project,
      taskIds: new Set(),
      activeTaskIds: new Set(),
      agentIds: new Set(),
      fallback: false,
    });
    roomKeyByProjectId.set(project.id, key);
    const normalizedPath = normalizePath(project.project_path);
    if (normalizedPath) roomKeyByPath.set(normalizedPath, key);
  }

  const taskById = new Map(tasks.map((task) => [task.id, task]));
  for (const task of tasks) {
    const key = resolveTaskRoomKey(task, roomKeyByProjectId, roomKeyByPath);
    if (!key) continue;
    const draft = ensureTaskRoom(roomDrafts, key, task);
    draft.taskIds.add(task.id);
    if (isLiveTask(task)) draft.activeTaskIds.add(task.id);
  }

  const assignmentByAgentId = new Map<string, { task: Task; roomKey: string }>();
  for (const agent of agents) {
    const directTask = agent.current_task_id ? taskById.get(agent.current_task_id) : undefined;
    const projectTask =
      directTask && isLiveTask(directTask) && resolveTaskRoomKey(directTask, roomKeyByProjectId, roomKeyByPath)
        ? directTask
        : findLatestAssignedProjectTask(agent, tasks, roomKeyByProjectId, roomKeyByPath);
    if (!projectTask) continue;

    const key = resolveTaskRoomKey(projectTask, roomKeyByProjectId, roomKeyByPath);
    if (!key) continue;
    const draft = ensureTaskRoom(roomDrafts, key, projectTask);
    draft.agentIds.add(agent.id);
    assignmentByAgentId.set(agent.id, { task: projectTask, roomKey: key });
  }

  const commonsDrafts = new Map<string, DepartmentCommonsSummary>();
  for (const department of departments) {
    commonsDrafts.set(department.id, {
      key: department.id,
      departmentId: department.id,
      department,
      agentIds: [],
    });
  }

  for (const agent of agents) {
    if (assignmentByAgentId.has(agent.id) || agent.status === "break") continue;
    const key = agent.department_id ?? "unassigned";
    if (!commonsDrafts.has(key)) {
      commonsDrafts.set(key, {
        key,
        departmentId: agent.department_id,
        department: departments.find((department) => department.id === agent.department_id) ?? null,
        agentIds: [],
      });
    }
    commonsDrafts.get(key)?.agentIds.push(agent.id);
  }

  return {
    projectRooms: Array.from(roomDrafts.values()).map((draft) => ({
      ...draft,
      taskIds: Array.from(draft.taskIds),
      activeTaskIds: Array.from(draft.activeTaskIds),
      agentIds: Array.from(draft.agentIds),
    })),
    departmentCommons: Array.from(commonsDrafts.values()),
    agentProjectAssignments: Array.from(assignmentByAgentId.entries()).map(([agentId, assignment]) => ({
      agentId,
      taskId: assignment.task.id,
      projectRoomKey: assignment.roomKey,
      departmentId: agents.find((agent) => agent.id === agentId)?.department_id ?? null,
    })),
  };
}

function findLatestAssignedProjectTask(
  agent: Agent,
  tasks: Task[],
  roomKeyByProjectId: Map<string, string>,
  roomKeyByPath: Map<string, string>,
): Task | null {
  const candidates = tasks
    .filter((task) => task.assigned_agent_id === agent.id)
    .filter((task) => isLiveTask(task))
    .filter((task) => Boolean(resolveTaskRoomKey(task, roomKeyByProjectId, roomKeyByPath)))
    .sort((a, b) => taskSortTime(b) - taskSortTime(a));
  return candidates[0] ?? null;
}

function ensureTaskRoom(
  roomDrafts: Map<
    string,
    Omit<ProjectRoomSummary, "taskIds" | "activeTaskIds" | "agentIds"> & {
      taskIds: Set<string>;
      activeTaskIds: Set<string>;
      agentIds: Set<string>;
    }
  >,
  key: string,
  task: Task,
) {
  const existing = roomDrafts.get(key);
  if (existing) return existing;

  const fallbackName = task.project_path ? getPathBasename(task.project_path) : `Project ${task.project_id?.slice(0, 8) ?? ""}`;
  const draft = {
    key,
    projectId: task.project_id ?? null,
    projectPath: task.project_path ?? null,
    name: fallbackName.trim() || "Project Room",
    project: null,
    taskIds: new Set<string>(),
    activeTaskIds: new Set<string>(),
    agentIds: new Set<string>(),
    fallback: true,
  };
  roomDrafts.set(key, draft);
  return draft;
}

function resolveTaskRoomKey(
  task: Task,
  roomKeyByProjectId: Map<string, string>,
  roomKeyByPath: Map<string, string>,
): string | null {
  if (task.project_id) return roomKeyByProjectId.get(task.project_id) ?? projectRoomKey(task.project_id);
  const normalizedPath = normalizePath(task.project_path);
  if (!normalizedPath) return null;
  return roomKeyByPath.get(normalizedPath) ?? pathRoomKey(normalizedPath);
}

function isLiveTask(task: Task): boolean {
  return !TERMINAL_TASK_STATUSES.has(task.status);
}

function taskSortTime(task: Task): number {
  return task.updated_at ?? task.started_at ?? task.created_at ?? 0;
}

function normalizePath(projectPath?: string | null): string {
  return projectPath?.trim().replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase() ?? "";
}

function getPathBasename(projectPath: string): string {
  const normalizedPath = projectPath.trim().replace(/\\/g, "/").replace(/\/+$/, "");
  return normalizedPath.split("/").filter(Boolean).pop() ?? normalizedPath;
}

function projectRoomKey(projectId: string): string {
  return `project:${projectId}`;
}

function pathRoomKey(normalizedPath: string): string {
  return `path:${normalizedPath}`;
}
