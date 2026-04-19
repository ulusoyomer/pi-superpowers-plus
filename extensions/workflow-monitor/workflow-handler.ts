import type { SessionEntry } from "@mariozechner/pi-coding-agent";
import { DebugMonitor, type DebugViolation } from "./debug-monitor";
import { isSourceFile } from "./heuristics";
import { isInvestigationCommand, isInvestigationToolCall } from "./investigation";
import { TddMonitor, type TddPhase, type TddViolation } from "./tdd-monitor";
import { parseTestCommand, parseTestResult } from "./test-runner";
import { VerificationMonitor, type VerificationViolation } from "./verification-monitor";
import { type Phase, type PhaseStatus, WorkflowTracker, type WorkflowTrackerState } from "./workflow-tracker";

export type Violation = TddViolation | DebugViolation;

export interface ToolCallResult {
  violation: Violation | null;
}

export interface SuperpowersStateSnapshot {
  workflow: WorkflowTrackerState;
  tdd: {
    phase: TddPhase;
    testFiles: string[];
    sourceFiles: string[];
    redVerificationPending: boolean;
  };
  debug: {
    active: boolean;
    investigated: boolean;
    fixAttempts: number;
  };
  verification: {
    verified: boolean;
    verificationWaived: boolean;
  };
}

export type SuperpowersStatePatch = {
  workflow?: Partial<WorkflowTrackerState> & {
    phases?: Partial<Record<Phase, PhaseStatus>>;
    artifacts?: Partial<Record<Phase, string | null>>;
    prompted?: Partial<Record<Phase, boolean>>;
  };
  tdd?: Partial<SuperpowersStateSnapshot["tdd"]>;
  debug?: Partial<SuperpowersStateSnapshot["debug"]>;
  verification?: Partial<SuperpowersStateSnapshot["verification"]>;
};

export const TDD_DEFAULTS = {
  phase: "idle" as TddPhase,
  testFiles: [] as string[],
  sourceFiles: [] as string[],
  redVerificationPending: false,
};

export const DEBUG_DEFAULTS = {
  active: false,
  investigated: false,
  fixAttempts: 0,
};

export const VERIFICATION_DEFAULTS = {
  verified: false,
  verificationWaived: false,
};

/** Result details from pi-subagents extension */
export interface SubagentResultDetails {
  mode?: "single" | "parallel" | "chain" | "management";
  status?: "completed" | "failed";
  agent?: string;
  task?: string;
  result?: string;
  filesChanged?: string[];
  testsRan?: boolean;
  tddViolations?: number;
  /** Per-step results in chain/parallel mode */
  results?: Array<{
    agent?: string;
    exitCode?: number;
    filesChanged?: string[];
    testsRan?: boolean;
    tddViolations?: number;
  }>;
}

export interface SubagentHandleResult {
  /** Number of TDD violations imported from subagent */
  tddViolationCount: number;
  /** Number of files tracked */
  filesTracked: number;
  /** Whether subagent ran tests */
  testsRan: boolean;
  /** Whether subagent failed */
  failed: boolean;
  /** Agent name(s) for reporting */
  agentNames: string[];
}

export interface WorkflowHandler {
  handleToolCall(toolName: string, input: Record<string, unknown>): ToolCallResult;
  handleReadOrInvestigation(toolName: string, path: string): void;
  handleBashResult(command: string, output: string, exitCode: number | undefined): void;
  /** Process subagent results from pi-subagents and feed into TDD/debug/workflow monitors */
  handleSubagentResult(details: SubagentResultDetails): SubagentHandleResult;
  isDebugActive(): boolean;
  getDebugFixAttempts(): number;
  getTddPhase(): string;
  getWidgetText(): string;
  getTddState(): ReturnType<TddMonitor["getState"]>;
  checkCommitGate(command: string): VerificationViolation | null;
  recordVerificationWaiver(): void;
  restoreTddState(phase: TddPhase, testFiles: string[], sourceFiles: string[], redVerificationPending?: boolean): void;
  handleInputText(text: string): boolean;
  handleFileWritten(path: string): boolean;
  handlePlanTrackerToolCall(input: Record<string, unknown>): boolean;
  getWorkflowState(): WorkflowTrackerState | null;
  getFullState(): SuperpowersStateSnapshot;
  setFullState(snapshot: SuperpowersStatePatch): void;
  restoreWorkflowStateFromBranch(branch: SessionEntry[]): void;
  markWorkflowPrompted(phase: Phase): boolean;
  completeCurrentWorkflowPhase(): boolean;
  advanceWorkflowTo(phase: Phase): boolean;
  skipWorkflowPhases(phases: Phase[]): boolean;
  handleSkillFileRead(path: string): boolean;
  resetState(): void;
}

export function createWorkflowHandler(): WorkflowHandler {
  const tdd = new TddMonitor();
  const debug = new DebugMonitor();
  const verification = new VerificationMonitor();
  const tracker = new WorkflowTracker();
  let debugFailStreak = 0;

  return {
    handleToolCall(toolName: string, input: Record<string, unknown>): ToolCallResult {
      // Track investigation from tool calls (LSP, kota, web search)
      if (isInvestigationToolCall(toolName, input)) {
        debug.onInvestigation();
      }

      if (toolName === "write" || toolName === "edit") {
        const path = input.path as string | undefined;
        if (path) {
          if (isSourceFile(path)) {
            verification.onSourceWritten();
          }

          // Debug violations take precedence, and when debug is active we don't
          // additionally enforce TDD write-order violations.
          if (debug.isActive() && isSourceFile(path)) {
            const debugViolation = debug.onSourceWritten(path);
            return { violation: debugViolation };
          }

          const tddViolation = tdd.onFileWritten(path);
          return { violation: tddViolation };
        }
      }
      return { violation: null };
    },

    handleReadOrInvestigation(toolName: string, _path: string): void {
      if (toolName === "read") {
        debug.onInvestigation();
      }
    },

    handleBashResult(command: string, output: string, exitCode: number | undefined): void {
      if (isInvestigationCommand(command)) {
        debug.onInvestigation();
      }

      if (/\bgit\s+commit\b/.test(command)) {
        debugFailStreak = 0;
        tdd.onCommit();
        debug.onCommit();
        return;
      }

      if (parseTestCommand(command)) {
        const passed = parseTestResult(output, exitCode);
        if (passed !== null) {
          if (passed) {
            verification.recordVerification();
          } else {
            verification.reset();
          }

          const excludeFromDebug = !passed && tdd.getPhase() === "red-pending";

          tdd.onTestResult(passed);

          if (passed) {
            debugFailStreak = 0;
            debug.onTestPassed();
          } else if (!excludeFromDebug) {
            debugFailStreak += 1;
            const tddPhase = tdd.getPhase();
            if (debugFailStreak >= 2 && tddPhase === "idle") {
              debug.onTestFailed();
            }
          }
        }
      }
    },

    handleSubagentResult(details: SubagentResultDetails): SubagentHandleResult {
      let tddViolationCount = 0;
      let filesTracked = 0;
      let testsRan = false;
      let failed = false;
      const agentNames: string[] = [];

      // Process single mode result
      const processFiles = (files: string[]) => {
        for (const file of files) {
          tracker.onFileWritten(file);
          // Feed into TDD monitor — subagent file writes count
          const tddViolation = tdd.onFileWritten(file);
          if (tddViolation) {
            tddViolationCount++;
          }
          // Feed into debug monitor — subagent source writes count as fix attempts
          if (debug.isActive() && isSourceFile(file)) {
            debug.onSourceWritten(file);
          }
          filesTracked++;
        }
      };

      // Collect from top-level or per-step results
      const allFiles = details.filesChanged ?? [];
      processFiles(allFiles);

      // Process chain/parallel step results
      if (details.results && details.results.length > 0) {
        for (const step of details.results) {
          if (step.agent) agentNames.push(step.agent);
          if (step.filesChanged) processFiles(step.filesChanged);
          if (step.testsRan) testsRan = true;
          tddViolationCount += step.tddViolations ?? 0;
          if (step.exitCode !== undefined && step.exitCode !== 0) failed = true;
        }
      }

      // Top-level fields
      if (details.agent) agentNames.push(details.agent);
      if (details.testsRan) testsRan = true;
      tddViolationCount += details.tddViolations ?? 0;

      // Failed status
      if (details.status === "failed") failed = true;

      // If subagent ran tests and they passed, update verification
      if (testsRan) {
        verification.recordVerification();
      }

      // If subagent had TDD violations, nudge the TDD state machine
      // to reflect that source was written (it went through onFileWritten above)
      // The violations are already counted; the TDD monitor state reflects them.

      return { tddViolationCount, filesTracked, testsRan, failed, agentNames };
    },

    isDebugActive(): boolean {
      return debug.isActive();
    },

    getDebugFixAttempts(): number {
      return debug.getFixAttempts();
    },

    getTddPhase(): string {
      return tdd.getPhase();
    },

    getWidgetText(): string {
      const parts: string[] = [];

      const phase = tdd.getPhase();
      if (phase !== "idle") {
        parts.push(`TDD: ${phase.toUpperCase()}`);
      }

      if (debug.isActive()) {
        parts.push("Debug: ACTIVE");
      }

      return parts.join(" | ");
    },

    getTddState() {
      return tdd.getState();
    },

    checkCommitGate(command: string) {
      return verification.checkCommitGate(command);
    },

    recordVerificationWaiver() {
      verification.recordVerificationWaiver();
    },

    restoreTddState(phase: TddPhase, testFiles: string[], sourceFiles: string[], redVerificationPending = false) {
      tdd.setState(phase, testFiles, sourceFiles, redVerificationPending);
    },

    handleInputText(text: string) {
      return tracker.onInputText(text);
    },

    handleFileWritten(path: string) {
      return tracker.onFileWritten(path);
    },

    handlePlanTrackerToolCall(input: Record<string, unknown>) {
      if (input.action === "init") {
        return tracker.onPlanTrackerInit();
      }
      return false;
    },

    getWorkflowState() {
      return tracker.getState();
    },

    getFullState() {
      return {
        workflow: tracker.getState(),
        tdd: tdd.getState(),
        debug: debug.getState(),
        verification: verification.getState(),
      };
    },

    setFullState(snapshot: SuperpowersStatePatch) {
      if (snapshot.workflow) {
        const defaultWorkflow = new WorkflowTracker().getState();
        tracker.setState({
          ...defaultWorkflow,
          ...snapshot.workflow,
          phases: { ...defaultWorkflow.phases, ...snapshot.workflow.phases },
          artifacts: { ...defaultWorkflow.artifacts, ...snapshot.workflow.artifacts },
          prompted: { ...defaultWorkflow.prompted, ...snapshot.workflow.prompted },
        });
      }
      if (snapshot.tdd) {
        const tddState = { ...TDD_DEFAULTS, ...snapshot.tdd };
        tdd.setState(tddState.phase, tddState.testFiles, tddState.sourceFiles, tddState.redVerificationPending);
      }
      if (snapshot.debug) {
        debug.setState({ ...DEBUG_DEFAULTS, ...snapshot.debug });
      }
      if (snapshot.verification) {
        verification.setState({ ...VERIFICATION_DEFAULTS, ...snapshot.verification });
      }
      debugFailStreak = 0;
    },

    restoreWorkflowStateFromBranch(branch: SessionEntry[]) {
      const state = WorkflowTracker.reconstructFromBranch(branch);
      if (state) {
        tracker.setState(state);
      }
    },

    markWorkflowPrompted(phase: Phase) {
      return tracker.markPrompted(phase);
    },

    completeCurrentWorkflowPhase() {
      return tracker.completeCurrent();
    },

    advanceWorkflowTo(phase) {
      return tracker.advanceTo(phase);
    },

    skipWorkflowPhases(phases) {
      return tracker.skipPhases(phases);
    },

    handleSkillFileRead(path: string) {
      return tracker.onSkillFileRead(path);
    },

    resetState() {
      const freshState: SuperpowersStateSnapshot = {
        workflow: new WorkflowTracker().getState(),
        tdd: { ...TDD_DEFAULTS, testFiles: [], sourceFiles: [] },
        debug: { ...DEBUG_DEFAULTS },
        verification: { ...VERIFICATION_DEFAULTS },
      };

      tracker.setState(freshState.workflow);
      tdd.setState(
        freshState.tdd.phase,
        freshState.tdd.testFiles,
        freshState.tdd.sourceFiles,
        freshState.tdd.redVerificationPending,
      );
      debug.setState(freshState.debug);
      verification.setState(freshState.verification);
      debugFailStreak = 0;
    },
  };
}
