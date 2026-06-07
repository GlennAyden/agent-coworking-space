import type { MutableRefObject } from "react";
import { AnimatedSprite, Container, Graphics, Sprite, Text, TextStyle, type Application, type Texture } from "pixi.js";
import type { Agent } from "../../types";
import type { AnimItem } from "./buildScene-types";
import { hashStr } from "./drawing-core";
import { TARGET_CHAR_H, destroyNode } from "./model";
import {
  buildAgentTravelPath,
  pathDistance,
  planAgentTravels,
  travelDurationMs,
  type AgentRoomAnchor,
} from "./agent-travel-planner";

export { planAgentTravels };
export type { AgentRoomAnchor, AgentTravelPlan, PlanAgentTravelsParams } from "./agent-travel-planner";

export interface AgentTravel {
  agentId: string;
  sprite: Container;
  trail: Graphics;
  fromX: number;
  fromY: number;
  toX: number;
  toY: number;
  path: AgentRoomAnchor[];
  segmentLengths: number[];
  distance: number;
  progress: number;
  startedAt: number;
  durationMs: number;
  color: number;
  finalSprite?: Container;
}

interface SpawnAgentTravelsParams {
  app: Application;
  agents: Agent[];
  textures: Record<string, Texture>;
  spriteMap: Map<string, number>;
  animItemsRef: MutableRefObject<AnimItem[]>;
  agentTravelAnimationsRef: MutableRefObject<AgentTravel[]>;
  previousPositions: Map<string, AgentRoomAnchor>;
  nextPositions: Map<string, AgentRoomAnchor>;
  dispatchAnchor?: AgentRoomAnchor | null;
  hasPreviousScene: boolean;
  isDark: boolean;
}

export function spawnAgentTravels({
  app,
  agents,
  textures,
  spriteMap,
  animItemsRef,
  agentTravelAnimationsRef,
  previousPositions,
  nextPositions,
  dispatchAnchor,
  hasPreviousScene,
  isDark,
}: SpawnAgentTravelsParams): void {
  const finalSpritesByAgent = new Map<string, Container>();
  const now = Date.now();
  for (const item of animItemsRef.current) {
    if (!item.agentId || item.sprite.destroyed) continue;
    finalSpritesByAgent.set(item.agentId, item.sprite);
  }

  agentTravelAnimationsRef.current = agentTravelAnimationsRef.current.filter((travel) => {
    if (travel.sprite.destroyed || travel.trail.destroyed) return false;
    if (!travel.trail.parent) app.stage.addChild(travel.trail);
    if (!travel.sprite.parent) app.stage.addChild(travel.sprite);
    const finalSprite = finalSpritesByAgent.get(travel.agentId);
    if (finalSprite) {
      travel.finalSprite = finalSprite;
      travel.finalSprite.visible = false;
    }
    const nextPosition = nextPositions.get(travel.agentId);
    if (nextPosition && distanceBetween(lastPoint(travel.path), nextPosition) > 8) {
      const current = currentTravelPosition(travel, now).position;
      const route = buildAgentTravelPath(current, nextPosition, dispatchAnchor);
      replaceTravelRoute(travel, route, now);
      redrawTravelTrail(travel, route, isDark);
    }
    return true;
  });

  const activeTravelAgentIds = new Set(agentTravelAnimationsRef.current.map((travel) => travel.agentId));
  const travelPlans = planAgentTravels({
    agentIds: agents.map((agent) => agent.id),
    previousPositions,
    nextPositions,
    activeTravelAgentIds,
    dispatchAnchor,
    hasPreviousScene,
  });
  const agentsById = new Map(agents.map((agent) => [agent.id, agent]));

  for (const plan of travelPlans) {
    const agent = agentsById.get(plan.agentId);
    if (!agent) continue;

    const color = travelColor(plan.agentId, isDark);
    const trail = drawTravelTrail(plan.path, color, isDark);
    const sprite = createTravelingAgentSprite(agent, textures, spriteMap, color);
    sprite.position.set(plan.from.x, plan.from.y);
    sprite.alpha = 1;

    const finalSprite = finalSpritesByAgent.get(plan.agentId);
    if (finalSprite) finalSprite.visible = false;

    app.stage.addChild(trail);
    app.stage.addChild(sprite);
    agentTravelAnimationsRef.current.push({
      agentId: plan.agentId,
      sprite,
      trail,
      fromX: plan.from.x,
      fromY: plan.from.y,
      toX: plan.to.x,
      toY: plan.to.y,
      path: plan.path,
      segmentLengths: segmentLengths(plan.path),
      distance: plan.distance,
      progress: 0,
      startedAt: now,
      durationMs: plan.durationMs,
      color,
      finalSprite,
    });
  }
}

export function updateAgentTravelAnimations(
  agentTravelAnimationsRef: MutableRefObject<AgentTravel[]>,
  tick: number,
): boolean {
  let completedAny = false;
  const travels = agentTravelAnimationsRef.current;
  for (let i = travels.length - 1; i >= 0; i--) {
    const travel = travels[i];
    if (travel.sprite.destroyed || travel.trail.destroyed) {
      travels.splice(i, 1);
      continue;
    }

    if (travel.finalSprite && !travel.finalSprite.destroyed) {
      travel.finalSprite.visible = false;
    }

    const t = Math.min(1, Math.max(0, (Date.now() - travel.startedAt) / travel.durationMs));
    travel.progress = t;
    const ease = t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t;
    const point = pointAlongPath(travel.path, travel.segmentLengths, travel.distance, ease);
    const lookAhead = pointAlongPath(travel.path, travel.segmentLengths, travel.distance, Math.min(1, ease + 0.02));
    const bounce = Math.abs(Math.sin(t * Math.PI * 11)) * 3.4;

    travel.sprite.position.set(point.x, point.y - bounce);
    travel.sprite.alpha = t < 0.1 ? 0.35 + t / 0.1 * 0.65 : 1;
    travel.sprite.rotation = Math.sin(tick * 0.12) * 0.025;
    travel.trail.alpha = Math.max(0.16, 1 - Math.max(0, t - 0.84) / 0.16);

    const walkVisual = (travel.sprite as any)._walkVisual as AnimatedSprite | Graphics | undefined;
    const baseScaleX = (travel.sprite as any)._walkBaseScaleX ?? 1;
    if (walkVisual) {
      walkVisual.scale.x = Math.abs(baseScaleX) * (lookAhead.x >= point.x ? 1 : -1);
    }

    if (walkVisual instanceof AnimatedSprite && walkVisual.totalFrames > 1) {
      walkVisual.gotoAndStop(Math.floor(tick / 5) % walkVisual.totalFrames);
    }

    if (t >= 1) {
      if (travel.finalSprite && !travel.finalSprite.destroyed) {
        travel.finalSprite.visible = true;
      }
      destroyNode(travel.sprite);
      destroyNode(travel.trail);
      travels.splice(i, 1);
      completedAny = true;
    }
  }
  return completedAny;
}

export function destroyAgentTravels(agentTravelAnimationsRef: MutableRefObject<AgentTravel[]>): void {
  for (const travel of agentTravelAnimationsRef.current) {
    if (travel.finalSprite && !travel.finalSprite.destroyed) travel.finalSprite.visible = true;
    if (!travel.sprite.destroyed) destroyNode(travel.sprite);
    if (!travel.trail.destroyed) destroyNode(travel.trail);
  }
  agentTravelAnimationsRef.current = [];
}

function createTravelingAgentSprite(
  agent: Agent,
  textures: Record<string, Texture>,
  spriteMap: Map<string, number>,
  color: number,
): Container {
  const root = new Container();
  const shadow = new Graphics();
  shadow.ellipse(0, 2, 15, 4).fill({ color: 0x151515, alpha: 0.17 });
  root.addChild(shadow);

  const spriteNum = spriteMap.get(agent.id) ?? (Math.abs(hashStr(agent.id)) % 13) + 1;
  const frames: Texture[] = [];
  for (let frame = 1; frame <= 3; frame++) {
    const key = `${spriteNum}-D-${frame}`;
    if (textures[key]) frames.push(textures[key]);
  }

  if (frames.length > 0) {
    const walker = new AnimatedSprite(frames);
    walker.anchor.set(0.5, 1);
    walker.scale.set((TARGET_CHAR_H * 0.9) / walker.texture.height);
    walker.gotoAndStop(0);
    root.addChild(walker);
    (root as any)._walkVisual = walker;
    (root as any)._walkBaseScaleX = Math.abs(walker.scale.x);
  } else {
    const fallback = new Graphics();
    fallback.circle(0, -30, 8).fill({ color: 0xf1d2a8, alpha: 1 });
    fallback.roundRect(-8, -28, 16, 20, 4).fill({ color, alpha: 0.95 });
    fallback.rect(-5, -9, 4, 9).fill(0x263241);
    fallback.rect(1, -9, 4, 9).fill(0x263241);
    root.addChild(fallback);
    (root as any)._walkVisual = fallback;
    (root as any)._walkBaseScaleX = 1;
  }

  const badgeText = new Text({
    text: "Moving",
    style: new TextStyle({
      fontSize: 7,
      fill: 0xf8fafc,
      fontWeight: "bold",
      fontFamily: "system-ui, sans-serif",
    }),
  });
  badgeText.anchor.set(0.5, 0.5);
  const badge = new Graphics();
  badge.roundRect(-badgeText.width / 2 - 5, -TARGET_CHAR_H - 20, badgeText.width + 10, 13, 4).fill({
    color: 0x1f2933,
    alpha: 0.88,
  });
  badge.roundRect(-badgeText.width / 2 - 5, -TARGET_CHAR_H - 20, badgeText.width + 10, 13, 4).stroke({
    width: 0.8,
    color,
    alpha: 0.85,
  });
  badgeText.position.set(0, -TARGET_CHAR_H - 13.5);
  root.addChild(badge);
  root.addChild(badgeText);

  return root;
}

function drawTravelTrail(path: AgentRoomAnchor[], color: number, isDark: boolean): Graphics {
  const trail = new Graphics();
  const totalDistance = Math.max(1, pathDistance(path));
  const lengths = segmentLengths(path);
  const steps = Math.max(16, Math.min(44, Math.ceil(totalDistance / 20)));

  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const { x, y } = pointAlongPath(path, lengths, totalDistance, t);
    const dotSize = i === steps ? 2.8 : 1.8;
    const alpha = (isDark ? 0.32 : 0.22) + t * 0.28;
    trail.circle(x, y, dotSize).fill({ color, alpha });
  }

  const to = lastPoint(path);
  trail
    .moveTo(to.x - 4, to.y - 4)
    .lineTo(to.x, to.y + 3)
    .lineTo(to.x + 4, to.y - 4)
    .fill({ color, alpha: isDark ? 0.62 : 0.46 });

  return trail;
}

function travelColor(agentId: string, isDark: boolean): number {
  const colors = isDark ? [0x6ee7b7, 0x93c5fd, 0xf9a8d4, 0xfcd34d] : [0x0f9f7a, 0x2563aa, 0xb45375, 0xb7791f];
  return colors[Math.abs(hashStr(`travel:${agentId}`)) % colors.length];
}

function replaceTravelRoute(travel: AgentTravel, path: AgentRoomAnchor[], now: number): void {
  const distance = pathDistance(path);
  const from = path[0];
  const to = lastPoint(path);
  travel.path = path;
  travel.segmentLengths = segmentLengths(path);
  travel.distance = distance;
  travel.fromX = from.x;
  travel.fromY = from.y;
  travel.toX = to.x;
  travel.toY = to.y;
  travel.startedAt = now;
  travel.durationMs = travelDurationMs(distance);
  travel.progress = 0;
}

function redrawTravelTrail(travel: AgentTravel, path: AgentRoomAnchor[], isDark: boolean): void {
  const parent = travel.trail.parent;
  const childIndex = parent?.children.indexOf(travel.trail) ?? -1;
  destroyNode(travel.trail);
  travel.trail = drawTravelTrail(path, travel.color, isDark);
  if (parent) {
    if (childIndex >= 0) parent.addChildAt(travel.trail, childIndex);
    else parent.addChild(travel.trail);
  }
}

function currentTravelPosition(travel: AgentTravel, now: number): { position: AgentRoomAnchor; progress: number } {
  const progress = Math.min(1, Math.max(0, (now - travel.startedAt) / travel.durationMs));
  const ease = progress < 0.5 ? 2 * progress * progress : -1 + (4 - 2 * progress) * progress;
  return {
    position: pointAlongPath(travel.path, travel.segmentLengths, travel.distance, ease),
    progress,
  };
}

function pointAlongPath(
  path: AgentRoomAnchor[],
  lengths: number[],
  totalDistance: number,
  progress: number,
): AgentRoomAnchor {
  if (path.length <= 1 || totalDistance <= 0) return path[0] ?? { x: 0, y: 0 };

  let remaining = totalDistance * Math.max(0, Math.min(1, progress));
  for (let index = 1; index < path.length; index++) {
    const length = lengths[index - 1] ?? 0;
    if (remaining > length && index < path.length - 1) {
      remaining -= length;
      continue;
    }
    const from = path[index - 1];
    const to = path[index];
    const t = length <= 0 ? 1 : Math.max(0, Math.min(1, remaining / length));
    return {
      x: from.x + (to.x - from.x) * t,
      y: from.y + (to.y - from.y) * t,
    };
  }

  return lastPoint(path);
}

function segmentLengths(path: AgentRoomAnchor[]): number[] {
  const lengths: number[] = [];
  for (let index = 1; index < path.length; index++) {
    lengths.push(distanceBetween(path[index - 1], path[index]));
  }
  return lengths;
}

function lastPoint(path: AgentRoomAnchor[]): AgentRoomAnchor {
  return path[path.length - 1] ?? { x: 0, y: 0 };
}

function distanceBetween(a: AgentRoomAnchor, b: AgentRoomAnchor): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}
