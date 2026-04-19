/**
 * Tests for subagent result integration in workflow-monitor.
 *
 * Validates that pi-subagents results (filesChanged, testsRan, tddViolations,
 * status) are properly processed by the WorkflowHandler, TddMonitor,
 * and WorkflowTracker.
 */
import { describe, expect, it, vi } from "vitest";
import { createMockLogger } from "../../helpers/mock-logger.js";
import { createWorkflowHandler, type SubagentResultDetails } from "../../../extensions/workflow-monitor/workflow-handler.js";

vi.mock("../../../extensions/logging.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../extensions/logging.js")>();
  return { ...actual, log: createMockLogger() };
});

// Helper: create handler with temp cwd for state file isolation
function createHandler() {
  const originalCwd = process.cwd();
  const tmpDir = `/tmp/subagent-test-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  require("fs").mkdirSync(tmpDir, { recursive: true });
  process.chdir(tmpDir);
  const handler = createWorkflowHandler();
  return {
    handler,
    cleanup() {
      process.chdir(originalCwd);
      try {
        require("fs").rmSync(tmpDir, { recursive: true, force: true });
      } catch {}
    },
  };
}

// ============================================================================
// handleSubagentResult — basic processing
// ============================================================================

describe("handleSubagentResult", () => {
  it("returns empty result for empty details", () => {
    const { handler, cleanup } = createHandler();
    try {
      const result = handler.handleSubagentResult({});
      expect(result.tddViolationCount).toBe(0);
      expect(result.filesTracked).toBe(0);
      expect(result.testsRan).toBe(false);
      expect(result.failed).toBe(false);
      expect(result.agentNames).toEqual([]);
    } finally {
      cleanup();
    }
  });

  it("tracks agent name from single mode", () => {
    const { handler, cleanup } = createHandler();
    try {
      const result = handler.handleSubagentResult({
        agent: "implementer",
        status: "completed",
      });
      expect(result.agentNames).toContain("implementer");
      expect(result.failed).toBe(false);
    } finally {
      cleanup();
    }
  });

  it("detects failed status", () => {
    const { handler, cleanup } = createHandler();
    try {
      const result = handler.handleSubagentResult({
        agent: "implementer",
        status: "failed",
        result: "exit code 1",
      });
      expect(result.failed).toBe(true);
      expect(result.agentNames).toContain("implementer");
    } finally {
      cleanup();
    }
  });

  it("tracks testsRan from top-level", () => {
    const { handler, cleanup } = createHandler();
    try {
      const result = handler.handleSubagentResult({
        agent: "implementer",
        testsRan: true,
      });
      expect(result.testsRan).toBe(true);
    } finally {
      cleanup();
    }
  });

  it("counts tddViolations from top-level", () => {
    const { handler, cleanup } = createHandler();
    try {
      const result = handler.handleSubagentResult({
        agent: "implementer",
        tddViolations: 3,
      });
      expect(result.tddViolationCount).toBe(3);
    } finally {
      cleanup();
    }
  });

  it("tracks filesChanged count", () => {
    const { handler, cleanup } = createHandler();
    try {
      const result = handler.handleSubagentResult({
        agent: "implementer",
        filesChanged: ["src/foo.ts", "src/bar.ts"],
      });
      expect(result.filesTracked).toBe(2);
    } finally {
      cleanup();
    }
  });
});

// ============================================================================
// handleSubagentResult — chain/parallel mode
// ============================================================================

describe("handleSubagentResult — multi-step results", () => {
  it("aggregates agent names from step results", () => {
    const { handler, cleanup } = createHandler();
    try {
      const result = handler.handleSubagentResult({
        mode: "chain",
        results: [
          { agent: "scout" },
          { agent: "planner" },
          { agent: "worker" },
        ],
      });
      expect(result.agentNames).toContain("scout");
      expect(result.agentNames).toContain("planner");
      expect(result.agentNames).toContain("worker");
    } finally {
      cleanup();
    }
  });

  it("aggregates filesChanged from step results", () => {
    const { handler, cleanup } = createHandler();
    try {
      const result = handler.handleSubagentResult({
        mode: "parallel",
        results: [
          { agent: "worker", filesChanged: ["src/a.ts"] },
          { agent: "worker", filesChanged: ["src/b.ts", "src/c.ts"] },
        ],
      });
      expect(result.filesTracked).toBe(3);
    } finally {
      cleanup();
    }
  });

  it("detects failure from step exitCode", () => {
    const { handler, cleanup } = createHandler();
    try {
      const result = handler.handleSubagentResult({
        mode: "chain",
        results: [
          { agent: "implementer", exitCode: 0 },
          { agent: "reviewer", exitCode: 1 },
        ],
      });
      expect(result.failed).toBe(true);
    } finally {
      cleanup();
    }
  });

  it("aggregates tddViolations from step results", () => {
    const { handler, cleanup } = createHandler();
    try {
      const result = handler.handleSubagentResult({
        mode: "parallel",
        results: [
          { agent: "worker", tddViolations: 1 },
          { agent: "worker", tddViolations: 2 },
        ],
      });
      expect(result.tddViolationCount).toBe(3);
    } finally {
      cleanup();
    }
  });

  it("detects testsRan from step results", () => {
    const { handler, cleanup } = createHandler();
    try {
      const result = handler.handleSubagentResult({
        mode: "chain",
        results: [
          { agent: "implementer", testsRan: true },
        ],
      });
      expect(result.testsRan).toBe(true);
    } finally {
      cleanup();
    }
  });
});

// ============================================================================
// handleSubagentResult — TDD state integration
// ============================================================================

describe("handleSubagentResult — TDD state", () => {
  it("does not create TDD violations for test files", () => {
    const { handler, cleanup } = createHandler();
    try {
      const result = handler.handleSubagentResult({
        agent: "implementer",
        filesChanged: ["src/foo.test.ts"],
      });
      expect(result.tddViolationCount).toBe(0);
    } finally {
      cleanup();
    }
  });

  it("creates TDD violation for source file without test", () => {
    const { handler, cleanup } = createHandler();
    try {
      const result = handler.handleSubagentResult({
        agent: "implementer",
        filesChanged: ["src/business-logic.ts"],
      });
      // Source without test = TDD violation
      expect(result.tddViolationCount).toBeGreaterThan(0);
    } finally {
      cleanup();
    }
  });

  it("does not create TDD violation when test file exists before source is written", () => {
    const { handler, cleanup } = createHandler();
    const fs = require("fs");
    const cwd = process.cwd();
    try {
      // Create the test file on disk so TDD monitor's fileExists check passes
      fs.mkdirSync(`${cwd}/src`, { recursive: true });
      fs.writeFileSync(`${cwd}/src/new-feature.test.ts`, "// test");

      // Write the source — test file already exists on disk, no test was written in-session
      // This simulates: subagent writes source code where tests already exist
      const result = handler.handleSubagentResult({
        agent: "implementer",
        filesChanged: ["src/new-feature.ts"],
      });
      // No TDD violation because test file exists on disk (corresponding test found)
      expect(result.tddViolationCount).toBe(0);
    } finally {
      cleanup();
    }
  });
});

// ============================================================================
// WorkflowTracker — subagent file tracking
// ============================================================================

describe("WorkflowTracker — subagent file writes", () => {
  it("tracks design doc writes from subagent", () => {
    const { handler, cleanup } = createHandler();
    try {
      handler.handleSubagentResult({
        agent: "worker",
        filesChanged: ["docs/plans/feature-design.md"],
      });
      const state = handler.getWorkflowState();
      expect(state?.currentPhase).toBe("brainstorm");
    } finally {
      cleanup();
    }
  });

  it("tracks implementation plan writes from subagent", () => {
    const { handler, cleanup } = createHandler();
    try {
      handler.handleSubagentResult({
        agent: "worker",
        filesChanged: ["docs/plans/feature-implementation.md"],
      });
      const state = handler.getWorkflowState();
      expect(state?.currentPhase).toBe("plan");
    } finally {
      cleanup();
    }
  });
});
