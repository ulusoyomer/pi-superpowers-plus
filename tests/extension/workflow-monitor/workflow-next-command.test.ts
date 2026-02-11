import { test, expect } from "vitest";
import workflowMonitorExtension from "../../../extensions/workflow-monitor";

test("/workflow-next creates new session and prefills kickoff message", async () => {
  let handler: any;
  const fakePi: any = {
    on() {},
    registerTool() {},
    appendEntry() {},
    registerCommand(_name: string, opts: any) {
      handler = opts.handler;
    },
  };

  workflowMonitorExtension(fakePi);

  const calls: any[] = [];
  const ctx: any = {
    hasUI: true,
    sessionManager: { getSessionFile: () => "/tmp/session.jsonl" },
    ui: {
      setEditorText: (t: string) => calls.push(["setEditorText", t]),
      notify: () => {},
    },
    newSession: async () => ({ cancelled: false }),
  };

  await handler("plan docs/plans/2026-02-10-x-design.md", ctx);

  expect(calls[0][0]).toBe("setEditorText");
  expect(calls[0][1]).toMatch(/Continue from artifact: docs\/plans\/2026-02-10-x-design\.md/);
});
