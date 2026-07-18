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

export type PlatformFamily = "macos" | "windows" | "linux" | "unknown";
export type ArchitectureFamily = "arm64" | "x64" | "universal" | "unknown";

export interface ReleaseAssetCandidate {
  name: string;
  href: string;
}

export function detectPlatformFamily(userAgent: string, platform = ""): PlatformFamily {
  const value = `${platform} ${userAgent}`.toLowerCase();
  if (/mac|darwin/.test(value)) return "macos";
  if (/win/.test(value)) return "windows";
  if (/linux|x11/.test(value)) return "linux";
  return "unknown";
}

export function detectArchitectureFamily(userAgent: string, platform = ""): ArchitectureFamily {
  const value = `${platform} ${userAgent}`.toLowerCase();
  if (/arm64|aarch64/.test(value)) return "arm64";
  // Chromium deliberately reports MacIntel on both Intel and Apple-silicon
  // Macs, so that value is not safe architecture evidence.
  if (/macintosh|macintel|mac os/.test(value) && /intel/.test(value)) return "unknown";
  if (/x64|x86_64|amd64|win64|wow64/.test(value)) return "x64";
  return "unknown";
}

function assetArchitecture(name: string): ArchitectureFamily {
  const lower = name.toLowerCase();
  if (/universal|universal2|noarch|anycpu/.test(lower)) return "universal";
  if (/arm64|aarch64|apple[-_. ]?silicon/.test(lower)) return "arm64";
  if (/x64|x86_64|amd64|intel/.test(lower)) return "x64";
  return "universal";
}

function matchesPlatform(name: string, platform: PlatformFamily): boolean {
  const lower = name.toLowerCase();
  if (platform === "macos") return /mac|macos|darwin|osx|\.dmg$|\.pkg$/.test(lower);
  if (platform === "windows") return /windows|win32|win64|\.msi$|\.exe$/.test(lower);
  if (platform === "linux") return /linux|appimage|\.deb$|\.rpm$/.test(lower);
  return false;
}

function installableReleaseAssets(
  assets: ReleaseAssetCandidate[],
  platform: PlatformFamily,
): ReleaseAssetCandidate[] {
  return assets.filter((asset) => {
    const name = asset.name.toLowerCase();
    return !/source code|checksums?|sha256|\.sig$|\.asc$/.test(name) && matchesPlatform(name, platform);
  });
}

export function releaseArchitectureChoices(
  assets: ReleaseAssetCandidate[],
  platform: PlatformFamily,
): Array<Exclude<ArchitectureFamily, "universal" | "unknown">> {
  const choices = new Set(installableReleaseAssets(assets, platform)
    .map((asset) => assetArchitecture(asset.name))
    .filter((architecture): architecture is "arm64" | "x64" => architecture === "arm64" || architecture === "x64"));
  return ["arm64", "x64"].filter((architecture): architecture is "arm64" | "x64" => choices.has(architecture as "arm64" | "x64"));
}

export function preferredReleaseAsset(
  assets: ReleaseAssetCandidate[],
  platform: PlatformFamily,
  userAgent = "",
  architecture: ArchitectureFamily = detectArchitectureFamily(userAgent),
): ReleaseAssetCandidate | null {
  if (platform === "unknown") return null;
  const candidates = installableReleaseAssets(assets, platform);
  if (candidates.length === 0) return null;
  const universal = candidates.filter((asset) => assetArchitecture(asset.name) === "universal");
  const choices = releaseArchitectureChoices(candidates, platform);
  if (architecture === "unknown" && universal.length === 0 && choices.length > 0) return null;
  const effectiveArchitecture = architecture;
  const score = (asset: ReleaseAssetCandidate): number => {
    const name = asset.name.toLowerCase();
    const assetArch = assetArchitecture(name);
    let value = 40;
    if (assetArch === "universal") value += 10;
    else if (effectiveArchitecture === assetArch) value += 16;
    else if (effectiveArchitecture !== "unknown") value -= 100;
    if (/\.dmg$|\.pkg$|\.msi$|\.exe$|\.appimage$|\.deb$|\.rpm$/.test(name)) value += 8;
    if (/\.zip$|\.tar\.gz$|\.tgz$/.test(name)) value += 2;
    return value;
  };
  return candidates
    .map((asset, index) => ({ asset, index, score: score(asset) }))
    .filter((candidate) => candidate.score > 0)
    .sort((left, right) => right.score - left.score || left.index - right.index)[0]?.asset ?? null;
}

export const agentStarters: AgentStarter[] = [
  { label: "Map it in 60 seconds", question: "Give me a 60-second overview of this repository" },
  { label: "Find the entry file", question: "Which file is the main implementation entry point?" },
  { label: "Choose my first read", question: "Where should I start reading this repository?" },
  { label: "Plan a contribution", question: "I want to change [feature]. Plan my first contribution.", requiresInput: true },
];

const landmarkDetails: Record<string, string> = {
  "Repository name": "The owner and repository name define the scope for clone URLs, issues, releases, and every file citation. Wayfinder keeps that identity attached to its evidence so results do not leak across projects.",
  "Current branch": "Changing this selection changes the version of the project you are reading. Wayfinder resolves answers to a commit so a later branch update cannot silently change the evidence behind an answer.",
  "File tree": "Top-level folders expose the project's broad architecture before you read implementation details. Source and test directories usually form the most useful pair, while manifests and configuration explain how the pieces run together.",
  "README": "The README is the author's intended entrance to the project. It is best for purpose and setup vocabulary, while source files remain the stronger evidence for how a feature is actually implemented.",
  "File breadcrumb": "The breadcrumb shows exactly where this file sits inside the repository. Moving left through its segments widens the context from file to folder to the project root.",
  "Source file": "Start with the file's public shape: exports, types, classes, and top-level functions. That gives you a useful outline before you spend time inside individual branches and helper calls.",
  "Line numbers": "A line selection turns a general file reference into a reproducible citation. It lets another contributor open the same evidence without searching through the entire file.",
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
  const maxHeight = Math.max(0, Math.min(bubbleHeight, side === "above" ? roomAbove : roomBelow));
  return {
    left: screenLeft - dock.left,
    top: side === "above" ? -maxHeight - margin : dock.height + margin,
    side,
    maxHeight,
  };
}

export type AnswerDepth = "concise" | "expanded";
export type ExperienceMode = "guided" | "quick";

export function measuredBubbleHeight(
  renderedHeight: number,
  scrollHeight: number,
  viewportHeight: number,
  designCap = 430,
): number {
  const measured = scrollHeight || renderedHeight || 220;
  return Math.min(measured, designCap, Math.max(0, viewportHeight - 28));
}

export function resolveAnswerDepth(
  storedDepth: unknown,
  mode: ExperienceMode | null,
): AnswerDepth {
  if (storedDepth === "concise" || storedDepth === "expanded") return storedDepth;
  return mode === "guided" ? "expanded" : "concise";
}
