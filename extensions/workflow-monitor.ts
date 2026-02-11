/**
 * Workflow Monitor Extension
 *
 * Observes tool_call and tool_result events to:
 * - Track TDD phase (RED→GREEN→REFACTOR) and inject warnings on violations
 * - Track debug fix-fail cycles and inject warnings on investigation skips / thrashing
 * - Show workflow state in TUI widget
 * - Register workflow_reference tool for on-demand reference content
 */

import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { StringEnum } from "@mariozechner/pi-ai";
import { Text } from "@mariozechner/pi-tui";
import { createWorkflowHandler, type Violation } from "./workflow-monitor/workflow-handler";
import { type VerificationViolation } from "./workflow-monitor/verification-monitor";
import { getTddViolationWarning } from "./workflow-monitor/warnings";
import {
  getDebugViolationWarning,
  getVerificationViolationWarning,
  type DebugViolationType,
} from "./workflow-monitor/warnings";
import { loadReference, REFERENCE_TOPICS } from "./workflow-monitor/reference-tool";
import {
  WORKFLOW_PHASES,
  WORKFLOW_TRACKER_ENTRY_TYPE,
  computeBoundaryToPrompt,
  type TransitionBoundary,
  type WorkflowTrackerState,
} from "./workflow-monitor/workflow-tracker";
import { getTransitionPrompt } from "./workflow-monitor/workflow-transitions";

export default function (pi: ExtensionAPI) {
  const handler = createWorkflowHandler();

  // Pending violation: set during tool_call, injected during tool_result.
  // Scoped here because tool_call and tool_result fire sequentially per call.
  let pendingViolation: Violation | null = null;
  let pendingVerificationViolation: VerificationViolation | null = null;

  const persistWorkflowState = () => {
    pi.appendEntry(WORKFLOW_TRACKER_ENTRY_TYPE, handler.getWorkflowState());
  };

  const phaseToSkill: Record<string, string> = {
    brainstorm: "brainstorming",
    plan: "writing-plans",
    execute: "executing-plans",
    verify: "verification-before-completion",
    review: "requesting-code-review",
    finish: "finishing-a-development-branch",
  };

  const boundaryToPhase: Record<TransitionBoundary, keyof typeof phaseToSkill> = {
    design_committed: "brainstorm",
    plan_ready: "plan",
    execution_complete: "execute",
    verification_passed: "verify",
    review_complete: "review",
  };

  // --- State reconstruction on session events ---
  for (const event of [
    "session_start",
    "session_switch",
    "session_fork",
    "session_tree",
  ] as const) {
    pi.on(event, async (_event, ctx) => {
      handler.resetState();
      handler.restoreWorkflowStateFromBranch(ctx.sessionManager.getBranch());
      pendingViolation = null;
      pendingVerificationViolation = null;
      updateWidget(ctx);
    });
  }

  // --- Input observation (skill detection) ---
  pi.on("input", async (event, ctx) => {
    if (event.source === "extension") return;
    const text = (event.input as string | undefined) ?? "";
    if (handler.handleInputText(text)) {
      persistWorkflowState();
      updateWidget(ctx);
    }
  });

  // --- Tool call observation (detect file writes + verification gate) ---
  pi.on("tool_call", async (event, ctx) => {
    if (event.toolName === "bash") {
      const command = ((event.input as Record<string, any>).command as string | undefined) ?? "";
      const verificationViolation = handler.checkCommitGate(command);
      if (verificationViolation) {
        pendingVerificationViolation = verificationViolation;
      }
    }

    const input = event.input as Record<string, any>;
    const result = handler.handleToolCall(event.toolName, input);
    pendingViolation = result.violation;

    let changed = false;

    if (event.toolName === "write" || event.toolName === "edit") {
      const path = input.path as string | undefined;
      if (path) {
        changed = handler.handleFileWritten(path) || changed;
      }
    }

    if (event.toolName === "plan_tracker") {
      changed = handler.handlePlanTrackerToolCall(input) || changed;
    }

    if (changed) {
      persistWorkflowState();
      updateWidget(ctx);
    }
  });

  // --- Tool result modification (inject warnings + track investigation) ---
  pi.on("tool_result", async (event, ctx) => {
    // Handle read tool as investigation signal
    if (event.toolName === "read") {
      const path = (event.input as Record<string, any>).path as string ?? "";
      handler.handleReadOrInvestigation("read", path);
    }

    // Inject violation warning on write/edit
    if ((event.toolName === "write" || event.toolName === "edit") && pendingViolation) {
      const violation = pendingViolation;
      pendingViolation = null;
      const warning = formatViolationWarning(violation);
      const existingText = event.content
        .filter((c): c is { type: "text"; text: string } => c.type === "text")
        .map((c) => c.text)
        .join("\n");
      updateWidget(ctx);
      return {
        content: [{ type: "text", text: `${existingText}\n\n${warning}` }],
      };
    }
    pendingViolation = null;

    // Handle bash results (test runs, commits, investigation)
    if (event.toolName === "bash") {
      const command = (event.input as Record<string, any>).command as string ?? "";
      const output = event.content
        .filter((c): c is { type: "text"; text: string } => c.type === "text")
        .map((c) => c.text)
        .join("\n");
      const exitCode = (event.details as any)?.exitCode as number | undefined;
      handler.handleBashResult(command, output, exitCode);

      if (pendingVerificationViolation) {
        const violation = pendingVerificationViolation;
        pendingVerificationViolation = null;
        const warning = getVerificationViolationWarning(violation.type, violation.command);
        const existingText = event.content
          .filter((c): c is { type: "text"; text: string } => c.type === "text")
          .map((c) => c.text)
          .join("\n");
        updateWidget(ctx);
        return {
          content: [{ type: "text", text: `${existingText}\n\n${warning}` }],
        };
      }
    }

    pendingVerificationViolation = null;
    updateWidget(ctx);
    return undefined;
  });

  // --- Boundary prompting at natural handoff points ---
  pi.on("agent_end", async (_event, ctx) => {
    if (!ctx.hasUI) return;

    const state = handler.getWorkflowState();
    if (!state) return;

    let changed = false;
    if (state.currentPhase && state.phases[state.currentPhase] === "active") {
      changed = handler.completeCurrentWorkflowPhase() || changed;
    }

    const latestState = handler.getWorkflowState();
    if (!latestState) return;

    const boundary = computeBoundaryToPrompt(latestState);
    if (!boundary) {
      if (changed) {
        persistWorkflowState();
        updateWidget(ctx);
      }
      return;
    }

    const boundaryPhase = boundaryToPhase[boundary];
    const prompt = getTransitionPrompt(boundary, latestState.artifacts[boundaryPhase]);

    const options = prompt.options.map((o) => ({ label: o.label, value: o.choice }));
    const result = await ctx.ui.select(prompt.title, options as any);

    const selected =
      typeof result === "string"
        ? prompt.options.find((o) => o.choice === result || o.label === result)?.choice
        : result?.value ?? result?.choice ?? null;

    const marked = handler.markWorkflowPromptedCurrent();
    if (marked) {
      persistWorkflowState();
      updateWidget(ctx);
    }

    const nextSkill = phaseToSkill[prompt.nextPhase] ?? "writing-plans";
    const nextInSession = `/skill:${nextSkill}`;
    const fresh = `/workflow-next ${prompt.nextPhase}${prompt.artifactPath ? ` ${prompt.artifactPath}` : ""}`;

    if (selected === "next") {
      ctx.ui.setEditorText(nextInSession);
    } else if (selected === "fresh") {
      ctx.ui.setEditorText(fresh);
    } else if (selected === "skip") {
      handler.advanceWorkflowTo(prompt.nextPhase);
      persistWorkflowState();
      updateWidget(ctx);
      ctx.ui.setEditorText(nextInSession);
    }
  });

  // --- Format violation warning based on type ---
  function formatViolationWarning(violation: Violation): string {
    if (violation.type === "source-before-test" || violation.type === "source-during-red") {
      return getTddViolationWarning(violation.type, violation.file);
    }
    return getDebugViolationWarning(
      violation.type as DebugViolationType,
      violation.file,
      "fixAttempts" in violation ? violation.fixAttempts : 0
    );
  }

  function formatPhaseStrip(state: WorkflowTrackerState | null, theme: any): string {
    if (!state?.currentPhase) return "";

    const arrow = theme.fg("dim", " → ");
    return WORKFLOW_PHASES.map((phase) => {
      const status = state.phases[phase];
      if (state.currentPhase === phase) return theme.fg("accent", `[${phase}]`);
      if (status === "complete") return theme.fg("success", `✓${phase}`);
      if (status === "skipped") return theme.fg("dim", `–${phase}`);
      return theme.fg("dim", phase);
    }).join(arrow);
  }

  // --- TUI Widget ---
  function updateWidget(ctx: ExtensionContext) {
    if (!ctx.hasUI) return;

    const tddPhase = handler.getTddPhase().toUpperCase();
    const hasDebug = handler.isDebugActive();
    const workflow = handler.getWorkflowState();
    const hasWorkflow = !!workflow?.currentPhase;

    if (!hasWorkflow && tddPhase === "IDLE" && !hasDebug) {
      ctx.ui.setWidget("workflow_monitor", undefined);
      return;
    }

    ctx.ui.setWidget("workflow_monitor", (_tui, theme) => {
      const parts: string[] = [];

      const phaseStrip = formatPhaseStrip(workflow, theme);
      if (phaseStrip) {
        parts.push(phaseStrip);
      }

      // TDD phase
      if (tddPhase !== "IDLE") {
        const colorMap: Record<string, string> = {
          RED: "error",
          GREEN: "success",
          REFACTOR: "accent",
        };
        parts.push(theme.fg(colorMap[tddPhase] ?? "muted", `TDD: ${tddPhase}`));
      }

      // Debug state
      if (hasDebug) {
        const attempts = handler.getDebugFixAttempts();
        if (attempts >= 3) {
          parts.push(theme.fg("error", `Debug: ${attempts} fix attempts ⚠️`));
        } else if (attempts > 0) {
          parts.push(theme.fg("warning", `Debug: ${attempts} fix attempt${attempts !== 1 ? "s" : ""}`));
        } else {
          parts.push(theme.fg("accent", "Debug: investigating"));
        }
      }

      return parts.length > 0
        ? new Text(parts.join(theme.fg("dim", "  |  ")), 0, 0)
        : undefined;
    });
  }

  pi.registerCommand("workflow-next", {
    description: "Start a fresh session for the next workflow phase (optionally referencing an artifact path)",
    async handler(args, ctx) {
      if (!ctx.hasUI) {
        ctx.ui.notify("workflow-next requires interactive mode", "error");
        return;
      }

      const [phase, artifact] = args.trim().split(/\s+/, 2);
      if (!phase) {
        ctx.ui.notify("Usage: /workflow-next <phase> [artifact-path]", "error");
        return;
      }

      const parentSession = ctx.sessionManager.getSessionFile();
      const res = await ctx.newSession({ parentSession });
      if (res.cancelled) return;

      const lines: string[] = [];
      if (artifact) lines.push(`Continue from artifact: ${artifact}`);

      if (phase === "plan") {
        lines.push("Use /skill:writing-plans to create the implementation plan.");
      } else if (phase === "execute") {
        lines.push("Use /skill:executing-plans (or /skill:subagent-driven-development) to execute the plan.");
      } else if (phase === "verify") {
        lines.push("Use /skill:verification-before-completion to verify before finishing.");
      } else if (phase === "review") {
        lines.push("Use /skill:requesting-code-review to get review.");
      } else if (phase === "finish") {
        lines.push("Use /skill:finishing-a-development-branch to integrate/ship.");
      }

      ctx.ui.setEditorText(lines.join("\n"));
      ctx.ui.notify("New session ready. Submit when ready.", "info");
    },
  });

  // --- Reference Tool ---
  pi.registerTool({
    name: "workflow_reference",
    label: "Workflow Reference",
    description: `Detailed guidance for workflow skills. Topics: ${REFERENCE_TOPICS.join(", ")}`,
    parameters: Type.Object({
      topic: StringEnum(REFERENCE_TOPICS as unknown as readonly [string, ...string[]], {
        description: "Reference topic to load",
      }),
    }),
    async execute(_toolCallId, params) {
      const content = await loadReference(params.topic);
      return {
        content: [{ type: "text", text: content }],
        details: { topic: params.topic },
      };
    },
    renderCall(args, theme) {
      let text = theme.fg("toolTitle", theme.bold("workflow_reference "));
      text += theme.fg("accent", args.topic);
      return new Text(text, 0, 0);
    },
    renderResult(result, _options, theme) {
      const topic = (result.details as any)?.topic ?? "unknown";
      const content = result.content[0];
      const len = content?.type === "text" ? content.text.length : 0;
      return new Text(
        theme.fg("success", "✓ ") + theme.fg("muted", `${topic} (${len} chars)`),
        0,
        0
      );
    },
  });
}
