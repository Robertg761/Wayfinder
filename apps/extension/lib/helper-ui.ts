export interface DockRect {
  left: number;
  right: number;
  top: number;
  height: number;
}

export interface BubblePlacement {
  left: number;
  top: number;
  side: "above" | "below";
  maxHeight: number;
}

export interface AgentStarter {
  label: string;
  question: string;
  requiresInput?: boolean;
}

export const agentStarters: AgentStarter[] = [
  { label: "Map it in 60 seconds", question: "Give me a 60-second overview of this repository" },
  { label: "Find the entry file", question: "Which file is the main implementation entry point?" },
  { label: "Choose my first read", question: "Where should I start reading this repository?" },
  { label: "Plan a contribution", question: "I want to change [feature]. Plan my first contribution.", requiresInput: true },
];

const landmarkDetails: Record<string, string> = {
  "Repository coordinates": "The owner and repository name define the scope for clone URLs, issues, releases, and every file citation. Wayfinder keeps that identity attached to its evidence so results do not leak across projects.",
  "Branch marker": "Changing this selection changes the version of the project you are reading. Wayfinder resolves answers to a commit so a later branch update cannot silently change the evidence behind an answer.",
  "Terrain map": "Top-level folders expose the project's broad architecture before you read implementation details. Source and test directories usually form the most useful pair, while manifests and configuration explain how the pieces run together.",
  "Field notes": "The README is the author's intended entrance to the project. It is best for purpose and setup vocabulary, while source files remain the stronger evidence for how a feature is actually implemented.",
  "Current coordinate": "The breadcrumb shows exactly where this file sits inside the repository. Moving left through its segments widens the context from file to folder to the project root.",
  "Source landmark": "Start with the file's public shape: exports, types, classes, and top-level functions. That gives you a useful outline before you spend time inside individual branches and helper calls.",
  "Line coordinates": "A line selection turns a general file reference into a reproducible citation. It lets another contributor open the same evidence without searching through the entire file.",
};

export function landmarkDetail(label: string): string {
  return landmarkDetails[label] ?? "This landmark is part of the repository's navigation context and helps keep the next explanation tied to what is visible on the page.";
}

export function placeBubble(
  dock: DockRect,
  bubbleWidth: number,
  bubbleHeight: number,
  viewportWidth: number,
  viewportHeight: number,
  margin = 14,
): BubblePlacement {
  const screenLeft = Math.max(margin, Math.min(viewportWidth - bubbleWidth - margin, dock.right - bubbleWidth));
  const roomAbove = Math.max(0, dock.top - margin * 2);
  const roomBelow = Math.max(0, viewportHeight - dock.top - dock.height - margin * 2);
  const side = bubbleHeight <= roomAbove || roomAbove >= roomBelow ? "above" : "below";
  const maxHeight = Math.max(120, Math.min(bubbleHeight, side === "above" ? roomAbove : roomBelow));
  return {
    left: screenLeft - dock.left,
    top: side === "above" ? -maxHeight - margin : dock.height + margin,
    side,
    maxHeight,
  };
}

export function measuredBubbleHeight(
  renderedHeight: number,
  scrollHeight: number,
  viewportHeight: number,
): number {
  const measured = renderedHeight || scrollHeight || 220;
  return Math.min(measured, viewportHeight - 28);
}
