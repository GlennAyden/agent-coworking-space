export interface AgentRoomAnchor {
  x: number;
  y: number;
}

export interface AgentTravelPlan {
  agentId: string;
  from: AgentRoomAnchor;
  to: AgentRoomAnchor;
  path: AgentRoomAnchor[];
  distance: number;
  durationMs: number;
}

export interface PlanAgentTravelsParams {
  agentIds: string[];
  previousPositions: Map<string, AgentRoomAnchor>;
  nextPositions: Map<string, AgentRoomAnchor>;
  activeTravelAgentIds?: Set<string>;
  dispatchAnchor?: AgentRoomAnchor | null;
  hasPreviousScene: boolean;
  minDistance?: number;
}

const DEFAULT_MIN_TRAVEL_DISTANCE = 34;
const MIN_TRAVEL_DURATION_MS = 1900;
const MAX_TRAVEL_DURATION_MS = 3600;
const TRAVEL_MS_PER_PIXEL = 5.2;

export function planAgentTravels({
  agentIds,
  previousPositions,
  nextPositions,
  activeTravelAgentIds = new Set(),
  dispatchAnchor,
  hasPreviousScene,
  minDistance = DEFAULT_MIN_TRAVEL_DISTANCE,
}: PlanAgentTravelsParams): AgentTravelPlan[] {
  if (!hasPreviousScene) return [];

  const plans: AgentTravelPlan[] = [];
  for (const agentId of agentIds) {
    if (activeTravelAgentIds.has(agentId)) continue;

    const previous = previousPositions.get(agentId) ?? dispatchAnchor ?? null;
    const next = nextPositions.get(agentId) ?? dispatchAnchor ?? null;
    if (!previous || !next) continue;

    const directDistance = distanceBetween(previous, next);
    if (directDistance < minDistance) continue;

    const path = buildAgentTravelPath(previous, next, dispatchAnchor);
    const distance = pathDistance(path);

    plans.push({
      agentId,
      from: previous,
      to: next,
      path,
      distance,
      durationMs: travelDurationMs(distance),
    });
  }

  return plans;
}

export function buildAgentTravelPath(
  from: AgentRoomAnchor,
  to: AgentRoomAnchor,
  dispatchAnchor?: AgentRoomAnchor | null,
): AgentRoomAnchor[] {
  if (!dispatchAnchor) return collapsePath([from, to]);

  const routeY = dispatchAnchor.y;
  return collapsePath([
    from,
    { x: from.x, y: routeY },
    dispatchAnchor,
    { x: to.x, y: routeY },
    to,
  ]);
}

export function pathDistance(path: AgentRoomAnchor[]): number {
  let distance = 0;
  for (let index = 1; index < path.length; index++) {
    distance += distanceBetween(path[index - 1], path[index]);
  }
  return distance;
}

export function travelDurationMs(distance: number): number {
  return Math.max(MIN_TRAVEL_DURATION_MS, Math.min(MAX_TRAVEL_DURATION_MS, Math.round(distance * TRAVEL_MS_PER_PIXEL)));
}

function collapsePath(path: AgentRoomAnchor[]): AgentRoomAnchor[] {
  const result: AgentRoomAnchor[] = [];
  for (const point of path) {
    const previous = result[result.length - 1];
    if (previous && distanceBetween(previous, point) < 4) continue;
    result.push(point);
  }
  return result.length >= 2 ? result : path;
}

function distanceBetween(a: AgentRoomAnchor, b: AgentRoomAnchor): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}
