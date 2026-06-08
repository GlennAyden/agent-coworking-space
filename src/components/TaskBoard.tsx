import { useCallback, useMemo, useState } from "react";
import { bulkHideTasks, isApprovalRequiredError } from "../api";
import type { ApprovalRequiredDetails, RunTaskOptions } from "../api";
import { useI18n } from "../i18n";
import type { Agent, Department, SubTask, Task, WorkflowPackKey } from "../types";
import ProjectManagerModal from "./ProjectManagerModal";
import BulkHideModal from "./taskboard/BulkHideModal";
import CreateTaskModal from "./taskboard/CreateTaskModal";
import FilterBar from "./taskboard/FilterBar";
import TaskCard from "./taskboard/TaskCard";
import { COLUMNS, isHideableStatus, taskStatusLabel, type HideableStatus } from "./taskboard/constants";

interface TaskBoardProps {
  tasks: Task[];
  agents: Agent[];
  departments: Department[];
  subtasks: SubTask[];
  onCreateTask: (input: {
    title: string;
    description?: string;
    department_id?: string;
    task_type?: string;
    priority?: number;
    project_id?: string;
    project_path?: string;
    assigned_agent_id?: string;
    workflow_pack_key?: WorkflowPackKey;
  }) => void;
  onUpdateTask: (id: string, data: Partial<Task>) => void;
  onDeleteTask: (id: string) => void;
  onAssignTask: (taskId: string, agentId: string) => void;
  onRunTask: (id: string, options?: RunTaskOptions) => void | Promise<void>;
  onStopTask: (id: string) => void;
  onPauseTask?: (id: string) => void;
  onResumeTask?: (id: string) => void;
  onOpenTerminal?: (taskId: string) => void;
  onOpenMeetingMinutes?: (taskId: string) => void;
  onMergeTask?: (id: string) => void;
  onDiscardTask?: (id: string) => void;
  onProjectsChange?: () => void;
}

export function TaskBoard({
  tasks,
  agents,
  departments,
  subtasks,
  onCreateTask,
  onUpdateTask,
  onDeleteTask,
  onAssignTask,
  onRunTask,
  onStopTask,
  onPauseTask,
  onResumeTask,
  onOpenTerminal,
  onOpenMeetingMinutes,
  onMergeTask,
  onDiscardTask,
  onProjectsChange,
}: TaskBoardProps) {
  const { t } = useI18n();
  const [showCreate, setShowCreate] = useState(false);
  const [showProjectManager, setShowProjectManager] = useState(false);
  const [showBulkHideModal, setShowBulkHideModal] = useState(false);
  const [filterDept, setFilterDept] = useState("");
  const [filterAgent, setFilterAgent] = useState("");
  const [filterType, setFilterType] = useState("");
  const [search, setSearch] = useState("");
  const [showAllTasks, setShowAllTasks] = useState(false);
  const [approvalRequest, setApprovalRequest] = useState<{
    taskId: string;
    taskTitle: string;
    details: ApprovalRequiredDetails;
  } | null>(null);
  const [approvalBusy, setApprovalBusy] = useState(false);

  const hiddenTaskIds = useMemo(
    () => new Set(tasks.filter((task) => task.hidden === 1).map((task) => task.id)),
    [tasks],
  );

  const hideTask = useCallback(
    (taskId: string) => {
      onUpdateTask(taskId, { hidden: 1 });
    },
    [onUpdateTask],
  );

  const unhideTask = useCallback(
    (taskId: string) => {
      onUpdateTask(taskId, { hidden: 0 });
    },
    [onUpdateTask],
  );

  const hideByStatuses = useCallback((statuses: HideableStatus[]) => {
    if (statuses.length === 0) return;
    bulkHideTasks(statuses, 1);
  }, []);

  const runTaskWithApprovalGate = useCallback(
    async (taskId: string, options?: RunTaskOptions) => {
      const task = tasks.find((entry) => entry.id === taskId);
      try {
        await onRunTask(taskId, options);
      } catch (error) {
        if (isApprovalRequiredError(error)) {
          setApprovalRequest({
            taskId,
            taskTitle: task?.title ?? taskId,
            details: error.details,
          });
          return;
        }
        throw error;
      }
    },
    [onRunTask, tasks],
  );

  const approveAndRunTask = useCallback(async () => {
    if (!approvalRequest || approvalBusy) return;
    setApprovalBusy(true);
    try {
      await onRunTask(approvalRequest.taskId, { approval_confirmed: true });
      setApprovalRequest(null);
    } catch (error) {
      if (isApprovalRequiredError(error)) {
        setApprovalRequest((current) =>
          current ? { ...current, details: error.details } : { ...approvalRequest, details: error.details },
        );
        return;
      }
      throw error;
    } finally {
      setApprovalBusy(false);
    }
  }, [approvalBusy, approvalRequest, onRunTask]);

  const filteredTasks = useMemo(() => {
    return tasks.filter((task) => {
      if (filterDept && task.department_id !== filterDept) return false;
      if (filterAgent && task.assigned_agent_id !== filterAgent) return false;
      if (filterType && task.task_type !== filterType) return false;
      if (search && !task.title.toLowerCase().includes(search.toLowerCase())) return false;
      const isHidden = hiddenTaskIds.has(task.id);
      if (!showAllTasks && isHidden) return false;
      return true;
    });
  }, [tasks, filterDept, filterAgent, filterType, search, hiddenTaskIds, showAllTasks]);

  const tasksByStatus = useMemo(() => {
    const grouped: Record<string, Task[]> = {};
    for (const column of COLUMNS) {
      grouped[column.status] = filteredTasks
        .filter((task) => task.status === column.status)
        .sort((a, b) => b.priority - a.priority || b.created_at - a.created_at);
    }
    return grouped;
  }, [filteredTasks]);

  const subtasksByTask = useMemo(() => {
    const grouped: Record<string, SubTask[]> = {};
    for (const subtask of subtasks) {
      if (!grouped[subtask.task_id]) grouped[subtask.task_id] = [];
      grouped[subtask.task_id].push(subtask);
    }
    return grouped;
  }, [subtasks]);

  const activeFilterCount = [filterDept, filterAgent, filterType, search].filter(Boolean).length;
  const hiddenTaskCount = useMemo(() => {
    let count = 0;
    for (const task of tasks) {
      if (isHideableStatus(task.status) && hiddenTaskIds.has(task.id)) count++;
    }
    return count;
  }, [tasks, hiddenTaskIds]);

  return (
    <div className="taskboard-shell flex h-full flex-col gap-4 bg-slate-950 p-3 sm:p-4">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-xl font-bold text-white">
          {t({ ko: "업무 보드", en: "Task Board", ja: "タスクボード", zh: "任务看板" })}
        </h1>
        <span className="rounded-full bg-slate-800 px-2.5 py-0.5 text-xs text-slate-400">
          {t({ ko: "총", en: "Total", ja: "合計", zh: "总计" })} {filteredTasks.length}
          {t({ ko: "개", en: "", ja: "件", zh: "项" })}
          {activeFilterCount > 0 &&
            ` (${t({ ko: "필터", en: "filters", ja: "フィルター", zh: "筛选器" })} ${activeFilterCount}${t({
              ko: "개 적용",
              en: " applied",
              ja: "件適用",
              zh: "个已应用",
            })})`}
        </span>
        <div className="ml-auto flex items-center gap-2">
          {activeFilterCount > 0 && (
            <button
              onClick={() => {
                setFilterDept("");
                setFilterAgent("");
                setFilterType("");
                setSearch("");
              }}
              className="rounded-lg border border-slate-700 px-3 py-1.5 text-xs text-slate-400 transition hover:bg-slate-800 hover:text-white"
            >
              {t({ ko: "필터 초기화", en: "Reset Filters", ja: "フィルターをリセット", zh: "重置筛选" })}
            </button>
          )}
          <button
            onClick={() => setShowAllTasks((prev) => !prev)}
            className={`rounded-lg border px-3 py-1.5 text-xs transition ${
              showAllTasks
                ? "border-cyan-600 bg-cyan-900/40 text-cyan-100 hover:bg-cyan-900/60"
                : "border-slate-700 text-slate-300 hover:bg-slate-800 hover:text-white"
            }`}
            title={
              showAllTasks
                ? t({
                    ko: "진행중 보기로 전환 (숨김 제외)",
                    en: "Switch to active view (exclude hidden)",
                    ja: "進行中表示へ切替（非表示を除外）",
                    zh: "切换到进行中视图（排除隐藏）",
                  })
                : t({
                    ko: "모두보기로 전환 (숨김 포함)",
                    en: "Switch to all view (include hidden)",
                    ja: "全体表示へ切替（非表示を含む）",
                    zh: "切换到全部视图（包含隐藏）",
                  })
            }
          >
            <span className={showAllTasks ? "text-slate-400" : "text-emerald-200"}>
              {t({ ko: "진행중", en: "Active", ja: "進行中", zh: "进行中" })}
            </span>
            <span className="mx-1 text-slate-500">/</span>
            <span className={showAllTasks ? "text-cyan-100" : "text-slate-500"}>
              {t({ ko: "모두보기", en: "All", ja: "すべて", zh: "全部" })}
            </span>
            <span className="ml-1 rounded-full bg-slate-800 px-1.5 py-0.5 text-[10px] text-slate-300">
              {hiddenTaskCount}
            </span>
          </button>
          <button
            onClick={() => setShowBulkHideModal(true)}
            className="rounded-lg border border-slate-700 px-3 py-1.5 text-xs text-slate-300 transition hover:bg-slate-800 hover:text-white"
            title={t({
              ko: "완료/보류/취소 상태 업무 숨기기",
              en: "Hide done/pending/cancelled tasks",
              ja: "完了/保留/キャンセル状態を非表示",
              zh: "隐藏完成/待处理/已取消任务",
            })}
          >
            🙈 {t({ ko: "숨김", en: "Hide", ja: "非表示", zh: "隐藏" })}
          </button>
          <button
            onClick={() => setShowProjectManager(true)}
            className="taskboard-project-manage-btn rounded-lg border px-3 py-1.5 text-xs font-semibold transition"
          >
            🗂 {t({ ko: "프로젝트 관리", en: "Project Manager", ja: "プロジェクト管理", zh: "项目管理" })}
          </button>
          <button
            onClick={() => setShowCreate(true)}
            className="rounded-lg bg-blue-600 px-4 py-1.5 text-sm font-semibold text-white shadow transition hover:bg-blue-500 active:scale-95"
          >
            + {t({ ko: "새 업무", en: "New Task", ja: "新規タスク", zh: "新建任务" })}
          </button>
        </div>
      </div>

      <FilterBar
        agents={agents}
        departments={departments}
        filterDept={filterDept}
        filterAgent={filterAgent}
        filterType={filterType}
        search={search}
        onFilterDept={setFilterDept}
        onFilterAgent={setFilterAgent}
        onFilterType={setFilterType}
        onSearch={setSearch}
      />

      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto pb-2 sm:flex-row sm:overflow-x-auto sm:overflow-y-hidden">
        {COLUMNS.map((column) => {
          const columnTasks = tasksByStatus[column.status] ?? [];
          return (
            <div
              key={column.status}
              className={`taskboard-column flex w-full flex-col rounded-xl border sm:w-72 sm:flex-shrink-0 ${column.borderColor} bg-slate-900`}
            >
              <div className={`flex items-center justify-between rounded-t-xl ${column.headerBg} px-3.5 py-2.5`}>
                <div className="flex items-center gap-2">
                  <span className={`h-2 w-2 flex-shrink-0 rounded-full ${column.dotColor}`} />
                  <span className="text-sm font-semibold text-white">
                    {column.icon} {taskStatusLabel(column.status, t)}
                  </span>
                </div>
                <span className="rounded-full bg-black/30 px-2 py-0.5 text-xs font-bold text-white/80">
                  {columnTasks.length}
                </span>
              </div>

              <div className="flex flex-col gap-2.5 p-2.5 sm:flex-1 sm:overflow-y-auto">
                {columnTasks.length === 0 ? (
                  <div className="flex min-h-24 items-center justify-center py-8 text-xs text-slate-600 sm:flex-1">
                    {t({ ko: "업무 없음", en: "No tasks", ja: "タスクなし", zh: "暂无任务" })}
                  </div>
                ) : (
                  columnTasks.map((task) => (
                    <TaskCard
                      key={task.id}
                      task={task}
                      agents={agents}
                      departments={departments}
                      taskSubtasks={subtasksByTask[task.id] ?? []}
                      isHiddenTask={hiddenTaskIds.has(task.id)}
                      onUpdateTask={onUpdateTask}
                      onDeleteTask={onDeleteTask}
                      onAssignTask={onAssignTask}
                      onRunTask={runTaskWithApprovalGate}
                      onStopTask={onStopTask}
                      onPauseTask={onPauseTask}
                      onResumeTask={onResumeTask}
                      onOpenTerminal={onOpenTerminal}
                      onOpenMeetingMinutes={onOpenMeetingMinutes}
                      onMergeTask={onMergeTask}
                      onDiscardTask={onDiscardTask}
                      onHideTask={hideTask}
                      onUnhideTask={unhideTask}
                    />
                  ))
                )}
              </div>
            </div>
          );
        })}
      </div>

      {showCreate && (
        <CreateTaskModal
          agents={agents}
          departments={departments}
          onClose={() => setShowCreate(false)}
          onCreate={onCreateTask}
          onAssign={onAssignTask}
        />
      )}

      {showProjectManager && (
        <ProjectManagerModal
          agents={agents}
          departments={departments}
          onProjectsChange={onProjectsChange}
          onClose={() => setShowProjectManager(false)}
        />
      )}

      {showBulkHideModal && (
        <BulkHideModal
          tasks={tasks}
          hiddenTaskIds={hiddenTaskIds}
          onClose={() => setShowBulkHideModal(false)}
          onApply={(statuses) => {
            hideByStatuses(statuses);
            setShowBulkHideModal(false);
          }}
        />
      )}

      {approvalRequest && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 px-4 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
          aria-labelledby="approval-required-title"
        >
          <div className="w-full max-w-lg rounded-2xl border border-amber-500/30 bg-slate-900 shadow-2xl shadow-black/30">
            <div className="border-b border-slate-700/60 px-5 py-4">
              <p className="text-xs font-semibold uppercase tracking-wider text-amber-300">
                {t({
                  ko: "ì‹¤í–‰ ìŠ¹ì¸ í•„ìš”",
                  en: "Approval required",
                  ja: "å®Ÿè¡Œæ‰¿èªãŒå¿…è¦",
                  zh: "éœ€è¦æ‰¹å‡†æ‰§è¡Œ",
                })}
              </p>
              <h2 id="approval-required-title" className="mt-1 text-base font-semibold text-white">
                {approvalRequest.taskTitle}
              </h2>
            </div>
            <div className="space-y-4 px-5 py-4">
              <div className="rounded-xl border border-amber-500/20 bg-amber-500/10 p-3">
                <p className="text-sm font-medium text-amber-100">
                  {t({
                    ko: "ì´ ìž‘ì—…ì€ production, data, deployment, ë˜ëŠ” repository ìƒíƒœì— ì˜í–¥ì„ ì¤„ ìˆ˜ ìžˆìŠµë‹ˆë‹¤.",
                    en: "This task can affect production, data, deployment, or repository state.",
                    ja: "ã“ã®ã‚¿ã‚¹ã‚¯ã¯ productionã€ãƒ‡ãƒ¼ã‚¿ã€ãƒ‡ãƒ—ãƒ­ã‚¤ã€ãƒªãƒã‚¸ãƒˆãƒªçŠ¶æ…‹ã«å½±éŸ¿ã™ã‚‹å¯èƒ½æ€§ãŒã‚ã‚Šã¾ã™ã€‚",
                    zh: "此任务可能影响生产环境、数据、部署或仓库状态。",
                  })}
                </p>
                <p className="mt-1 text-xs leading-relaxed text-amber-200/80">
                  {t({
                    ko: "ìŠ¹ì¸í•˜ë©´ ì´ ìœ„í—˜ì„ ì¸ì§€í•œ ìƒíƒœë¡œ ë‹¤ì‹œ ì‹¤í–‰í•©ë‹ˆë‹¤. ì‹¤í–‰ í›„ì—ëŠ” ì™¸ë¶€ ì‹œìŠ¤í…œ ë³€ê²½ì´ ë°œìƒí•  ìˆ˜ ìžˆìŠµë‹ˆë‹¤.",
                    en: "Approving retries the run with explicit confirmation. External systems may change after execution starts.",
                    ja: "æ‰¿èªã™ã‚‹ã¨æ˜Žç¤ºçš„ãªç¢ºèªä»˜ãã§å†å®Ÿè¡Œã—ã¾ã™ã€‚å®Ÿè¡Œé–‹å§‹å¾Œã«å¤–éƒ¨ã‚·ã‚¹ãƒ†ãƒ ãŒå¤‰æ›´ã•ã‚Œã‚‹å ´åˆãŒã‚ã‚Šã¾ã™ã€‚",
                    zh: "批准后会带着明确确认重新运行。执行开始后，外部系统可能会发生变化。",
                  })}
                </p>
              </div>
              <div>
                <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-400">
                  {t({ ko: "ìœ„í—˜ ì‚¬ìœ ", en: "Risk reasons", ja: "ãƒªã‚¹ã‚¯ç†ç”±", zh: "风险原因" })}
                </p>
                <ul className="space-y-1.5">
                  {approvalRequest.details.reasons.map((reason, index) => (
                    <li
                      key={`${reason}-${index}`}
                      className="rounded-lg border border-slate-700/70 bg-slate-800/70 px-3 py-2 text-xs leading-relaxed text-slate-200"
                    >
                      {reason}
                    </li>
                  ))}
                </ul>
              </div>
            </div>
            <div className="flex items-center justify-end gap-2 border-t border-slate-700/60 px-5 py-4">
              <button
                type="button"
                onClick={() => setApprovalRequest(null)}
                disabled={approvalBusy}
                className="rounded-lg border border-slate-700 px-3 py-1.5 text-sm text-slate-300 transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {t({ ko: "ì·¨ì†Œ", en: "Cancel", ja: "ã‚­ãƒ£ãƒ³ã‚»ãƒ«", zh: "取消" })}
              </button>
              <button
                type="button"
                onClick={approveAndRunTask}
                disabled={approvalBusy}
                className="rounded-lg bg-amber-600 px-3 py-1.5 text-sm font-semibold text-white transition hover:bg-amber-500 active:scale-95 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {approvalBusy
                  ? t({ ko: "ì‹¤í–‰ ì¤‘...", en: "Running...", ja: "å®Ÿè¡Œä¸­...", zh: "运行中..." })
                  : t({ ko: "ìŠ¹ì¸ í›„ ì‹¤í–‰", en: "Approve and Run", ja: "æ‰¿èªã—ã¦å®Ÿè¡Œ", zh: "批准并运行" })}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default TaskBoard;
