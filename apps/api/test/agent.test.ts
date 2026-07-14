import { describe, expect, it } from "vitest";
import { classifyAgentIntent } from "../src/agent";

describe("classifyAgentIntent", () => {
  it.each([
    ["How do I install and run this?", "installation"],
    ["How do I run the tests?", "installation"],
    ["What dependencies do I need?", "installation"],
    ["What does this repository do?", "orientation"],
    ["Tell me about this project", "orientation"],
    ["Where should I start?", "orientation"],
    ["Give me an architecture tour", "orientation"],
    ["Where are the tests?", "file-find"],
    ["Find the authentication implementation", "file-find"],
    ["What does pagination do?", "file-find"],
    ["configuration", "file-find"],
  ] as const)("routes %s to %s", (query, intent) => {
    expect(classifyAgentIntent(query)).toBe(intent);
  });
});
