import { describe, expect, test } from "vitest";
import { discoverAgents } from "../../../extensions/subagent/agents";

describe("agent frontmatter extensions", () => {
  test("implementer includes tdd-guard extension", () => {
    const res = discoverAgents(process.cwd(), "project");
    const impl = res.agents.find((a) => a.name === "implementer");
    expect(impl).toBeTruthy();
    expect(impl?.extensions).toBeTruthy();
    expect(impl?.extensions?.some((p: string) => p.includes("tdd-guard"))).toBe(true);
  });
});
