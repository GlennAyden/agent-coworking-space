import { type Container } from "pixi.js";
import { buildSpriteMap } from "../AgentAvatar";
import {
  BREAK_ROOM_GAP,
  BREAK_ROOM_H,
  CEO_ZONE_H,
  COLS_PER_ROW,
  HALLWAY_H,
  ROOM_PAD,
  SLOT_H,
  SLOT_W,
  detachNode,
} from "./model";
import { DEFAULT_BREAK_THEME, DEFAULT_CEO_THEME, applyOfficeThemeMode } from "./themes-locale";
import type { BuildOfficeSceneContext } from "./buildScene-types";
import { buildCeoAndHallway } from "./buildScene-ceo-hallway";
import { buildDepartmentRooms } from "./buildScene-departments";
import { buildBreakRoom } from "./buildScene-break-room";
import { buildFinalLayers } from "./buildScene-final-layers";
import {
  buildProjectCoworkingRooms,
  createProjectCoworkingLayout,
  PROJECT_COWORKING_MIN_W,
  shouldUseProjectCoworking,
} from "./project-coworking-renderer";
import { spawnAgentTravels } from "./agent-travel";

export function buildOfficeScene(context: BuildOfficeSceneContext): void {
  const {
    appRef,
    texturesRef,
    dataRef,
    cbRef,
    activeMeetingTaskIdRef,
    meetingMinutesOpenRef,
    localeRef,
    themeRef,
    animItemsRef,
    roomRectsRef,
    deliveriesRef,
    agentTravelAnimationsRef,
    deliveryLayerRef,
    prevAssignRef,
    agentPosRef,
    spriteMapRef,
    ceoMeetingSeatsRef,
    totalHRef,
    officeWRef,
    ceoPosRef,
    ceoSpriteRef,
    crownRef,
    highlightRef,
    ceoOfficeRectRef,
    breakRoomRectRef,
    breakAnimItemsRef,
    subCloneAnimItemsRef,
    subCloneBurstParticlesRef,
    subCloneSnapshotRef,
    breakSteamParticlesRef,
    breakBubblesRef,
    wallClocksRef,
    wallClockSecondRef,
    coworkingSelectionRef,
    setSceneRevision,
  } = context;

  const app = appRef.current;
  const textures = texturesRef.current;
  if (!app) return;

  const previousAgentPositions = new Map(agentPosRef.current);
  const hadPreviousScene = previousAgentPositions.size > 0;
  const movingAgentIds = new Set(agentTravelAnimationsRef.current.map((travel) => travel.agentId));
  const preservedStageNodes = new Set<Container>();
  for (const delivery of deliveriesRef.current) {
    if (delivery.sprite.destroyed) continue;
    preservedStageNodes.add(delivery.sprite);
    detachNode(delivery.sprite);
  }
  for (const travel of agentTravelAnimationsRef.current) {
    if (!travel.trail.destroyed) {
      preservedStageNodes.add(travel.trail);
      detachNode(travel.trail);
    }
    if (!travel.sprite.destroyed) {
      preservedStageNodes.add(travel.sprite);
      detachNode(travel.sprite);
    }
  }

  const oldChildren = app.stage.removeChildren();
  for (const child of oldChildren) {
    if (preservedStageNodes.has(child)) continue;
    if (!child.destroyed) child.destroy({ children: true });
  }

  animItemsRef.current = [];
  roomRectsRef.current = [];
  agentPosRef.current.clear();
  breakAnimItemsRef.current = [];
  subCloneAnimItemsRef.current = [];
  subCloneBurstParticlesRef.current = [];
  breakBubblesRef.current = [];
  breakSteamParticlesRef.current = null;
  wallClocksRef.current = [];
  wallClockSecondRef.current = -1;
  ceoOfficeRectRef.current = null;
  breakRoomRectRef.current = null;
  ceoMeetingSeatsRef.current = [];

  const {
    departments,
    agents,
    projects,
    tasks,
    subAgents,
    unreadAgentIds: unread,
    customDeptThemes: customThemes,
  } = dataRef.current;

  const previousSubSnapshot = subCloneSnapshotRef.current;
  const currentWorkingSubIds = new Set(subAgents.filter((sub) => sub.status === "working").map((sub) => sub.id));
  const addedWorkingSubIds = new Set<string>();
  for (const sub of subAgents) {
    if (sub.status !== "working") continue;
    if (!previousSubSnapshot.has(sub.id)) addedWorkingSubIds.add(sub.id);
  }

  const removedSubBurstsByParent = new Map<string, Array<{ x: number; y: number }>>();
  for (const [subId, prev] of previousSubSnapshot.entries()) {
    if (currentWorkingSubIds.has(subId)) continue;
    const list = removedSubBurstsByParent.get(prev.parentAgentId) ?? [];
    list.push({ x: prev.x, y: prev.y });
    removedSubBurstsByParent.set(prev.parentAgentId, list);
  }
  const nextSubSnapshot = new Map<string, { parentAgentId: string; x: number; y: number }>();

  const activeLocale = localeRef.current;
  const isDark = themeRef.current === "dark";
  applyOfficeThemeMode(isDark);
  const ceoTheme = customThemes?.ceoOffice ?? DEFAULT_CEO_THEME;
  const breakTheme = customThemes?.breakRoom ?? DEFAULT_BREAK_THEME;

  const spriteMap = buildSpriteMap(agents);
  spriteMapRef.current = spriteMap;

  const useProjectCoworking = shouldUseProjectCoworking(projects, tasks);
  const OFFICE_W = useProjectCoworking ? Math.max(PROJECT_COWORKING_MIN_W, officeWRef.current) : officeWRef.current;
  officeWRef.current = OFFICE_W;
  if (useProjectCoworking) {
    const layout = createProjectCoworkingLayout({
      OFFICE_W,
      projects,
      tasks,
      agents,
      departments,
    });
    totalHRef.current = layout.totalH;

    app.renderer.resize(OFFICE_W, layout.totalH);
    syncCanvasCssSize(app.canvas as HTMLCanvasElement, OFFICE_W, layout.totalH);

    buildCeoAndHallway({
      app,
      OFFICE_W,
      totalH: layout.totalH,
      breakRoomY: layout.breakRoomY,
      isDark,
      activeLocale,
      ceoTheme,
      activeMeetingTaskId: activeMeetingTaskIdRef.current,
      onOpenActiveMeetingMinutes: meetingMinutesOpenRef.current,
      agents,
      tasks,
      deliveriesRef,
      ceoMeetingSeatsRef,
      wallClocksRef,
      ceoOfficeRectRef,
    });

    buildProjectCoworkingRooms({
      app,
      textures,
      layout,
      departments,
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
      coworkingSelection: coworkingSelectionRef.current,
      hiddenAgentIds: movingAgentIds,
      removedSubBurstsByParent,
      addedWorkingSubIds,
      nextSubSnapshot,
    });
    subCloneSnapshotRef.current = nextSubSnapshot;

    buildBreakRoom({
      app,
      textures,
      agents,
      spriteMap,
      activeLocale,
      breakTheme,
      isDark,
      breakRoomY: layout.breakRoomY,
      OFFICE_W,
      cbRef,
      breakAnimItemsRef,
      breakBubblesRef,
      breakSteamParticlesRef,
      breakRoomRectRef,
      wallClocksRef,
      agentPosRef,
      hiddenAgentIds: movingAgentIds,
    });

    buildFinalLayers({
      app,
      textures,
      tasks,
      ceoPosRef,
      agentPosRef,
      deliveriesRef,
      deliveryLayerRef,
      highlightRef,
      ceoSpriteRef,
      crownRef,
      prevAssignRef,
      setSceneRevision,
    });

    spawnAgentTravels({
      app,
      agents,
      textures,
      spriteMap,
      animItemsRef,
      agentTravelAnimationsRef,
      previousPositions: previousAgentPositions,
      nextPositions: new Map(agentPosRef.current),
      dispatchAnchor: layout.dispatchAnchor,
      hasPreviousScene: hadPreviousScene,
      isDark,
    });
    return;
  }

  const deptCount = departments.length || 1;
  const baseRoomW = COLS_PER_ROW * SLOT_W + ROOM_PAD * 2;
  const roomGap = 12;
  let gridCols = Math.min(deptCount, 3);
  while (gridCols > 1 && gridCols * baseRoomW + (gridCols - 1) * roomGap + 24 > OFFICE_W) {
    gridCols -= 1;
  }

  const gridRows = Math.ceil(deptCount / gridCols);
  const agentsPerDept = departments.map((dept) => agents.filter((agent) => agent.department_id === dept.id));
  const maxAgents = Math.max(1, ...agentsPerDept.map((deptAgents) => deptAgents.length));
  const agentRows = Math.ceil(maxAgents / COLS_PER_ROW);

  const totalRoomSpace = OFFICE_W - 24 - (gridCols - 1) * roomGap;
  const roomW = Math.max(baseRoomW, Math.floor(totalRoomSpace / gridCols));
  const roomH = Math.max(170, agentRows * SLOT_H + 44);
  const deptStartY = CEO_ZONE_H + HALLWAY_H;
  const breakRoomY = deptStartY + gridRows * (roomH + roomGap) + BREAK_ROOM_GAP;
  const totalH = breakRoomY + BREAK_ROOM_H + 30;
  const roomStartX = (OFFICE_W - (gridCols * roomW + (gridCols - 1) * roomGap)) / 2;
  totalHRef.current = totalH;

  app.renderer.resize(OFFICE_W, totalH);
  syncCanvasCssSize(app.canvas as HTMLCanvasElement, OFFICE_W, totalH);

  buildCeoAndHallway({
    app,
    OFFICE_W,
    totalH,
    breakRoomY,
    isDark,
    activeLocale,
    ceoTheme,
    activeMeetingTaskId: activeMeetingTaskIdRef.current,
    onOpenActiveMeetingMinutes: meetingMinutesOpenRef.current,
    agents,
    tasks,
    deliveriesRef,
    ceoMeetingSeatsRef,
    wallClocksRef,
    ceoOfficeRectRef,
  });

  buildDepartmentRooms({
    app,
    textures,
    departments,
    agents,
    tasks,
    subAgents,
    unread,
    customThemes,
    activeLocale,
    gridCols,
    roomStartX,
    roomW,
    roomH,
    roomGap,
    deptStartY,
    agentRows,
    spriteMap,
    cbRef,
    roomRectsRef,
    agentPosRef,
    animItemsRef,
    subCloneAnimItemsRef,
    subCloneBurstParticlesRef,
    wallClocksRef,
    removedSubBurstsByParent,
    addedWorkingSubIds,
    nextSubSnapshot,
  });
  subCloneSnapshotRef.current = nextSubSnapshot;

  buildBreakRoom({
    app,
    textures,
    agents,
    spriteMap,
    activeLocale,
    breakTheme,
    isDark,
    breakRoomY,
    OFFICE_W,
    cbRef,
    breakAnimItemsRef,
    breakBubblesRef,
    breakSteamParticlesRef,
    breakRoomRectRef,
    wallClocksRef,
    agentPosRef,
    hiddenAgentIds: movingAgentIds,
  });

  buildFinalLayers({
    app,
    textures,
    tasks,
    ceoPosRef,
    agentPosRef,
    deliveriesRef,
    deliveryLayerRef,
    highlightRef,
    ceoSpriteRef,
    crownRef,
    prevAssignRef,
    setSceneRevision,
  });

  spawnAgentTravels({
    app,
    agents,
    textures,
    spriteMap,
    animItemsRef,
    agentTravelAnimationsRef,
    previousPositions: previousAgentPositions,
    nextPositions: new Map(agentPosRef.current),
    dispatchAnchor: { x: OFFICE_W / 2, y: deptStartY - 10 },
    hasPreviousScene: hadPreviousScene,
    isDark,
  });
}

function syncCanvasCssSize(canvas: HTMLCanvasElement, width: number, height: number): void {
  canvas.style.width = `${width}px`;
  canvas.style.height = `${height}px`;
}
