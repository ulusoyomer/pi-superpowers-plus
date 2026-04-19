/**
 * Async subagent result monitor.
 *
 * When pi-subagents dispatches a subagent in async mode, the tool_result
 * returns immediately with { asyncId, asyncDir }. The actual result is
 * written to `asyncDir/status.json` and `asyncDir/result.json` when done.
 *
 * This module watches those directories and feeds completed results into
 * the workflow monitor via the handler.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { log } from "../logging.js";
import type { SubagentResultDetails, WorkflowHandler } from "./workflow-handler.js";

/** Tracked async subagent job */
interface TrackedAsyncJob {
  asyncId: string;
  asyncDir: string;
  agentName: string;
  startedAt: number;
}

/** Result structure written by pi-subagents to result.json */
interface AsyncResultFile {
  id: string;
  agent?: string;
  success: boolean;
  summary?: string;
  results?: Array<{
    agent?: string;
    output?: string;
    success: boolean;
    model?: string;
    artifactPaths?: unknown;
    truncated?: boolean;
  }>;
  exitCode: number;
  timestamp: number;
  durationMs: number;
  cwd?: string;
  sessionFile?: string;
}

/** Status structure written by pi-subagents to status.json */
interface AsyncStatusFile {
  runId: string;
  mode: "single" | "chain";
  state: "queued" | "running" | "complete" | "failed";
  steps?: Array<{
    agent: string;
    status: string;
    durationMs?: number;
    model?: string;
    error?: string;
  }>;
  error?: string;
}

export class AsyncSubagentMonitor {
  private trackedJobs = new Map<string, TrackedAsyncJob>();
  private poller: ReturnType<typeof setInterval> | null = null;
  private readonly POLL_INTERVAL_MS = 3000;
  private readonly MAX_TRACKED = 10;
  private readonly RESULT_CLEANUP_MS = 30_000;

  constructor(
    private handler: WorkflowHandler,
    private onResult: (details: SubagentResultDetails, agentName: string) => void,
  ) {}

  /**
   * Start tracking an async subagent job.
   * Called when tool_result for "subagent" contains asyncId + asyncDir.
   */
  track(asyncId: string, asyncDir: string, agentName: string): void {
    // Limit tracked jobs
    if (this.trackedJobs.size >= this.MAX_TRACKED) {
      const oldest = Array.from(this.trackedJobs.entries())[0];
      if (oldest) this.trackedJobs.delete(oldest[0]);
    }

    this.trackedJobs.set(asyncId, {
      asyncId,
      asyncDir,
      agentName,
      startedAt: Date.now(),
    });

    log.debug(`AsyncSubagentMonitor: tracking ${asyncId} (${agentName}) at ${asyncDir}`);
    this.ensurePoller();
  }

  /** Stop all tracking and clean up */
  dispose(): void {
    if (this.poller) {
      clearInterval(this.poller);
      this.poller = null;
    }
    this.trackedJobs.clear();
  }

  private ensurePoller(): void {
    if (this.poller) return;

    this.poller = setInterval(() => this.poll(), this.POLL_INTERVAL_MS);
    this.poller.unref?.();
  }

  /** Poll tracked async jobs for completion. Public for testing. */
  poll(): void {
    if (this.trackedJobs.size === 0) {
      if (this.poller) {
        clearInterval(this.poller);
        this.poller = null;
      }
      return;
    }

    for (const [asyncId, job] of this.trackedJobs) {
      try {
        const status = this.readStatus(job.asyncDir);
        if (!status || (status.state !== "complete" && status.state !== "failed")) {
          continue;
        }

        // Job completed — read result and process
        log.debug(`AsyncSubagentMonitor: ${asyncId} ${status.state}`);
        const result = this.readResult(job.asyncDir);

        if (result) {
          const details = this.convertToDetails(status, result);
          this.handler.handleSubagentResult(details);
          this.onResult(details, job.agentName);
        } else {
          // No result file — use status info
          const details = this.buildDetailsFromStatus(status, job);
          this.handler.handleSubagentResult(details);
          this.onResult(details, job.agentName);
        }

        this.trackedJobs.delete(asyncId);

        // Schedule cleanup of async dir
        this.scheduleCleanup(job.asyncDir);
      } catch (err) {
        log.debug(`AsyncSubagentMonitor: error polling ${asyncId}: ${err instanceof Error ? err.message : err}`);
      }
    }

    // Stop poller if nothing left
    if (this.trackedJobs.size === 0 && this.poller) {
      clearInterval(this.poller);
      this.poller = null;
    }
  }

  private readStatus(asyncDir: string): AsyncStatusFile | null {
    const statusPath = path.join(asyncDir, "status.json");
    try {
      if (!fs.existsSync(statusPath)) return null;
      return JSON.parse(fs.readFileSync(statusPath, "utf-8")) as AsyncStatusFile;
    } catch {
      return null;
    }
  }

  private readResult(asyncDir: string): AsyncResultFile | null {
    // pi-subagents writes result to resultPath specified in config
    // The result file is next to the status file or at a configurable path
    const candidates = [
      path.join(asyncDir, "result.json"),
      // Check for result-*.json files
      ...this.findResultFiles(asyncDir),
    ];

    for (const candidate of candidates) {
      try {
        if (fs.existsSync(candidate)) {
          return JSON.parse(fs.readFileSync(candidate, "utf-8")) as AsyncResultFile;
        }
      } catch {}
    }
    return null;
  }

  private findResultFiles(asyncDir: string): string[] {
    try {
      return fs
        .readdirSync(asyncDir)
        .filter((f) => f.startsWith("result") && f.endsWith(".json"))
        .map((f) => path.join(asyncDir, f));
    } catch {
      return [];
    }
  }

  private convertToDetails(status: AsyncStatusFile, result: AsyncResultFile): SubagentResultDetails {
    const filesChanged: string[] = [];
    let testsRan = false;

    // Extract from result
    if (result.results) {
      for (const r of result.results) {
        // Parse output for filesChanged and testsRan if available
        if (r.output) {
          const parsed = this.parseOutputMetadata(r.output);
          filesChanged.push(...parsed.filesChanged);
          if (parsed.testsRan) testsRan = true;
        }
      }
    }

    return {
      mode: status.mode,
      status: result.success ? "completed" : "failed",
      agent: result.agent ?? status.steps?.[0]?.agent,
      result: result.summary,
      filesChanged,
      testsRan,
      tddViolations: 0,
      results:
        status.steps?.map((step, _i) => ({
          agent: step.agent,
          exitCode: step.status === "failed" ? 1 : 0,
        })) ?? [],
    };
  }

  private buildDetailsFromStatus(status: AsyncStatusFile, job: TrackedAsyncJob): SubagentResultDetails {
    return {
      mode: status.mode,
      status: status.state === "complete" ? "completed" : "failed",
      agent: job.agentName,
      result: status.error ?? `Async subagent ${status.state}`,
      filesChanged: [],
      testsRan: false,
      tddViolations: 0,
      results:
        status.steps?.map((step) => ({
          agent: step.agent,
          exitCode: step.status === "failed" ? 1 : 0,
        })) ?? [],
    };
  }

  /** Extract metadata from subagent output text */
  private parseOutputMetadata(output: string): { filesChanged: string[]; testsRan: boolean } {
    const filesChanged: string[] = [];
    let testsRan = false;

    // Look for file paths in common patterns
    const filePatterns = [/^Files changed:\s*(.+)$/m, /^Changed files:\s*(.+)$/m];
    for (const p of filePatterns) {
      const match = p.exec(output);
      if (match?.[1]) {
        filesChanged.push(
          ...match[1]
            .split(",")
            .map((f) => f.trim())
            .filter(Boolean),
        );
      }
    }

    // Detect test runs
    if (/\b(vitest|pytest|jest|npm test|pnpm test)\b/i.test(output)) {
      testsRan = true;
    }

    return { filesChanged, testsRan };
  }

  private scheduleCleanup(asyncDir: string): void {
    setTimeout(() => {
      try {
        if (fs.existsSync(asyncDir)) {
          fs.rmSync(asyncDir, { recursive: true, force: true });
        }
      } catch (err) {
        log.debug(`AsyncSubagentMonitor: cleanup failed for ${asyncDir}: ${err instanceof Error ? err.message : err}`);
      }
    }, this.RESULT_CLEANUP_MS);
  }
}
