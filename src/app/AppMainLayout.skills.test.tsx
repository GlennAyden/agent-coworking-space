import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { Agent, CompanySettings, Department } from "../types";
import AppMainLayout from "./AppMainLayout";

vi.mock("../components/Sidebar", () => ({
  default: () => <aside data-testid="sidebar" />,
}));

vi.mock("./AppHeaderBar", () => ({
  default: () => <header data-testid="header" />,
}));

vi.mock("../components/OfficeView", () => ({
  default: () => <div data-testid="office-view" />,
}));

vi.mock("../components/Dashboard", () => ({
  default: () => <div data-testid="dashboard" />,
}));

vi.mock("../components/TaskBoard", () => ({
  default: () => <div data-testid="task-board" />,
}));

vi.mock("../components/AgentManager", () => ({
  default: () => <div data-testid="agent-manager" />,
}));

vi.mock("../components/SettingsPanel", () => ({
  default: () => <div data-testid="settings-panel" />,
}));

vi.mock("../components/SkillsLibrary", () => ({
  default: ({ agents }: { agents: Agent[] }) => (
    <div data-testid="skills-library-agents">
      {agents.map((agent) => `${agent.id}:${agent.name}:${agent.cli_provider}`).join("|")}
    </div>
  ),
}));

function makeDepartment(input: Partial<Department> & { id: string; name: string }): Department {
  return {
    id: input.id,
    name: input.name,
    name_ko: input.name_ko ?? input.name,
    name_ja: input.name_ja ?? input.name,
    name_zh: input.name_zh ?? input.name,
    icon: input.icon ?? "D",
    color: input.color ?? "#64748b",
    description: input.description ?? null,
    prompt: input.prompt ?? null,
    sort_order: input.sort_order ?? 1,
    created_at: input.created_at ?? 1,
  };
}

function makeAgent(input: Partial<Agent> & { id: string; name: string; cli_provider: Agent["cli_provider"] }): Agent {
  return {
    id: input.id,
    name: input.name,
    name_ko: input.name_ko ?? input.name,
    name_ja: input.name_ja ?? input.name,
    name_zh: input.name_zh ?? input.name,
    department_id: input.department_id ?? "planning",
    workflow_pack_key: input.workflow_pack_key ?? "report",
    role: input.role ?? "team_leader",
    acts_as_planning_leader: input.acts_as_planning_leader ?? 0,
    cli_provider: input.cli_provider,
    avatar_emoji: input.avatar_emoji ?? "A",
    sprite_number: input.sprite_number ?? null,
    personality: input.personality ?? null,
    status: input.status ?? "idle",
    current_task_id: input.current_task_id ?? null,
    stats_tasks_done: input.stats_tasks_done ?? 0,
    stats_xp: input.stats_xp ?? 0,
    created_at: input.created_at ?? 1,
  };
}

const noop = () => {};
const asyncNoop = async () => {};

describe("AppMainLayout skills view", () => {
  it("passes the active office pack agents to SkillsLibrary", () => {
    const reportDepartments = [makeDepartment({ id: "planning", name: "Editorial Planning" })];
    const reportAtlas = makeAgent({
      id: "report-seed-5",
      name: "Atlas",
      department_id: "operations",
      cli_provider: "codex",
      workflow_pack_key: "report",
    });
    const reportSage = makeAgent({
      id: "report-seed-1",
      name: "Sage",
      department_id: "planning",
      cli_provider: "claude",
      workflow_pack_key: "report",
    });
    const globalAtlas = makeAgent({
      id: "global-atlas",
      name: "Atlas",
      department_id: "operations",
      cli_provider: "claude",
      workflow_pack_key: "development",
    });

    const settings: CompanySettings = {
      companyName: "Agent Coworking Space",
      ceoName: "CEO",
      autoAssign: true,
      yoloMode: false,
      autoUpdateEnabled: false,
      autoUpdateNoticePending: false,
      oauthAutoSwap: true,
      theme: "dark",
      language: "en",
      defaultProvider: "codex",
      officeWorkflowPack: "report",
      officePackHydratedPacks: ["report"],
      messengerChannels: undefined,
      officePackProfiles: {
        report: {
          departments: reportDepartments,
          agents: [reportSage, reportAtlas],
          updated_at: 1,
        },
      },
    };

    render(
      <AppMainLayout
        connected={true}
        view="skills"
        setView={noop}
        departments={reportDepartments}
        agents={[globalAtlas]}
        stats={null}
        tasks={[]}
        projects={[]}
        subtasks={[]}
        subAgents={[]}
        meetingPresence={[]}
        settings={settings}
        cliStatus={null}
        oauthResult={null}
        labels={{
          uiLanguage: "en",
          viewTitle: "Library",
          announcementLabel: "Announcement",
          roomManagerLabel: "Office Manager",
          roomManagerDepartments: [],
          reportLabel: "Reports",
          tasksPrimaryLabel: "Tasks",
          agentStatusLabel: "Agents",
          decisionLabel: "Decisions",
          autoUpdateNoticeVisible: false,
          autoUpdateNoticeTitle: "",
          autoUpdateNoticeHint: "",
          autoUpdateNoticeActionLabel: "",
          autoUpdateNoticeContainerClass: "",
          autoUpdateNoticeTextClass: "",
          autoUpdateNoticeHintClass: "",
          autoUpdateNoticeButtonClass: "",
          effectiveUpdateStatus: null,
          updateBannerVisible: false,
          updateReleaseUrl: "",
          updateTitle: "",
          updateHint: "",
          updateReleaseLabel: "",
          updateDismissLabel: "",
          updateTestModeHint: "",
        }}
        mobileNavOpen={false}
        setMobileNavOpen={noop}
        mobileHeaderMenuOpen={false}
        setMobileHeaderMenuOpen={noop}
        theme="dark"
        toggleTheme={noop}
        decisionInboxLoading={false}
        decisionInboxCount={0}
        activeMeetingTaskId={null}
        unreadAgentIds={new Set()}
        crossDeptDeliveries={[]}
        ceoOfficeCalls={[]}
        customRoomThemes={{}}
        activeRoomThemeTargetId={null}
        onCrossDeptDeliveryProcessed={noop}
        onCeoOfficeCallProcessed={noop}
        onOpenActiveMeetingMinutes={noop}
        onSelectAgent={noop}
        onSelectDepartment={noop}
        onCreateTask={asyncNoop}
        onUpdateTask={asyncNoop}
        onDeleteTask={asyncNoop}
        onAssignTask={asyncNoop}
        onRunTask={asyncNoop}
        onStopTask={asyncNoop}
        onPauseTask={asyncNoop}
        onResumeTask={asyncNoop}
        onOpenTerminal={noop}
        onOpenMeetingMinutes={noop}
        onAgentsChange={noop}
        activeOfficeWorkflowPack="report"
        onChangeOfficeWorkflowPack={noop}
        onSaveSettings={asyncNoop}
        onRefreshCli={asyncNoop}
        onOauthResultClear={noop}
        onOpenDecisionInbox={noop}
        onOpenAgentStatus={noop}
        onOpenReportHistory={noop}
        onOpenAnnouncement={noop}
        onOpenRoomManager={noop}
        onDismissAutoUpdateNotice={asyncNoop}
        onDismissUpdate={noop}
      />,
    );

    const renderedAgents = screen.getByTestId("skills-library-agents").textContent ?? "";
    expect(renderedAgents).toContain("report-seed-5:Atlas:codex");
    expect(renderedAgents).toContain("report-seed-1:Sage:claude");
    expect(renderedAgents).not.toContain("global-atlas:Atlas:claude");
  });
});
