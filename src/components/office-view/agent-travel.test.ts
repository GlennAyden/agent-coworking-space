import { describe, expect, it } from "vitest";
import { buildAgentTravelPath, planAgentTravels, travelDurationMs } from "./agent-travel-planner";

const p = (x: number, y: number) => ({ x, y });

describe("agent travel planner", () => {
  it("does not animate the initial scene", () => {
    const plans = planAgentTravels({
      agentIds: ["agent-1"],
      previousPositions: new Map(),
      nextPositions: new Map([["agent-1", p(120, 100)]]),
      dispatchAnchor: p(40, 40),
      hasPreviousScene: false,
    });

    expect(plans).toEqual([]);
  });

  it("plans department commons to project room movement", () => {
    const plans = planAgentTravels({
      agentIds: ["agent-1"],
      previousPositions: new Map([["agent-1", p(80, 300)]]),
      nextPositions: new Map([["agent-1", p(420, 130)]]),
      hasPreviousScene: true,
    });

    expect(plans).toHaveLength(1);
    expect(plans[0]).toMatchObject({
      agentId: "agent-1",
      from: p(80, 300),
      to: p(420, 130),
    });
    expect(plans[0].path).toEqual([p(80, 300), p(420, 130)]);
    expect(plans[0].durationMs).toBeGreaterThanOrEqual(1900);
  });

  it("plans project room to commons movement when work ends", () => {
    const plans = planAgentTravels({
      agentIds: ["agent-1"],
      previousPositions: new Map([["agent-1", p(420, 130)]]),
      nextPositions: new Map([["agent-1", p(80, 300)]]),
      hasPreviousScene: true,
    });

    expect(plans[0]).toMatchObject({
      from: p(420, 130),
      to: p(80, 300),
    });
  });

  it("plans project room to project room movement", () => {
    const plans = planAgentTravels({
      agentIds: ["agent-1"],
      previousPositions: new Map([["agent-1", p(260, 130)]]),
      nextPositions: new Map([["agent-1", p(620, 130)]]),
      hasPreviousScene: true,
    });

    expect(plans[0]?.distance).toBeGreaterThan(300);
  });

  it("ignores tiny jitter from rebuilds or resize", () => {
    const plans = planAgentTravels({
      agentIds: ["agent-1"],
      previousPositions: new Map([["agent-1", p(260, 130)]]),
      nextPositions: new Map([["agent-1", p(270, 142)]]),
      hasPreviousScene: true,
      minDistance: 34,
    });

    expect(plans).toEqual([]);
  });

  it("does not duplicate an active travel for the same agent", () => {
    const plans = planAgentTravels({
      agentIds: ["agent-1"],
      previousPositions: new Map([["agent-1", p(80, 300)]]),
      nextPositions: new Map([["agent-1", p(420, 130)]]),
      activeTravelAgentIds: new Set(["agent-1"]),
      hasPreviousScene: true,
    });

    expect(plans).toEqual([]);
  });

  it("uses dispatch gate as fallback for missing old or next anchors after the first scene", () => {
    const plans = planAgentTravels({
      agentIds: ["agent-1", "agent-2"],
      previousPositions: new Map([["agent-2", p(420, 130)]]),
      nextPositions: new Map([["agent-1", p(80, 300)]]),
      dispatchAnchor: p(240, 220),
      hasPreviousScene: true,
    });

    expect(plans).toEqual([
      expect.objectContaining({ agentId: "agent-1", from: p(240, 220), to: p(80, 300), path: [p(240, 220), p(80, 220), p(80, 300)] }),
      expect.objectContaining({ agentId: "agent-2", from: p(420, 130), to: p(240, 220), path: [p(420, 130), p(420, 220), p(240, 220)] }),
    ]);
  });

  it("routes visible movement through the dispatch gate instead of direct desk-to-desk motion", () => {
    const dispatch = p(240, 220);
    const path = buildAgentTravelPath(p(80, 300), p(420, 130), dispatch);

    expect(path).toEqual([p(80, 300), p(80, 220), dispatch, p(420, 220), p(420, 130)]);
  });

  it("uses a slow enough duration for long office routes", () => {
    expect(travelDurationMs(100)).toBe(1900);
    expect(travelDurationMs(500)).toBe(2600);
    expect(travelDurationMs(1200)).toBe(3600);
  });
});
