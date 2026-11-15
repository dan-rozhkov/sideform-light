import { describe, expect, it } from "vitest";
import { toolHandlers } from "../toolRegistry";

const EXPECTED = [
  "analyze_image",
  "ask_user",
  "browse_act",
  "browse_agent",
  "browse_fill_login",
  "browse_find_images",
  "browse_open",
  "browse_read",
  "browse_screenshot",
  "browse_snapshot",
  "browse_tabs",
  "browse_task",
  "qa_assert",
  "qa_verdict",
  "schedule_create",
  "schedule_list",
  "trace_frame",
  "trace_list",
  "trace_read",
];

describe("toolRegistry", () => {
  it("handles exactly the browser-assistant tools", () => {
    expect(Object.keys(toolHandlers).sort()).toEqual(EXPECTED);
  });

  it("only handles ask_user, schedule_*, analyze_image, browse_*, qa_* and trace_* (no canvas, doc, workflow or design tool)", () => {
    for (const name of Object.keys(toolHandlers)) {
      expect(name, name).toMatch(/^(ask_user|schedule_(?:create|list)|analyze_image|browse_[a-z_]+|qa_[a-z_]+|trace_[a-z_]+)$/);
    }
  });

  it("has no browse_capture and no trace_open handler", () => {
    expect(toolHandlers).not.toHaveProperty("browse_capture");
    expect(toolHandlers).not.toHaveProperty("trace_open");
  });

  it("refuses qa_* calls made outside a browse_agent run", async () => {
    for (const name of ["qa_assert", "qa_verdict"]) {
      expect(JSON.parse(await toolHandlers[name]({}))).toEqual({ error: expect.stringContaining("only available inside a browse_agent QA run") });
    }
  });
});
