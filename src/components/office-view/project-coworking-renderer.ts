import type { MutableRefObject } from "react";
import { Container, Graphics, Text, TextStyle, type Application, type Texture } from "pixi.js";
import type { Agent, Department, Project, SubAgent, Task } from "../../types";
import { localeName } from "../../i18n";
import type { AnimItem, CallbackSnapshot, SubCloneAnimItem } from "./buildScene-types";
import {
  ROOM_PAD,
  TARGET_CHAR_H,
  type RoomRect,
  type SubCloneBurstParticle,
  type WallClockVisual,
  emitSubCloneSmokeBurst,
} from "./model";
import { DEPT_THEME, LOCALE_TEXT, type SupportedLocale, pickLocale } from "./themes-locale";
import {
  blendColor,
  contrastTextColor,
  drawAmbientGlow,
  drawBunting,
  drawCeilingLight,
  drawPictureFrame,
  drawRoomAtmosphere,
  drawRug,
  drawTiledFloor,
  drawTrashCan,
  drawWallClock,
  drawWindow,
  hashStr,
} from "./drawing-core";
import { drawChair, drawDesk, drawPlant, drawWhiteboard } from "./drawing-furniture-a";
import { drawBookshelf, drawCoffeeTable, drawHighTable, drawSofa } from "./drawing-furniture-b";
import { renderDeskAgentAndSubClones } from "./buildScene-department-agent";
import {
  type DepartmentCommonsSummary,
  type ProjectRoomSummary,
} from "./project-coworking-model";
import {
  createProjectCoworkingLayout,
  PROJECT_COWORKING_MIN_W,
  shouldUseProjectCoworking,
  type ProjectCoworkingLayout,
  type Rect,
} from "./project-coworking-layout";

export { createProjectCoworkingLayout, PROJECT_COWORKING_MIN_W, shouldUseProjectCoworking };

const ROOM_GAP = 12;
const MAX_VISIBLE_PROJECT_AGENTS = 3;
const MAX_VISIBLE_COMMONS_AGENTS = 3;

type RoomTheme = { floor1: number; floor2: number; wall: number; accent: number };

interface BuildProjectCoworkingRoomsParams {
  app: Application;
  textures: Record<string, Texture>;
  layout: ProjectCoworkingLayout;
  departments: Department[];
  agents: Agent[];
  tasks: Task[];
  subAgents: SubAgent[];
  unread?: Set<string>;
  customThemes?: Record<string, RoomTheme>;
  activeLocale: SupportedLocale;
  isDark: boolean;
  spriteMap: Map<string, number>;
  cbRef: MutableRefObject<CallbackSnapshot>;
  roomRectsRef: MutableRefObject<RoomRect[]>;
  agentPosRef: MutableRefObject<Map<string, { x: number; y: number }>>;
  animItemsRef: MutableRefObject<AnimItem[]>;
  subCloneAnimItemsRef: MutableRefObject<SubCloneAnimItem[]>;
  subCloneBurstParticlesRef: MutableRefObject<SubCloneBurstParticle[]>;
  wallClocksRef: MutableRefObject<WallClockVisual[]>;
  hiddenAgentIds?: Set<string>;
  removedSubBurstsByParent: Map<string, Array<{ x: number; y: number }>>;
  addedWorkingSubIds: Set<string>;
  nextSubSnapshot: Map<string, { parentAgentId: string; x: number; y: number }>;
}

const PROJECT_THEMES_LIGHT: RoomTheme[] = [
  { floor1: 0xe4eadc, floor2: 0xdbe5d2, wall: 0x788a5f, accent: 0x71915b },
  { floor1: 0xe6e0cf, floor2: 0xddd5c0, wall: 0x8d7f65, accent: 0xa38245 },
  { floor1: 0xdbe7e6, floor2: 0xd1dfde, wall: 0x667f82, accent: 0x4f8b90 },
  { floor1: 0xeadfdf, floor2: 0xe1d3d3, wall: 0x8d6f72, accent: 0xa26667 },
];

const PROJECT_THEMES_DARK: RoomTheme[] = [
  { floor1: 0x101610, floor2: 0x0c120c, wall: 0x263420, accent: 0x4d6f45 },
  { floor1: 0x16130d, floor2: 0x121008, wall: 0x342c20, accent: 0x705a2b },
  { floor1: 0x0d1516, floor2: 0x091112, wall: 0x203438, accent: 0x2f6f73 },
  { floor1: 0x180f10, floor2: 0x130b0c, wall: 0x382226, accent: 0x733d42 },
];

export function buildProjectCoworkingRooms({
  app,
  textures,
  layout,
  agents,
  tasks,
  subAgents,
  unread,
  customThemes,
  activeLocale,
  isDark,
  spriteMap,
  cbRef,
  roomRectsRef,
  agentPosRef,
  animItemsRef,
  subCloneAnimItemsRef,
  subCloneBurstParticlesRef,
  wallClocksRef,
  hiddenAgentIds,
  removedSubBurstsByParent,
  addedWorkingSubIds,
  nextSubSnapshot,
}: BuildProjectCoworkingRoomsParams): void {
  const agentById = new Map(agents.map((agent) => [agent.id, agent]));
  const taskById = new Map(tasks.map((task) => [task.id, task]));
  const projectRects = new Map<string, Rect>();
  const commonsRects = new Map<string, Rect>();

  layout.summary.projectRooms.forEach((room, index) => {
    projectRects.set(room.key, rectForIndex(index, layout.projectCols, layout.projectRoomStartX, layout.projectStartY, layout.projectRoomW, layout.projectRoomH));
  });
  layout.summary.departmentCommons.forEach((commons, index) => {
    commonsRects.set(commons.key, rectForIndex(index, layout.commonsCols, layout.commonsRoomStartX, layout.commonsStartY, layout.commonsRoomW, layout.commonsRoomH));
  });

  drawSectionLabel(app.stage, "PROJECT ROOMS", layout.projectRoomStartX + 8, layout.projectStartY - 18, 0x3f4f36, isDark);
  drawRouteLayer(app.stage, layout, projectRects, commonsRects, agentById, isDark);

  layout.summary.projectRooms.forEach((projectRoom, index) => {
    const rect = projectRects.get(projectRoom.key);
    if (!rect) return;
    renderProjectRoom({
      app,
      textures,
      roomSummary: projectRoom,
      rect,
      index,
      agents: projectRoom.agentIds.map((agentId) => agentById.get(agentId)).filter(Boolean) as Agent[],
      taskById,
      subAgents,
      unread,
      activeLocale,
      isDark,
      spriteMap,
      cbRef,
      agentPosRef,
      animItemsRef,
      subCloneAnimItemsRef,
      subCloneBurstParticlesRef,
      hiddenAgentIds,
      removedSubBurstsByParent,
      addedWorkingSubIds,
      nextSubSnapshot,
    });
  });

  drawSectionLabel(
    app.stage,
    "DEPARTMENT COMMONS",
    layout.commonsRoomStartX + 8,
    layout.commonsStartY - 18,
    0x516070,
    isDark,
  );
  layout.summary.departmentCommons.forEach((commons, index) => {
    const rect = commonsRects.get(commons.key);
    if (!rect) return;
    renderDepartmentCommons({
      app,
      textures,
      commons,
      rect,
      index,
      agents: commons.agentIds.map((agentId) => agentById.get(agentId)).filter(Boolean) as Agent[],
      tasks,
      subAgents,
      unread,
      customThemes,
      activeLocale,
      spriteMap,
      cbRef,
      roomRectsRef,
      agentPosRef,
      animItemsRef,
      subCloneAnimItemsRef,
      subCloneBurstParticlesRef,
      wallClocksRef,
      hiddenAgentIds,
      removedSubBurstsByParent,
      addedWorkingSubIds,
      nextSubSnapshot,
    });
  });

  drawCoworkingHub(app.stage, layout, isDark);
  drawProjectCommandPanel(app.stage, layout, tasks, agentById, taskById, activeLocale, isDark);
}

function renderProjectRoom({
  app,
  textures,
  roomSummary,
  rect,
  index,
  agents,
  taskById,
  subAgents,
  unread,
  activeLocale,
  isDark,
  spriteMap,
  cbRef,
  agentPosRef,
  animItemsRef,
  subCloneAnimItemsRef,
  subCloneBurstParticlesRef,
  hiddenAgentIds,
  removedSubBurstsByParent,
  addedWorkingSubIds,
  nextSubSnapshot,
}: {
  app: Application;
  textures: Record<string, Texture>;
  roomSummary: ProjectRoomSummary;
  rect: Rect;
  index: number;
  agents: Agent[];
  taskById: Map<string, Task>;
  subAgents: SubAgent[];
  unread?: Set<string>;
  activeLocale: SupportedLocale;
  isDark: boolean;
  spriteMap: Map<string, number>;
  cbRef: MutableRefObject<CallbackSnapshot>;
  agentPosRef: MutableRefObject<Map<string, { x: number; y: number }>>;
  animItemsRef: MutableRefObject<AnimItem[]>;
  subCloneAnimItemsRef: MutableRefObject<SubCloneAnimItem[]>;
  subCloneBurstParticlesRef: MutableRefObject<SubCloneBurstParticle[]>;
  hiddenAgentIds?: Set<string>;
  removedSubBurstsByParent: Map<string, Array<{ x: number; y: number }>>;
  addedWorkingSubIds: Set<string>;
  nextSubSnapshot: Map<string, { parentAgentId: string; x: number; y: number }>;
}): void {
  const theme = projectTheme(roomSummary.key, index, isDark);
  const room = new Container();
  drawRoomShell(room, rect, theme, true);

  drawProjectSign(room, rect, theme, roomSummary, isDark);
  drawProjectDecor(room, rect, theme, index);
  drawProjectMetrics(room, rect, theme, roomSummary, isDark);

  if (agents.length === 0) {
    drawEmptyRoomState(room, rect, "Ready room", "Waiting for assigned work", theme, isDark);
  }

  const visibleAgents = agents.slice(0, MAX_VISIBLE_PROJECT_AGENTS);
  const slotCols = rect.w >= 430 ? 3 : 2;
  const slotW = (rect.w - ROOM_PAD * 2) / slotCols;
  visibleAgents.forEach((agent, agentIndex) => {
    const col = agentIndex % slotCols;
    const row = Math.floor(agentIndex / slotCols);
    const ax = rect.x + ROOM_PAD + col * slotW + slotW / 2;
    const nameY = rect.y + 72 + row * 82;
    const charFeetY = nameY + 23 + TARGET_CHAR_H;
    const deskY = charFeetY - 8;
    const activeTask = roomSummary.activeTaskIds.map((taskId) => taskById.get(taskId)).find((task) => task?.assigned_agent_id === agent.id);

    agentPosRef.current.set(agent.id, { x: ax, y: deskY });
    if (hiddenAgentIds?.has(agent.id)) {
      drawChair(room, ax, charFeetY - TARGET_CHAR_H * 0.18, theme.accent);
      drawDesk(room, ax - 24, deskY, false);
      return;
    }

    renderAgentHeader(room, ax, nameY, agent, theme.accent, unread, activeLocale);
    drawChair(room, ax, charFeetY - TARGET_CHAR_H * 0.18, theme.accent);
    emitRemovedSubBursts(room, subCloneBurstParticlesRef, removedSubBurstsByParent, agent.id);

    renderDeskAgentAndSubClones({
      room,
      textures,
      spriteMap,
      agent,
      tasks: activeTask ? [activeTask] : [],
      subAgents,
      ax,
      deskY,
      charFeetY,
      isWorking: agent.status === "working",
      isOffline: agent.status === "offline",
      cbRef,
      animItemsRef,
      subCloneAnimItemsRef,
      subCloneBurstParticlesRef,
      addedWorkingSubIds,
      nextSubSnapshot,
      themeAccent: theme.accent,
    });
  });

  if (agents.length > MAX_VISIBLE_PROJECT_AGENTS) {
    const overflowX = rect.x + rect.w - 34;
    const overflowY = rect.y + rect.h - 22;
    for (const agent of agents.slice(MAX_VISIBLE_PROJECT_AGENTS)) {
      agentPosRef.current.set(agent.id, { x: overflowX, y: overflowY });
    }
    drawOverflowBadge(room, overflowX, overflowY, agents.length - MAX_VISIBLE_PROJECT_AGENTS, theme);
  }

  app.stage.addChild(room);
}

function renderDepartmentCommons({
  app,
  textures,
  commons,
  rect,
  index,
  agents,
  tasks,
  subAgents,
  unread,
  customThemes,
  activeLocale,
  spriteMap,
  cbRef,
  roomRectsRef,
  agentPosRef,
  animItemsRef,
  subCloneAnimItemsRef,
  subCloneBurstParticlesRef,
  wallClocksRef,
  hiddenAgentIds,
  removedSubBurstsByParent,
  addedWorkingSubIds,
  nextSubSnapshot,
}: {
  app: Application;
  textures: Record<string, Texture>;
  commons: DepartmentCommonsSummary;
  rect: Rect;
  index: number;
  agents: Agent[];
  tasks: Task[];
  subAgents: SubAgent[];
  unread?: Set<string>;
  customThemes?: Record<string, RoomTheme>;
  activeLocale: SupportedLocale;
  spriteMap: Map<string, number>;
  cbRef: MutableRefObject<CallbackSnapshot>;
  roomRectsRef: MutableRefObject<RoomRect[]>;
  agentPosRef: MutableRefObject<Map<string, { x: number; y: number }>>;
  animItemsRef: MutableRefObject<AnimItem[]>;
  subCloneAnimItemsRef: MutableRefObject<SubCloneAnimItem[]>;
  subCloneBurstParticlesRef: MutableRefObject<SubCloneBurstParticle[]>;
  wallClocksRef: MutableRefObject<WallClockVisual[]>;
  hiddenAgentIds?: Set<string>;
  removedSubBurstsByParent: Map<string, Array<{ x: number; y: number }>>;
  addedWorkingSubIds: Set<string>;
  nextSubSnapshot: Map<string, { parentAgentId: string; x: number; y: number }>;
}): void {
  const theme = commons.department
    ? customThemes?.[commons.department.id] || DEPT_THEME[commons.department.id] || DEPT_THEME.dev
    : DEPT_THEME.dev;
  const room = new Container();
  drawRoomShell(room, rect, theme, false);
  drawCommonsSign(room, rect, theme, commons, activeLocale, cbRef);
  drawCommonsDecor(room, rect, theme, index, wallClocksRef);

  if (commons.department) roomRectsRef.current.push({ dept: commons.department, ...rect });

  if (agents.length === 0) {
    drawEmptyRoomState(room, rect, pickLocale(activeLocale, LOCALE_TEXT.noAssignedAgent), "Commons open", theme, false);
  }

  const visibleAgents = agents.slice(0, MAX_VISIBLE_COMMONS_AGENTS);
  const slotCols = Math.min(3, Math.max(1, visibleAgents.length || 1));
  const slotW = (rect.w - ROOM_PAD * 2) / slotCols;
  visibleAgents.forEach((agent, agentIndex) => {
    const ax = rect.x + ROOM_PAD + agentIndex * slotW + slotW / 2;
    const nameY = rect.y + 65;
    const charFeetY = nameY + 23 + TARGET_CHAR_H;
    const deskY = charFeetY - 8;

    agentPosRef.current.set(agent.id, { x: ax, y: deskY });
    if (hiddenAgentIds?.has(agent.id)) {
      drawChair(room, ax, charFeetY - TARGET_CHAR_H * 0.18, theme.accent);
      drawDesk(room, ax - 24, deskY, false);
      return;
    }

    renderAgentHeader(room, ax, nameY, agent, theme.accent, unread, activeLocale);
    drawChair(room, ax, charFeetY - TARGET_CHAR_H * 0.18, theme.accent);
    emitRemovedSubBursts(room, subCloneBurstParticlesRef, removedSubBurstsByParent, agent.id);

    if (agent.status === "break") {
      drawDesk(room, ax - 24, deskY, false);
      return;
    }

    renderDeskAgentAndSubClones({
      room,
      textures,
      spriteMap,
      agent,
      tasks,
      subAgents,
      ax,
      deskY,
      charFeetY,
      isWorking: agent.status === "working",
      isOffline: agent.status === "offline",
      cbRef,
      animItemsRef,
      subCloneAnimItemsRef,
      subCloneBurstParticlesRef,
      addedWorkingSubIds,
      nextSubSnapshot,
      themeAccent: theme.accent,
    });
  });

  if (agents.length > MAX_VISIBLE_COMMONS_AGENTS) {
    const overflowX = rect.x + rect.w - 30;
    const overflowY = rect.y + rect.h - 18;
    for (const agent of agents.slice(MAX_VISIBLE_COMMONS_AGENTS)) {
      agentPosRef.current.set(agent.id, { x: overflowX, y: overflowY });
    }
    drawOverflowBadge(room, overflowX, overflowY, agents.length - MAX_VISIBLE_COMMONS_AGENTS, theme);
  }

  app.stage.addChild(room);
}

function drawRoomShell(room: Container, rect: Rect, theme: RoomTheme, isProject: boolean): void {
  const floorG = new Graphics();
  drawTiledFloor(floorG, rect.x, rect.y, rect.w, rect.h, theme.floor1, theme.floor2);
  room.addChild(floorG);
  drawRoomAtmosphere(room, rect.x, rect.y, rect.w, rect.h, theme.wall, theme.accent);
  drawAmbientGlow(room, rect.x + rect.w / 2, rect.y + rect.h / 2, rect.w * 0.34, theme.accent, isProject ? 0.055 : 0.04);

  const wallG = new Graphics();
  wallG.roundRect(rect.x, rect.y, rect.w, rect.h, 3).stroke({ width: isProject ? 3 : 2.4, color: theme.wall });
  wallG.roundRect(rect.x + 4, rect.y + 4, rect.w - 8, rect.h - 8, 2).stroke({
    width: 0.8,
    color: blendColor(theme.wall, 0xffffff, 0.38),
    alpha: 0.35,
  });
  room.addChild(wallG);

  const doorG = new Graphics();
  doorG.rect(rect.x + rect.w / 2 - 18, rect.y - 2, 36, 5).fill(0xf5f0e8);
  room.addChild(doorG);
}

function drawProjectSign(room: Container, rect: Rect, theme: RoomTheme, roomSummary: ProjectRoomSummary, isDark: boolean): void {
  const signW = Math.min(150, rect.w - 34);
  const title = truncate(roomSummary.name, 24);
  const labelFill = contrastTextColor(theme.accent);
  const signBg = new Graphics();
  signBg.roundRect(rect.x + rect.w / 2 - signW / 2 + 1, rect.y - 3, signW, 24, 4).fill({ color: 0x000000, alpha: 0.13 });
  signBg.roundRect(rect.x + rect.w / 2 - signW / 2, rect.y - 4, signW, 24, 4).fill(theme.accent);
  signBg.roundRect(rect.x + rect.w / 2 - signW / 2 + 3, rect.y - 1, signW - 6, 6, 2).fill({
    color: 0xffffff,
    alpha: isDark ? 0.05 : 0.1,
  });
  room.addChild(signBg);

  const titleTxt = new Text({
    text: title,
    style: new TextStyle({
      fontSize: 9,
      fill: labelFill,
      fontWeight: "bold",
      fontFamily: "system-ui, sans-serif",
    }),
  });
  titleTxt.anchor.set(0.5, 0.5);
  titleTxt.position.set(rect.x + rect.w / 2, rect.y + 5);
  room.addChild(titleTxt);

  const typeTxt = new Text({
    text: roomSummary.fallback ? "FALLBACK ROOM" : "PROJECT ROOM",
    style: new TextStyle({
      fontSize: 5.8,
      fill: labelFill,
      fontFamily: "system-ui, sans-serif",
    }),
  });
  typeTxt.anchor.set(0.5, 0.5);
  typeTxt.position.set(rect.x + rect.w / 2, rect.y + 15);
  room.addChild(typeTxt);
}

function drawCommonsSign(
  room: Container,
  rect: Rect,
  theme: RoomTheme,
  commons: DepartmentCommonsSummary,
  activeLocale: SupportedLocale,
  cbRef: MutableRefObject<CallbackSnapshot>,
): void {
  const signW = Math.min(136, rect.w - 28);
  const label = commons.department ? `${localeName(activeLocale, commons.department)} Commons` : "Unassigned Commons";
  const signBg = new Graphics();
  signBg.roundRect(rect.x + rect.w / 2 - signW / 2 + 1, rect.y - 3, signW, 20, 4).fill({ color: 0x000000, alpha: 0.12 });
  signBg.roundRect(rect.x + rect.w / 2 - signW / 2, rect.y - 4, signW, 20, 4).fill(theme.accent);
  signBg.eventMode = commons.department ? "static" : "none";
  signBg.cursor = commons.department ? "pointer" : "default";
  if (commons.department) signBg.on("pointerdown", () => cbRef.current.onSelectDepartment(commons.department as Department));
  room.addChild(signBg);

  const signTxt = new Text({
    text: truncate(label, 22),
    style: new TextStyle({
      fontSize: 8,
      fill: contrastTextColor(theme.accent),
      fontWeight: "bold",
      fontFamily: "system-ui, sans-serif",
    }),
  });
  signTxt.anchor.set(0.5, 0.5);
  signTxt.position.set(rect.x + rect.w / 2, rect.y + 5);
  room.addChild(signTxt);
}

function drawProjectDecor(room: Container, rect: Rect, theme: RoomTheme, index: number): void {
  drawCeilingLight(room, rect.x + rect.w / 2, rect.y + 18, theme.accent);
  drawBunting(
    room,
    rect.x + 16,
    rect.y + 22,
    rect.w - 32,
    blendColor(theme.accent, 0xffffff, 0.24),
    blendColor(theme.wall, 0xffffff, 0.42),
    0.45,
  );
  drawWhiteboard(room, rect.x + rect.w - 54, rect.y + 26);
  drawBookshelf(room, rect.x + 8, rect.y + 28);
  drawWindow(room, rect.x + rect.w / 2 - 14, rect.y + 30, 28, 18);
  if (rect.w > 430) {
    drawWindow(room, rect.x + rect.w / 2 - 60, rect.y + 30, 28, 18);
    drawWindow(room, rect.x + rect.w / 2 + 34, rect.y + 30, 28, 18);
  }
  drawPictureFrame(room, rect.x + 44, rect.y + 31);
  drawPlant(room, rect.x + 12, rect.y + rect.h - 16, index);
  drawPlant(room, rect.x + rect.w - 14, rect.y + rect.h - 16, index + 1);
  drawTrashCan(room, rect.x + rect.w - 18, rect.y + rect.h - 30);
  drawRug(room, rect.x + rect.w / 2, rect.y + rect.h - 54, rect.w - 58, 76, theme.accent);
}

function drawCommonsDecor(
  room: Container,
  rect: Rect,
  theme: RoomTheme,
  index: number,
  wallClocksRef: MutableRefObject<WallClockVisual[]>,
): void {
  drawCeilingLight(room, rect.x + rect.w / 2, rect.y + 15, theme.accent);
  drawBookshelf(room, rect.x + 8, rect.y + 20);
  drawWhiteboard(room, rect.x + rect.w - 48, rect.y + 20);
  wallClocksRef.current.push(drawWallClock(room, rect.x + rect.w - 16, rect.y + 13));
  drawSofa(room, rect.x + Math.max(38, rect.w / 2 - 88), rect.y + 45, theme.accent);
  drawCoffeeTable(room, rect.x + rect.w / 2 - 18, rect.y + 58);
  drawPlant(room, rect.x + 12, rect.y + rect.h - 15, index + 2);
  drawPlant(room, rect.x + rect.w - 13, rect.y + rect.h - 15, index + 3);
}

function drawProjectMetrics(
  room: Container,
  rect: Rect,
  theme: RoomTheme,
  roomSummary: ProjectRoomSummary,
  isDark: boolean,
): void {
  const rows = [
    `${roomSummary.activeTaskIds.length} active`,
    `${roomSummary.agentIds.length} agents`,
    `${roomSummary.taskIds.length} tasks`,
  ];
  rows.forEach((row, index) => {
    const y = rect.y + 28 + index * 15;
    const txt = new Text({
      text: row,
      style: new TextStyle({
        fontSize: 6.8,
        fill: isDark ? 0xd6dfd0 : 0x394033,
        fontFamily: "system-ui, sans-serif",
      }),
    });
    txt.anchor.set(1, 0.5);
    const x = rect.x + rect.w - 12;
    const bgW = txt.width + 8;
    const bg = new Graphics();
    bg.roundRect(x - bgW, y - 5, bgW, 10, 2).fill({ color: blendColor(theme.floor1, theme.accent, 0.15), alpha: 0.86 });
    bg.roundRect(x - bgW, y - 5, bgW, 10, 2).stroke({ width: 0.5, color: theme.accent, alpha: 0.25 });
    room.addChild(bg);
    txt.position.set(x - 4, y - 0.5);
    room.addChild(txt);
  });
}

function drawEmptyRoomState(room: Container, rect: Rect, title: string, subtitle: string, theme: RoomTheme, isDark: boolean): void {
  const titleTxt = new Text({
    text: title,
    style: new TextStyle({
      fontSize: 10,
      fill: isDark ? 0xcbd5c0 : 0x6f6252,
      fontWeight: "bold",
      fontFamily: "system-ui, sans-serif",
    }),
  });
  titleTxt.anchor.set(0.5, 0.5);
  titleTxt.position.set(rect.x + rect.w / 2, rect.y + rect.h / 2 - 4);
  room.addChild(titleTxt);

  const subTxt = new Text({
    text: subtitle,
    style: new TextStyle({
      fontSize: 7,
      fill: isDark ? 0x9ca78e : 0x9a8a7a,
      fontFamily: "system-ui, sans-serif",
    }),
  });
  subTxt.anchor.set(0.5, 0.5);
  subTxt.position.set(rect.x + rect.w / 2, rect.y + rect.h / 2 + 10);
  room.addChild(subTxt);

  const g = new Graphics();
  g.roundRect(rect.x + rect.w / 2 - 54, rect.y + rect.h / 2 - 18, 108, 38, 6).stroke({
    width: 1,
    color: theme.accent,
    alpha: 0.22,
  });
  room.addChildAt(g, Math.max(0, room.children.indexOf(titleTxt)));
}

function renderAgentHeader(
  room: Container,
  ax: number,
  nameY: number,
  agent: Agent,
  accent: number,
  unread: Set<string> | undefined,
  activeLocale: SupportedLocale,
): void {
  const nameText = new Text({
    text: truncate(localeName(activeLocale, agent), 16),
    style: new TextStyle({
      fontSize: 7,
      fill: 0x3a3a4a,
      fontWeight: "bold",
      fontFamily: "system-ui, sans-serif",
    }),
  });
  nameText.anchor.set(0.5, 0);
  const nameTagW = Math.min(nameText.width + 6, 72);
  const nameTagBg = new Graphics();
  nameTagBg.roundRect(ax - nameTagW / 2, nameY, nameTagW, 12, 3).fill({ color: 0xffffff, alpha: 0.86 });
  room.addChild(nameTagBg);
  nameText.position.set(ax, nameY + 2);
  room.addChild(nameText);

  if (unread?.has(agent.id)) {
    const bangBg = new Graphics();
    const bangX = ax + nameTagW / 2 + 2;
    bangBg.circle(bangX, nameY + 6, 6).fill(0xff3333);
    bangBg.circle(bangX, nameY + 6, 6).stroke({ width: 1, color: 0xff0000, alpha: 0.6 });
    room.addChild(bangBg);
    const bangTxt = new Text({
      text: "!",
      style: new TextStyle({ fontSize: 8, fill: 0xffffff, fontWeight: "bold", fontFamily: "monospace" }),
    });
    bangTxt.anchor.set(0.5, 0.5);
    bangTxt.position.set(bangX, nameY + 6);
    room.addChild(bangTxt);
  }

  const roleText = new Text({
    text: pickLocale(
      activeLocale,
      LOCALE_TEXT.role[agent.role as keyof typeof LOCALE_TEXT.role] || {
        ko: agent.role,
        en: agent.role,
        ja: agent.role,
        zh: agent.role,
      },
    ),
    style: new TextStyle({
      fontSize: 6,
      fill: contrastTextColor(accent),
      fontFamily: "system-ui, sans-serif",
    }),
  });
  roleText.anchor.set(0.5, 0.5);
  const roleTagW = roleText.width + 5;
  const roleTagBg = new Graphics();
  roleTagBg.roundRect(ax - roleTagW / 2, nameY + 13, roleTagW, 9, 2).fill({ color: accent, alpha: 0.82 });
  room.addChild(roleTagBg);
  roleText.position.set(ax, nameY + 17.5);
  room.addChild(roleText);
}

function drawRouteLayer(
  stage: Container,
  layout: ProjectCoworkingLayout,
  projectRects: Map<string, Rect>,
  commonsRects: Map<string, Rect>,
  agentById: Map<string, Agent>,
  isDark: boolean,
): void {
  const routeLayer = new Container();
  const g = new Graphics();
  routeLayer.addChild(g);
  for (const assignment of layout.summary.agentProjectAssignments) {
    const projectRect = projectRects.get(assignment.projectRoomKey);
    const agent = agentById.get(assignment.agentId);
    const commonsRect = commonsRects.get(assignment.departmentId ?? "unassigned") ?? (agent?.department_id ? commonsRects.get(agent.department_id) : undefined);
    if (!projectRect || !commonsRect) continue;
    const color = projectTheme(assignment.projectRoomKey, hashStr(assignment.projectRoomKey), isDark).accent;
    const from = { x: commonsRect.x + commonsRect.w / 2, y: commonsRect.y + 10 };
    const to = { x: projectRect.x + projectRect.w / 2, y: projectRect.y + projectRect.h + 4 };
    drawDottedRoute(g, from, layout.dispatchAnchor, color, isDark);
    drawDottedRoute(g, layout.dispatchAnchor, to, color, isDark);
  }
  stage.addChild(routeLayer);
}

function drawCoworkingHub(stage: Container, layout: ProjectCoworkingLayout, isDark: boolean): void {
  const hub = new Container();
  const dispatchTheme = {
    floor1: isDark ? 0x15120e : 0xe8ddca,
    floor2: isDark ? 0x100d0a : 0xdfd2bb,
    wall: isDark ? 0x5a4428 : 0x8c6c43,
    accent: isDark ? 0xd6a94e : 0xa87326,
  };
  drawMiniRoom(hub, layout.dispatchGateRect, dispatchTheme, "DISPATCH GATE", "Queue 2");
  drawHighTable(
    hub,
    layout.dispatchGateRect.x + layout.dispatchGateRect.w / 2 - 35,
    layout.dispatchGateRect.y + 25,
  );
  drawPlant(hub, layout.dispatchGateRect.x + 12, layout.dispatchGateRect.y + layout.dispatchGateRect.h - 13, 2);
  drawPlant(
    hub,
    layout.dispatchGateRect.x + layout.dispatchGateRect.w - 12,
    layout.dispatchGateRect.y + layout.dispatchGateRect.h - 13,
    4,
  );

  const idleTheme = {
    floor1: isDark ? 0x111616 : 0xdfe9e4,
    floor2: isDark ? 0x0d1112 : 0xd4e0da,
    wall: isDark ? 0x284642 : 0x668779,
    accent: isDark ? 0x62b6a2 : 0x3e8b7a,
  };
  drawMiniRoom(hub, layout.idleLobbyRect, idleTheme, "IDLE LOBBY", "Standby");
  drawSofa(hub, layout.idleLobbyRect.x + 20, layout.idleLobbyRect.y + 42, idleTheme.accent);
  drawCoffeeTable(hub, layout.idleLobbyRect.x + layout.idleLobbyRect.w / 2 - 18, layout.idleLobbyRect.y + 52);
  drawPlant(hub, layout.idleLobbyRect.x + layout.idleLobbyRect.w - 13, layout.idleLobbyRect.y + layout.idleLobbyRect.h - 13, 5);

  stage.addChild(hub);
}

function drawMiniRoom(room: Container, rect: Rect, theme: RoomTheme, title: string, subtitle: string): void {
  const shell = new Graphics();
  drawTiledFloor(shell, rect.x, rect.y, rect.w, rect.h, theme.floor1, theme.floor2);
  room.addChild(shell);
  drawRoomAtmosphere(room, rect.x, rect.y, rect.w, rect.h, theme.wall, theme.accent);
  drawAmbientGlow(room, rect.x + rect.w / 2, rect.y + rect.h / 2, rect.w * 0.42, theme.accent, 0.055);
  const border = new Graphics();
  border.roundRect(rect.x, rect.y, rect.w, rect.h, 4).stroke({ width: 2, color: theme.wall, alpha: 0.95 });
  border.roundRect(rect.x + 3, rect.y + 3, rect.w - 6, rect.h - 6, 3).stroke({
    width: 0.7,
    color: blendColor(theme.wall, 0xffffff, 0.42),
    alpha: 0.38,
  });
  room.addChild(border);

  const signW = Math.min(rect.w - 20, 108);
  const sign = new Graphics();
  sign.roundRect(rect.x + rect.w / 2 - signW / 2, rect.y - 4, signW, 18, 4).fill(theme.accent);
  sign.roundRect(rect.x + rect.w / 2 - signW / 2, rect.y - 4, signW, 18, 4).stroke({
    width: 0.8,
    color: blendColor(theme.accent, 0xffffff, 0.4),
    alpha: 0.55,
  });
  room.addChild(sign);

  const label = new Text({
    text: title,
    style: new TextStyle({
      fontSize: 8,
      fill: contrastTextColor(theme.accent),
      fontWeight: "bold",
      fontFamily: "system-ui, sans-serif",
    }),
  });
  label.anchor.set(0.5, 0.5);
  label.position.set(rect.x + rect.w / 2, rect.y + 4.5);
  room.addChild(label);

  const note = new Text({
    text: subtitle,
    style: new TextStyle({ fontSize: 7, fill: 0x4a4337, fontFamily: "monospace" }),
  });
  note.anchor.set(0.5, 0.5);
  note.position.set(rect.x + rect.w / 2, rect.y + 22);
  room.addChild(note);
}

function drawProjectCommandPanel(
  stage: Container,
  layout: ProjectCoworkingLayout,
  tasks: Task[],
  agentById: Map<string, Agent>,
  taskById: Map<string, Task>,
  activeLocale: SupportedLocale,
  isDark: boolean,
): void {
  const rect = layout.bottomPanelRect;
  const room = layout.summary.projectRooms.find((projectRoom) => projectRoom.activeTaskIds.length > 0) ?? layout.summary.projectRooms[0];
  if (!room) return;

  const theme = projectTheme(room.key, hashStr(`${room.key}:panel`), isDark);
  const panel = new Container();
  const bg = new Graphics();
  bg.roundRect(rect.x, rect.y, rect.w, rect.h, 6).fill({ color: isDark ? 0x17130d : 0xf4eadb, alpha: 0.96 });
  bg.roundRect(rect.x, rect.y, rect.w, rect.h, 6).stroke({ width: 2, color: theme.wall, alpha: 0.72 });
  bg.roundRect(rect.x + 5, rect.y + 5, rect.w - 10, rect.h - 10, 4).stroke({
    width: 0.8,
    color: blendColor(theme.accent, 0xffffff, 0.34),
    alpha: 0.38,
  });
  panel.addChild(bg);

  const preview = { x: rect.x + 12, y: rect.y + 14, w: 142, h: rect.h - 28 };
  drawTiledFloor(bg, preview.x, preview.y, preview.w, preview.h, theme.floor1, theme.floor2);
  bg.roundRect(preview.x, preview.y, preview.w, preview.h, 4).stroke({ width: 1.8, color: theme.wall, alpha: 0.9 });
  drawWhiteboard(panel, preview.x + preview.w - 42, preview.y + 14);
  drawPlant(panel, preview.x + 12, preview.y + preview.h - 14, 1);
  const previewAgents = room.agentIds.slice(0, 3);
  previewAgents.forEach((agentId, index) => {
    const ax = preview.x + 36 + index * 38;
    const ay = preview.y + preview.h - 25;
    const dot = new Graphics();
    dot.circle(ax, ay - 18, 8).fill(theme.accent);
    dot.roundRect(ax - 10, ay - 16, 20, 18, 4).fill({ color: blendColor(theme.accent, 0xffffff, 0.28), alpha: 0.95 });
    dot.ellipse(ax, ay + 2, 14, 4).fill({ color: 0x1b1f24, alpha: 0.14 });
    panel.addChild(dot);
  });

  const titleX = rect.x + 174;
  const status = room.activeTaskIds.length > 0 ? "RUNNING" : room.taskIds.length > 0 ? "IN REVIEW" : "READY";
  const title = new Text({
    text: truncate(room.name.toUpperCase(), 26),
    style: new TextStyle({
      fontSize: 15,
      fill: isDark ? 0xf6eddc : 0x2e251b,
      fontWeight: "bold",
      fontFamily: "system-ui, sans-serif",
    }),
  });
  title.position.set(titleX, rect.y + 18);
  panel.addChild(title);
  drawStatusPill(panel, titleX, rect.y + 42, status, theme.accent);

  const pathText = new Text({
    text: truncate(room.projectPath ?? "No project path", 44),
    style: new TextStyle({ fontSize: 7, fill: isDark ? 0xd6cabb : 0x6b5a49, fontFamily: "monospace" }),
  });
  pathText.position.set(titleX, rect.y + 61);
  panel.addChild(pathText);

  const currentTask = room.activeTaskIds.map((taskId) => taskById.get(taskId)).find(Boolean) ?? room.taskIds.map((taskId) => taskById.get(taskId)).find(Boolean);
  if (rect.w < 760) {
    const compactTask = new Text({
      text: truncate(currentTask?.title ?? "Waiting for assignment", 34),
      style: new TextStyle({
        fontSize: 7,
        fill: isDark ? 0xe9dcc8 : 0x473b30,
        fontFamily: "system-ui, sans-serif",
      }),
    });
    compactTask.position.set(titleX, rect.y + 82);
    panel.addChild(compactTask);
    stage.addChild(panel);
    return;
  }

  drawInfoBlock(panel, rect.x + rect.w * 0.42, rect.y + 18, 156, "CURRENT TASK", currentTask?.title ?? "Waiting for assignment");
  drawAssignedAgents(panel, rect.x + rect.w * 0.58, rect.y + 18, room.agentIds, agentById, activeLocale, theme.accent);
  drawTerminalPreview(panel, rect.x + rect.w * 0.74, rect.y + 18, 156, rect.h - 36, room, currentTask);
  drawQuickActions(panel, rect.x + rect.w - 116, rect.y + 18, 96, rect.h - 36, theme.accent);

  stage.addChild(panel);
}

function drawStatusPill(panel: Container, x: number, y: number, text: string, accent: number): void {
  const label = new Text({
    text,
    style: new TextStyle({ fontSize: 7, fill: 0xffffff, fontWeight: "bold", fontFamily: "system-ui, sans-serif" }),
  });
  const w = label.width + 12;
  const bg = new Graphics();
  bg.roundRect(x, y, w, 14, 4).fill({ color: accent, alpha: 0.92 });
  panel.addChild(bg);
  label.position.set(x + 6, y + 3);
  panel.addChild(label);
}

function drawInfoBlock(panel: Container, x: number, y: number, w: number, label: string, value: string): void {
  const heading = new Text({
    text: label,
    style: new TextStyle({ fontSize: 6.5, fill: 0x75634f, fontWeight: "bold", fontFamily: "monospace" }),
  });
  heading.position.set(x, y);
  panel.addChild(heading);
  const bg = new Graphics();
  bg.roundRect(x, y + 13, w, 48, 4).fill({ color: 0xfffbf2, alpha: 0.86 });
  bg.roundRect(x, y + 13, w, 48, 4).stroke({ width: 0.8, color: 0xd2b98f, alpha: 0.55 });
  panel.addChild(bg);
  const body = new Text({
    text: truncate(value, 46),
    style: new TextStyle({
      fontSize: 7,
      fill: 0x473b30,
      fontFamily: "system-ui, sans-serif",
      wordWrap: true,
      wordWrapWidth: w - 14,
    }),
  });
  body.position.set(x + 7, y + 22);
  panel.addChild(body);
}

function drawAssignedAgents(
  panel: Container,
  x: number,
  y: number,
  agentIds: string[],
  agentById: Map<string, Agent>,
  activeLocale: SupportedLocale,
  accent: number,
): void {
  const heading = new Text({
    text: `ASSIGNED AGENTS (${agentIds.length})`,
    style: new TextStyle({ fontSize: 6.5, fill: 0x75634f, fontWeight: "bold", fontFamily: "monospace" }),
  });
  heading.position.set(x, y);
  panel.addChild(heading);
  agentIds.slice(0, 4).forEach((agentId, index) => {
    const agent = agentById.get(agentId);
    const ax = x + 14 + index * 36;
    const avatar = new Graphics();
    avatar.circle(ax, y + 31, 11).fill({ color: blendColor(accent, 0xffffff, 0.18), alpha: 1 });
    avatar.circle(ax, y + 31, 11).stroke({ width: 1, color: accent, alpha: 0.65 });
    panel.addChild(avatar);
    const name = new Text({
      text: truncate(agent ? localeName(activeLocale, agent) : agentId, 7),
      style: new TextStyle({ fontSize: 5.8, fill: 0x3f352d, fontFamily: "system-ui, sans-serif" }),
    });
    name.anchor.set(0.5, 0);
    name.position.set(ax, y + 45);
    panel.addChild(name);
  });
}

function drawTerminalPreview(
  panel: Container,
  x: number,
  y: number,
  w: number,
  h: number,
  room: ProjectRoomSummary,
  task?: Task,
): void {
  const bg = new Graphics();
  bg.roundRect(x, y, w, h, 5).fill({ color: 0x111820, alpha: 0.96 });
  bg.roundRect(x, y, w, h, 5).stroke({ width: 0.8, color: 0x2a3847, alpha: 0.8 });
  panel.addChild(bg);
  const lines = [
    "$ agent run task",
    task ? `task: ${truncate(task.id, 18)}` : `project: ${truncate(room.key, 18)}`,
    "syncing workspace...",
    "visual route armed",
    "handoff ready",
  ];
  lines.forEach((line, index) => {
    const txt = new Text({
      text: line,
      style: new TextStyle({ fontSize: 6.8, fill: index === 0 ? 0xf1c35b : 0xcde6dd, fontFamily: "monospace" }),
    });
    txt.position.set(x + 9, y + 10 + index * 13);
    panel.addChild(txt);
  });
}

function drawQuickActions(panel: Container, x: number, y: number, w: number, h: number, accent: number): void {
  const heading = new Text({
    text: "QUICK ACTIONS",
    style: new TextStyle({ fontSize: 6.5, fill: 0x75634f, fontWeight: "bold", fontFamily: "monospace" }),
  });
  heading.position.set(x, y);
  panel.addChild(heading);
  ["Open Project", "View Tasks", "Report", "Assign"].forEach((label, index) => {
    const by = y + 16 + index * 20;
    const bg = new Graphics();
    bg.roundRect(x, by, w, 14, 3).fill({ color: 0xfffbf2, alpha: 0.84 });
    bg.roundRect(x, by, w, 14, 3).stroke({ width: 0.8, color: index === 3 ? accent : 0xd2b98f, alpha: 0.55 });
    panel.addChild(bg);
    const dot = new Graphics();
    dot.roundRect(x + 6, by + 4, 6, 6, 1.5).fill({ color: index === 3 ? accent : 0xb9a27b, alpha: 0.9 });
    panel.addChild(dot);
    const text = new Text({
      text: label,
      style: new TextStyle({ fontSize: 6.2, fill: 0x4b3d30, fontFamily: "system-ui, sans-serif" }),
    });
    text.position.set(x + 16, by + 3.5);
    panel.addChild(text);
  });
  const mask = new Graphics();
  mask.roundRect(x, y, w, h, 4).stroke({ width: 0.6, color: accent, alpha: 0.18 });
  panel.addChild(mask);
}

function drawDottedRoute(
  g: Graphics,
  from: { x: number; y: number },
  to: { x: number; y: number },
  color: number,
  isDark: boolean,
): void {
  const mid = { x: (from.x + to.x) / 2, y: Math.min(from.y, to.y) - 36 };
  for (let i = 0; i <= 18; i++) {
    const t = i / 18;
    const x = quadratic(from.x, mid.x, to.x, t);
    const y = quadratic(from.y, mid.y, to.y, t);
    const alpha = 0.12 + t * 0.22;
    g.circle(x, y, i === 18 ? 2.8 : 1.7).fill({ color, alpha: isDark ? alpha + 0.12 : alpha });
  }
  g.moveTo(to.x - 4, to.y - 3).lineTo(to.x, to.y + 3).lineTo(to.x + 4, to.y - 3).fill({ color, alpha: isDark ? 0.42 : 0.34 });
}

function drawSectionLabel(stage: Container, text: string, x: number, y: number, color: number, isDark: boolean): void {
  const label = new Text({
    text,
    style: new TextStyle({
      fontSize: 8,
      fill: isDark ? 0xd7dfd2 : 0x4a463e,
      fontWeight: "bold",
      fontFamily: "system-ui, sans-serif",
      letterSpacing: 0.8,
    }),
  });
  const bg = new Graphics();
  bg.roundRect(x - 6, y - 5, label.width + 12, 14, 4).fill({ color, alpha: isDark ? 0.32 : 0.14 });
  bg.roundRect(x - 6, y - 5, label.width + 12, 14, 4).stroke({ width: 0.7, color, alpha: isDark ? 0.5 : 0.28 });
  label.position.set(x, y - 2);
  stage.addChild(bg);
  stage.addChild(label);
}

function drawOverflowBadge(room: Container, x: number, y: number, extraCount: number, theme: RoomTheme): void {
  const bg = new Graphics();
  bg.roundRect(x - 18, y - 8, 36, 16, 5).fill({ color: blendColor(theme.accent, 0x101826, 0.55), alpha: 0.9 });
  bg.roundRect(x - 18, y - 8, 36, 16, 5).stroke({ width: 1, color: blendColor(theme.accent, 0xffffff, 0.2), alpha: 0.55 });
  room.addChild(bg);
  const txt = new Text({
    text: `+${extraCount}`,
    style: new TextStyle({
      fontSize: 8,
      fill: contrastTextColor(blendColor(theme.accent, 0x101826, 0.55)),
      fontWeight: "bold",
      fontFamily: "system-ui, sans-serif",
    }),
  });
  txt.anchor.set(0.5, 0.5);
  txt.position.set(x, y);
  room.addChild(txt);
}

function emitRemovedSubBursts(
  room: Container,
  subCloneBurstParticlesRef: MutableRefObject<SubCloneBurstParticle[]>,
  removedSubBurstsByParent: Map<string, Array<{ x: number; y: number }>>,
  agentId: string,
): void {
  const removedBursts = removedSubBurstsByParent.get(agentId);
  if (!removedBursts?.length) return;
  for (const burst of removedBursts) {
    emitSubCloneSmokeBurst(room, subCloneBurstParticlesRef.current, burst.x, burst.y, "despawn");
  }
  removedSubBurstsByParent.delete(agentId);
}

function rectForIndex(index: number, cols: number, startX: number, startY: number, roomW: number, roomH: number): Rect {
  const col = index % cols;
  const row = Math.floor(index / cols);
  return {
    x: startX + col * (roomW + ROOM_GAP),
    y: startY + row * (roomH + ROOM_GAP),
    w: roomW,
    h: roomH,
  };
}

function projectTheme(key: string, index: number, isDark: boolean): RoomTheme {
  const themes = isDark ? PROJECT_THEMES_DARK : PROJECT_THEMES_LIGHT;
  return themes[Math.abs(hashStr(`${key}:${index}`)) % themes.length];
}

function truncate(value: string, max: number): string {
  if (value.length <= max) return value;
  return `${value.slice(0, Math.max(0, max - 3))}...`;
}

function quadratic(a: number, b: number, c: number, t: number): number {
  const m = 1 - t;
  return m * m * a + 2 * m * t * b + t * t * c;
}
