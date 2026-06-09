import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import CreateTaskModalView from "./CreateTaskModalView";

vi.mock("./Sections", () => ({
  ProjectSection: () => <div data-testid="project-section" />,
  PrioritySection: () => <div data-testid="priority-section" />,
  AssigneeSection: () => <div data-testid="assignee-section" />,
}));

vi.mock("./Overlays", () => ({
  default: () => null,
}));

const t = (text: { en: string }) => text.en;

function renderCreateTaskModal() {
  render(
    <CreateTaskModalView
      t={t as any}
      locale="en"
      createNewProjectMode={false}
      draftsCount={0}
      title=""
      description=""
      departmentId=""
      taskType="general"
      priority={3}
      assignAgentId=""
      submitBusy={false}
      formFeedback={null}
      departments={[]}
      filteredAgents={[]}
      projectSectionProps={{} as any}
      overlaysProps={{} as any}
      onOpenDraftModal={() => {}}
      onRequestClose={() => {}}
      onSubmit={(event) => event.preventDefault()}
      onTitleChange={() => {}}
      onDescriptionChange={() => {}}
      onDepartmentChange={() => {}}
      onTaskTypeChange={() => {}}
      onPriorityChange={() => {}}
      onAssignAgentChange={() => {}}
    />,
  );
}

describe("CreateTaskModalView", () => {
  it("keeps the create task dialog bounded with an internal scroll region", () => {
    renderCreateTaskModal();

    const dialog = screen.getByRole("dialog", { name: "Create New Task" });
    expect(dialog).toHaveClass("max-h-[calc(100dvh-1rem)]");
    expect(dialog).toHaveClass("lg:max-h-[calc(100dvh-2rem)]");
    expect(dialog.className).not.toContain("lg:max-h-none");

    const scrollRegion = screen.getByTestId("create-task-scroll-region");
    expect(scrollRegion).toHaveClass("overflow-y-auto");
    expect(scrollRegion).toHaveClass("overscroll-contain");
    expect(scrollRegion.className).not.toContain("lg:overflow-visible");
  });
});
