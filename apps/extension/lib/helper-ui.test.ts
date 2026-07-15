import { describe, expect, it } from "vitest";
import { agentStarters, landmarkDetail, measuredBubbleHeight, placeBubble } from "./helper-ui";

describe("placeBubble", () => {
  it("keeps a bottom-right bubble attached above its dock", () => {
    expect(placeBubble({ left: 1180, right: 1236, top: 680, height: 64 }, 430, 500, 1280)).toEqual({
      left: -374,
      top: -514,
      side: "above",
    });
  });

  it("attaches the bubble below a dock near the top edge", () => {
    expect(placeBubble({ left: 300, right: 356, top: 20, height: 64 }, 326, 220, 1280)).toEqual({
      left: -270,
      top: 78,
      side: "below",
    });
  });

  it("clamps the bubble to the viewport while preserving a dock-relative offset", () => {
    expect(placeBubble({ left: 4, right: 60, top: 500, height: 64 }, 326, 220, 1280)).toEqual({
      left: 10,
      top: -234,
      side: "above",
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
      "Where is the main entry point and execution path?",
      "Where should I start reading this repository?",
      "Help me plan one small, safe first contribution",
    ]);
  });
});

describe("landmarkDetail", () => {
  it("adds useful context beyond the tour caption", () => {
    expect(landmarkDetail("Repository coordinates")).toContain("clone URLs");
    expect(landmarkDetail("Branch marker")).toContain("commit");
    expect(landmarkDetail("Line coordinates")).toContain("reproducible citation");
  });
});
