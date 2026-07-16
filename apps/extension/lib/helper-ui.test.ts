import { describe, expect, it } from "vitest";
import { agentStarters, landmarkDetail, measuredBubbleHeight, placeBubble, resolveAnswerDepth } from "./helper-ui";

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

  it("never forces a minimum height beyond a very short viewport opening", () => {
    expect(placeBubble({ left: 100, right: 156, top: 50, height: 20 }, 120, 220, 320, 100)).toEqual({
      left: -64,
      top: -36,
      side: "above",
      maxHeight: 22,
    });
  });
});

describe("measuredBubbleHeight", () => {
  it("uses natural content height so a stale inline clamp can expand", () => {
    expect(measuredBubbleHeight(220, 380, 900)).toBe(380);
  });

  it("applies guided and agent design caps", () => {
    expect(measuredBubbleHeight(610, 1_600, 900)).toBe(430);
    expect(measuredBubbleHeight(430, 1_600, 900, 610)).toBe(610);
  });

  it("clamps natural content to a short viewport", () => {
    expect(measuredBubbleHeight(430, 900, 300, 610)).toBe(272);
  });

  it("falls back safely before the panel has rendered", () => {
    expect(measuredBubbleHeight(0, 0, 900)).toBe(220);
  });
});

describe("resolveAnswerDepth", () => {
  it("uses a valid stored value before the mode default", () => {
    expect(resolveAnswerDepth("concise", "guided")).toBe("concise");
    expect(resolveAnswerDepth("expanded", "quick")).toBe("expanded");
  });

  it("keeps legacy preferences backward compatible", () => {
    expect(resolveAnswerDepth(undefined, "guided")).toBe("expanded");
    expect(resolveAnswerDepth(undefined, "quick")).toBe("concise");
    expect(resolveAnswerDepth(undefined, null)).toBe("concise");
  });

  it("uses the mode fallback for invalid stored data", () => {
    expect(resolveAnswerDepth("verbose", "guided")).toBe("expanded");
    expect(resolveAnswerDepth(1, "quick")).toBe("concise");
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
