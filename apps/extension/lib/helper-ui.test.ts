import { describe, expect, it } from "vitest";
import { agentStarters, detectArchitectureFamily, detectPlatformFamily, landmarkDetail, measuredBubbleHeight, placeBubble, preferredReleaseAsset, releaseArchitectureChoices, resolveAnswerDepth } from "./helper-ui";

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

describe("release asset guidance", () => {
  const assets = [
    { name: "Wayfinder-macos-arm64.dmg", href: "/mac" },
    { name: "Wayfinder-windows-x64.exe", href: "/windows" },
    { name: "Wayfinder-linux-x86_64.AppImage", href: "/linux" },
    { name: "Source code (zip)", href: "/source" },
  ];

  it("detects common desktop platforms", () => {
    expect(detectPlatformFamily("Mozilla/5.0 (Macintosh; Intel Mac OS X)")).toBe("macos");
    expect(detectPlatformFamily("Mozilla/5.0 (Windows NT 10.0; Win64; x64)")).toBe("windows");
    expect(detectPlatformFamily("Mozilla/5.0 (X11; Linux x86_64)")).toBe("linux");
  });

  it("does not treat Chromium's MacIntel compatibility value as architecture evidence", () => {
    expect(detectArchitectureFamily("Mozilla/5.0 (Macintosh; Intel Mac OS X)", "MacIntel")).toBe("unknown");
    expect(detectArchitectureFamily("Mozilla/5.0 (Macintosh; arm64 Mac OS X)", "MacIntel")).toBe("arm64");
    expect(detectArchitectureFamily("Mozilla/5.0 (Windows NT 10.0; Win64; x64)", "Win32")).toBe("x64");
  });

  it("prefers an OS and architecture matched binary over source archives", () => {
    expect(preferredReleaseAsset(assets, "macos", "Macintosh arm64")?.name).toBe("Wayfinder-macos-arm64.dmg");
    expect(preferredReleaseAsset(assets, "windows", "Windows x64")?.name).toBe("Wayfinder-windows-x64.exe");
    expect(preferredReleaseAsset(assets, "linux", "Linux x86_64")?.name).toBe("Wayfinder-linux-x86_64.AppImage");
  });

  it("waits for an OS choice instead of guessing for an unknown platform", () => {
    expect(preferredReleaseAsset(assets, "unknown", "Unknown browser")).toBeNull();
  });

  it("never falls through to a different operating system's installer", () => {
    expect(preferredReleaseAsset(assets.filter((asset) => !asset.name.includes("macos")), "macos", "Macintosh")).toBeNull();
  });

  it("asks for architecture instead of guessing between incompatible installers", () => {
    const macAssets = [
      { name: "Wayfinder-macos-arm64.dmg", href: "/arm" },
      { name: "Wayfinder-macos-x64.dmg", href: "/x64" },
    ];
    expect(releaseArchitectureChoices(macAssets, "macos")).toEqual(["arm64", "x64"]);
    expect(preferredReleaseAsset(macAssets, "macos", "Macintosh", "unknown")).toBeNull();
    expect(preferredReleaseAsset(macAssets, "macos", "Macintosh", "x64")?.href).toBe("/x64");
  });

  it("prefers a universal installer when architecture is unknown", () => {
    const macAssets = [
      { name: "Wayfinder-macos-arm64.dmg", href: "/arm" },
      { name: "Wayfinder-macos-universal.dmg", href: "/universal" },
    ];
    expect(preferredReleaseAsset(macAssets, "macos", "Macintosh", "unknown")?.href).toBe("/universal");
  });
});
