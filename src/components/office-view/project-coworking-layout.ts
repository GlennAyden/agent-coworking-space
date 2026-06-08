import type { Agent, Department, Project, Task } from "../../types";
import { BREAK_ROOM_GAP, BREAK_ROOM_H, CEO_ZONE_H, HALLWAY_H } from "./office-layout-constants";
import { deriveProjectCoworkingSummary, type ProjectCoworkingSummary } from "./project-coworking-model";

const ROOM_GAP = 12;
export const PROJECT_COWORKING_MIN_W = 1120;
const PROJECT_ROOM_MIN_W = 270;
const PROJECT_ROOM_H = 188;
const COMMONS_ROOM_H = 142;

export type Rect = { x: number; y: number; w: number; h: number };

export interface CoworkingRoomLayout {
  dispatchGateRect: Rect;
  idleLobbyRect: Rect;
  bottomPanelRect: Rect;
  dispatchAnchor: { x: number; y: number };
}

export interface ProjectCoworkingLayout extends CoworkingRoomLayout {
  summary: ProjectCoworkingSummary;
  officeW: number;
  totalH: number;
  breakRoomY: number;
  projectStartY: number;
  projectCols: number;
  projectRoomW: number;
  projectRoomH: number;
  projectRoomStartX: number;
  commonsStartY: number;
  commonsCols: number;
  commonsRoomW: number;
  commonsRoomH: number;
  commonsRoomStartX: number;
}

export function shouldUseProjectCoworking(projects: Project[], tasks: Task[]): boolean {
  return projects.length > 0 || tasks.some((task) => Boolean(task.project_id || task.project_path));
}

export function createProjectCoworkingLayout({
  OFFICE_W,
  projects,
  tasks,
  agents,
  departments,
}: {
  OFFICE_W: number;
  projects: Project[];
  tasks: Task[];
  agents: Agent[];
  departments: Department[];
}): ProjectCoworkingLayout {
  const summary = deriveProjectCoworkingSummary({ projects, tasks, agents, departments });
  const projectCount = Math.max(1, summary.projectRooms.length);
  const wideFloorplan = OFFICE_W >= 760;
  if (wideFloorplan) {
    const edge = 12;
    const hubW = 154;
    const hubGap = 10;
    const commonsAreaW = Math.max(336, Math.floor(OFFICE_W * 0.3));
    const projectAreaW = OFFICE_W - edge * 2 - hubW - hubGap * 2 - commonsAreaW;
    const projectCols = projectAreaW >= PROJECT_ROOM_MIN_W * 2 + ROOM_GAP ? 2 : 1;
    const projectRows = Math.ceil(projectCount / projectCols);
    const projectRoomW = Math.floor((projectAreaW - (projectCols - 1) * ROOM_GAP) / projectCols);

    const commonsCount = Math.max(1, summary.departmentCommons.length);
    const commonsCols = commonsAreaW >= 320 ? 2 : 1;
    const commonsRows = Math.ceil(commonsCount / commonsCols);
    const commonsRoomW = Math.floor((commonsAreaW - (commonsCols - 1) * ROOM_GAP) / commonsCols);

    const projectStartY = CEO_ZONE_H + HALLWAY_H + 24;
    const projectRoomStartX = edge;
    const commonsStartY = projectStartY;
    const commonsRoomStartX = OFFICE_W - edge - commonsAreaW;
    const hubX = projectRoomStartX + projectAreaW + hubGap;
    const dispatchGateRect = { x: hubX, y: projectStartY + 112, w: hubW, h: 76 };
    const idleLobbyRect = { x: hubX, y: dispatchGateRect.y + dispatchGateRect.h + 10, w: hubW, h: 84 };
    const contentBottom = Math.max(
      projectStartY + projectRows * (PROJECT_ROOM_H + ROOM_GAP),
      commonsStartY + commonsRows * (COMMONS_ROOM_H + ROOM_GAP),
      idleLobbyRect.y + idleLobbyRect.h,
    );
    const breakRoomY = contentBottom + BREAK_ROOM_GAP;
    const bottomPanelRect = { x: edge + 16, y: Math.max(projectStartY + 24, breakRoomY - 146), w: Math.min(440, OFFICE_W - edge * 2 - 32), h: 132 };
    const totalH = breakRoomY + BREAK_ROOM_H + 30;

    return {
      summary,
      officeW: OFFICE_W,
      totalH,
      breakRoomY,
      projectStartY,
      projectCols,
      projectRoomW,
      projectRoomH: PROJECT_ROOM_H,
      projectRoomStartX,
      commonsStartY,
      commonsCols,
      commonsRoomW,
      commonsRoomH: COMMONS_ROOM_H,
      commonsRoomStartX,
      dispatchGateRect,
      idleLobbyRect,
      bottomPanelRect,
      dispatchAnchor: {
        x: dispatchGateRect.x + dispatchGateRect.w / 2,
        y: dispatchGateRect.y + dispatchGateRect.h / 2 + 18,
      },
    };
  }

  const projectCols = OFFICE_W >= 760 && OFFICE_W - 24 - ROOM_GAP >= PROJECT_ROOM_MIN_W * 2 ? 2 : 1;
  const projectRows = Math.ceil(projectCount / projectCols);
  const projectRoomW = Math.floor((OFFICE_W - 24 - (projectCols - 1) * ROOM_GAP) / projectCols);
  const projectRoomStartX = (OFFICE_W - (projectCols * projectRoomW + (projectCols - 1) * ROOM_GAP)) / 2;

  const commonsCount = Math.max(1, summary.departmentCommons.length);
  let commonsCols = Math.min(commonsCount, 3);
  while (commonsCols > 1 && commonsCols * 210 + (commonsCols - 1) * ROOM_GAP + 24 > OFFICE_W) {
    commonsCols -= 1;
  }
  const commonsRows = Math.ceil(commonsCount / commonsCols);
  const commonsRoomW = Math.floor((OFFICE_W - 24 - (commonsCols - 1) * ROOM_GAP) / commonsCols);
  const commonsRoomStartX = (OFFICE_W - (commonsCols * commonsRoomW + (commonsCols - 1) * ROOM_GAP)) / 2;

  const projectStartY = CEO_ZONE_H + HALLWAY_H + 18;
  const hubY = projectStartY + projectRows * (PROJECT_ROOM_H + ROOM_GAP) + 24;
  const dispatchGateRect = { x: OFFICE_W / 2 - 74, y: hubY, w: 148, h: 70 };
  const idleLobbyRect = { x: OFFICE_W / 2 - 88, y: hubY + 82, w: 176, h: 78 };
  const commonsStartY = idleLobbyRect.y + idleLobbyRect.h + 34;
  const breakRoomY = commonsStartY + commonsRows * (COMMONS_ROOM_H + ROOM_GAP) + BREAK_ROOM_GAP;
  const bottomPanelRect = { x: 12, y: Math.max(projectStartY + 20, breakRoomY - 144), w: OFFICE_W - 24, h: 132 };
  const totalH = breakRoomY + BREAK_ROOM_H + 30;

  return {
    summary,
    officeW: OFFICE_W,
    totalH,
    breakRoomY,
    projectStartY,
    projectCols,
    projectRoomW,
    projectRoomH: PROJECT_ROOM_H,
    projectRoomStartX,
    commonsStartY,
    commonsCols,
    commonsRoomW,
    commonsRoomH: COMMONS_ROOM_H,
    commonsRoomStartX,
    dispatchGateRect,
    idleLobbyRect,
    bottomPanelRect,
    dispatchAnchor: {
      x: dispatchGateRect.x + dispatchGateRect.w / 2,
      y: dispatchGateRect.y + dispatchGateRect.h / 2 + 18,
    },
  };
}

export function getFloatingPanelRect(anchor: Rect, layout: ProjectCoworkingLayout, desiredW = 560, desiredH = 142): Rect {
  const margin = 12;
  const w = Math.min(desiredW, layout.officeW - margin * 2);
  const h = Math.min(desiredH, layout.totalH - margin * 2);
  let x = anchor.x + anchor.w + 14;
  if (x + w > layout.officeW - margin) x = anchor.x - w - 14;
  if (x < margin) x = Math.min(Math.max(margin, layout.officeW - w - margin), Math.max(margin, anchor.x + 10));

  let y = anchor.y + Math.min(22, Math.max(10, anchor.h * 0.18));
  if (y + h > layout.totalH - margin) y = anchor.y - h - 12;
  y = Math.max(margin, Math.min(layout.totalH - h - margin, y));
  return { x, y, w, h };
}
