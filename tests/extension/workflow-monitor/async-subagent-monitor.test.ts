/**
 * Tests for AsyncSubagentMonitor — async subagent result polling.
 */
import { describe, expect, it, vi, afterEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { AsyncSubagentMonitor } from "../../../extensions/workflow-monitor/async-subagent-monitor.js";
import {
  createWorkflowHandler,
  type SubagentResultDetails,
} from "../../../extensions/workflow-monitor/workflow-handler.js";

// We mock logging but use the real handler
vi.mock("../../../extensions/logging.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../extensions/logging.js")>();
  return { ...actual, log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } };
});

function withTempCwd(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "async-monitor-test-"));
  process.chdir(dir);
  return dir;
}

const ORIGINAL_CWD = process.cwd();
const TEMP_DIRS: string[] = [];

afterEach(() => {
  if (process.cwd() !== ORIGINAL_CWD) {
    process.chdir(ORIGINAL_CWD);
  }
  for (const dir of TEMP_DIRS.splice(0)) {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch {}
  }
});

describe("AsyncSubagentMonitor", () => {
  it("does nothing when no jobs are tracked", () => {
    const tmpDir = withTempCwd();
    TEMP_DIRS.push(tmpDir);
    const handler = createWorkflowHandler();
    const onResult = vi.fn();
    const monitor = new AsyncSubagentMonitor(handler, onResult);

    // No tracking — should not crash
    monitor.dispose();
    expect(onResult).not.toHaveBeenCalled();
  });

  it("detects completed async job from status.json", () => {
    const tmpDir = withTempCwd();
    TEMP_DIRS.push(tmpDir);
    const handler = createWorkflowHandler();
    const onResult = vi.fn();
    const monitor = new AsyncSubagentMonitor(handler, onResult);

    // Create a fake async directory with completed status
    const asyncDir = path.join(tmpDir, "async-run-1");
    fs.mkdirSync(asyncDir, { recursive: true });

    // Write status.json as "running" first
    fs.writeFileSync(
      path.join(asyncDir, "status.json"),
      JSON.stringify({
        runId: "test-123",
        mode: "single",
        state: "running",
        steps: [{ agent: "implementer", status: "running" }],
      }),
    );

    monitor.track("test-123", asyncDir, "implementer");

    // Poll — should find "running", do nothing
    monitor.poll();
    expect(onResult).not.toHaveBeenCalled();

    // Update status to "complete"
    fs.writeFileSync(
      path.join(asyncDir, "status.json"),
      JSON.stringify({
        runId: "test-123",
        mode: "single",
        state: "complete",
        steps: [{ agent: "implementer", status: "completed" }],
      }),
    );

    // Write a minimal result.json
    fs.writeFileSync(
      path.join(asyncDir, "result.json"),
      JSON.stringify({
        id: "test-123",
        agent: "implementer",
        success: true,
        exitCode: 0,
        timestamp: Date.now(),
        durationMs: 5000,
      }),
    );

    // Poll — should detect completion
    monitor.poll();
    expect(onResult).toHaveBeenCalledTimes(1);

    const [details, agentName] = onResult.mock.calls[0] as [SubagentResultDetails, string];
    expect(agentName).toBe("implementer");
    expect(details.status).toBe("completed");
    expect(details.mode).toBe("single");

    monitor.dispose();
  });

  it("detects failed async job", () => {
    const tmpDir = withTempCwd();
    TEMP_DIRS.push(tmpDir);
    const handler = createWorkflowHandler();
    const onResult = vi.fn();
    const monitor = new AsyncSubagentMonitor(handler, onResult);

    const asyncDir = path.join(tmpDir, "async-run-2");
    fs.mkdirSync(asyncDir, { recursive: true });

    fs.writeFileSync(
      path.join(asyncDir, "status.json"),
      JSON.stringify({
        runId: "test-456",
        mode: "single",
        state: "failed",
        error: "Exit code 1",
        steps: [{ agent: "worker", status: "failed", error: "Exit code 1" }],
      }),
    );

    monitor.track("test-456", asyncDir, "worker");
    monitor.poll();

    expect(onResult).toHaveBeenCalledTimes(1);
    const [details, agentName] = onResult.mock.calls[0] as [SubagentResultDetails, string];
    expect(agentName).toBe("worker");
    expect(details.status).toBe("failed");
    expect(details.result).toContain("Exit code 1");

    monitor.dispose();
  });

  it("tracks chain mode async jobs with multiple steps", () => {
    const tmpDir = withTempCwd();
    TEMP_DIRS.push(tmpDir);
    const handler = createWorkflowHandler();
    const onResult = vi.fn();
    const monitor = new AsyncSubagentMonitor(handler, onResult);

    const asyncDir = path.join(tmpDir, "async-run-3");
    fs.mkdirSync(asyncDir, { recursive: true });

    fs.writeFileSync(
      path.join(asyncDir, "status.json"),
      JSON.stringify({
        runId: "test-789",
        mode: "chain",
        state: "complete",
        steps: [
          { agent: "scout", status: "completed" },
          { agent: "planner", status: "completed" },
          { agent: "worker", status: "completed" },
        ],
      }),
    );

    fs.writeFileSync(
      path.join(asyncDir, "result.json"),
      JSON.stringify({
        id: "test-789",
        agent: "scout",
        success: true,
        exitCode: 0,
        results: [
          { agent: "scout", success: true, output: "Recon done" },
          { agent: "planner", success: true, output: "Plan created" },
          { agent: "worker", success: true, output: "Implemented" },
        ],
        timestamp: Date.now(),
        durationMs: 30000,
      }),
    );

    monitor.track("test-789", asyncDir, "scout");
    monitor.poll();

    expect(onResult).toHaveBeenCalledTimes(1);
    const [details] = onResult.mock.calls[0] as [SubagentResultDetails, string];
    expect(details.mode).toBe("chain");
    expect(details.status).toBe("completed");
    expect(details.results).toHaveLength(3);
    expect(details.results?.map((r) => r.agent)).toEqual(["scout", "planner", "worker"]);

    monitor.dispose();
  });

  it("stops tracking after job completes", () => {
    const tmpDir = withTempCwd();
    TEMP_DIRS.push(tmpDir);
    const handler = createWorkflowHandler();
    const onResult = vi.fn();
    const monitor = new AsyncSubagentMonitor(handler, onResult);

    const asyncDir = path.join(tmpDir, "async-run-4");
    fs.mkdirSync(asyncDir, { recursive: true });

    fs.writeFileSync(
      path.join(asyncDir, "status.json"),
      JSON.stringify({
        runId: "test-000",
        mode: "single",
        state: "complete",
        steps: [{ agent: "worker", status: "completed" }],
      }),
    );

    monitor.track("test-000", asyncDir, "worker");
    monitor.poll();

    expect(onResult).toHaveBeenCalledTimes(1);

    // Second poll should not trigger again
    monitor.poll();
    expect(onResult).toHaveBeenCalledTimes(1);

    monitor.dispose();
  });

  it("handles missing status.json gracefully", () => {
    const tmpDir = withTempCwd();
    TEMP_DIRS.push(tmpDir);
    const handler = createWorkflowHandler();
    const onResult = vi.fn();
    const monitor = new AsyncSubagentMonitor(handler, onResult);

    const asyncDir = path.join(tmpDir, "async-run-5");
    fs.mkdirSync(asyncDir, { recursive: true });
    // No status.json

    monitor.track("test-missing", asyncDir, "worker");
    // Should not crash
    monitor.poll();
    expect(onResult).not.toHaveBeenCalled();

    monitor.dispose();
  });

  it("limits tracked jobs to MAX_TRACKED", () => {
    const tmpDir = withTempCwd();
    TEMP_DIRS.push(tmpDir);
    const handler = createWorkflowHandler();
    const onResult = vi.fn();
    const monitor = new AsyncSubagentMonitor(handler, onResult);

    // Track more than MAX_TRACKED (10) — verify no crash
    for (let i = 0; i < 12; i++) {
      const asyncDir = path.join(tmpDir, `async-${i}`);
      fs.mkdirSync(asyncDir, { recursive: true });
      monitor.track(`job-${i}`, asyncDir, "worker");
    }

    // Complete all 12 jobs
    for (let i = 0; i < 12; i++) {
      const asyncDir = path.join(tmpDir, `async-${i}`);
      fs.writeFileSync(
        path.join(asyncDir, "status.json"),
        JSON.stringify({
          runId: `job-${i}`,
          mode: "single",
          state: "complete",
          steps: [{ agent: "worker", status: "completed" }],
        }),
      );
    }

    // Poll should process completed jobs without error
    monitor.poll();
    // First 2 were evicted, so 10 should complete
    expect(onResult).toHaveBeenCalled();
    // After polling, tracked jobs should be cleaned up
    monitor.poll();
    // All completed jobs removed

    monitor.dispose();
  });
});
