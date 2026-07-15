import { describe, expect, it } from "vitest";
import { agentStarters, landmarkDetail, measuredBubbleHeight, placeBubble } from "./helper-ui";

describe("placeBubble", () => {
  it("keeps a bottom-right bubble attached above its dock", () => {
    expect(placeBubble({ left: 1180, right: 1236, top: 680, height: 64 }, 430, 500, 1280, 900)).toEqual({
      left: -374,
      top: -514,
      side: "above",
      maxHeight: 500,
    });
  });

  it("attaches the bubble below a dock near the top edge", () => {
    expect(placeBubble({ left: 300, right: 356, top: 20, height: 64 }, 326, 220, 1280, 900)).toEqual({
      left: -270,
      top: 78,
      side: "below",
      maxHeight: 220,
    });
  });

  it("clamps the bubble to the viewport while preserving a dock-relative offset", () => {
    expect(placeBubble({ left: 4, right: 60, top: 500, height: 64 }, 326, 220, 1280, 800)).toEqual({
      left: 10,
      top: -234,
      side: "above",
      maxHeight: 220,
    });
  });

  it("chooses the larger vertical opening and keeps a long panel on screen", () => {
    expect(placeBubble({ left: 600, right: 656, top: 360, height: 64 }, 430, 610, 1280, 720)).toEqual({
      left: -374,
      top: -346,
      side: "above",
      maxHeight: 332,
    });
  });
});

describe("measuredBubbleHeight", () => {
  it("uses the rendered panel height instead of its much larger scroll content", () => {
    expect(measuredBubbleHeight(610, 1_600, 900)).toBe(610);
  });

  it("falls back safely before the panel has rendered", () => {
    expect(measuredBubbleHeight(0, 0, 900)).toBe(220);
  });
});

describe("agentStarters", () => {
  it("uses concrete repository jobs instead of generic questions", () => {
    expect(agentStarters.map((starter) => starter.question)).toEqual([
      "Give me a 60-second overview of this repository",
      "Which file is the main implementation entry point?",
      "Where should I start reading this repository?",
      "I want to change [feature]. Plan my first contribution.",
    ]);
    expect(agentStarters.at(-1)?.requiresInput).toBe(true);
  });
});

describe("landmarkDetail", () => {
  it("adds useful context beyond the tour caption", () => {
    expect(landmarkDetail("Repository name")).toContain("clone URLs");
    expect(landmarkDetail("Current branch")).toContain("commit");
    expect(landmarkDetail("Line numbers")).toContain("reproducible citation");
  });
});
